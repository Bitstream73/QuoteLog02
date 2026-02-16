import { matchEntities, storeQuoteKeywords, resolveTopicsAndCategories } from './keywordMatcher.js';
import { queueUnmatchedEntities } from './unmatchedEntityHandler.js';

/**
 * Classify a quote using the taxonomy pipeline
 * @param {number} quoteId - quote database ID
 * @param {string} quoteDate - ISO date of the quote
 * @param {Array<{name: string, type: string}>} extractedEntities - from Gemini extraction
 * @returns {Object} classification results
 */
export function classifyQuote(quoteId, quoteDate, extractedEntities) {
  if (!extractedEntities || extractedEntities.length === 0) {
    return { matched: [], unmatched: [], flagged: [], topicsAssigned: 0 };
  }

  // Step 2: Match entities against keyword aliases (database lookup, no LLM)
  const { matched, unmatched, flagged } = matchEntities(extractedEntities);

  // Store keyword matches with confidence levels
  if (matched.length > 0) {
    storeQuoteKeywords(quoteId, matched);

    // Step 3: Resolve topics and categories (database joins, no LLM)
    resolveTopicsAndCategories(quoteId, matched, quoteDate);
  }

  // Step 4: Queue unmatched entities for admin review (may trigger LLM later)
  if (unmatched.length > 0) {
    queueUnmatchedEntities(unmatched);
  }

  return { matched, unmatched, flagged };
}
