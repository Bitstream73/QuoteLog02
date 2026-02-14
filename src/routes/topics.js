import { Router } from 'express';
import { getDb } from '../config/database.js';

const router = Router();

// GET /api/topics — list topics with quote counts, sorted by trending_score
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const topics = db.prepare(`
      SELECT t.id, t.name, t.slug, t.description, t.importants_count, t.trending_score,
        (SELECT COUNT(*) FROM quote_topics qt2 JOIN quotes q ON q.id = qt2.quote_id AND q.is_visible = 1 WHERE qt2.topic_id = t.id) as quote_count
      FROM topics t
      WHERE t.enabled = 1
      GROUP BY t.id
      HAVING quote_count > 0
      ORDER BY t.trending_score DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM topics t
      WHERE t.enabled = 1
        AND (SELECT COUNT(*) FROM quote_topics qt2 JOIN quotes q ON q.id = qt2.quote_id AND q.is_visible = 1 WHERE qt2.topic_id = t.id) > 0
    `).get().count;

    res.json({ topics, total, limit, offset });
  } catch (err) {
    console.error('Topics list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/topics/:slug — single topic with paginated quotes
router.get('/:slug', (req, res) => {
  try {
    const db = getDb();
    const { slug } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;

    const topic = db.prepare('SELECT * FROM topics WHERE slug = ?').get(slug);
    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    // Get topic's keywords
    const keywords = db.prepare(`
      SELECT k.id, k.name, k.keyword_type
      FROM topic_keywords tk
      JOIN keywords k ON k.id = tk.keyword_id AND k.enabled = 1
      WHERE tk.topic_id = ?
      ORDER BY k.name
    `).all(topic.id);

    // Get topic's quotes (paginated)
    const quotes = db.prepare(`
      SELECT q.id, q.text, q.context, q.created_at, q.importants_count, q.share_count,
        p.canonical_name as person_name, p.photo_url, p.id as person_id,
        a.title as article_title, a.id as article_id, a.url as article_url,
        s.domain as source_domain, s.name as source_name
      FROM quotes q
      JOIN quote_topics qt ON qt.quote_id = q.id
      JOIN persons p ON p.id = q.person_id
      LEFT JOIN quote_articles qa ON qa.quote_id = q.id
      LEFT JOIN articles a ON a.id = qa.article_id
      LEFT JOIN sources s ON a.source_id = s.id
      WHERE qt.topic_id = ? AND q.is_visible = 1
      GROUP BY q.id
      ORDER BY q.importants_count DESC, q.created_at DESC
      LIMIT ? OFFSET ?
    `).all(topic.id, limit, offset);

    const quoteCount = db.prepare(`
      SELECT COUNT(*) as count FROM quote_topics qt JOIN quotes q ON q.id = qt.quote_id AND q.is_visible = 1 WHERE qt.topic_id = ?
    `).get(topic.id).count;

    res.json({
      topic: {
        id: topic.id,
        name: topic.name,
        slug: topic.slug,
        description: topic.description,
        context: topic.context,
        importantsCount: topic.importants_count,
        shareCount: topic.share_count,
        viewCount: topic.view_count,
        trendingScore: topic.trending_score,
      },
      keywords,
      quotes,
      quoteCount,
      limit,
      offset,
    });
  } catch (err) {
    console.error('Topic detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
