# Database Schema -- Historical Quote Backfill

All changes go in `src/config/database.js` inside `initializeTables()`. Follow the existing pattern: use `PRAGMA table_info` to check if a column exists before adding it.

## New Table: `historical_sources`

Add after the existing `CREATE TABLE IF NOT EXISTS` statements:

```sql
CREATE TABLE IF NOT EXISTS historical_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK(status IN ('working', 'failed', 'disabled', 'unknown')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  total_articles_fetched INTEGER NOT NULL DEFAULT 0,
  last_fetch_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  config TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_historical_sources_key ON historical_sources(provider_key);
CREATE INDEX IF NOT EXISTS idx_historical_sources_enabled ON historical_sources(enabled);
```

## Seed Historical Sources

After creating the table, seed the default providers using `INSERT OR IGNORE`:

```javascript
const defaultProviders = [
  { provider_key: 'wikiquote', name: 'Wikiquote', description: 'Quotes from Wikiquote via MediaWiki API' },
  { provider_key: 'chronicling_america', name: 'Chronicling America', description: 'Historical US newspapers via Library of Congress API (1836-1963)' },
  { provider_key: 'wayback', name: 'Wayback Machine', description: 'Historical news article snapshots via Internet Archive CDX API' },
  { provider_key: 'govinfo', name: 'Congressional Record', description: 'Congressional speeches via GovInfo API (1995-present)' },
  { provider_key: 'presidency_project', name: 'American Presidency Project', description: 'Presidential speeches and press conferences from UCSB archive (1789-present)' },
];

const insertProvider = db.prepare(
  'INSERT OR IGNORE INTO historical_sources (provider_key, name, description) VALUES (?, ?, ?)'
);
for (const p of defaultProviders) {
  insertProvider.run(p.provider_key, p.name, p.description);
}
```

## New Columns on `articles` Table

Both use migration guard pattern (check `PRAGMA table_info(articles)` for column before adding):

### `historical_source_id`
```sql
ALTER TABLE articles ADD COLUMN historical_source_id INTEGER REFERENCES historical_sources(id)
```
- NULL for RSS-sourced articles, populated for historical articles
- Index: `CREATE INDEX IF NOT EXISTS idx_articles_historical ON articles(historical_source_id)`

### `prefetched_text`
```sql
ALTER TABLE articles ADD COLUMN prefetched_text TEXT
```
- NULL for RSS articles (text fetched from URL at processing time)
- Populated by providers that return full text (Wikiquote, GovInfo, Presidency Project)
- Checked by `processArticle` before attempting URL-based extraction

## New Settings

Add to the `defaultSettings` object in `initializeTables()`:

```javascript
historical_fetch_enabled: '1',
historical_articles_per_source_per_cycle: '5',
```

Add validation in `src/routes/settings.js` `numericSettings` object:
```javascript
historical_articles_per_source_per_cycle: { min: 1, max: 100 },
```

## Test Expectations

- `historical_sources` table exists with all expected columns
- 5 default providers exist after initialization
- `articles.historical_source_id` column exists, is nullable
- `articles.prefetched_text` column exists, is nullable
- `historical_fetch_enabled` setting exists with default '1'
- `historical_articles_per_source_per_cycle` setting exists with default '5'
- All existing tests still pass (no interference with RSS sources)
