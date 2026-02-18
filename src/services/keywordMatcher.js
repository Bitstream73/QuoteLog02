import { getDb } from '../config/database.js';
import jaroWinkler from 'jaro-winkler';

/**
 * Match extracted entities against keyword aliases
 * @param {Array<{name: string, type: string}>} entities - extracted entities
 * @returns {{ matched: Array<{entity, keyword, confidence}>, unmatched: Array, flagged: Array }}
 */
export function matchEntities(entities) {
  const db = getDb();

  // Load all keyword aliases (with keyword info)
  const aliases = db.prepare(`
    SELECT ka.alias_normalized, ka.keyword_id, k.name as keyword_name, k.name_normalized
    FROM keyword_aliases ka
    JOIN keywords k ON k.id = ka.keyword_id
  `).all();

  // Also match against keyword names directly
  const keywords = db.prepare(`SELECT id, name, name_normalized FROM keywords`).all();

  const matched = [];
  const unmatched = [];
  const flagged = [];

  for (const entity of entities) {
    const normalized = entity.name.toLowerCase().trim();
    let bestMatch = null;
    let bestScore = 0;

    // Check exact match on keyword names
    for (const kw of keywords) {
      if (kw.name_normalized === normalized) {
        bestMatch = { keyword_id: kw.id, keyword_name: kw.name };
        bestScore = 1.0;
        break;
      }
    }

    // Check exact match on aliases
    if (!bestMatch) {
      for (const alias of aliases) {
        if (alias.alias_normalized === normalized) {
          bestMatch = { keyword_id: alias.keyword_id, keyword_name: alias.keyword_name };
          bestScore = 1.0;
          break;
        }
      }
    }

    // If no exact match, try fuzzy matching
    if (!bestMatch) {
      // Check against keyword names
      for (const kw of keywords) {
        const score = jaroWinkler(normalized, kw.name_normalized);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = { keyword_id: kw.id, keyword_name: kw.name };
        }
      }

      // Check against aliases
      for (const alias of aliases) {
        const score = jaroWinkler(normalized, alias.alias_normalized);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = { keyword_id: alias.keyword_id, keyword_name: alias.keyword_name };
        }
      }
    }

    // Classify by confidence threshold
    if (bestScore >= 0.95) {
      matched.push({ entity, keyword: bestMatch, confidence: 'high', score: bestScore });
    } else if (bestScore >= 0.85) {
      matched.push({ entity, keyword: bestMatch, confidence: 'medium', score: bestScore });
      flagged.push({ entity, keyword: bestMatch, confidence: 'medium', score: bestScore });
    } else {
      unmatched.push({ entity, bestMatch, bestScore });
    }
  }

  return { matched, unmatched, flagged };
}

/**
 * Store keyword matches for a quote
 * @param {number} quoteId
 * @param {Array<{keyword, confidence}>} matches
 */
export function storeQuoteKeywords(quoteId, matches) {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO quote_keywords (quote_id, keyword_id, confidence)
    VALUES (?, ?, ?)
  `);

  for (const match of matches) {
    insert.run(quoteId, match.keyword.keyword_id, match.confidence);
  }
}

/**
 * Resolve topics and categories for a quote based on matched keywords.
 * Applies temporal scoping from topic date ranges.
 * @param {number} quoteId
 * @param {Array<{keyword}>} matches - matched keywords
 * @param {string} quoteDate - ISO date string of the quote
 */
/**
 * Match extracted topic names against existing topics and topic aliases.
 * Uses exact case-insensitive matching only (no fuzzy matching).
 * @param {Array<string>} topicNames - topic strings from Gemini extraction
 * @returns {{ matched: Array<{topicName: string, topicId: number}>, unmatched: Array<{topicName: string}> }}
 */
export function matchTopics(topicNames) {
  const db = getDb();

  const topics = db.prepare(`SELECT id, name FROM topics WHERE status = 'active'`).all();
  const aliases = db.prepare(`
    SELECT ta.alias_normalized, ta.topic_id, t.name as topic_name
    FROM topic_aliases ta
    JOIN topics t ON t.id = ta.topic_id
    WHERE t.status = 'active'
  `).all();

  const matched = [];
  const unmatched = [];

  for (const topicName of topicNames) {
    if (!topicName || typeof topicName !== 'string') continue;
    const normalized = topicName.toLowerCase().trim();
    if (!normalized) continue;

    let found = null;

    // Exact match on topic name
    for (const t of topics) {
      if (t.name.toLowerCase() === normalized) {
        found = { topicName: t.name, topicId: t.id };
        break;
      }
    }

    // Exact match on topic alias
    if (!found) {
      for (const a of aliases) {
        if (a.alias_normalized === normalized) {
          found = { topicName: a.topic_name, topicId: a.topic_id };
          break;
        }
      }
    }

    if (found) {
      matched.push(found);
    } else {
      unmatched.push({ topicName });
    }
  }

  return { matched, unmatched };
}

/**
 * Store direct topic-quote links for matched topics, respecting temporal scoping.
 * @param {number} quoteId
 * @param {Array<{topicName: string, topicId: number}>} matchedTopics
 * @param {string} quoteDate - ISO date string
 */
export function storeQuoteTopicsDirect(quoteId, matchedTopics, quoteDate) {
  const db = getDb();
  const insertTopic = db.prepare(`INSERT OR IGNORE INTO quote_topics (quote_id, topic_id) VALUES (?, ?)`);

  for (const { topicId } of matchedTopics) {
    const topic = db.prepare(`SELECT start_date, end_date FROM topics WHERE id = ?`).get(topicId);
    if (!topic) continue;

    let inRange = true;
    if (topic.start_date && quoteDate) {
      if (quoteDate < topic.start_date) inRange = false;
    }
    if (topic.end_date && quoteDate) {
      if (quoteDate > topic.end_date) inRange = false;
    }

    if (inRange) {
      insertTopic.run(quoteId, topicId);
    }
  }
}

export function resolveTopicsAndCategories(quoteId, matches, quoteDate) {
  const db = getDb();

  const keywordIds = matches.map(m => m.keyword.keyword_id);
  if (keywordIds.length === 0) return;

  // Find topics for these keywords, applying date filtering
  const placeholders = keywordIds.map(() => '?').join(',');
  const topics = db.prepare(`
    SELECT DISTINCT t.id, t.start_date, t.end_date, t.status
    FROM topics t
    JOIN topic_keywords tk ON tk.topic_id = t.id
    WHERE tk.keyword_id IN (${placeholders})
    AND t.status = 'active'
  `).all(...keywordIds);

  // Apply temporal scoping
  const insertTopic = db.prepare(`INSERT OR IGNORE INTO quote_topics (quote_id, topic_id) VALUES (?, ?)`);

  for (const topic of topics) {
    let inRange = true;

    if (topic.start_date && quoteDate) {
      if (quoteDate < topic.start_date) inRange = false;
    }
    if (topic.end_date && quoteDate) {
      if (quoteDate > topic.end_date) inRange = false;
    }

    if (inRange) {
      insertTopic.run(quoteId, topic.id);
    }
  }
}
