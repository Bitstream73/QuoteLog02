import { getDb } from '../config/database.js';
import gemini from './ai/gemini.js';
import { queryQuotes, searchQuotes } from './vectorDb.js';
import logger from './logger.js';

const MODEL_VERSION = 'gemini-2.5-flash-v1';

/**
 * Analyze a quote's claims with AI, gathering evidence from internal data + Gemini knowledge.
 * Results are cached for 7 days.
 */
export async function analyzeQuoteContext(quoteId, { force = false } = {}) {
  const db = getDb();

  // Check cache first
  if (!force) {
    const cached = db.prepare(
      `SELECT * FROM quote_context_cache WHERE quote_id = ? AND expires_at > datetime('now')`
    ).get(quoteId);
    if (cached) {
      return {
        ...JSON.parse(cached.analysis),
        cachedAt: cached.created_at,
        expiresAt: cached.expires_at,
        fromCache: true,
      };
    }
  }

  // Load quote + person
  const quote = db.prepare(`
    SELECT q.*, p.canonical_name, p.disambiguation
    FROM quotes q
    JOIN persons p ON q.person_id = p.id
    WHERE q.id = ?
  `).get(quoteId);

  if (!quote) throw new Error('Quote not found');

  // Step 1: Identify claims via Gemini
  let claims;
  try {
    const claimPrompt = `Analyze the following quote and identify the distinct claims or assertions being made.

Quote: "${quote.text}"
Speaker: ${quote.canonical_name}${quote.disambiguation ? ` (${quote.disambiguation})` : ''}
${quote.context ? `Context: ${quote.context}` : ''}

Return a JSON object with this exact structure (no markdown, just raw JSON):
{
  "claims": [
    {
      "claim": "A clear, concise statement of what is being claimed",
      "searchQuery": "2-5 word search query to find related quotes",
      "type": "factual|opinion|prediction|promise|accusation"
    }
  ],
  "overallTheme": "A brief summary of what this quote is about"
}

Rules:
- Extract 1-5 claims maximum
- "type" must be exactly one of: factual, opinion, prediction, promise, accusation
- "searchQuery" should be broad enough to find relevant quotes from any author
- If the quote is simple with no real claims, return 1 claim summarizing its point`;

    const claimResponse = await gemini.generateText(claimPrompt);
    const jsonStr = claimResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    claims = JSON.parse(jsonStr);
  } catch (err) {
    logger.error('quote_context', 'claim_identification_failed', { quoteId, error: err.message });
    throw new Error('Failed to analyze quote claims');
  }

  // Step 2: Gather evidence from Pinecone + SQLite
  const evidenceQuotes = new Map(); // quoteId -> quote data

  for (const claim of claims.claims) {
    try {
      // Cross-author Pinecone search
      const pineconeResults = await searchQuotes(claim.searchQuery, 10);
      for (const hit of pineconeResults) {
        const qId = hit.metadata?.quote_id;
        if (qId && qId !== quoteId && !evidenceQuotes.has(qId)) {
          const eq = db.prepare(`
            SELECT q.id, q.text, q.context, q.created_at, q.quote_datetime,
                   p.canonical_name, p.disambiguation,
                   a.url AS article_url, a.title AS article_title,
                   s.name AS source_name, s.domain AS source_domain
            FROM quotes q
            JOIN persons p ON q.person_id = p.id
            LEFT JOIN quote_articles qa ON qa.quote_id = q.id
            LEFT JOIN articles a ON qa.article_id = a.id
            LEFT JOIN sources s ON a.source_id = s.id
            WHERE q.id = ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
          `).get(qId);
          if (eq) evidenceQuotes.set(qId, eq);
        }
      }
    } catch (err) {
      logger.warn('quote_context', 'pinecone_search_failed', { quoteId, claim: claim.claim, error: err.message });
    }

    // SQLite: quotes sharing same topics
    try {
      const topicQuotes = db.prepare(`
        SELECT DISTINCT q.id, q.text, q.context, q.created_at, q.quote_datetime,
               p.canonical_name, p.disambiguation,
               a.url AS article_url, a.title AS article_title,
               s.name AS source_name, s.domain AS source_domain
        FROM quotes q
        JOIN persons p ON q.person_id = p.id
        LEFT JOIN quote_articles qa ON qa.quote_id = q.id
        LEFT JOIN articles a ON qa.article_id = a.id
        LEFT JOIN sources s ON a.source_id = s.id
        JOIN quote_topics qt1 ON qt1.quote_id = q.id
        JOIN quote_topics qt2 ON qt2.topic_id = qt1.topic_id
        WHERE qt2.quote_id = ? AND q.id != ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
        LIMIT 10
      `).all(quoteId, quoteId);
      for (const eq of topicQuotes) {
        if (!evidenceQuotes.has(eq.id)) {
          evidenceQuotes.set(eq.id, eq);
        }
      }
    } catch (err) {
      logger.warn('quote_context', 'topic_search_failed', { quoteId, error: err.message });
    }
  }

  // Cap at 15 evidence quotes
  const evidenceList = Array.from(evidenceQuotes.values()).slice(0, 15);

  // Step 3: Contextual analysis via Gemini
  let analysis;
  try {
    const evidenceBlock = evidenceList.map((eq, i) =>
      `[${i + 1}] (ID: ${eq.id}) "${eq.text.substring(0, 300)}" — ${eq.canonical_name}${eq.quote_datetime ? ` (${eq.quote_datetime})` : ''}`
    ).join('\n');

    const analysisPrompt = `You are analyzing a political/news quote to provide context and fact-checking.

ORIGINAL QUOTE:
"${quote.text}"
Speaker: ${quote.canonical_name}${quote.disambiguation ? ` (${quote.disambiguation})` : ''}
${quote.context ? `Context: ${quote.context}` : ''}

IDENTIFIED CLAIMS:
${claims.claims.map((c, i) => `${i + 1}. [${c.type}] ${c.claim}`).join('\n')}

EVIDENCE QUOTES FROM OUR DATABASE:
${evidenceBlock || '(No evidence quotes found)'}

INSTRUCTIONS:
For each claim, find supporting evidence, contradicting evidence, and additional context
ONLY from the evidence quotes provided above. Do NOT include conclusions from your own
training data or general knowledge.

If no evidence quotes are relevant to a claim, leave its arrays empty — do not fabricate
or assume evidence. Every evidence item MUST reference one of the numbered evidence quotes
above by its ID.

Return a JSON object (no markdown, just raw JSON):
{
  "claims": [
    {
      "claim": "The claim text",
      "type": "factual|opinion|prediction|promise|accusation",
      "supporting": [
        {"quoteId": 123, "explanation": "Why this supports the claim"}
      ],
      "contradicting": [],
      "addingContext": []
    }
  ],
  "summary": "2-3 sentence editorial summary of the overall context",
  "confidenceNote": "Note: analysis is based solely on quotes in our database. Claims without evidence listed may still be true or false — we simply lack sourced quotes to confirm."
}

Rules:
- ONLY cite evidence quotes from the numbered list above — never general knowledge
- Every evidence item MUST have a valid quoteId matching an evidence quote ID above
- If a claim has no relevant evidence, leave supporting/contradicting/addingContext as empty arrays
- Keep explanations concise (1-2 sentences each)
- Be balanced — include both supporting and contradicting evidence when available
- Maximum 3 items per category (supporting/contradicting/addingContext) per claim`;

    const analysisResponse = await gemini.generateText(analysisPrompt);
    const jsonStr = analysisResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    analysis = JSON.parse(jsonStr);
  } catch (err) {
    logger.error('quote_context', 'analysis_failed', { quoteId, error: err.message });
    throw new Error('Failed to generate contextual analysis');
  }

  // Strip any unsourced items (general_knowledge) and hydrate with full data
  for (const claim of analysis.claims) {
    for (const category of ['supporting', 'contradicting', 'addingContext']) {
      if (!claim[category]) {
        claim[category] = [];
        continue;
      }
      // Filter out items without a valid quoteId (e.g. general_knowledge)
      claim[category] = claim[category].filter(item => item.quoteId != null);
      // Hydrate remaining items with quote text, author, and source URL
      for (const item of claim[category]) {
        const eq = evidenceQuotes.get(item.quoteId);
        if (eq) {
          item.quoteText = eq.text.length > 200 ? eq.text.substring(0, 200) + '...' : eq.text;
          item.authorName = eq.canonical_name;
          item.quoteDate = eq.quote_datetime || eq.created_at;
          item.sourceUrl = eq.article_url || null;
          item.sourceTitle = eq.article_title || null;
          item.sourceName = eq.source_name || eq.source_domain || null;
        }
        // Remove legacy source field
        delete item.source;
      }
    }
  }

  // Cache the result
  const relatedIds = Array.from(evidenceQuotes.keys());
  const analysisJson = JSON.stringify(analysis);

  db.prepare(`
    INSERT INTO quote_context_cache (quote_id, analysis, related_quote_ids, model_version)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(quote_id) DO UPDATE SET
      analysis = excluded.analysis,
      related_quote_ids = excluded.related_quote_ids,
      model_version = excluded.model_version,
      created_at = datetime('now'),
      expires_at = datetime('now', '+7 days')
  `).run(quoteId, analysisJson, JSON.stringify(relatedIds), MODEL_VERSION);

  const cached = db.prepare('SELECT created_at, expires_at FROM quote_context_cache WHERE quote_id = ?').get(quoteId);

  logger.info('quote_context', 'analysis_complete', {
    quoteId,
    claimCount: analysis.claims.length,
    evidenceCount: relatedIds.length,
  });

  return {
    ...analysis,
    cachedAt: cached.created_at,
    expiresAt: cached.expires_at,
    fromCache: false,
  };
}

