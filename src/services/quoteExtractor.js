import gemini from './ai/gemini.js';
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
 * Detect whether a quote looks like a sentence fragment rather than
 * a complete statement.  Fragments are hidden (is_visible = 0) even
 * if their significance score is above the threshold.
 */
function isQuoteFragment(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;

  // Starts or ends with ellipsis → truncated excerpt
  if (/^\.{3}|^\u2026/.test(trimmed)) return true;
  if (/\.{3}$|\u2026$/.test(trimmed)) return true;

  // Starts with lowercase letter → mid-sentence fragment
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
    return [];
  }

  const prompt = `You are a precise news quote extraction system. Extract ONLY direct, verbatim quotes from this news article.

Article published: ${article.published_at || 'Unknown date'}
Article title: ${article.title || 'Untitled'}

For each quote, return:
- quote_text: The exact quoted text as it appears in quotation marks. Use the verbatim words only.
- speaker: The full name of the person being quoted. Never use pronouns — resolve "he", "she", "they" to the actual name.
- speaker_title: Their role, title, or affiliation as mentioned in the article (e.g., "CEO of Apple", "U.S. Senator"). Null if not mentioned.
- speaker_category: One of: "Politician", "Government Official", "Business Leader", "Entertainer", "Athlete", "Pundit", "Journalist", "Scientist/Academic", "Legal/Judicial", "Military/Defense", "Activist/Advocate", "Religious Leader", "Other". Choose based on the speaker's primary public role.
- speaker_category_context: Brief context for the category. For Politicians: party and office (e.g. "Republican, U.S. Senator from Texas"). For Athletes: team and sport (e.g. "Los Angeles Lakers, NBA"). For Business Leaders: company and title. For Entertainers: medium and notable works. For Pundits/Journalists: outlet. For others: relevant affiliation. Null if unknown.
- quote_type: Always "direct".
- context: One sentence describing what the quote is about and why it was said.
- quote_date: The date when this quote was actually spoken/written, in ISO format (YYYY-MM-DD).
  * For current news quotes: use the article's publication date provided above.
  * For historical quotes (quoting someone from the past, reprinting old statements): use the original date if mentioned in the article, otherwise "unknown".
  * For "yesterday"/"last week" references: compute the actual date relative to the article publication date.
  * If the speaker is deceased or the quote clearly predates the article, do NOT use the article date.
- topics: Array of 1-3 SPECIFIC subject categories. Use the most specific applicable name:

  Politics: "U.S. Presidential Politics", "U.S. Congressional Politics", "UK Politics", "EU Politics", "State/Local Politics", "Voting Rights"
  Government: "U.S. Foreign Policy", "Diplomacy", "Intelligence & Espionage", "Military & Defense", "Governance"
  Law: "Supreme Court", "Criminal Justice", "Constitutional Law", "Civil Rights & Liberties", "Law Enforcement"
  Economy: "U.S. Finance", "Global Economy", "Federal Reserve", "Trade & Tariffs", "Labor & Employment", "Cryptocurrency"
  Business: "Big Tech", "Startups", "Corporate Governance", "Energy Industry"
  Social: "Healthcare", "Education", "Immigration", "Housing", "Gun Control", "Reproductive Rights"
  Science: "Climate & Environment", "Space Exploration", "Artificial Intelligence", "Public Health"
  Culture: "Film & Television", "Music", "Olympic Sports", "NFL", "NBA", "MLB", "Soccer", "Social Media"
  World: "Middle East Conflict", "Ukraine War", "China-Taiwan Relations", "African Affairs", "Latin American Affairs"
  Media: "Journalism", "Misinformation", "Media Industry"
  Philosophy: "Philosophy", "Ethics", "Religion"

  IMPORTANT: Use specific names, NOT broad ones. "U.S. Finance" not "Business". "UK Politics" not "Politics". "Olympic Sports" not "Sports". "Supreme Court" not "Law".

- keywords: Array of 2-5 specific named entities relevant to this quote. Follow these rules STRICTLY:

  GOOD keywords (use as models):
  "Donald Trump", "Supreme Court", "January 6th Committee", "Affordable Care Act",
  "European Union", "Silicon Valley", "Paris Climate Agreement", "Federal Reserve",
  "2026 Winter Olympics", "Senate Judiciary Committee"

  BAD keywords (NEVER produce these):
  "Trump" (incomplete — use "Donald Trump"), "critical" (adjective), "emphasizes" (verb),
  "policy" (too vague), "Donald" (first name only), "innovation" (generic noun),
  "business" (generic), "groups" (generic), "competition" (generic), "strength" (generic)

  Rules:
  1. ALWAYS use FULL proper names: "Donald Trump" not "Trump", "Federal Reserve" not "Fed"
  2. Multi-word entities are ONE keyword: "January 6th Committee" is one keyword
  3. Every keyword MUST be a proper noun, named event, specific organization, legislation, or geographic location
  4. NEVER include: verbs, adjectives, generic nouns, common words, the speaker's own name
  5. Single-word keywords are ONLY allowed for proper nouns (e.g., "NATO", "OPEC", "Brexit", "Hamas")
  6. If no specific named entities exist in the quote, return an EMPTY array — never fill with generic words

- significance: Integer 1-10 rating of how noteworthy this quote is:
  9-10: Historic or landmark statement (declaring war, resignation, major policy)
  7-8: Strong claim, bold prediction, headline-worthy, reveals new information
  5-6: Substantive opinion, meaningful analysis, newsworthy reaction
  3-4: Routine statement, standard commentary, generic encouragement
  1-2: Vague platitude, meaningless fragment, purely descriptive, no substance

  HIGH: makes a specific claim, sets a goal, predicts, reveals information, accuses, is funny/memorable, provides genuine insight
  LOW: "We need to do better" (platitude), "It was a nice event" (descriptive), "The meeting begins at noon" (procedural), fragments without assertion

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
      const parsed = await gemini.generateJSON(prompt);
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
    return [];
  }

  // Step 2: Extract quotes with Gemini
  const rawQuotes = await extractQuotesWithGemini(articleText, article);

  if (rawQuotes.length === 0) {
    return [];
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

      // Determine quote date
      const quoteDate = q.quote_date && q.quote_date !== 'unknown' ? q.quote_date : (article.published_at || null);

      // Determine visibility based on significance score and fragment detection
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
          topics: q.topics || [],
          keywords: q.keywords || [],
          quoteDate,
          isVisible,
        },
        personId,
        article,
        db
      );

      if (quoteResult) {
        insertedQuotes.push(quoteResult);
        logger.info('extractor', 'quote_extracted', {
          quoteId: quoteResult.id,
          speaker: q.speaker,
          category: q.speaker_category || null,
          quote: q.quote_text.substring(0, 200),
          context: (q.context || articleSummary || '').substring(0, 200),
          topics: q.topics || [],
          keywords: q.keywords || [],
          significance,
          isVisible,
          isFragment: fragment,
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

  return insertedQuotes;
}

// Legacy export for compatibility
const quoteExtractor = {
  async extractFromArticle(articleText, sourceName, sourceUrl) {
    const rawQuotes = await extractQuotesWithGemini(articleText, { published_at: null, title: null });
    return rawQuotes.map(q => ({
      text: q.quote_text,
      author: q.speaker,
      sourceName,
      sourceUrl,
    }));
  },
};

export { isQuoteFragment };
export default quoteExtractor;
