import gemini from './ai/gemini.js';
import config from '../config/index.js';
import { getDb, getSettingValue } from '../config/database.js';
import logger from './logger.js';
import { resolvePersonId } from './nameDisambiguator.js';
import { insertAndDeduplicateQuote } from './quoteDeduplicator.js';
import { fetchAndStoreHeadshot } from './personPhoto.js';
import { getPromptTemplate } from './promptManager.js';
import { classifyQuote } from './classificationPipeline.js';

/**
 * Normalize a date string to ISO format (YYYY-MM-DD).
 * Handles formats like "October 28, 1932", "10/28/1932", etc.
 * Returns null if unparseable.
 */
export function normalizeToIsoDate(dateStr) {
  if (!dateStr || dateStr === 'unknown') return null;
  // Already ISO format (YYYY-MM-DD with optional time suffix)
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.substring(0, 10);
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Quote detection patterns
const QUOTE_CHARS = /["\u201C\u201D]/;
const ATTRIBUTION_VERBS = /\b(said|stated|told|claimed|argued|noted|added|explained|warned|insisted|remarked|commented|declared|announced|responded|replied|acknowledged|admitted|confirmed|denied|emphasized|stressed|suggested|urged|asked|demanded|revealed|disclosed|predicted|recalled|testified|wrote|tweeted|posted)\b/i;

/**
 * Detect whether a quote looks like a sentence fragment rather than
 * a complete statement.  Fragments are hidden (is_visible = 0) even
 * if their significance score is above the threshold.
 */
function isQuoteFragment(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;

  // Starts or ends with ellipsis \u2192 truncated excerpt
  if (/^\.{3}|^\u2026/.test(trimmed)) return true;
  if (/\.{3}$|\u2026$/.test(trimmed)) return true;

  // Starts with lowercase letter \u2192 mid-sentence fragment
  // Only check when the very first non-whitespace character is a letter
  // (quotes starting with numbers, punctuation, etc. are fine)
  const firstChar = trimmed[0];
  if (/[a-z]/.test(firstChar)) {
    return true;
  }

  return false;
}

/**
 * Pre-filter check - does article likely contain quotes?
 */
function likelyHasQuotes(text) {
  return QUOTE_CHARS.test(text) && ATTRIBUTION_VERBS.test(text);
}

/**
 * Verify that a quote exists in the article text
 */
function verifyQuoteInArticle(quoteText, articleText) {
  const normalize = s => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  const normalizedQuote = normalize(quoteText);
  const normalizedArticle = normalize(articleText);

  // Allow partial matches for long quotes
  if (normalizedQuote.length > 50) {
    const words = normalizedQuote.split(' ');
    const firstPart = words.slice(0, 10).join(' ');
    const lastPart = words.slice(-10).join(' ');
    return normalizedArticle.includes(firstPart) || normalizedArticle.includes(lastPart);
  }

  return normalizedArticle.includes(normalizedQuote);
}

/**
 * Verify speaker name appears in article
 */
function verifySpeakerInArticle(speaker, articleText) {
  const lastName = speaker.split(/\s+/).pop();
  return articleText.toLowerCase().includes(lastName.toLowerCase());
}

/**
 * Extract quotes from article text using Gemini
 */
async function extractQuotesWithGemini(articleText, article) {
  if (!config.geminiApiKey) {
    logger.warn('extractor', 'no_gemini_key', {});
    return { quotes: [] };
  }

  // Load prompt template from DB (falls back to hardcoded default)
  const template = getPromptTemplate('quote_extraction');
  const prompt = template
    .replace('{{published_at}}', article.published_at || 'Unknown date')
    .replace('{{title}}', article.title || 'Untitled')
    .replace('{{article_text}}', articleText.substring(0, 15000));

  // Retry with exponential backoff for rate limits
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const parsed = await gemini.generateJSON(prompt);
      return {
        quotes: parsed.quotes || [],
      };
    } catch (err) {
      lastError = err;
      // Check for rate limit (429) or server errors (5xx)
      const isRateLimit = err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED');
      const isServerError = err.message?.includes('500') || err.message?.includes('503');
      if ((isRateLimit || isServerError) && attempt < 2) {
        const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s
        logger.warn('extractor', 'gemini_rate_limited', { attempt: attempt + 1, delay });
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }

  logger.error('extractor', 'gemini_extraction_failed', { error: lastError?.message });
  return { quotes: [] };
}

/**
 * Generate a brief article summary for context fallback
 */
async function generateArticleSummary(articleText) {
  if (!config.geminiApiKey) return null;

  try {
    const text = await gemini.generateText(
      `Summarize this news article in 2-3 sentences. Focus on the main topic and key events.\n\nArticle:\n${articleText.substring(0, 5000)}`
    );
    return text.trim() || null;
  } catch (err) {
    logger.warn('extractor', 'summary_generation_failed', { error: err.message });
    return null;
  }
}

/**
 * Main quote extraction pipeline for an article
 */
export async function extractQuotesFromArticle(articleText, article, db, io) {
  // Step 1: Pre-filter - does article likely have quotes?
  if (!likelyHasQuotes(articleText)) {
    logger.debug('extractor', 'no_quotes_detected', { url: article.url });
    return { quotes: [], extracted_entities: [] };
  }

  // Step 2: Extract quotes with Gemini
  const extractionResult = await extractQuotesWithGemini(articleText, article);
  const rawQuotes = extractionResult.quotes;

  if (rawQuotes.length === 0) {
    return { quotes: [], extracted_entities: [] };
  }

  // Step 3: Verify and filter quotes (direct only)
  const minWords = parseInt(getSettingValue('min_quote_words', '5'), 10);
  const minSignificance = parseInt(getSettingValue('min_significance_score', '5'), 10);
  const verifiedQuotes = rawQuotes.filter(q => {
    // Reject non-direct quotes
    if (q.quote_type !== 'direct') {
      logger.debug('extractor', 'indirect_quote_skipped', { quote: q.quote_text?.substring(0, 50) });
      return false;
    }

    // Verify quote exists in article
    if (!verifyQuoteInArticle(q.quote_text, articleText)) {
      logger.debug('extractor', 'quote_not_verified', { quote: q.quote_text.substring(0, 50) });
      return false;
    }

    // Verify speaker appears in article
    if (!verifySpeakerInArticle(q.speaker, articleText)) {
      logger.debug('extractor', 'speaker_not_verified', { speaker: q.speaker });
      return false;
    }

    // Check minimum length
    if (q.quote_text.split(/\s+/).length < minWords) {
      return false;
    }

    // Reject quotes lacking factual assertions/claims/predictions
    if (q.contains_claim === false) {
      logger.debug('extractor', 'no_claim_skipped', { quote: q.quote_text?.substring(0, 50), speaker: q.speaker });
      return false;
    }

    // Reject vague/rhetorical quotes (Category C)
    const factCheckCat = (q.fact_check_category || '').toUpperCase();
    if (factCheckCat === 'C') {
      logger.debug('extractor', 'rhetorical_skipped', { quote: q.quote_text?.substring(0, 50) });
      return false;
    }

    return true;
  });

  // Generate article summary as context fallback for quotes without context
  let articleSummary = null;
  const needsSummary = verifiedQuotes.some(q => !q.context);
  if (needsSummary) {
    articleSummary = await generateArticleSummary(articleText);
  }

  // Step 4: Process each verified quote
  const insertedQuotes = [];
  for (const q of verifiedQuotes) {
    try {
      // Resolve person (disambiguation)
      const personId = await resolvePersonId(q.speaker, q.speaker_title, q.context, article, db);

      // Update person category if provided by extraction
      if (q.speaker_category) {
        const existingPerson = db.prepare('SELECT category FROM persons WHERE id = ?').get(personId);
        if (!existingPerson?.category || existingPerson.category === 'Other') {
          db.prepare('UPDATE persons SET category = ?, category_context = ? WHERE id = ?')
            .run(q.speaker_category, q.speaker_category_context || null, personId);
        }
      }

      // Fire-and-forget headshot fetch
      fetchAndStoreHeadshot(personId, q.speaker).catch(() => {});

      // Build RSS metadata from article info
      const rssMetadata = {
        articleUrl: article.url,
        articleTitle: article.title || null,
        publishedAt: article.published_at || null,
        sourceId: article.source_id || null,
        domain: article.domain || null,
      };

      // Determine quote date \u2014 normalize to ISO format (YYYY-MM-DD)
      const rawDate = q.quote_date === 'unknown' ? null : (q.quote_date || article.published_at || null);
      const quoteDate = normalizeToIsoDate(rawDate);

      // Determine visibility based on significance score and fragment detection
      // (Category C quotes are already hard-filtered above)
      const significance = parseInt(q.significance, 10) || 5;
      const fragment = isQuoteFragment(q.quote_text);
      const isVisible = (!fragment && significance >= minSignificance) ? 1 : 0;

      // Insert and deduplicate quote (use article summary as context fallback)
      const quoteResult = await insertAndDeduplicateQuote(
        {
          text: q.quote_text,
          quoteType: q.quote_type,
          context: q.context || articleSummary || null,
          sourceUrl: article.url,
          rssMetadata: JSON.stringify(rssMetadata),
          quoteDate,
          isVisible,
          extractedKeywords: JSON.stringify(q.keywords || []),
        },
        personId,
        article,
        db
      );

      if (quoteResult) {
        insertedQuotes.push(quoteResult);

        // Classify new (non-duplicate) quotes using per-quote keywords from Gemini
        if (!quoteResult.isDuplicate) {
          const quoteEntities = (q.keywords || []).map(k => ({ name: k, type: 'keyword' }));
          if (quoteEntities.length > 0) {
            try {
              const classification = classifyQuote(quoteResult.id, quoteDate, quoteEntities);
              logger.debug('extractor', 'quote_classified', {
                quoteId: quoteResult.id,
                matched: classification.matched.length,
                unmatched: classification.unmatched.length,
                flagged: classification.flagged.length,
              });
            } catch (classifyErr) {
              logger.error('extractor', 'quote_classification_failed', {
                quoteId: quoteResult.id,
                error: classifyErr.message,
              });
            }
          }
        }

        logger.info('extractor', 'quote_extracted', {
          quoteId: quoteResult.id,
          speaker: q.speaker,
          category: q.speaker_category || null,
          quote: q.quote_text.substring(0, 200),
          context: (q.context || articleSummary || '').substring(0, 200),
          significance,
          isVisible,
          isFragment: fragment,
          containsClaim: q.contains_claim,
          factCheckCategory: (q.fact_check_category || '').toUpperCase() || null,
          articleUrl: article.url,
        });
      }
    } catch (err) {
      logger.error('extractor', 'quote_insert_failed', {
        quote: q.quote_text.substring(0, 50),
        error: err.message,
      });
    }
  }

  // Emit new quotes via Socket.IO
  if (io && insertedQuotes.length > 0) {
    io.emit('new_quotes', { quotes: insertedQuotes });
  }

  // Aggregate per-quote keywords into extracted_entities for backward compatibility
  const seenKeywords = new Set();
  const allEntities = [];
  for (const q of verifiedQuotes) {
    for (const k of (q.keywords || [])) {
      if (!seenKeywords.has(k)) {
        seenKeywords.add(k);
        allEntities.push({ name: k, type: 'keyword' });
      }
    }
  }

  return { quotes: insertedQuotes, extracted_entities: allEntities };
}

// Legacy export for compatibility
const quoteExtractor = {
  async extractFromArticle(articleText, sourceName, sourceUrl) {
    const result = await extractQuotesWithGemini(articleText, { published_at: null, title: null });
    return result.quotes.map(q => ({
      text: q.quote_text,
      author: q.speaker,
      sourceName,
      sourceUrl,
    }));
  },
};

export { isQuoteFragment };
export default quoteExtractor;
