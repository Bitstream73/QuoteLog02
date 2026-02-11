import { getDb } from '../config/database.js';

/**
 * Compute recency bonus — decays over 7 days with ~48h half-life.
 * @param {string} createdAt - ISO datetime string
 * @returns {number}
 */
function recencyBonus(createdAt) {
  if (!createdAt) return 0.0;
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  if (ageHours <= 0) return 10.0;
  if (ageHours > 168) return 0.0; // 7 days
  return 10.0 * Math.exp(-ageHours / 48);
}

/**
 * Recalculate trending_score for all quotes.
 */
function recalculateQuotes(db) {
  const quotes = db.prepare(
    'SELECT id, importants_count, share_count, created_at FROM quotes WHERE is_visible = 1'
  ).all();

  const update = db.prepare('UPDATE quotes SET trending_score = ? WHERE id = ?');

  const updateMany = db.transaction((quotes) => {
    for (const q of quotes) {
      const score = q.importants_count * 3.0
        + q.share_count * 2.0
        + recencyBonus(q.created_at);
      update.run(Math.round(score * 100) / 100, q.id);
    }
  });

  updateMany(quotes);
}

/**
 * Recalculate trending_score for all articles (includes child quote importants + recency).
 */
function recalculateArticles(db) {
  const articles = db.prepare(`
    SELECT a.id, a.importants_count, a.share_count, a.view_count, a.published_at,
      COALESCE(SUM(q.importants_count), 0) as child_importants
    FROM articles a
    LEFT JOIN quote_articles qa ON qa.article_id = a.id
    LEFT JOIN quotes q ON q.id = qa.quote_id AND q.is_visible = 1
    GROUP BY a.id
  `).all();

  const update = db.prepare('UPDATE articles SET trending_score = ? WHERE id = ?');

  const updateMany = db.transaction((articles) => {
    for (const a of articles) {
      const score = a.importants_count * 3.0
        + a.share_count * 2.0
        + a.view_count * 0.5
        + a.child_importants * 1.0
        + recencyBonus(a.published_at);
      update.run(Math.round(score * 100) / 100, a.id);
    }
  });

  updateMany(articles);
}

/**
 * Recalculate trending_score for all persons.
 */
function recalculatePersons(db) {
  const persons = db.prepare(
    'SELECT id, importants_count, share_count, view_count FROM persons'
  ).all();

  const update = db.prepare('UPDATE persons SET trending_score = ? WHERE id = ?');

  const updateMany = db.transaction((persons) => {
    for (const p of persons) {
      const score = p.importants_count * 3.0
        + p.share_count * 2.0
        + p.view_count * 0.5;
      update.run(Math.round(score * 100) / 100, p.id);
    }
  });

  updateMany(persons);
}

/**
 * Recalculate trending_score for all topics (includes child quote importants).
 */
function recalculateTopics(db) {
  const topics = db.prepare(`
    SELECT t.id, t.importants_count, t.share_count, t.view_count,
      COALESCE(SUM(q.importants_count), 0) as child_importants
    FROM topics t
    LEFT JOIN quote_topics qt ON qt.topic_id = t.id
    LEFT JOIN quotes q ON q.id = qt.quote_id AND q.is_visible = 1
    GROUP BY t.id
  `).all();

  const update = db.prepare('UPDATE topics SET trending_score = ? WHERE id = ?');

  const updateMany = db.transaction((topics) => {
    for (const t of topics) {
      const score = t.importants_count * 3.0
        + t.share_count * 2.0
        + t.view_count * 0.5
        + t.child_importants * 1.0;
      update.run(Math.round(score * 100) / 100, t.id);
    }
  });

  updateMany(topics);
}

/**
 * Recalculate trending scores for all entity types.
 * @param {object} [dbOverride]
 */
export function recalculateTrendingScores(dbOverride) {
  const db = dbOverride || getDb();
  recalculateQuotes(db);
  recalculateArticles(db);
  recalculatePersons(db);
  recalculateTopics(db);
}

