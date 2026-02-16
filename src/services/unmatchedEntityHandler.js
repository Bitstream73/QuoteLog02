import { getDb } from '../config/database.js';

/**
 * Handle unmatched entities from keyword matching.
 * If entities list is empty, do nothing (no LLM cost).
 * Otherwise, create taxonomy suggestions for admin review.
 * @param {Array<{entity: {name, type}, bestMatch, bestScore}>} unmatchedEntities
 */
export function queueUnmatchedEntities(unmatchedEntities) {
  if (!unmatchedEntities || unmatchedEntities.length === 0) return;

  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status)
    VALUES (?, ?, ?, 'pending')
  `);

  for (const item of unmatchedEntities) {
    const suggestedData = JSON.stringify({
      name: item.entity.name,
      type: item.entity.type,
      closest_match: item.bestMatch ? {
        keyword_name: item.bestMatch.keyword_name,
        score: item.bestScore
      } : null,
      suggested_aliases: [item.entity.name]
    });

    insert.run('new_keyword', suggestedData, 'ai_extraction');
  }
}

/**
 * Get pending taxonomy suggestions for admin review.
 * @param {Object} options - { type?, status?, limit?, offset? }
 * @returns {Array} suggestions
 */
export function getSuggestions({ type, status = 'pending', limit = 50, offset = 0 } = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM taxonomy_suggestions WHERE 1=1';
  const params = [];

  if (type) { sql += ' AND suggestion_type = ?'; params.push(type); }
  if (status) { sql += ' AND status = ?'; params.push(status); }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(sql).all(...params);
}

/**
 * Approve a suggestion - create the keyword/alias/etc.
 * @param {number} suggestionId
 * @param {Object} editedData - optional modified data
 */
export function approveSuggestion(suggestionId, editedData = null) {
  const db = getDb();
  const suggestion = db.prepare('SELECT * FROM taxonomy_suggestions WHERE id = ?').get(suggestionId);
  if (!suggestion) throw new Error('Suggestion not found');

  const data = editedData || JSON.parse(suggestion.suggested_data);

  if (suggestion.suggestion_type === 'new_keyword') {
    const normalized = data.name.toLowerCase().trim();
    const result = db.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)').run(data.name, normalized);
    const keywordId = result.lastInsertRowid;

    if (data.suggested_aliases) {
      const insertAlias = db.prepare('INSERT OR IGNORE INTO keyword_aliases (keyword_id, alias, alias_normalized) VALUES (?, ?, ?)');
      for (const alias of data.suggested_aliases) {
        insertAlias.run(keywordId, alias, alias.toLowerCase().trim());
      }
    }
  }

  const status = editedData ? 'edited' : 'approved';
  db.prepare('UPDATE taxonomy_suggestions SET status = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, suggestionId);
}

/**
 * Reject a suggestion.
 * @param {number} suggestionId
 */
export function rejectSuggestion(suggestionId) {
  const db = getDb();
  db.prepare('UPDATE taxonomy_suggestions SET status = \'rejected\', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?').run(suggestionId);
}
