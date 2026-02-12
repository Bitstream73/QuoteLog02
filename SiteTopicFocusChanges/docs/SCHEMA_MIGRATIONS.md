# Schema Migrations

All changes go in `src/config/database.js` inside `initializeDatabase()`. Follow the existing pattern: use `PRAGMA table_info` to check if a column exists before adding it.

## New Tables

### `importants` — Polymorphic "Important?" Marks

```sql
CREATE TABLE IF NOT EXISTS importants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('quote', 'article', 'person', 'topic')),
  entity_id INTEGER NOT NULL,
  voter_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, entity_id, voter_hash)
);
CREATE INDEX IF NOT EXISTS idx_importants_entity ON importants(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_importants_voter ON importants(voter_hash);
```

**Why polymorphic:** Users can mark quotes, articles (displayed as "Sources"), persons (authors), and topics as important — all in one table. The `UNIQUE` constraint prevents double-counting per voter per entity.

### `topic_keywords` — Links Topics to Keywords

```sql
CREATE TABLE IF NOT EXISTS topic_keywords (
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_id, keyword_id)
);
CREATE INDEX IF NOT EXISTS idx_topic_keywords_keyword ON topic_keywords(keyword_id);
```

**Purpose:** Topics are populated by matching their keywords against quote keywords. This junction table defines which keywords belong to which topic.

## New Columns on Existing Tables

### `quotes` table additions
```sql
-- Column-existence guard pattern:
-- Check PRAGMA table_info(quotes) for column name before ALTER TABLE

ALTER TABLE quotes ADD COLUMN quote_datetime TEXT;
ALTER TABLE quotes ADD COLUMN importants_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN trending_score REAL NOT NULL DEFAULT 0.0;
```

### `articles` table additions
```sql
ALTER TABLE articles ADD COLUMN importants_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN trending_score REAL NOT NULL DEFAULT 0.0;
```

### `persons` table additions
```sql
ALTER TABLE persons ADD COLUMN importants_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE persons ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE persons ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE persons ADD COLUMN trending_score REAL NOT NULL DEFAULT 0.0;
```

### `topics` table additions
```sql
ALTER TABLE topics ADD COLUMN description TEXT;
ALTER TABLE topics ADD COLUMN context TEXT;
ALTER TABLE topics ADD COLUMN importants_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE topics ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE topics ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE topics ADD COLUMN trending_score REAL NOT NULL DEFAULT 0.0;
```

## Migration Guard Pattern

Use this exact pattern for each column addition (matches existing codebase):

```javascript
const topicsColumns = db.pragma('table_info(topics)').map(c => c.name);
if (!topicsColumns.includes('importants_count')) {
  db.exec(`ALTER TABLE topics ADD COLUMN importants_count INTEGER NOT NULL DEFAULT 0`);
}
```

## New Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_quotes_trending ON quotes(trending_score DESC) WHERE is_visible = 1;
CREATE INDEX IF NOT EXISTS idx_articles_trending ON articles(trending_score DESC);
CREATE INDEX IF NOT EXISTS idx_persons_trending ON persons(trending_score DESC);
CREATE INDEX IF NOT EXISTS idx_topics_trending ON topics(trending_score DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_importants ON quotes(importants_count DESC) WHERE is_visible = 1;
CREATE INDEX IF NOT EXISTS idx_quotes_datetime ON quotes(quote_datetime DESC) WHERE is_visible = 1;
```

## Test Expectations

1. All new tables exist after `initializeDatabase()`
2. `importants` UNIQUE constraint enforced (duplicate insert throws)
3. `topic_keywords` CASCADE delete works (delete topic removes junction rows)
4. All new columns exist on `quotes`, `articles`, `persons`, `topics`
5. All new indexes exist (check via `PRAGMA index_list`)
6. All 214+ existing tests still pass