/**
 * Get smart related quotes: contradictions, supporting context (same author),
 * and mentions by other authors within ±7 days.
 */
export async function getSmartRelatedQuotes(quoteId) {
  const db = getDb();

  // Check cache first
  const cachedRows = db.prepare(
    `SELECT * FROM quote_smart_related WHERE quote_id = ? AND expires_at > datetime('now')`
  ).all(quoteId);

  if (cachedRows.length > 0) {
    return formatSmartRelated(db, cachedRows, true);
  }

  // Load quote + person
  const quote = db.prepare(`
    SELECT q.*, p.canonical_name, p.disambiguation
    FROM quotes q
    JOIN persons p ON q.person_id = p.id
    WHERE q.id = ?
  `).get(quoteId);

  if (!quote) throw new Error('Quote not found');

  const results = [];

  // Section A: Same-author analysis (contradictions + supporting context)
  let sameAuthorCandidates = [];
  try {
    const pineconeResults = await queryQuotes(quote.text, quote.person_id, 20);
    const candidateIds = pineconeResults
      .map(hit => hit.metadata?.quote_id)
      .filter(id => id && id !== quoteId);

    // Fetch full quote data for candidates
    for (const cId of candidateIds) {
      const cq = db.prepare(`
        SELECT q.id, q.text, q.context, q.created_at, q.quote_datetime,
               p.canonical_name
        FROM quotes q
        JOIN persons p ON q.person_id = p.id
        WHERE q.id = ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL AND q.id != ?
      `).get(cId, quoteId);
      if (cq) sameAuthorCandidates.push(cq);
    }

    // Dedupe and limit
    const seen = new Set();
    sameAuthorCandidates = sameAuthorCandidates.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    }).slice(0, 10);
  } catch (err) {
    logger.warn('quote_context', 'same_author_pinecone_failed', { quoteId, error: err.message });
    // Fallback: recent same-person quotes from SQLite
    sameAuthorCandidates = db.prepare(`
      SELECT q.id, q.text, q.context, q.created_at, q.quote_datetime,
             p.canonical_name
      FROM quotes q
      JOIN persons p ON q.person_id = p.id
      WHERE q.person_id = ? AND q.id != ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
      ORDER BY q.created_at DESC
      LIMIT 10
    `).all(quote.person_id, quoteId);
  }

  // Classify same-author candidates with Gemini
  if (sameAuthorCandidates.length > 0) {
    try {
      const candidateBlock = sameAuthorCandidates.map((c, i) =>
        `[${i + 1}] (ID: ${c.id}) "${c.text.substring(0, 300)}"${c.quote_datetime ? ` (${c.quote_datetime})` : ''}`
      ).join('\n');

      const classifyPrompt = `Classify each candidate quote's relationship to the original quote.

ORIGINAL QUOTE by ${quote.canonical_name}:
"${quote.text}"

CANDIDATE QUOTES (same author):
${candidateBlock}

For each candidate, classify as one of:
- "contradiction" — directly contradicts the original quote
- "supporting_context" — supports, expands on, or adds context to the original
- "unrelated" — no meaningful connection

Return a JSON array (no markdown, just raw JSON):
[
  {"id": 123, "classification": "contradiction|supporting_context|unrelated", "confidence": 0.8, "explanation": "Brief reason"}
]

Rules:
- Be strict: only "contradiction" for genuine contradictions, not just different topics
- confidence should be 0.0-1.0
- Keep explanations to 1 sentence`;

      const classifyResponse = await gemini.generateText(classifyPrompt);
      const jsonStr = classifyResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const classifications = JSON.parse(jsonStr);

      for (const c of classifications) {
        if (c.classification === 'unrelated' || c.confidence < 0.5) continue;
        const relatedType = c.classification === 'contradiction' ? 'contradiction' : 'context';
        results.push({
          quote_id: quoteId,
          related_type: relatedType,
          related_quote_id: c.id,
          confidence: c.confidence,
          explanation: c.explanation,
        });
      }
    } catch (err) {
      logger.warn('quote_context', 'classification_failed', { quoteId, error: err.message });
      // Graceful degradation: store raw Pinecone results as "context" without labels
      for (const c of sameAuthorCandidates.slice(0, 5)) {
        results.push({
          quote_id: quoteId,
          related_type: 'context',
          related_quote_id: c.id,
          confidence: 0.6,
          explanation: 'Related quote from same author',
        });
      }
    }
  }

  // Section B: Mentions by others (±7 days)
  const personName = quote.canonical_name;
  const lastName = personName.split(' ').pop();
  const refDate = quote.quote_datetime || quote.created_at;

  let mentionQuotes = [];
  try {
    // Build LIKE conditions for name mentions
    const likeConditions = [`q.text LIKE '%' || ? || '%'`];
    const likeParams = [personName];

    // Add last name search if it's different from full name
    if (lastName !== personName && lastName.length > 2) {
      likeConditions.push(`q.text LIKE '%' || ? || '%'`);
      likeParams.push(lastName);
    }

    mentionQuotes = db.prepare(`
      SELECT q.id, q.text, q.context, q.created_at, q.quote_datetime,
             p.canonical_name
      FROM quotes q
      JOIN persons p ON q.person_id = p.id
      WHERE (${likeConditions.join(' OR ')})
        AND q.person_id != ?
        AND q.is_visible = 1
        AND q.canonical_quote_id IS NULL
        AND (
          (q.quote_datetime IS NOT NULL AND ABS(julianday(q.quote_datetime) - julianday(?)) <= 7)
          OR (q.quote_datetime IS NULL AND ABS(julianday(q.created_at) - julianday(?)) <= 7)
        )
      ORDER BY CASE
        WHEN q.quote_datetime IS NOT NULL THEN ABS(julianday(q.quote_datetime) - julianday(?))
        ELSE ABS(julianday(q.created_at) - julianday(?))
      END ASC
      LIMIT 10
    `).all(...likeParams, quote.person_id, refDate, refDate, refDate, refDate);
  } catch (err) {
    logger.warn('quote_context', 'mentions_search_failed', { quoteId, error: err.message });
  }

  for (const mq of mentionQuotes) {
    results.push({
      quote_id: quoteId,
      related_type: 'mention',
      related_quote_id: mq.id,
      confidence: 0.8,
      explanation: `${mq.canonical_name} mentions ${personName}`,
    });
  }

  // Store results in cache
  const insertStmt = db.prepare(`
    INSERT INTO quote_smart_related (quote_id, related_type, related_quote_id, confidence, explanation)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(quote_id, related_quote_id, related_type) DO UPDATE SET
      confidence = excluded.confidence,
      explanation = excluded.explanation,
      created_at = datetime('now'),
      expires_at = datetime('now', '+7 days')
  `);

  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      insertStmt.run(r.quote_id, r.related_type, r.related_quote_id, r.confidence, r.explanation);
    }
  });
  insertMany(results);

  // Fetch fresh cache rows to return
  const freshRows = db.prepare(
    `SELECT * FROM quote_smart_related WHERE quote_id = ? AND expires_at > datetime('now')`
  ).all(quoteId);

  logger.info('quote_context', 'smart_related_complete', {
    quoteId,
    contradictions: results.filter(r => r.related_type === 'contradiction').length,
    context: results.filter(r => r.related_type === 'context').length,
    mentions: results.filter(r => r.related_type === 'mention').length,
  });

  return formatSmartRelated(db, freshRows, false);
}

