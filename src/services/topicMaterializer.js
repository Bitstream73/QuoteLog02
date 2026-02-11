import { getDb } from '../config/database.js';

/**
 * Rebuild quote_topics cache by matching topic keywords against quote keywords.
 * A quote matches a topic if they share at least one keyword via topic_keywords ↔ quote_keywords.
 * @param {object} [dbOverride] - optional database handle (for testing)
 * @returns {{ topicsProcessed: number, linksCreated: number }}
 */
export function materializeTopics(dbOverride) {
  const db = dbOverride || getDb();

  // Clear existing quote_topics
  db.exec('DELETE FROM quote_topics');

  const topics = db.prepare('SELECT id FROM topics').all();

  const findQuotes = db.prepare(`
    SELECT DISTINCT qk.quote_id
    FROM topic_keywords tk
    JOIN quote_keywords qk ON qk.keyword_id = tk.keyword_id
    JOIN quotes q ON q.id = qk.quote_id AND q.is_visible = 1
    WHERE tk.topic_id = ?
  `);

  const insertQuoteTopic = db.prepare(
    'INSERT OR IGNORE INTO quote_topics (quote_id, topic_id) VALUES (?, ?)'
  );

  let linksCreated = 0;

  const insertMany = db.transaction((topics) => {
    for (const topic of topics) {
      const quotes = findQuotes.all(topic.id);
      for (const row of quotes) {
        const result = insertQuoteTopic.run(row.quote_id, topic.id);
        if (result.changes > 0) linksCreated++;
      }
    }
  });

  insertMany(topics);

  return { topicsProcessed: topics.length, linksCreated };
}

/**
 * Materialize a single topic (after create/update).
 * @param {number} topicId
 * @param {object} [dbOverride]
 * @returns {{ linksCreated: number }}
 */
export function materializeSingleTopic(topicId, dbOverride) {
  const db = dbOverride || getDb();

  // Remove existing links for this topic
  db.prepare('DELETE FROM quote_topics WHERE topic_id = ?').run(topicId);

  const quotes = db.prepare(`
    SELECT DISTINCT qk.quote_id
    FROM topic_keywords tk
    JOIN quote_keywords qk ON qk.keyword_id = tk.keyword_id
    JOIN quotes q ON q.id = qk.quote_id AND q.is_visible = 1
    WHERE tk.topic_id = ?
  `).all(topicId);

  const insertQuoteTopic = db.prepare(
    'INSERT OR IGNORE INTO quote_topics (quote_id, topic_id) VALUES (?, ?)'
  );

  let linksCreated = 0;
  for (const row of quotes) {
    const result = insertQuoteTopic.run(row.quote_id, topicId);
    if (result.changes > 0) linksCreated++;
  }

  return { linksCreated };
}

export default { materializeTopics, materializeSingleTopic };
