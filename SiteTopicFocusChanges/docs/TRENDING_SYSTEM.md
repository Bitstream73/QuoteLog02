# Trending Score Calculation & Caching

Trending scores are cached in `trending_score` columns on entity tables. Recalculated after fetch cycles and after important/share events. This avoids expensive JOINs on every page load.

## Formula

```
trending_score = importants_count * 3.0
               + share_count * 2.0
               + view_count * 0.5
               + recency_bonus
```

**Recency bonus** (decays over 7 days):
```javascript
function recencyBonus(createdAt) {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  if (ageHours <= 0) return 10.0;
  if (ageHours > 168) return 0.0; // 7 days
  return 10.0 * Math.exp(-ageHours / 48); // half-life ~48 hours
}
```

**For topics**, the score also includes child quote importants:
```
topic.trending_score = topic.importants_count * 3.0
                     + topic.share_count * 2.0
                     + topic.view_count * 0.5
                     + SUM(child_quote.importants_count) * 1.0
```

**For articles**, similar child aggregation:
```
article.trending_score = article.importants_count * 3.0
                       + article.share_count * 2.0
                       + article.view_count * 0.5
                       + SUM(child_quote.importants_count) * 1.0
                       + recency_bonus(article.published_at)
```

## Service

### `src/services/trendingCalculator.js`

```javascript
export function recalculateTrendingScores(db) {
  // 1. Recalculate quotes
  recalculateQuotes(db);
  // 2. Recalculate articles (includes child quote importants)
  recalculateArticles(db);
  // 3. Recalculate persons
  recalculatePersons(db);
  // 4. Recalculate topics (includes child quote importants)
  recalculateTopics(db);
}

export function recalculateEntityScore(db, entityType, entityId) {
  // Targeted recalculation for a single entity after important/share event
}
```

**Quote recalculation (bulk):**
```sql
-- Done in JS because recency_bonus requires date math:
SELECT id, importants_count, share_count, created_at FROM quotes WHERE is_visible = 1
-- For each: compute trending_score in JS, then batch UPDATE
```

**Topic recalculation:**
```sql
SELECT t.id, t.importants_count, t.share_count, t.view_count,
  COALESCE(SUM(q.importants_count), 0) as child_importants
FROM topics t
LEFT JOIN quote_topics qt ON qt.topic_id = t.id
LEFT JOIN quotes q ON q.id = qt.quote_id AND q.is_visible = 1
GROUP BY t.id
```

**Article recalculation:**
```sql
SELECT a.id, a.importants_count, a.share_count, a.view_count, a.published_at,
  COALESCE(SUM(q.importants_count), 0) as child_importants
FROM articles a
LEFT JOIN quote_articles qa ON qa.article_id = a.id
LEFT JOIN quotes q ON q.id = qa.quote_id AND q.is_visible = 1
GROUP BY a.id
```

## When to Recalculate

### Full recalculation (all entities)
- After every fetch cycle in `scheduler.js` (after materialization completes)
- Called via `recalculateTrendingScores(db)`

### Targeted recalculation (single entity)
- After important toggle: recalculate the toggled entity + parent entities
  - If quote toggled: recalculate the quote + its article + its topic(s) + its person
  - If article toggled: recalculate the article
  - If topic toggled: recalculate the topic
  - If person toggled: recalculate the person
- After share event: same logic as important toggle
- Called via `recalculateEntityScore(db, entityType, entityId)`

## API Endpoints

Add to `src/routes/analytics.js` (or create separate file):

### GET /api/analytics/trending-topics
Homepage "Trending Topics" tab data.

```sql
SELECT t.id, t.name, t.slug, t.description, t.context, t.importants_count, t.trending_score
FROM topics t
WHERE t.trending_score > 0
ORDER BY t.trending_score DESC
LIMIT 20
```

For each topic, also return top 3 quotes:
```sql
SELECT q.id, q.text, q.quote_datetime, q.importants_count, q.share_count,
  p.id as person_id, p.canonical_name as person_name, p.photo_url,
  p.category_context, a.id as article_id, a.title as article_title,
  a.url as article_url, s.domain as source_domain
FROM quotes q
JOIN quote_topics qt ON qt.quote_id = q.id AND qt.topic_id = ?
JOIN persons p ON p.id = q.person_id
LEFT JOIN quote_articles qa ON qa.quote_id = q.id
LEFT JOIN articles a ON a.id = qa.article_id
LEFT JOIN sources s ON s.id = a.source_id
WHERE q.is_visible = 1
ORDER BY q.importants_count DESC, q.created_at DESC
LIMIT 3
```

### GET /api/analytics/trending-sources
Homepage "Trending Sources" tab data. Same structure but for articles.

### GET /api/analytics/trending-quotes
Homepage "Trending Quotes" tab. Returns:
- `quote_of_day`: highest importants_count quote from today
- `quote_of_week`: highest importants_count quote from this week
- `quote_of_month`: highest importants_count quote from this month
- `recent_quotes`: paginated list of all quotes sorted by `created_at DESC`

### GET /api/analytics/all-sources
Homepage "All" tab. All articles with their quotes, ordered by `published_at DESC`.

**Query params:** `page`, `limit` (default 20), `sort` (date|importance)

## Test Expectations

1. `recalculateTrendingScores` updates all entity trending_score columns
2. Recency bonus decays correctly (0 for >7 days old)
3. Topic score includes child quote importants
4. Article score includes child quote importants + recency
5. `recalculateEntityScore` only updates the targeted entity and its parents
6. GET trending-topics returns topics sorted by trending_score, each with 3 quotes
7. GET trending-quotes returns quote of day/week/month + recent list
8. GET all-sources returns articles with quotes, newest first
9. Sort param switches between date and importance ordering
