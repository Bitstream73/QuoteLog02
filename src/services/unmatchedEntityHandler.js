import { getDb } from '../config/database.js';
import { resolveTopicsAndCategories } from './keywordMatcher.js';

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

  // Check for existing pending suggestion with the same name (case-insensitive)
  const existingPending = db.prepare(`
    SELECT id FROM taxonomy_suggestions
    WHERE suggestion_type = 'new_keyword' AND status = 'pending'
      AND LOWER(json_extract(suggested_data, '$.name')) = ?
    LIMIT 1
  `);

  // Check if keyword already exists in the keywords table
  const existingKeyword = db.prepare(`
    SELECT id FROM keywords WHERE name_normalized = ? LIMIT 1
  `);

  const seenInBatch = new Set();

  for (const item of unmatchedEntities) {
    const normalized = item.entity.name.toLowerCase().trim();

    // Skip duplicates within this batch
    if (seenInBatch.has(normalized)) continue;
    seenInBatch.add(normalized);

    // Skip if keyword already exists
    if (existingKeyword.get(normalized)) continue;

    // Skip if an identical pending suggestion already exists
    if (existingPending.get(normalized)) continue;

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

/**
 * Auto-approve and link all extracted keywords for a quote.
 * For each keyword string:
 *   1. If it exists in keywords table → link via quote_keywords
 *   2. If a pending taxonomy_suggestion exists → approve it, then link
 *   3. Otherwise → create the keyword directly, then link
 * After linking all keywords, resolve topics.
 * @param {number} quoteId
 * @param {Object} [dbOverride] - optional db override for testing
 */
export function autoApproveQuoteKeywords(quoteId, dbOverride) {
  const db = dbOverride || getDb();

  const quote = db.prepare('SELECT extracted_keywords, quote_datetime FROM quotes WHERE id = ?').get(quoteId);
  if (!quote || !quote.extracted_keywords) return;

  let keywordStrings;
  try {
    keywordStrings = JSON.parse(quote.extracted_keywords);
  } catch {
    return;
  }
  if (!Array.isArray(keywordStrings) || keywordStrings.length === 0) return;

  const findKeyword = db.prepare('SELECT id FROM keywords WHERE name_normalized = ? LIMIT 1');
  const findPendingSuggestion = db.prepare(`
    SELECT id FROM taxonomy_suggestions
    WHERE suggestion_type = 'new_keyword' AND status = 'pending'
      AND LOWER(json_extract(suggested_data, '$.name')) = ?
    LIMIT 1
  `);
  const insertKeyword = db.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)');
  const insertAlias = db.prepare('INSERT OR IGNORE INTO keyword_aliases (keyword_id, alias, alias_normalized) VALUES (?, ?, ?)');
  const linkQuoteKeyword = db.prepare('INSERT OR IGNORE INTO quote_keywords (quote_id, keyword_id, confidence) VALUES (?, ?, ?)');
  const approveSugg = db.prepare("UPDATE taxonomy_suggestions SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?");

  const linkedKeywordIds = [];

  for (const kwString of keywordStrings) {
    if (!kwString || typeof kwString !== 'string') continue;
    const normalized = kwString.toLowerCase().trim();
    if (!normalized) continue;

    let keywordId;

    // 1. Check if keyword already exists
    const existing = findKeyword.get(normalized);
    if (existing) {
      keywordId = existing.id;
    } else {
      // 2. Check for pending taxonomy suggestion
      const suggestion = findPendingSuggestion.get(normalized);
      if (suggestion) {
        // Approve the suggestion and create the keyword
        const result = insertKeyword.run(kwString, normalized);
        keywordId = result.lastInsertRowid;
        insertAlias.run(keywordId, kwString, normalized);
        approveSugg.run(suggestion.id);
      } else {
        // 3. Create keyword directly
        const result = insertKeyword.run(kwString, normalized);
        keywordId = result.lastInsertRowid;
        insertAlias.run(keywordId, kwString, normalized);
      }
    }

    // Link to quote
    linkQuoteKeyword.run(quoteId, keywordId, 'high');
    linkedKeywordIds.push({ keyword: { keyword_id: keywordId } });
  }

  // Resolve topics based on linked keywords
  if (linkedKeywordIds.length > 0) {
    resolveTopicsAndCategories(quoteId, linkedKeywordIds, quote.quote_datetime || null);
  }
}
