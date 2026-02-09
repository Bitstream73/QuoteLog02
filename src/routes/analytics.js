import { Router } from 'express';
import { getDb } from '../config/database.js';

const router = Router();

const VALID_PERIODS = ['day', 'week', 'month', 'year'];

function getPeriodClause(period) {
  const map = { day: '-1 day', week: '-7 days', month: '-30 days', year: '-365 days' };
  return `datetime('now', '${map[period] || map.week}')`;
}

function validatePeriod(period) {
  return VALID_PERIODS.includes(period) ? period : 'week';
}

// GET /api/analytics/overview
router.get('/analytics/overview', (req, res) => {
  try {
    const db = getDb();

    // Quotes today
    const quotesToday = db.prepare(
      "SELECT COUNT(*) as count FROM quotes WHERE date(created_at) = date('now') AND is_visible = 1"
    ).get().count;

    // Quotes this week
    const quotesThisWeek = db.prepare(
      "SELECT COUNT(*) as count FROM quotes WHERE created_at >= datetime('now', '-7 days') AND is_visible = 1"
    ).get().count;

    // Total quotes
    const quotesTotal = db.prepare(
      'SELECT COUNT(*) as count FROM quotes WHERE is_visible = 1'
    ).get().count;

    // Articles today
    const articlesToday = db.prepare(
      "SELECT COUNT(*) as count FROM articles WHERE date(created_at) = date('now')"
    ).get().count;

    // Top author today
    const topAuthorToday = db.prepare(`
      SELECT p.id, p.canonical_name, p.photo_url, COUNT(q.id) as quote_count
      FROM quotes q JOIN persons p ON q.person_id = p.id
      WHERE date(q.created_at) = date('now') AND q.is_visible = 1
      GROUP BY p.id ORDER BY quote_count DESC LIMIT 1
    `).get() || null;

    // Most upvoted today
    const mostUpvotedToday = db.prepare(`
      SELECT q.id, q.text, p.canonical_name,
             COALESCE(SUM(v.vote_value), 0) as vote_score
      FROM quotes q
      JOIN persons p ON q.person_id = p.id
      LEFT JOIN votes v ON v.quote_id = q.id
      WHERE date(q.created_at) = date('now') AND q.is_visible = 1
      GROUP BY q.id ORDER BY vote_score DESC LIMIT 1
    `).get() || null;

    // Quotes per day (last 30 days)
    const quotesPerDay = db.prepare(`
      SELECT date(created_at) as date, COUNT(*) as count
      FROM quotes WHERE is_visible = 1
        AND created_at >= datetime('now', '-30 days')
      GROUP BY date(created_at) ORDER BY date
    `).all();

    res.json({
      quotes_today: quotesToday,
      quotes_this_week: quotesThisWeek,
      quotes_total: quotesTotal,
      articles_today: articlesToday,
      top_author_today: topAuthorToday ? {
        id: topAuthorToday.id,
        name: topAuthorToday.canonical_name,
        photo_url: topAuthorToday.photo_url,
        quote_count: topAuthorToday.quote_count,
      } : null,
      most_upvoted_today: mostUpvotedToday ? {
        id: mostUpvotedToday.id,
        text: mostUpvotedToday.text,
        person_name: mostUpvotedToday.canonical_name,
        vote_score: mostUpvotedToday.vote_score,
      } : null,
      quotes_per_day: quotesPerDay,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/quotes?period=week
router.get('/analytics/quotes', (req, res) => {
  try {
    const db = getDb();
    const period = validatePeriod(req.query.period);
    const periodClause = getPeriodClause(period);

    const quotes = db.prepare(`
      SELECT q.id, q.text, q.person_id, p.canonical_name, p.photo_url, q.created_at,
             COALESCE(SUM(v.vote_value), 0) as vote_score,
             COUNT(CASE WHEN v.vote_value = 1 THEN 1 END) as upvotes,
             COUNT(CASE WHEN v.vote_value = -1 THEN 1 END) as downvotes
      FROM quotes q
      JOIN persons p ON q.person_id = p.id
      LEFT JOIN votes v ON v.quote_id = q.id
      WHERE q.created_at >= ${periodClause} AND q.is_visible = 1
      GROUP BY q.id
      ORDER BY vote_score DESC
      LIMIT 20
    `).all();

    res.json({
      period,
      quotes: quotes.map(q => ({
        id: q.id,
        text: q.text,
        person_id: q.person_id,
        person_name: q.canonical_name,
        photo_url: q.photo_url,
        vote_score: q.vote_score,
        upvotes: q.upvotes,
        downvotes: q.downvotes,
        created_at: q.created_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/authors?period=week
router.get('/analytics/authors', (req, res) => {
  try {
    const db = getDb();
    const period = validatePeriod(req.query.period);
    const periodClause = getPeriodClause(period);

    const authors = db.prepare(`
      SELECT p.id, p.canonical_name, p.photo_url, p.category,
             COUNT(q.id) as quote_count,
             COALESCE(SUM(vs.vote_score), 0) as total_vote_score
      FROM persons p
      JOIN quotes q ON q.person_id = p.id
      LEFT JOIN (
        SELECT quote_id, SUM(vote_value) as vote_score FROM votes GROUP BY quote_id
      ) vs ON vs.quote_id = q.id
      WHERE q.created_at >= ${periodClause} AND q.is_visible = 1
      GROUP BY p.id
      ORDER BY quote_count DESC, total_vote_score DESC
      LIMIT 20
    `).all();

    res.json({
      period,
      authors: authors.map(a => ({
        id: a.id,
        name: a.canonical_name,
        photo_url: a.photo_url,
        category: a.category,
        quote_count: a.quote_count,
        total_vote_score: a.total_vote_score,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/topics?period=week
router.get('/analytics/topics', (req, res) => {
  try {
    const db = getDb();
    const period = validatePeriod(req.query.period);
    const periodClause = getPeriodClause(period);

    // Current period keyword counts
    const currentTopics = db.prepare(`
      SELECT qk.keyword, COUNT(*) as count
      FROM quote_keywords qk
      JOIN quotes q ON q.id = qk.quote_id
      WHERE q.created_at >= ${periodClause} AND q.is_visible = 1
      GROUP BY qk.keyword
      ORDER BY count DESC
      LIMIT 30
    `).all();

    // Previous period counts for trend calculation
    const prevPeriodMap = {
      day: { start: '-2 days', end: '-1 day' },
      week: { start: '-14 days', end: '-7 days' },
      month: { start: '-60 days', end: '-30 days' },
      year: { start: '-730 days', end: '-365 days' },
    };
    const prev = prevPeriodMap[period] || prevPeriodMap.week;

    const prevTopics = db.prepare(`
      SELECT qk.keyword, COUNT(*) as count
      FROM quote_keywords qk
      JOIN quotes q ON q.id = qk.quote_id
      WHERE q.created_at >= datetime('now', '${prev.start}')
        AND q.created_at < datetime('now', '${prev.end}')
        AND q.is_visible = 1
      GROUP BY qk.keyword
    `).all();

    const prevMap = {};
    for (const t of prevTopics) {
      prevMap[t.keyword] = t.count;
    }

    // Calculate trends
    const topics = currentTopics.map(t => {
      const prevCount = prevMap[t.keyword] || 0;
      let trend = 'stable';
      if (prevCount === 0 && t.count > 0) {
        trend = 'up';
      } else if (prevCount > 0) {
        if (t.count > prevCount * 1.1) trend = 'up';
        else if (t.count < prevCount * 0.9) trend = 'down';
      }
      return { keyword: t.keyword, count: t.count, trend };
    });

    res.json({ period, topics });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Temporal Trend Endpoints ---

function getGranularity(period) {
  const map = {
    day: { fmt: '%Y-%m-%d %H:00:00', label: 'hour' },
    week: { fmt: '%Y-%m-%d', label: 'day' },
    month: { fmt: '%Y-%m-%d', label: 'day' },
    year: { fmt: '%Y-W%W', label: 'week' },
  };
  return map[period] || map.week;
}

// GET /api/analytics/trends/quotes?period=month — Daily/hourly quote counts
router.get('/analytics/trends/quotes', (req, res) => {
  try {
    const db = getDb();
    const period = validatePeriod(req.query.period);
    const periodClause = getPeriodClause(period);
    const gran = getGranularity(period);

    const buckets = db.prepare(`
      SELECT strftime('${gran.fmt}', q.created_at) as bucket, COUNT(*) as count
      FROM quotes q
      WHERE q.is_visible = 1 AND q.created_at >= ${periodClause}
      GROUP BY bucket ORDER BY bucket
    `).all();

    res.json({ period, granularity: gran.label, buckets });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/trends/topics?period=month&limit=5 — Top N topics over time
router.get('/analytics/trends/topics', (req, res) => {
  try {
    const db = getDb();
    const period = validatePeriod(req.query.period);
    const periodClause = getPeriodClause(period);
    const gran = getGranularity(period);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 10);

    // Step 1: find top N keywords in this period
    const topKeywords = db.prepare(`
      SELECT qk.keyword, COUNT(*) as total
      FROM quote_keywords qk
      JOIN quotes q ON q.id = qk.quote_id
      WHERE q.is_visible = 1 AND q.created_at >= ${periodClause}
      GROUP BY qk.keyword ORDER BY total DESC LIMIT ?
    `).all(limit);

    if (topKeywords.length === 0) {
      return res.json({ period, granularity: gran.label, series: [] });
    }

    // Step 2: get time-bucketed counts for those keywords
    const placeholders = topKeywords.map(() => '?').join(',');
    const keywordNames = topKeywords.map(k => k.keyword);

    const rows = db.prepare(`
      SELECT qk.keyword, strftime('${gran.fmt}', q.created_at) as bucket, COUNT(*) as count
      FROM quote_keywords qk
      JOIN quotes q ON q.id = qk.quote_id
      WHERE q.is_visible = 1 AND q.created_at >= ${periodClause}
        AND qk.keyword IN (${placeholders})
      GROUP BY qk.keyword, bucket ORDER BY bucket
    `).all(...keywordNames);

    // Group by keyword
    const seriesMap = {};
    for (const kw of keywordNames) seriesMap[kw] = { keyword: kw, buckets: [] };
    for (const r of rows) {
      if (seriesMap[r.keyword]) seriesMap[r.keyword].buckets.push({ bucket: r.bucket, count: r.count });
    }

    res.json({ period, granularity: gran.label, series: Object.values(seriesMap) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/trends/sources?period=month&limit=5 — Top N sources over time
router.get('/analytics/trends/sources', (req, res) => {
  try {
    const db = getDb();
    const period = validatePeriod(req.query.period);
    const periodClause = getPeriodClause(period);
    const gran = getGranularity(period);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 10);

    // Step 1: find top N sources in this period
    const topSources = db.prepare(`
      SELECT s.id, s.name, COUNT(DISTINCT q.id) as total
      FROM quotes q
      JOIN quote_articles qa ON qa.quote_id = q.id
      JOIN articles a ON a.id = qa.article_id
      JOIN sources s ON s.id = a.source_id
      WHERE q.is_visible = 1 AND q.created_at >= ${periodClause}
      GROUP BY s.id ORDER BY total DESC LIMIT ?
    `).all(limit);

    if (topSources.length === 0) {
      return res.json({ period, granularity: gran.label, series: [] });
    }

    // Step 2: get time-bucketed counts for those sources
    const sourceIds = topSources.map(s => s.id);
    const placeholders = sourceIds.map(() => '?').join(',');

    const rows = db.prepare(`
      SELECT s.id, s.name, strftime('${gran.fmt}', q.created_at) as bucket, COUNT(DISTINCT q.id) as count
      FROM quotes q
      JOIN quote_articles qa ON qa.quote_id = q.id
      JOIN articles a ON a.id = qa.article_id
      JOIN sources s ON s.id = a.source_id
      WHERE q.is_visible = 1 AND q.created_at >= ${periodClause}
        AND s.id IN (${placeholders})
      GROUP BY s.id, bucket ORDER BY bucket
    `).all(...sourceIds);

    const seriesMap = {};
    for (const s of topSources) seriesMap[s.id] = { source_id: s.id, name: s.name, buckets: [] };
    for (const r of rows) {
      if (seriesMap[r.id]) seriesMap[r.id].buckets.push({ bucket: r.bucket, count: r.count });
    }

    res.json({ period, granularity: gran.label, series: Object.values(seriesMap) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/trends/author/:id?period=month — Author timeline + peers + topics
router.get('/analytics/trends/author/:id', (req, res) => {
  try {
    const db = getDb();
    const authorId = parseInt(req.params.id);
    if (!authorId) return res.status(400).json({ error: 'Invalid author ID' });

    const period = validatePeriod(req.query.period);
    const periodClause = getPeriodClause(period);
    const gran = getGranularity(period);

    // Author timeline
    const timeline = db.prepare(`
      SELECT strftime('${gran.fmt}', q.created_at) as bucket, COUNT(*) as count
      FROM quotes q
      WHERE q.person_id = ? AND q.is_visible = 1 AND q.created_at >= ${periodClause}
      GROUP BY bucket ORDER BY bucket
    `).all(authorId);

    // Topic distribution (keywords for this author's quotes in period)
    const topics = db.prepare(`
      SELECT qk.keyword, COUNT(*) as count
      FROM quote_keywords qk
      JOIN quotes q ON q.id = qk.quote_id
      WHERE q.person_id = ? AND q.is_visible = 1 AND q.created_at >= ${periodClause}
      GROUP BY qk.keyword ORDER BY count DESC LIMIT 8
    `).all(authorId);

    // Peer comparison: find authors in same category
    const author = db.prepare('SELECT id, canonical_name, category FROM persons WHERE id = ?').get(authorId);
    let peers = [];
    if (author && author.category) {
      const peerAuthors = db.prepare(`
        SELECT p.id, p.canonical_name
        FROM persons p
        JOIN quotes q ON q.person_id = p.id
        WHERE p.category = ? AND p.id != ? AND q.is_visible = 1 AND q.created_at >= ${periodClause}
        GROUP BY p.id ORDER BY COUNT(q.id) DESC LIMIT 3
      `).all(author.category, authorId);

      for (const peer of peerAuthors) {
        const peerTimeline = db.prepare(`
          SELECT strftime('${gran.fmt}', q.created_at) as bucket, COUNT(*) as count
          FROM quotes q
          WHERE q.person_id = ? AND q.is_visible = 1 AND q.created_at >= ${periodClause}
          GROUP BY bucket ORDER BY bucket
        `).all(peer.id);
        peers.push({ id: peer.id, name: peer.canonical_name, buckets: peerTimeline });
      }
    }

    res.json({
      period,
      granularity: gran.label,
      author: author ? { id: author.id, name: author.canonical_name, category: author.category } : null,
      timeline,
      topics,
      peers,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/trends/article/:id — Per-author counts + topic distribution
router.get('/analytics/trends/article/:id', (req, res) => {
  try {
    const db = getDb();
    const articleId = parseInt(req.params.id);
    if (!articleId) return res.status(400).json({ error: 'Invalid article ID' });

    // Per-author quote counts
    const authors = db.prepare(`
      SELECT p.id, p.canonical_name as name, COUNT(q.id) as quote_count
      FROM quotes q
      JOIN quote_articles qa ON qa.quote_id = q.id
      JOIN persons p ON p.id = q.person_id
      WHERE qa.article_id = ? AND q.is_visible = 1
      GROUP BY p.id ORDER BY quote_count DESC
    `).all(articleId);

    // Topic distribution
    const topics = db.prepare(`
      SELECT qk.keyword, COUNT(*) as count
      FROM quote_keywords qk
      JOIN quotes q ON q.id = qk.quote_id
      JOIN quote_articles qa ON qa.quote_id = q.id
      WHERE qa.article_id = ? AND q.is_visible = 1
      GROUP BY qk.keyword ORDER BY count DESC LIMIT 10
    `).all(articleId);

    res.json({ article_id: articleId, authors, topics });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Dashboard Endpoints ---

// GET /api/analytics/categories?period=week — Quote counts per person category
router.get('/analytics/categories', (req, res) => {
  try {
    const db = getDb();
    const period = validatePeriod(req.query.period);
    const periodClause = getPeriodClause(period);
    const gran = getGranularity(period);

    const categories = db.prepare(`
      SELECT COALESCE(p.category, 'Other') as category,
             COUNT(DISTINCT q.id) as quote_count,
             COUNT(DISTINCT p.id) as author_count
      FROM quotes q
      JOIN persons p ON q.person_id = p.id
      WHERE q.is_visible = 1 AND q.created_at >= ${periodClause}
      GROUP BY category
      ORDER BY quote_count DESC
    `).all();

    // Time series per category (top 6)
    const topCats = categories.slice(0, 6).map(c => c.category);
    let series = [];
    if (topCats.length > 0) {
      const placeholders = topCats.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT COALESCE(p.category, 'Other') as category,
               strftime('${gran.fmt}', q.created_at) as bucket,
               COUNT(*) as count
        FROM quotes q JOIN persons p ON q.person_id = p.id
        WHERE q.is_visible = 1 AND q.created_at >= ${periodClause}
          AND COALESCE(p.category, 'Other') IN (${placeholders})
        GROUP BY category, bucket ORDER BY bucket
      `).all(...topCats);

      const seriesMap = {};
      for (const cat of topCats) seriesMap[cat] = { category: cat, buckets: [] };
      for (const r of rows) {
        if (seriesMap[r.category]) seriesMap[r.category].buckets.push({ bucket: r.bucket, count: r.count });
      }
      series = Object.values(seriesMap);
    }

    res.json({ period, granularity: gran.label, categories, series });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/compare/authors?ids=1,2,3&period=month — Compare selected authors
router.get('/analytics/compare/authors', (req, res) => {
  try {
    const db = getDb();
    const period = validatePeriod(req.query.period);
    const periodClause = getPeriodClause(period);
    const gran = getGranularity(period);
    const ids = (req.query.ids || '').split(',').map(Number).filter(n => n > 0).slice(0, 8);

    if (ids.length === 0) return res.json({ period, granularity: gran.label, authors: [] });

    const authors = [];
    for (const id of ids) {
      const person = db.prepare('SELECT id, canonical_name as name, category FROM persons WHERE id = ?').get(id);
      if (!person) continue;

      const buckets = db.prepare(`
        SELECT strftime('${gran.fmt}', q.created_at) as bucket, COUNT(*) as count
        FROM quotes q
        WHERE q.person_id = ? AND q.is_visible = 1 AND q.created_at >= ${periodClause}
        GROUP BY bucket ORDER BY bucket
      `).all(id);

      const totalQuotes = buckets.reduce((s, b) => s + b.count, 0);
      authors.push({ id: person.id, name: person.name, category: person.category, total: totalQuotes, buckets });
    }

    res.json({ period, granularity: gran.label, authors });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/compare/topics?keywords=economy,politics&period=month — Compare selected topics
router.get('/analytics/compare/topics', (req, res) => {
  try {
    const db = getDb();
    const period = validatePeriod(req.query.period);
    const periodClause = getPeriodClause(period);
    const gran = getGranularity(period);
    const keywords = (req.query.keywords || '').split(',').map(k => k.trim()).filter(Boolean).slice(0, 8);

    if (keywords.length === 0) return res.json({ period, granularity: gran.label, topics: [] });

    const topics = [];
    for (const keyword of keywords) {
      const buckets = db.prepare(`
        SELECT strftime('${gran.fmt}', q.created_at) as bucket, COUNT(*) as count
        FROM quote_keywords qk
        JOIN quotes q ON q.id = qk.quote_id
        WHERE qk.keyword = ? AND q.is_visible = 1 AND q.created_at >= ${periodClause}
        GROUP BY bucket ORDER BY bucket
      `).all(keyword);

      const total = buckets.reduce((s, b) => s + b.count, 0);
      topics.push({ keyword, total, buckets });
    }

    res.json({ period, granularity: gran.label, topics });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/sources/breakdown?period=week — Source volume and diversity
router.get('/analytics/sources/breakdown', (req, res) => {
  try {
    const db = getDb();
    const period = validatePeriod(req.query.period);
    const periodClause = getPeriodClause(period);

    const sources = db.prepare(`
      SELECT s.id, s.name, s.domain,
             COUNT(DISTINCT q.id) as quote_count,
             COUNT(DISTINCT a.id) as article_count
      FROM quotes q
      JOIN quote_articles qa ON qa.quote_id = q.id
      JOIN articles a ON a.id = qa.article_id
      JOIN sources s ON s.id = a.source_id
      WHERE q.is_visible = 1 AND q.created_at >= ${periodClause}
      GROUP BY s.id ORDER BY quote_count DESC
      LIMIT 20
    `).all();

    res.json({ period, sources });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/heatmap?period=month — Activity heatmap (day-of-week x hour)
router.get('/analytics/heatmap', (req, res) => {
  try {
    const db = getDb();
    const period = validatePeriod(req.query.period);
    const periodClause = getPeriodClause(period);

    const cells = db.prepare(`
      SELECT CAST(strftime('%w', q.created_at) AS INTEGER) as day_of_week,
             CAST(strftime('%H', q.created_at) AS INTEGER) as hour,
             COUNT(*) as count
      FROM quotes q
      WHERE q.is_visible = 1 AND q.created_at >= ${periodClause}
      GROUP BY day_of_week, hour
    `).all();

    res.json({ period, cells });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/authors/search?q=trump — Autocomplete for author comparison
router.get('/analytics/authors/search', (req, res) => {
  try {
    const db = getDb();
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ authors: [] });

    const authors = db.prepare(`
      SELECT p.id, p.canonical_name as name, p.category, p.photo_url, p.quote_count
      FROM persons p
      WHERE p.canonical_name LIKE ? AND p.quote_count > 0
      ORDER BY p.quote_count DESC
      LIMIT 10
    `).all(`%${q}%`);

    res.json({ authors });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/topics/list?period=week&limit=50 — List keywords for topic picker
router.get('/analytics/topics/list', (req, res) => {
  try {
    const db = getDb();
    const period = validatePeriod(req.query.period);
    const periodClause = getPeriodClause(period);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
    const q = (req.query.q || '').trim();

    let sql = `
      SELECT qk.keyword, COUNT(*) as count
      FROM quote_keywords qk
      JOIN quotes qu ON qu.id = qk.quote_id
      WHERE qu.is_visible = 1 AND qu.created_at >= ${periodClause}
    `;
    const params = [];
    if (q.length >= 2) {
      sql += ' AND qk.keyword LIKE ?';
      params.push(`%${q}%`);
    }
    sql += ' GROUP BY qk.keyword ORDER BY count DESC LIMIT ?';
    params.push(limit);

    const topics = db.prepare(sql).all(...params);
    res.json({ period, topics });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
