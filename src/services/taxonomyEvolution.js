import { getDb } from '../config/database.js';

/**
 * Analyze recent unmatched entities and generate keyword proposals.
 * Looks at taxonomy_suggestions from ai_extraction that are still pending
 * and groups by name to find frequently occurring unmatched entities.
 * @param {number} days - look back period (default 7)
 * @returns {Array} proposals with name, type, and occurrence_count
 */
export function analyzeUnmatchedEntities(days = 7) {
  const db = getDb();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const suggestions = db.prepare(`
    SELECT suggested_data, COUNT(*) as occurrence_count
    FROM taxonomy_suggestions
    WHERE source = 'ai_extraction'
    AND status = 'pending'
    AND created_at >= ?
    GROUP BY json_extract(suggested_data, '$.name')
    HAVING COUNT(*) >= 3
    ORDER BY occurrence_count DESC
  `).all(cutoff.toISOString());

  return suggestions.map(s => ({
    ...JSON.parse(s.suggested_data),
    occurrence_count: s.occurrence_count,
  }));
}

/**
 * Suggest alias expansions based on close fuzzy matches.
 * Looks at medium-confidence keyword matches and suggests adding as aliases.
 * @returns {Array} flagged keywords with match counts
 */
export function suggestAliasExpansions() {
  const db = getDb();

  const flagged = db.prepare(`
    SELECT qk.keyword_id, k.name as keyword_name, COUNT(*) as match_count
    FROM quote_keywords qk
    JOIN keywords k ON k.id = qk.keyword_id
    WHERE qk.confidence = 'medium'
    GROUP BY qk.keyword_id
    HAVING COUNT(*) >= 2
  `).all();

  return flagged;
}

/**
 * Run full taxonomy evolution analysis.
 * Generates suggestions and queues them for admin review.
 * @param {number} days - look back period for unmatched entity analysis
 * @returns {{ keywordProposals: number, aliasExpansions: number }}
 */
/**
 * Analyze recent unmatched topics and generate topic proposals.
 * @param {number} days - look back period (default 7)
 * @returns {Array} proposals with name and occurrence_count
 */
export function analyzeUnmatchedTopics(days = 7) {
  const db = getDb();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const suggestions = db.prepare(`
    SELECT suggested_data, COUNT(*) as occurrence_count
    FROM taxonomy_suggestions
    WHERE source = 'ai_extraction'
    AND suggestion_type = 'new_topic'
    AND status = 'pending'
    AND created_at >= ?
    GROUP BY json_extract(suggested_data, '$.name')
    HAVING COUNT(*) >= 3
    ORDER BY occurrence_count DESC
  `).all(cutoff.toISOString());

  return suggestions.map(s => ({
    ...JSON.parse(s.suggested_data),
    occurrence_count: s.occurrence_count,
  }));
}

export function runTaxonomyEvolution(days = 7) {
  const db = getDb();
  const results = { keywordProposals: 0, aliasExpansions: 0, topicProposals: 0 };

  // 1. Keyword proposals from frequent unmatched entities
  const proposals = analyzeUnmatchedEntities(days);
  const insertSuggestion = db.prepare(`
    INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status)
    VALUES (?, ?, 'batch_evolution', 'pending')
  `);

  for (const proposal of proposals) {
    // Check it's not already suggested via batch_evolution
    const existing = db.prepare(`
      SELECT id FROM taxonomy_suggestions
      WHERE source = 'batch_evolution'
      AND json_extract(suggested_data, '$.name') = ?
      AND status = 'pending'
    `).get(proposal.name);

    if (!existing) {
      insertSuggestion.run('new_keyword', JSON.stringify({
        name: proposal.name,
        type: proposal.type || 'unknown',
        occurrence_count: proposal.occurrence_count,
        suggested_aliases: [proposal.name],
      }));
      results.keywordProposals++;
    }
  }

  // 2. Alias expansions
  const expansions = suggestAliasExpansions();
  for (const expansion of expansions) {
    insertSuggestion.run('keyword_alias', JSON.stringify({
      keyword_id: expansion.keyword_id,
      keyword_name: expansion.keyword_name,
      match_count: expansion.match_count,
    }));
    results.aliasExpansions++;
  }

  // 3. Topic proposals from frequent unmatched topics
  const topicProposals = analyzeUnmatchedTopics(days);
  for (const proposal of topicProposals) {
    const existing = db.prepare(`
      SELECT id FROM taxonomy_suggestions
      WHERE source = 'batch_evolution'
      AND suggestion_type = 'new_topic'
      AND json_extract(suggested_data, '$.name') = ?
      AND status = 'pending'
    `).get(proposal.name);

    if (!existing) {
      insertSuggestion.run('new_topic', JSON.stringify({
        name: proposal.name,
        occurrence_count: proposal.occurrence_count,
        suggested_aliases: proposal.suggested_aliases || [proposal.name],
      }));
      results.topicProposals++;
    }
  }

  return results;
}
