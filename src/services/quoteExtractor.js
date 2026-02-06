import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/index.js';
import { getDb, getSettingValue } from '../config/database.js';
import logger from './logger.js';
import { resolvePersonId } from './nameDisambiguator.js';
import { insertAndDeduplicateQuote } from './quoteDeduplicator.js';
import { fetchAndStoreHeadshot } from './personPhoto.js';

// Quote detection patterns
const QUOTE_CHARS = /["\u201C\u201D]/;
const ATTRIBUTION_VERBS = /\b(said|stated|told|claimed|argued|noted|added|explained|warned|insisted|remarked|commented|declared|announced|responded|replied|acknowledged|admitted|confirmed|denied|emphasized|stressed|suggested|urged|asked|demanded|revealed|disclosed|predicted|recalled|testified|wrote|tweeted|posted)\b/i;

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
async function extractQuotesWithGemini(articleText) {
  if (!config.geminiApiKey) {
    logger.warn('extractor', 'no_gemini_key', {});
    return [];
  }

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });

  const prompt = `You are a precise news quote extraction system. Extract ONLY direct, verbatim quotes from this news article.

For each quote, return:
- quote_text: The exact quoted text as it appears in quotation marks. Use the verbatim words only.
- speaker: The full name of the person being quoted. Never use pronouns — resolve "he", "she", "they" to the actual name.
- speaker_title: Their role, title, or affiliation as mentioned in the article (e.g., "CEO of Apple", "U.S. Senator"). Null if not mentioned.
- quote_type: Always "direct".
- context: One sentence describing what the quote is about and why it was said.

Rules:
- ONLY extract verbatim quotes that appear inside quotation marks.
- Do NOT extract indirect/reported speech, paraphrases, or descriptions of what someone said.
- Only extract quotes attributed to a specific named person. Skip unattributed quotes.
- If a quote spans multiple paragraphs, combine into one entry.
- If a person is quoted multiple times, create separate entries for each distinct statement.
- Do NOT fabricate or embellish quotes. Only extract what is in the article.
- For speaker names, use the most complete version that appears in the article.

Return a JSON object: { "quotes": [...] }
If there are no attributable direct quotes, return: { "quotes": [] }

Article text:
${articleText.substring(0, 15000)}`;

  // Retry with exponential backoff for rate limits
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Parse JSON response
      const parsed = JSON.parse(text);
      return parsed.quotes || [];
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
  return [];
}

/**
 * Generate a brief article summary for context fallback
 */
async function generateArticleSummary(articleText) {
  if (!config.geminiApiKey) return null;

  try {
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.1 },
    });

    const result = await model.generateContent(
      `Summarize this news article in 2-3 sentences. Focus on the main topic and key events.\n\nArticle:\n${articleText.substring(0, 5000)}`
    );
    const response = await result.response;
    return response.text().trim() || null;
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
    return [];
  }

  // Step 2: Extract quotes with Gemini
  const rawQuotes = await extractQuotesWithGemini(articleText);

  if (rawQuotes.length === 0) {
    return [];
  }

  // Step 3: Verify and filter quotes (direct only)
  const minWords = parseInt(getSettingValue('min_quote_words', '5'), 10);
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

      // Fire-and-forget headshot fetch
      fetchAndStoreHeadshot(personId, q.speaker).catch(() => {});

      // Insert and deduplicate quote (use article summary as context fallback)
      const quoteData = await insertAndDeduplicateQuote(
        {
          text: q.quote_text,
          quoteType: q.quote_type,
          context: q.context || articleSummary || null,
          sourceUrl: article.url,
        },
        personId,
        article,
        db
      );

      if (quoteData) {
        insertedQuotes.push(quoteData);
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

  return insertedQuotes;
}

// Legacy export for compatibility
const quoteExtractor = {
  async extractFromArticle(articleText, sourceName, sourceUrl) {
    const rawQuotes = await extractQuotesWithGemini(articleText);
    return rawQuotes.map(q => ({
      text: q.quote_text,
      author: q.speaker,
      sourceName,
      sourceUrl,
    }));
  },
};

export default quoteExtractor;
