import { matchEntities, storeQuoteKeywords, resolveTopicsAndCategories, matchTopics, storeQuoteTopicsDirect } from './keywordMatcher.js';
import { queueUnmatchedEntities, queueUnmatchedTopics } from './unmatchedEntityHandler.js';

/**
 * Classify a quote using the taxonomy pipeline
 * @param {number} quoteId - quote database ID
 * @param {string} quoteDate - ISO date of the quote
 * @param {Array<{name: string, type: string}>} extractedEntities - from Gemini extraction
 * @param {Array<string>} extractedTopics - topic strings from Gemini extraction
 * @returns {Object} classification results
 */
export function classifyQuote(quoteId, quoteDate, extractedEntities, extractedTopics = []) {
  if (!extractedEntities || extractedEntities.length === 0) {
    // Still process topics even if no keyword entities
    if (extractedTopics.length > 0) {
      const { matched: topicMatched, unmatched: topicUnmatched } = matchTopics(extractedTopics);
      if (topicMatched.length > 0) storeQuoteTopicsDirect(quoteId, topicMatched, quoteDate);
      if (topicUnmatched.length > 0) queueUnmatchedTopics(topicUnmatched);
    }
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

  // Step 5: Direct topic matching (independent of keyword-based topic resolution)
  if (extractedTopics.length > 0) {
    const { matched: topicMatched, unmatched: topicUnmatched } = matchTopics(extractedTopics);
    if (topicMatched.length > 0) storeQuoteTopicsDirect(quoteId, topicMatched, quoteDate);
    if (topicUnmatched.length > 0) queueUnmatchedTopics(topicUnmatched);
  }

  return { matched, unmatched, flagged };
}