/**
 * Format cached smart-related rows into the API response shape.
 */
function formatSmartRelated(db, rows, fromCache) {
  const contradictions = [];
  const supportingContext = [];
  const mentionsByOthers = [];

  for (const row of rows) {
    const rq = db.prepare(`
      SELECT q.id, q.text, q.context, q.created_at, q.quote_datetime,
             q.person_id, q.importants_count, p.canonical_name, p.photo_url,
             a.id AS article_id, a.url AS article_url, a.title AS article_title,
             s.name AS source_name, s.domain AS source_domain
      FROM quotes q
      JOIN persons p ON q.person_id = p.id
      LEFT JOIN quote_articles qa ON qa.quote_id = q.id
      LEFT JOIN articles a ON qa.article_id = a.id
      LEFT JOIN sources s ON a.source_id = s.id
      WHERE q.id = ?
    `).get(row.related_quote_id);

    if (!rq) continue;

    // Fetch topics for this related quote
    const topicRows = db.prepare(`
      SELECT t.id, t.name, t.slug FROM topics t
      JOIN quote_topics qt ON qt.topic_id = t.id
      WHERE qt.quote_id = ?
    `).all(rq.id);

    const item = {
      id: rq.id,
      text: rq.text,
      context: rq.context || '',
      person_id: rq.person_id,
      person_name: rq.canonical_name,
      photo_url: rq.photo_url || '',
      importants_count: rq.importants_count || 0,
      authorName: rq.canonical_name,
      date: rq.quote_datetime || rq.created_at,
      quote_datetime: rq.quote_datetime || '',
      confidence: row.confidence,
      explanation: row.explanation,
      sourceUrl: rq.article_url || null,
      sourceName: rq.source_name || rq.source_domain || null,
      article_id: rq.article_id || null,
      article_title: rq.article_title || null,
      source_domain: rq.source_domain || null,
      source_name: rq.source_name || null,
      topics: topicRows,
    };

    if (row.related_type === 'contradiction') contradictions.push(item);
    else if (row.related_type === 'context') supportingContext.push(item);
    else if (row.related_type === 'mention') mentionsByOthers.push(item);
  }

  const cachedAt = rows[0]?.created_at || null;
  const expiresAt = rows[0]?.expires_at || null;

  return { contradictions, supportingContext, mentionsByOthers, cachedAt, expiresAt, fromCache };
}
