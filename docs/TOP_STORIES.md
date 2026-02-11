# Top Stories Feature Spec

## Overview
Add a "Top Stories" tab to the homepage that surfaces curated content. Admins can mark sources and individual articles as "Top Story" to feature them.

## Database Changes

### sources table — new column
```sql
ALTER TABLE sources ADD COLUMN is_top_story INTEGER NOT NULL DEFAULT 0
```
- Migration in `src/config/database.js` `initializeTables()`
- Guard: check `PRAGMA table_info(sources)` for `is_top_story` before adding
- When `is_top_story=1`, ALL articles from this source are included in Top Stories

### articles table — new column
```sql
ALTER TABLE articles ADD COLUMN is_top_story INTEGER NOT NULL DEFAULT 0
```
- Same migration pattern
- When `is_top_story=1`, this specific article is included in Top Stories regardless of source setting

## API Changes

### GET /api/sources (existing, modify response)
- Include `is_top_story` field in each source object returned
- No auth required to read

### PATCH /api/sources/:id (existing, accept new field)
- Accept `is_top_story` (0 or 1) in request body
- Admin only (existing `requireAdmin` middleware)
- Update: `UPDATE sources SET is_top_story = ?, updated_at = datetime('now') WHERE id = ?`

### PATCH /api/articles/:id (NEW endpoint)
- Accept `{ is_top_story: 0|1 }` in request body
- Admin only (`requireAdmin` middleware)
- Update: `UPDATE articles SET is_top_story = ? WHERE id = ?`
- Return updated article

### GET /api/articles/:id (existing, modify response)
- Include `is_top_story` field in article object returned

### GET /api/quotes (existing, add tab filter)
- New query param: `tab=top-stories`
- When `tab=top-stories`:
  ```sql
  SELECT q.*, p.canonical_name AS personName, ...
  FROM quotes q
  JOIN persons p ON q.person_id = p.id
  JOIN quote_articles qa ON q.id = qa.quote_id
  JOIN articles a ON qa.article_id = a.id
  LEFT JOIN sources s ON a.source_id = s.id
  WHERE (a.is_top_story = 1 OR s.is_top_story = 1)
    AND q.is_visible = 1
  ORDER BY q.created_at DESC
  ```
- Standard pagination still applies (`page`, `limit`)
- Category/subFilter still apply on top of the top-stories filter

## Frontend Changes

### Homepage Tabs (`public/js/home.js`)

Current tab categories: `['All', 'Politicians', 'Professionals', 'Other']`

New tab order: `['Top Stories', 'All', 'Politicians', 'Professionals', 'Other']`

- "Top Stories" is the DEFAULT active tab on page load
- When "Top Stories" is active, fetch with `?tab=top-stories` instead of category filter
- Sub-filters should still work within Top Stories (if applicable)
- If Top Stories has no content, show a message: "No top stories yet. Check back soon!"
- Badge count on Top Stories tab shows total count

### Settings — Source Row (`public/js/settings.js`)
- Add checkbox labeled "Top Story" to each source row (after enable/disable toggle)
- Checkbox checked when `source.is_top_story === 1`
- On change: `api.patch('/sources/' + sourceId, { is_top_story: checked ? 1 : 0 })`
- Show toast on success: "Source marked as top story" / "Source removed from top stories"

### Article Detail Page (`public/js/article.js`)
- When `isAdmin`, show "Top Story" checkbox in article header area
- Checkbox checked when `article.is_top_story === 1`
- On change: `api.patch('/articles/' + articleId, { is_top_story: checked ? 1 : 0 })`
- Show toast on success

## Test Expectations
- Schema test: verify `is_top_story` column exists on both tables, defaults to 0
- API test: PATCH source with `is_top_story=1`, verify GET returns updated value
- API test: PATCH article with `is_top_story=1`, verify GET returns updated value
- API test: GET quotes with `tab=top-stories` returns only quotes from top-story sources/articles
- API test: Non-admin cannot PATCH `is_top_story` (401)
- Frontend test: Top Stories tab renders first and is default active
