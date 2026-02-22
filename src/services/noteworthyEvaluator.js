// Time-based evaluation engine for noteworthy card configs

export function getTimeWindowStart(period) {
  const now = new Date();
  switch (period) {
    case 'hour': return new Date(now - 60 * 60 * 1000).toISOString();
    case 'day': return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case 'week': return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'month': return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    default: throw new Error(`Invalid period: ${period}`);
  }
}

export function evaluateQuoteOfPeriod(db, period, config = {}) {
  const since = getTimeWindowStart(period);
  let sql = `
    SELECT q.*, p.canonical_name as person_name, p.photo_url, p.category_context as person_category_context
    FROM quotes q
    JOIN persons p ON p.id = q.person_id
    WHERE q.is_visible = 1 AND q.canonical_quote_id IS NULL AND q.created_at >= ?
  `;
  const params = [since];

  if (config.filter_type === 'author') {
    sql += ' AND q.person_id = ?';
    params.push(config.filter_value);
  } else if (config.filter_type === 'topic') {
    sql += ' AND q.id IN (SELECT qt.quote_id FROM quote_topics qt WHERE qt.topic_id = ?)';
    params.push(config.filter_value);
  } else if (config.filter_type === 'keyword') {
    sql += ' AND q.id IN (SELECT qk.quote_id FROM quote_keywords qk WHERE qk.keyword_id = ?)';
    params.push(config.filter_value);
  } else if (config.filter_type === 'category') {
    sql += ' AND q.id IN (SELECT qt.quote_id FROM quote_topics qt JOIN category_topics ct ON ct.topic_id = qt.topic_id WHERE ct.category_id = ?)';
    params.push(config.filter_value);
  }

  sql += ' ORDER BY q.importants_count DESC LIMIT 1';
  return db.prepare(sql).get(...params) || null;
}

export function evaluateAuthorOfPeriod(db, period) {
  const since = getTimeWindowStart(period);
  const person = db.prepare(`
    SELECT p.id, p.canonical_name, p.photo_url, p.category, p.category_context,
           SUM(q.importants_count) as period_importants
    FROM persons p
    JOIN quotes q ON q.person_id = p.id
    WHERE q.is_visible = 1 AND q.canonical_quote_id IS NULL AND q.created_at >= ?
    GROUP BY p.id
    ORDER BY period_importants DESC
    LIMIT 1
  `).get(since);
  if (!person) return null;

  const top_quotes = db.prepare(`
    SELECT id, text, context, importants_count, fact_check_verdict
    FROM quotes
    WHERE person_id = ? AND is_visible = 1 AND canonical_quote_id IS NULL AND created_at >= ?
    ORDER BY importants_count DESC
    LIMIT 3
  `).all(person.id, since);

  return { entity: person, top_quotes };
}

export function evaluateSourceOfPeriod(db, period) {
  const since = getTimeWindowStart(period);
  const source = db.prepare(`
    SELECT sa.id, sa.name, sa.domain, sa.image_url,
           SUM(q.importants_count) as period_importants
    FROM source_authors sa
    JOIN sources s ON s.source_author_id = sa.id
    JOIN articles a ON a.source_id = s.id
    JOIN quote_articles qa ON qa.article_id = a.id
    JOIN quotes q ON q.id = qa.quote_id
    WHERE q.is_visible = 1 AND q.canonical_quote_id IS NULL AND q.created_at >= ?
    GROUP BY sa.id
    ORDER BY period_importants DESC
    LIMIT 1
  `).get(since);
  if (!source) return null;

  const top_quotes = db.prepare(`
    SELECT q.id, q.text, q.context, q.importants_count, q.fact_check_verdict,
           p.canonical_name as person_name, p.photo_url
    FROM quotes q
    JOIN persons p ON p.id = q.person_id
    JOIN quote_articles qa ON qa.quote_id = q.id
    JOIN articles a ON a.id = qa.article_id
    JOIN sources s ON s.id = a.source_id
    WHERE s.source_author_id = ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL AND q.created_at >= ?
    ORDER BY q.importants_count DESC
    LIMIT 3
  `).all(source.id, since);

  return { entity: source, top_quotes };
}

