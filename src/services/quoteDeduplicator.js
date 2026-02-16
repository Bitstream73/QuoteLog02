import gemini from './ai/gemini.js';
import config from '../config/index.js';
import { getDb } from '../config/database.js';
import { embedQuote, queryQuotes } from './vectorDb.js';
import logger from './logger.js';

/**
 * Normalize text for comparison
 */
function normalizeForComparison(text) {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/\.{3}|\u2026/g, ' ')
    .replace(/[^\w\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get words from text
 */
function getWords(text) {
  return normalizeForComparison(text).split(' ').filter(Boolean);
}

/**
 * Word-level containment: what fraction of shorter's words appear in order in longer
 */
function wordContainment(shorter, longer) {
  const wordsShort = getWords(shorter);
  const wordsLong = getWords(longer);
  if (wordsShort.length === 0) return 0;
  if (wordsShort.length > wordsLong.length) return 0;

  let i = 0;
  for (let j = 0; j < wordsLong.length && i < wordsShort.length; j++) {
    if (wordsShort[i] === wordsLong[j]) i++;
  }
  return i / wordsShort.length;
}

/**
 * Ellipsis-aware fragment matching
 */
function ellipsisFragmentMatch(fragment, candidateFull) {
  if (!/\.{3}|\u2026/.test(fragment)) return null;

  const anchors = fragment
    .split(/\.{3}|\u2026/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (anchors.length === 0) return 0;
  const normalizedFull = normalizeForComparison(candidateFull);

  let matched = 0;
  let lastIndex = 0;
  for (const anchor of anchors) {
    const normalized = normalizeForComparison(anchor);
    const idx = normalizedFull.indexOf(normalized, lastIndex);
    if (idx >= 0) {
      matched++;
      lastIndex = idx + normalized.length;
    }
  }
  return matched / anchors.length;
}

/**
 * Bigram containment (asymmetric)
 */
function bigramContainment(shorter, longer) {
  const bigrams = (text) => {
    const words = getWords(text);
    const grams = new Set();
    for (let i = 0; i < words.length - 1; i++) {
      grams.add(words[i] + ' ' + words[i + 1]);
    }
    return grams;
  };

  const gramsA = bigrams(shorter);
  const gramsB = bigrams(longer);
  if (gramsA.size === 0) return 0;

  let overlap = 0;
  for (const g of gramsA) {
    if (gramsB.has(g)) overlap++;
  }
  return overlap / gramsA.size;
}

/**
 * Analyze relationship between two quotes
 */
function analyzeQuotePair(newQuote, candidateQuote) {
  const [shorter, longer] = newQuote.length <= candidateQuote.length
    ? [newQuote, candidateQuote]
    : [candidateQuote, newQuote];

  const containment = wordContainment(shorter, longer);
  const ellipsis = ellipsisFragmentMatch(shorter, longer);
  const bigrams = bigramContainment(shorter, longer);

  if (containment > 0.90) return { action: 'auto_merge', score: containment };
  if (ellipsis !== null && ellipsis > 0.80) return { action: 'auto_merge', score: ellipsis };
  if (containment > 0.75 || bigrams > 0.70) return { action: 'llm_verify', score: containment };
  return { action: 'no_match', score: containment };
}

/**
 * LLM verification for ambiguous dedup cases
 */
async function llmVerifyDuplicate(quoteA, quoteB, speaker) {
  if (!config.geminiApiKey) {
    return { relationship: 'UNRELATED', confidence: 0.5 };
  }

  const prompt = `You are a quote deduplication system. Analyze these two quotes from the same speaker.

Quote A: "${quoteA}"
Quote B: "${quoteB}"
Speaker: ${speaker}

Classify the relationship as EXACTLY ONE of:
- IDENTICAL: Same quote, minor formatting differences only
- SUBSET: One is a fragment/excerpt of the other (with omitted portions)
- PARAPHRASE: Same statement expressed differently
- SAME_TOPIC: About the same subject but different statements
- UNRELATED: Different topics

Return JSON:
{
  "relationship": "IDENTICAL|SUBSET|PARAPHRASE|SAME_TOPIC|UNRELATED",
  "confidence": 0.0 to 1.0,
  "canonical": "A or B (which is more complete)",
  "explanation": "brief reason"
}`;

  try {
    return await gemini.generateJSON(prompt, { temperature: 0.3 });
  } catch (err) {
    logger.error('deduplicator', 'llm_verify_failed', { error: err.message });
    return { relationship: 'UNRELATED', confidence: 0.5 };
  }
}

/**
 * Select the canonical (best) quote from a set
 */
function selectCanonicalQuote(quotes) {
  return quotes.sort((a, b) => {
    // Prefer longer (more complete)
    const lenDiff = b.text.length - a.text.length;
    if (Math.abs(lenDiff) > 20) return lenDiff > 0 ? 1 : -1;
    // Prefer no ellipsis
    const aE = /\.{3}|\u2026/.test(a.text) ? 1 : 0;
    const bE = /\.{3}|\u2026/.test(b.text) ? 1 : 0;
    if (aE !== bE) return aE - bE;
    // Prefer earlier (first seen)
    return new Date(a.first_seen_at) - new Date(b.first_seen_at);
  })[0];
}

/**
 * Find duplicate candidates using vector similarity
 */
async function findDuplicateCandidates(quoteText, personId, db) {
  try {
    // Try vector search if Pinecone is configured
    if (config.pineconeApiKey && config.pineconeIndexHost) {
      const results = await queryQuotes(quoteText, personId, 10);
      return results
        .filter(m => m.score > 0.78)
        .map(m => ({
          id: m.id,
          score: m.score,
          text: m.metadata?.text,
          quoteId: m.metadata?.quote_id,
        }));
    }
  } catch (err) {
    logger.debug('deduplicator', 'vector_search_failed', { error: err.message });
  }

  // Fallback to SQLite text search
  const candidates = db.prepare(`
    SELECT id, text, first_seen_at
    FROM quotes
    WHERE person_id = ? AND canonical_quote_id IS NULL
    ORDER BY created_at DESC
    LIMIT 50
  `).all(personId);

  // Simple similarity check
  const newNormalized = normalizeForComparison(quoteText);
  return candidates
    .map(c => ({
      quoteId: c.id,
      text: c.text,
      score: wordContainment(
        newNormalized.length < normalizeForComparison(c.text).length ? newNormalized : normalizeForComparison(c.text),
        newNormalized.length >= normalizeForComparison(c.text).length ? newNormalized : normalizeForComparison(c.text)
      ),
    }))
    .filter(c => c.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

/**
 * Merge quotes - mark variant and update canonical
 */
function mergeQuotes(canonicalId, variantIds, db) {
  db.transaction(() => {
    // Collect all source URLs
    const canonical = db.prepare('SELECT * FROM quotes WHERE id = ?').get(canonicalId);
    const allUrls = new Set(JSON.parse(canonical.source_urls || '[]'));

    for (const variantId of variantIds) {
      const variant = db.prepare('SELECT * FROM quotes WHERE id = ?').get(variantId);
      JSON.parse(variant.source_urls || '[]').forEach(u => allUrls.add(u));

      // Point variant to canonical
      db.prepare('UPDATE quotes SET canonical_quote_id = ? WHERE id = ?')
        .run(canonicalId, variantId);

      // Record relationship
      db.prepare(`INSERT OR IGNORE INTO quote_relationships
        (quote_id_a, quote_id_b, relationship, confidence, canonical_quote_id)
        VALUES (?, ?, 'subset', 1.0, ?)`)
        .run(canonicalId, variantId, canonicalId);
    }

    // Update canonical with merged source URLs
    db.prepare('UPDATE quotes SET source_urls = ? WHERE id = ?')
      .run(JSON.stringify([...allUrls]), canonicalId);

    // Update person quote count
    db.prepare(`UPDATE persons SET quote_count = (
      SELECT COUNT(*) FROM quotes WHERE person_id = ? AND canonical_quote_id IS NULL
    ) WHERE id = ?`).run(canonical.person_id, canonical.person_id);
  })();
}

/**
 * Main deduplication and insert function
 */
export async function insertAndDeduplicateQuote(quoteData, personId, article, db) {
  const { text, quoteType, context, sourceUrl, rssMetadata, topics, keywords, quoteDate, isVisible, factCheckCategory, factCheckConfidence } = quoteData;

  // Find duplicate candidates
  const candidates = await findDuplicateCandidates(text, personId, db);

  if (candidates.length === 0) {
    // No duplicates - insert new quote
    return insertNewQuote(text, quoteType, context, sourceUrl, personId, article.id, db, rssMetadata, topics, keywords, quoteDate, isVisible, factCheckCategory, factCheckConfidence);
  }

  // Check each candidate
  for (const candidate of candidates) {
    const analysis = analyzeQuotePair(text, candidate.text);

    if (analysis.action === 'auto_merge') {
      // This is a duplicate - add source URL to existing quote
      const existing = db.prepare('SELECT * FROM quotes WHERE id = ?').get(candidate.quoteId);
      const urls = new Set(JSON.parse(existing.source_urls || '[]'));
      urls.add(sourceUrl);

      db.prepare('UPDATE quotes SET source_urls = ? WHERE id = ?')
        .run(JSON.stringify([...urls]), candidate.quoteId);

      // Link to article
      db.prepare('INSERT OR IGNORE INTO quote_articles (quote_id, article_id) VALUES (?, ?)')
        .run(candidate.quoteId, article.id);

      logger.debug('deduplicator', 'merged_duplicate', {
        quoteId: candidate.quoteId,
        score: analysis.score,
      });

      // Return the existing quote data
      const person = db.prepare('SELECT canonical_name FROM persons WHERE id = ?').get(personId);
      return {
        id: candidate.quoteId,
        text: existing.text,
        personId,
        personName: person?.canonical_name,
        sourceUrls: [...urls],
        createdAt: existing.created_at,
        isDuplicate: true,
      };
    }

    if (analysis.action === 'llm_verify') {
      // Use LLM to verify
      const person = db.prepare('SELECT canonical_name FROM persons WHERE id = ?').get(personId);
      const llmResult = await llmVerifyDuplicate(text, candidate.text, person?.canonical_name || 'Unknown');

      if (['IDENTICAL', 'SUBSET'].includes(llmResult.relationship) && llmResult.confidence > 0.7) {
        // Treat as duplicate
        const existing = db.prepare('SELECT * FROM quotes WHERE id = ?').get(candidate.quoteId);
        const urls = new Set(JSON.parse(existing.source_urls || '[]'));
        urls.add(sourceUrl);

        db.prepare('UPDATE quotes SET source_urls = ? WHERE id = ?')
          .run(JSON.stringify([...urls]), candidate.quoteId);

        db.prepare('INSERT OR IGNORE INTO quote_articles (quote_id, article_id) VALUES (?, ?)')
          .run(candidate.quoteId, article.id);

        // Record the relationship
        db.prepare(`INSERT OR IGNORE INTO quote_relationships
          (quote_id_a, quote_id_b, relationship, confidence, canonical_quote_id)
          VALUES (?, ?, ?, ?, ?)`)
          .run(
            candidate.quoteId,
            candidate.quoteId, // Placeholder - will be updated if new quote inserted
            llmResult.relationship.toLowerCase(),
            llmResult.confidence,
            candidate.quoteId
          );

        logger.debug('deduplicator', 'llm_merged_duplicate', {
          quoteId: candidate.quoteId,
          relationship: llmResult.relationship,
          confidence: llmResult.confidence,
        });

        return {
          id: candidate.quoteId,
          text: existing.text,
          personId,
          personName: person?.canonical_name,
          sourceUrls: [...urls],
          createdAt: existing.created_at,
          isDuplicate: true,
        };
      }
    }
  }

  // No strong duplicate found - insert as new
  return insertNewQuote(text, quoteType, context, sourceUrl, personId, article.id, db, rssMetadata, topics, keywords, quoteDate, isVisible, factCheckCategory, factCheckConfidence);
}

/**
 * Store topics and keywords for a quote
 */
function storeTopicsAndKeywords(quoteId, topics, keywords, db) {
  if (topics && topics.length > 0) {
    const upsertTopic = db.prepare(
      `INSERT INTO topics (name, slug) VALUES (?, ?)
       ON CONFLICT(name) DO NOTHING`
    );
    const getTopic = db.prepare('SELECT id FROM topics WHERE name = ?');
    const linkTopic = db.prepare(
      'INSERT OR IGNORE INTO quote_topics (quote_id, topic_id) VALUES (?, ?)'
    );

    for (const topicName of topics) {
      if (!topicName || typeof topicName !== 'string') continue;
      const trimmed = topicName.trim();
      if (!trimmed) continue;
      const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      upsertTopic.run(trimmed, slug);
      const topic = getTopic.get(trimmed);
      if (topic) {
        linkTopic.run(quoteId, topic.id);
      }
    }
  }

  if (keywords && keywords.length > 0) {
    const upsertKeyword = db.prepare(
      `INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, ?)
       ON CONFLICT(name) DO NOTHING`
    );
    const getKeyword = db.prepare('SELECT id FROM keywords WHERE name = ?');
    const linkKeyword = db.prepare(
      'INSERT OR IGNORE INTO quote_keywords (quote_id, keyword_id) VALUES (?, ?)'
    );

    for (const kw of keywords) {
      if (!kw || typeof kw !== 'string') continue;
      const trimmed = kw.trim();
      if (!trimmed) continue;
      const normalized = trimmed.toLowerCase();
      // Infer keyword type from simple heuristics
      const kwType = inferKeywordType(trimmed);
      upsertKeyword.run(trimmed, normalized, kwType);
      const keyword = getKeyword.get(trimmed);
      if (keyword) {
        linkKeyword.run(quoteId, keyword.id);
      }
    }
  }
}

/**
 * Infer keyword type from the keyword text
 */
function inferKeywordType(keyword) {
  const lower = keyword.toLowerCase();
  // Common patterns for different types
  const orgPatterns = /\b(congress|senate|house|committee|department|agency|fbi|cia|nato|united nations|un|eu|who|imf|nfl|nba|mlb|nhl|court|council|commission|administration|bureau|foundation|institute|association|corporation|inc|llc|party|group)\b/i;
  const locationPatterns = /\b(city|state|country|county|province|region|island|river|mountain|ocean|sea|lake|street|avenue|district|territory|gaza|ukraine|taiwan|israel|russia|china|iran|iraq|syria|afghanistan|north korea)\b/i;
  const eventPatterns = /\b(war|crisis|scandal|election|summit|trial|hearing|investigation|attack|shooting|hurricane|earthquake|pandemic|protest|riot|coup|files|gate|accord|deal|agreement|act)\b/i;
  const legislationPatterns = /\b(act|bill|amendment|law|order|resolution|proposition|regulation|directive|treaty|protocol)\b/i;

  if (orgPatterns.test(keyword)) return 'organization';
  if (locationPatterns.test(keyword)) return 'location';
  if (legislationPatterns.test(keyword) && /^[A-Z]/.test(keyword)) return 'legislation';
  if (eventPatterns.test(keyword)) return 'event';
  // If it looks like a person name (2-3 capitalized words)
  if (/^[A-Z][a-z]+ [A-Z][a-z]+( [A-Z][a-z]+)?$/.test(keyword)) return 'person';
  return 'concept';
}

/**
 * Insert a new quote
 */
function insertNewQuote(text, quoteType, context, sourceUrl, personId, articleId, db, rssMetadata, topics, keywords, quoteDate, isVisible, factCheckCategory, factCheckConfidence) {
  const sourceUrls = JSON.stringify([sourceUrl]);

  const result = db.prepare(`INSERT INTO quotes
    (person_id, text, quote_type, context, source_urls, rss_metadata, quote_datetime, is_visible, fact_check_category, fact_check_confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(personId, text, quoteType || 'direct', context, sourceUrls, rssMetadata || null, quoteDate || null, isVisible !== undefined ? isVisible : 1, factCheckCategory || null, factCheckConfidence != null ? factCheckConfidence : null);

  const quoteId = result.lastInsertRowid;

  // Link to article
  db.prepare('INSERT OR IGNORE INTO quote_articles (quote_id, article_id) VALUES (?, ?)')
    .run(quoteId, articleId);

  // Store topics and keywords
  storeTopicsAndKeywords(quoteId, topics, keywords, db);

  // Update person quote count and last seen
  db.prepare(`UPDATE persons SET
    quote_count = quote_count + 1,
    last_seen_at = datetime('now')
    WHERE id = ?`).run(personId);

  // Get person name for response
  const person = db.prepare('SELECT canonical_name FROM persons WHERE id = ?').get(personId);

  logger.debug('deduplicator', 'new_quote_inserted', { quoteId, personId });

  // Try to index in Pinecone (async, don't await) — enriched with context + person name
  if (config.pineconeApiKey && config.pineconeIndexHost) {
    embedQuote(quoteId, text, personId, context, person?.canonical_name).catch(err => {
      logger.debug('deduplicator', 'pinecone_index_failed', { error: err.message });
    });
  }

  return {
    id: quoteId,
    text,
    personId,
    personName: person?.canonical_name,
    sourceUrls: [sourceUrl],
    createdAt: new Date().toISOString(),
    isDuplicate: false,
  };
}

export { storeTopicsAndKeywords };
export default { insertAndDeduplicateQuote, storeTopicsAndKeywords };
