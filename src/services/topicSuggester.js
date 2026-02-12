import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '../config/database.js';
import config from '../config/index.js';
import logger from './logger.js';
import { materializeSingleTopic } from './topicMaterializer.js';

/**
 * Generate slug from topic name.
 */
function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Suggest new topics for uncategorized recent quotes using Gemini.
 * Only runs if there are >3 uncategorized quotes from the last day.
 * Creates at most 1 new topic per call.
 * @param {object} [dbOverride] - optional database handle (for testing)
 * @returns {{ suggested: boolean, topicName?: string, keywordsAdded?: number }}
 */
export async function suggestTopics(dbOverride) {
  const db = dbOverride || getDb();

  if (!config.geminiApiKey) {
    return { suggested: false, reason: 'no_api_key' };
  }

  // Find recent quotes with no topic
  const uncategorized = db.prepare(`
    SELECT q.id, q.text, q.context, p.canonical_name
    FROM quotes q
    JOIN persons p ON p.id = q.person_id
    LEFT JOIN quote_topics qt ON qt.quote_id = q.id
    WHERE qt.topic_id IS NULL
      AND q.is_visible = 1
      AND q.created_at > datetime('now', '-1 day')
    LIMIT 20
  `).all();

  if (uncategorized.length < 3) {
    return { suggested: false, reason: 'too_few_uncategorized', count: uncategorized.length };
  }

  try {
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const quoteTexts = uncategorized.slice(0, 10).map(q =>
      `"${q.text}" — ${q.canonical_name}${q.context ? ` (${q.context})` : ''}`
    ).join('\n');

    const prompt = `Given these recent news quotes, suggest ONE topic name and 3-5 keywords that would categorize them.

${quoteTexts}

Use consistent topic names like: "U.S. Politics", "Foreign Policy", "Criminal Justice", "Healthcare", "Economy", "Technology", "Entertainment", "Sports", "Climate & Environment", "Education", "Immigration", "Civil Rights", "National Security", "Business", "Science", "Media", "Religion", "Housing", "Labor", "Trade".

Only suggest a NEW topic if the quotes don't fit existing categories. Keywords should be specific named entities, events, or concepts.

Return: { "name": "Topic Name", "keywords": ["keyword1", "keyword2", ...] }`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const parsed = JSON.parse(response.text());

    if (!parsed.name || !parsed.keywords || !Array.isArray(parsed.keywords)) {
      return { suggested: false, reason: 'invalid_response' };
    }

    const topicName = parsed.name.trim();
    const slug = generateSlug(topicName);

    // Check if topic already exists
    const existing = db.prepare('SELECT id FROM topics WHERE slug = ?').get(slug);
    if (existing) {
      return { suggested: false, reason: 'topic_exists', topicName };
    }

    // Create topic
    const insertTopic = db.prepare(
      "INSERT INTO topics (name, slug) VALUES (?, ?)"
    );
    const topicResult = insertTopic.run(topicName, slug);
    const topicId = topicResult.lastInsertRowid;

    // Create keywords and link to topic
    const upsertKeyword = db.prepare(
      `INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, 'concept')
       ON CONFLICT(name) DO NOTHING`
    );
    const getKeyword = db.prepare('SELECT id FROM keywords WHERE name = ?');
    const linkKeyword = db.prepare(
      'INSERT OR IGNORE INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)'
    );

    let keywordsAdded = 0;
    for (const kw of parsed.keywords) {
      if (!kw || typeof kw !== 'string') continue;
      const trimmed = kw.trim();
      if (!trimmed) continue;
      upsertKeyword.run(trimmed, trimmed.toLowerCase());
      const keyword = getKeyword.get(trimmed);
      if (keyword) {
        linkKeyword.run(topicId, keyword.id);
        keywordsAdded++;
      }
    }

    // Run materialization for the new topic
    materializeSingleTopic(Number(topicId), db);

    logger.info('topic_suggester', 'topic_created', { topicName, slug, keywordsAdded });

    return { suggested: true, topicName, keywordsAdded };
  } catch (err) {
    logger.error('topic_suggester', 'suggestion_failed', { error: err.message });
    return { suggested: false, reason: 'error', error: err.message };
  }
}

export default { suggestTopics };