/**
 * Targeted recalculation for a single entity after important/share event.
 * Also recalculates parent entities (article -> its person, topics -> via quotes).
 * @param {object} dbOverride
 * @param {string} entityType
 * @param {number} entityId
 */
export function recalculateEntityScore(dbOverride, entityType, entityId) {
  const db = dbOverride || getDb();

  if (entityType === 'quote') {
    // Recalculate the quote
    const q = db.prepare(
      'SELECT id, importants_count, share_count, created_at FROM quotes WHERE id = ?'
    ).get(entityId);
    if (q) {
      const score = q.importants_count * 3.0 + q.share_count * 2.0 + recencyBonus(q.created_at);
      db.prepare('UPDATE quotes SET trending_score = ? WHERE id = ?').run(Math.round(score * 100) / 100, q.id);
    }

    // Also recalculate parent article(s)
    const articles = db.prepare(
      'SELECT article_id FROM quote_articles WHERE quote_id = ?'
    ).all(entityId);
    for (const row of articles) {
      recalculateEntityScore(db, 'article', row.article_id);
    }

    // Also recalculate parent topic(s)
    const topics = db.prepare(
      'SELECT topic_id FROM quote_topics WHERE quote_id = ?'
    ).all(entityId);
    for (const row of topics) {
      recalculateEntityScore(db, 'topic', row.topic_id);
    }

    // Also recalculate parent person
    const quote = db.prepare('SELECT person_id FROM quotes WHERE id = ?').get(entityId);
    if (quote) {
      recalculateEntityScore(db, 'person', quote.person_id);
    }
  } else if (entityType === 'article') {
    const a = db.prepare(`
      SELECT a.id, a.importants_count, a.share_count, a.view_count, a.published_at,
        COALESCE(SUM(q.importants_count), 0) as child_importants
      FROM articles a
      LEFT JOIN quote_articles qa ON qa.article_id = a.id
      LEFT JOIN quotes q ON q.id = qa.quote_id AND q.is_visible = 1
      WHERE a.id = ?
      GROUP BY a.id
    `).get(entityId);
    if (a) {
      const score = a.importants_count * 3.0 + a.share_count * 2.0 + a.view_count * 0.5
        + a.child_importants * 1.0 + recencyBonus(a.published_at);
      db.prepare('UPDATE articles SET trending_score = ? WHERE id = ?').run(Math.round(score * 100) / 100, a.id);
    }
  } else if (entityType === 'person') {
    const p = db.prepare(
      'SELECT id, importants_count, share_count, view_count FROM persons WHERE id = ?'
    ).get(entityId);
    if (p) {
      const score = p.importants_count * 3.0 + p.share_count * 2.0 + p.view_count * 0.5;
      db.prepare('UPDATE persons SET trending_score = ? WHERE id = ?').run(Math.round(score * 100) / 100, p.id);
    }
  } else if (entityType === 'topic') {
    const t = db.prepare(`
      SELECT t.id, t.importants_count, t.share_count, t.view_count,
        COALESCE(SUM(q.importants_count), 0) as child_importants
      FROM topics t
      LEFT JOIN quote_topics qt ON qt.topic_id = t.id
      LEFT JOIN quotes q ON q.id = qt.quote_id AND q.is_visible = 1
      WHERE t.id = ?
      GROUP BY t.id
    `).get(entityId);
    if (t) {
      const score = t.importants_count * 3.0 + t.share_count * 2.0 + t.view_count * 0.5
        + t.child_importants * 1.0;
      db.prepare('UPDATE topics SET trending_score = ? WHERE id = ?').run(Math.round(score * 100) / 100, t.id);
    }
  }
}

// Export recencyBonus for testing
export { recencyBonus };

export default { recalculateTrendingScores, recalculateEntityScore, recencyBonus };
