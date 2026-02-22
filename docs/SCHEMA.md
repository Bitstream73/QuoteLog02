# Database Schema Changes

## New Tables

### noteworthy_card_configs

Template-based card configurations. Different from existing `noteworthy_items` (which are static entity picks).

```sql
CREATE TABLE IF NOT EXISTS noteworthy_card_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_type TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  custom_title TEXT,
  config TEXT DEFAULT '{}',
  collection_id INTEGER REFERENCES noteworthy_collections(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)
```

**card_type values (28 total):**

Time-based (20):
- `quote_of_hour`, `quote_of_day`, `quote_of_week`, `quote_of_month`
- `author_of_hour`, `author_of_day`, `author_of_week`, `author_of_month`
- `source_of_hour`, `source_of_day`, `source_of_week`, `source_of_month`
- `topic_of_hour`, `topic_of_day`, `topic_of_week`, `topic_of_month`
- `category_of_hour`, `category_of_day`, `category_of_week`, `category_of_month`

Search (4): `search_topic`, `search_quote_text`, `search_source_author`, `search_source`

Info (4): `info_importance`, `info_fact_check`, `info_bug`, `info_donate`

**config JSON (for time-based quote cards only):**
```json
{"filter_type": "author", "filter_value": "42"}
{"filter_type": "topic", "filter_value": "15"}
{"filter_type": "keyword", "filter_value": "7"}
{"filter_type": "category", "filter_value": "3"}
{}
```
Empty object = no filter (highest importants_count quote overall).

### noteworthy_collections

Groups cards into horizontal scroll rows on the homepage.

```sql
CREATE TABLE IF NOT EXISTS noteworthy_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)
```

### Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_ncc_enabled ON noteworthy_card_configs(enabled, display_order)
CREATE INDEX IF NOT EXISTS idx_ncc_collection ON noteworthy_card_configs(collection_id)
CREATE INDEX IF NOT EXISTS idx_nc_enabled ON noteworthy_collections(enabled, display_order)
```

## New Settings Keys

Add via `INSERT OR IGNORE` in `initializeTables()`:

| Key | Default | Description |
|-----|---------|-------------|
| `noteworthy_pepper_frequency` | `5` | Number of quotes between card insertion chances |
| `noteworthy_pepper_chance` | `50` | Percentage chance (0-100) of card insertion |
| `noteworthy_pick_mode` | `sequential` | `sequential` or `random` |
| `noteworthy_reuse_cards` | `1` | `1` = cycle through again after all shown, `0` = stop |

## Migration Pattern

Follow existing pattern in `src/config/database.js`. Add new code AFTER the existing `noteworthy_items` migration block (~line 968):

```javascript
// Noteworthy card configs — template-based cards for peppered scroll
db.exec(`
  CREATE TABLE IF NOT EXISTS noteworthy_collections (...)
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS noteworthy_card_configs (...)
`);
// indexes...
```

## Seed Default Card Configs

All 28 card types seeded with `enabled = 0` (admin enables desired ones). Use `INSERT OR IGNORE` keyed on `card_type` (UNIQUE).

```javascript
const defaultCardConfigs = [
  { card_type: 'quote_of_hour', display_order: 1, custom_title: 'Quote of the Hour' },
  { card_type: 'quote_of_day', display_order: 2, custom_title: 'Quote of the Day' },
  // ... all 28
  { card_type: 'info_donate', display_order: 28, custom_title: 'Support QuoteLog' },
];
const insertConfig = db.prepare(
  'INSERT OR IGNORE INTO noteworthy_card_configs (card_type, display_order, custom_title) VALUES (?, ?, ?)'
);
for (const c of defaultCardConfigs) {
  insertConfig.run(c.card_type, c.display_order, c.custom_title);
}
```

## Test Expectations

- Both tables exist with correct columns
- 28 default card configs seeded (all `enabled = 0`)
- 4 new settings keys present with correct defaults
- INSERT/UPDATE/DELETE on card configs works
- Collection FK: deleting a collection sets `collection_id = NULL` on its cards
- `config` column stores and returns valid JSON
