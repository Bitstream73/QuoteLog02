# Topics System Enhancement

Topics are named collections of keywords. Quotes match topics via keyword overlap between `topic_keywords` and `quote_keywords`. Results are materialized (cached) in `quote_topics`.

## Data Model

**topics** table (existing + new columns):
- `id`, `name` (UNIQUE), `slug` (UNIQUE), `created_at` — existing
- `description` TEXT — short description of topic
- `context` TEXT — longer editorial context shown on topic page
- `importants_count`, `share_count`, `view_count`, `trending_score` — new counters

**topic_keywords** table (NEW):
- `topic_id` FK -> topics
- `keyword_id` FK -> keywords
- PRIMARY KEY (topic_id, keyword_id)

**quote_topics** table (existing, used as materialized cache):
- `quote_id` FK -> quotes
- `topic_id` FK -> topics
- PRIMARY KEY (quote_id, topic_id)

## Topic Materialization Service

### `src/services/topicMaterializer.js`

**Purpose:** Rebuild `quote_topics` cache by matching topic keywords against quote keywords.

```javascript
export function materializeTopics(db) {
  // 1. Clear existing quote_topics
  db.exec('DELETE FROM quote_topics');

  // 2. For each topic, find quotes that share at least one keyword
  const topics = db.prepare('SELECT t.id FROM topics t').all();

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

  const insertMany = db.transaction((topics) => {
    for (const topic of topics) {
      const quotes = findQuotes.all(topic.id);
      for (const row of quotes) {
        insertQuoteTopic.run(row.quote_id, topic.id);
      }
    }
  });

  insertMany(topics);
}
```

**When to run:** After every fetch cycle in `scheduler.js`, after keyword extraction completes.

## Topic Suggestion Service

### `src/services/topicSuggester.js`

**Purpose:** When new quotes arrive that don't match any existing topic, use Gemini to suggest a new topic name and keywords.

**Flow:**
1. After materialization, find quotes with no topic: `SELECT q.id, q.text, q.context FROM quotes q LEFT JOIN quote_topics qt ON qt.quote_id = q.id WHERE qt.topic_id IS NULL AND q.is_visible = 1 AND q.created_at > datetime('now', '-1 day')`
2. If count > 3 uncategorized quotes, batch them and ask Gemini:

```
Given these recent news quotes, suggest a topic name and 3-5 keywords:
[quote texts]
Respond as JSON: { "name": "Topic Name", "keywords": ["keyword1", "keyword2", ...] }
```

3. Check if suggested topic name already exists (fuzzy match on slug)
4. If new: create topic, create keywords (INSERT OR IGNORE), create topic_keywords links
5. Re-run materialization for the new topic only

**Rate limit:** Max 1 suggestion call per fetch cycle. Use existing Gemini client from `quoteExtractor.js`.

## Admin CRUD Endpoints

Add to `src/routes/admin.js` (behind `requireAdmin` middleware):

### GET /api/admin/topics
List all topics with keyword counts and quote counts.

```sql
SELECT t.*,
  (SELECT COUNT(*) FROM topic_keywords WHERE topic_id = t.id) as keyword_count,
  (SELECT COUNT(*) FROM quote_topics WHERE topic_id = t.id) as quote_count
FROM topics t ORDER BY t.name
```

### POST /api/admin/topics
Create a new topic with keywords.

**Request Body:**
```json
{
  "name": "Climate Policy",
  "description": "Climate and environmental policy debates",
  "keywords": ["climate", "environment", "carbon", "emissions"]
}
```

**Logic:**
1. Generate slug from name (lowercase, spaces to hyphens, strip special chars)
2. INSERT topic
3. For each keyword: INSERT OR IGNORE into `keywords` table, then INSERT into `topic_keywords`
4. Run materialization for this topic
5. Return created topic with keywords

### PUT /api/admin/topics/:id
Update topic name, description, context, and/or keywords.

**Logic:**
1. Update topic fields
2. If keywords provided: DELETE FROM topic_keywords WHERE topic_id = ?, then re-insert
3. Re-run materialization for this topic

### DELETE /api/admin/topics/:id
Delete topic and cascade (topic_keywords and quote_topics cleaned via CASCADE).

## Public Endpoints

Create `src/routes/topics.js`:

### GET /api/topics
List topics with quote counts, sorted by trending_score desc.

```sql
SELECT t.id, t.name, t.slug, t.description, t.importants_count, t.trending_score,
  (SELECT COUNT(*) FROM quote_topics WHERE topic_id = t.id) as quote_count
FROM topics t
ORDER BY t.trending_score DESC
LIMIT ? OFFSET ?
```

### GET /api/topics/:slug
Single topic with its quotes (paginated).

```sql
-- Topic info:
SELECT * FROM topics WHERE slug = ?

-- Topic's quotes (paginated):
SELECT q.*, p.canonical_name as person_name, p.photo_url,
  a.title as article_title, a.id as article_id
FROM quotes q
JOIN quote_topics qt ON qt.quote_id = q.id
JOIN persons p ON p.id = q.person_id
LEFT JOIN quote_articles qa ON qa.quote_id = q.id
LEFT JOIN articles a ON a.id = qa.article_id
WHERE qt.topic_id = ? AND q.is_visible = 1
ORDER BY q.importants_count DESC, q.created_at DESC
LIMIT ? OFFSET ?
```

Mount in `src/index.js`:
```javascript
import topicsRouter from './routes/topics.js';
app.use('/api/topics', topicsRouter);
```

## Test Expectations

1. Materialization: quote with keyword "economy" matches topic with keyword "economy"
2. Materialization: quote with no matching keywords gets no topic
3. Materialization: re-running is idempotent (same result)
4. Admin CRUD: create topic returns topic with keywords
5. Admin CRUD: update keywords triggers re-materialization
6. Admin CRUD: delete topic cascades to topic_keywords and quote_topics
7. Public GET /api/topics returns sorted by trending_score
8. Public GET /api/topics/:slug returns topic with paginated quotes
9. Slug generation handles special characters correctly