export function evaluateTopicOfPeriod(db, period) {
  const since = getTimeWindowStart(period);
  const topic = db.prepare(`
    SELECT t.id, t.name, t.slug, t.description,
           SUM(q.importants_count) as period_importants
    FROM topics t
    JOIN quote_topics qt ON qt.topic_id = t.id
    JOIN quotes q ON q.id = qt.quote_id
    WHERE q.is_visible = 1 AND q.canonical_quote_id IS NULL AND q.created_at >= ?
    GROUP BY t.id
    ORDER BY period_importants DESC
    LIMIT 1
  `).get(since);
  if (!topic) return null;

  const top_quotes = db.prepare(`
    SELECT q.id, q.text, q.context, q.importants_count, q.fact_check_verdict,
           p.canonical_name as person_name, p.photo_url
    FROM quotes q
    JOIN persons p ON p.id = q.person_id
    JOIN quote_topics qt ON qt.quote_id = q.id
    WHERE qt.topic_id = ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL AND q.created_at >= ?
    ORDER BY q.importants_count DESC
    LIMIT 3
  `).all(topic.id, since);

  return { entity: topic, top_quotes };
}

export function evaluateCategoryOfPeriod(db, period) {
  const since = getTimeWindowStart(period);
  const category = db.prepare(`
    SELECT c.id, c.name, c.slug, c.image_url, c.icon_name,
           SUM(q.importants_count) as period_importants
    FROM categories c
    JOIN category_topics ct ON ct.category_id = c.id
    JOIN quote_topics qt ON qt.topic_id = ct.topic_id
    JOIN quotes q ON q.id = qt.quote_id
    WHERE q.is_visible = 1 AND q.canonical_quote_id IS NULL AND q.created_at >= ?
    GROUP BY c.id
    ORDER BY period_importants DESC
    LIMIT 1
  `).get(since);
  if (!category) return null;

  const top_quotes = db.prepare(`
    SELECT q.id, q.text, q.context, q.importants_count, q.fact_check_verdict,
           p.canonical_name as person_name, p.photo_url
    FROM quotes q
    JOIN persons p ON p.id = q.person_id
    JOIN quote_topics qt ON qt.quote_id = q.id
    JOIN category_topics ct ON ct.topic_id = qt.topic_id
    WHERE ct.category_id = ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL AND q.created_at >= ?
    GROUP BY q.id
    ORDER BY q.importants_count DESC
    LIMIT 3
  `).all(category.id, since);

  return { entity: category, top_quotes };
}

export function evaluateCard(db, cardConfig) {
  const config = JSON.parse(cardConfig.config || '{}');
  const parts = cardConfig.card_type.split('_');

  const entityType = parts[0];

  if (entityType === 'search') {
    return { type: 'search', data: { search_type: cardConfig.card_type.replace('search_', '') } };
  }
  if (entityType === 'info') {
    return { type: 'info', data: { info_type: cardConfig.card_type.replace('info_', '') } };
  }

  // Time-based: e.g. "author_of_day" → entityType="author", period="day"
  const period = parts[parts.length - 1]; // last part is the period

  switch (entityType) {
    case 'quote': return { type: 'quote', data: evaluateQuoteOfPeriod(db, period, config) };
    case 'author': return { type: 'author', data: evaluateAuthorOfPeriod(db, period) };
    case 'source': return { type: 'source', data: evaluateSourceOfPeriod(db, period) };
    case 'topic': return { type: 'topic', data: evaluateTopicOfPeriod(db, period) };
    case 'category': return { type: 'category', data: evaluateCategoryOfPeriod(db, period) };
    default: return null;
  }
}
