# Scheduler Integration -- Historical Fetch

## Current Fetch Cycle Flow (Do Not Break)

In `src/services/scheduler.js` `runFetchCycle()`:

```
Phase 1: Discover articles from RSS sources (lines 113-148)
Phase 2: Process pending articles with per-source limit (lines 150-178)
Phase 3: Post-process -- materialize topics, trending scores, Socket.IO events (lines 180-206)
```

## New Flow

```
Pre-fetch backup (existing, unchanged)
Phase 1:   Discover articles from RSS sources (existing, unchanged)
Phase 1.5: Discover articles from historical sources (NEW)
Phase 2:   Process ALL pending articles (MODIFIED query to include historical)
Phase 3:   Post-process (existing, unchanged)
```

## Phase 1.5 Implementation

Insert after Phase 1 (line 148) and before Phase 2 (line 150) in `scheduler.js`:

```javascript
// Phase 1.5: Discover historical articles
const historicalEnabled = getSettingValue('historical_fetch_enabled', '1') === '1';
if (historicalEnabled) {
  try {
    const { fetchHistoricalArticles } = await import('./historicalFetcher.js');
    const historicalLimit = parseInt(
      getSettingValue('historical_articles_per_source_per_cycle', '5'), 10
    );
    const historicalResult = await fetchHistoricalArticles(historicalLimit, db);
    totalNewArticles += historicalResult.newArticles;

    logger.info('scheduler', 'historical_fetch_complete', {
      newArticles: historicalResult.newArticles,
      providers: historicalResult.providerResults,
    });
  } catch (err) {
    logger.error('scheduler', 'historical_fetch_error', { error: err.message });
    // Historical fetch errors must NOT prevent Phase 2 from running
  }
}
```

## Phase 2 Query Modification

The existing Phase 2 query (lines 151-162) uses `JOIN sources s ON a.source_id = s.id`, which EXCLUDES historical articles (they have `source_id = NULL`, `historical_source_id` populated instead).

**Replace the query with:**

```sql
SELECT a.*,
  COALESCE(s.domain, hs.provider_key) as domain
FROM articles a
LEFT JOIN sources s ON a.source_id = s.id
LEFT JOIN historical_sources hs ON a.historical_source_id = hs.id
WHERE a.status = 'pending'
  AND a.id IN (
    SELECT id FROM (
      SELECT id,
        COALESCE(source_id, 1000000 + historical_source_id) as group_id,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(source_id, 1000000 + historical_source_id)
          ORDER BY created_at ASC
        ) AS rn
      FROM articles WHERE status = 'pending'
    ) WHERE rn <= ?
  )
ORDER BY a.created_at ASC
```

**Why `1000000 + historical_source_id`:** Prevents collision between `source_id` and `historical_source_id` values when partitioning. RSS source IDs and historical source IDs are separate sequences -- adding 1000000 ensures they never overlap in the PARTITION BY.

**Alternative simpler approach:** Use two separate queries -- one for RSS articles, one for historical -- and merge results. This is simpler but doesn't interleave them:

```javascript
// RSS articles (existing query, unchanged)
const rssArticles = db.prepare(`
  SELECT a.*, s.domain FROM articles a
  JOIN sources s ON a.source_id = s.id
  WHERE a.status = 'pending' AND a.source_id IS NOT NULL
  AND a.id IN (
    SELECT id FROM (
      SELECT id, source_id, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY created_at ASC) AS rn
      FROM articles WHERE status = 'pending' AND source_id IS NOT NULL
    ) WHERE rn <= ?
  )
  ORDER BY a.created_at ASC
`).all(maxArticlesPerSource);

// Historical articles (new query)
const historicalArticles = db.prepare(`
  SELECT a.*, hs.provider_key as domain FROM articles a
  JOIN historical_sources hs ON a.historical_source_id = hs.id
  WHERE a.status = 'pending' AND a.historical_source_id IS NOT NULL
  AND a.id IN (
    SELECT id FROM (
      SELECT id, historical_source_id, ROW_NUMBER() OVER (PARTITION BY historical_source_id ORDER BY created_at ASC) AS rn
      FROM articles WHERE status = 'pending' AND historical_source_id IS NOT NULL
    ) WHERE rn <= ?
  )
  ORDER BY a.created_at ASC
`).all(maxArticlesPerSource);

const pending = [...rssArticles, ...historicalArticles];
```

**Recommended:** Use the two-query approach. It's simpler, doesn't risk breaking the existing RSS query, and is easier to test independently.

## `processArticle` Modification

In `src/services/articleFetcher.js`, the `processArticle` function fetches article text from a URL. For historical articles with `prefetched_text`, skip the URL fetch.

**Add at the start of text extraction in `processArticle`:**

```javascript
// Check for prefetched text (historical articles)
if (article.prefetched_text && article.prefetched_text.length >= 200) {
  extracted = { text: article.prefetched_text, title: article.title };
} else {
  // Existing URL-based extraction logic
  extracted = await extractArticleText(article.url);
  // ... existing fallback to extractWithReadability ...
}
```

This ensures:
- Historical articles with prefetched text skip the HTTP fetch (faster, no rate limit cost)
- Historical articles without prefetched text (e.g., Wayback) fetch from URL as normal
- RSS articles (no `prefetched_text`) continue working unchanged

## `historicalFetcher.js` Implementation

Create `src/services/historicalFetcher.js`:

```javascript
import { getDb } from '../config/database.js';
import logger from './logger.js';
import { getEnabledProviders } from './historical/index.js';

export async function fetchHistoricalArticles(limitPerProvider, db) {
  if (!db) db = getDb();
  const providers = getEnabledProviders();
  let totalNew = 0;
  const providerResults = [];

  for (const provider of providers) {
    const hsRow = db.prepare(
      'SELECT * FROM historical_sources WHERE provider_key = ?'
    ).get(provider.key);
    if (!hsRow) continue;

    const config = JSON.parse(hsRow.config || '{}');

    try {
      const articles = await provider.fetchArticles(limitPerProvider, db, config);
      let inserted = 0;

      const stmt = db.prepare(`
        INSERT OR IGNORE INTO articles (url, historical_source_id, title, published_at, prefetched_text, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `);

      for (const article of articles) {
        const result = stmt.run(
          article.url,
          hsRow.id,
          article.title,
          article.published || null,
          article.text || null
        );
        if (result.changes > 0) inserted++;
      }

      totalNew += inserted;

      // Update provider stats on success
      db.prepare(`
        UPDATE historical_sources
        SET consecutive_failures = 0,
            status = 'working',
            total_articles_fetched = total_articles_fetched + ?,
            last_fetch_at = datetime('now'),
            last_success_at = datetime('now'),
            last_error = NULL,
            updated_at = datetime('now')
        WHERE provider_key = ?
      `).run(inserted, provider.key);

      providerResults.push({ provider: provider.key, fetched: articles.length, inserted });

    } catch (err) {
      logger.error('historical', 'provider_fetch_error', {
        provider: provider.key,
        error: err.message,
      });

      // Update failure tracking
      db.prepare(`
        UPDATE historical_sources
        SET consecutive_failures = consecutive_failures + 1,
            last_fetch_at = datetime('now'),
            last_error = ?,
            updated_at = datetime('now')
        WHERE provider_key = ?
      `).run(err.message, provider.key);

      // Auto-disable after 5 consecutive failures
      const updated = db.prepare(
        'SELECT consecutive_failures FROM historical_sources WHERE provider_key = ?'
      ).get(provider.key);
      if (updated && updated.consecutive_failures >= 5) {
        db.prepare(
          "UPDATE historical_sources SET status = 'failed' WHERE provider_key = ?"
        ).run(provider.key);
        logger.warn('historical', 'provider_auto_disabled', {
          provider: provider.key,
          reason: '5 consecutive failures',
        });
      }

      providerResults.push({ provider: provider.key, error: err.message });
    }
  }

  return { newArticles: totalNew, providerResults };
}
```

## Socket.IO Events

After the historical fetch phase, optionally emit:
```javascript
if (io && historicalResult.newArticles > 0) {
  io.emit('historical_fetch_complete', {
    newArticles: historicalResult.newArticles,
    providers: historicalResult.providerResults,
  });
}
```

## Test Expectations

- Scheduler runs historical Phase 1.5 when `historical_fetch_enabled` is '1'
- Scheduler skips Phase 1.5 when `historical_fetch_enabled` is '0'
- Historical articles inserted with correct `historical_source_id`, `prefetched_text`, `status='pending'`
- Phase 2 processes both RSS and historical pending articles
- `processArticle` uses `prefetched_text` when available, skips URL fetch
- Provider failures update `consecutive_failures` and `last_error`
- Provider auto-disabled after 5 consecutive failures
- Existing RSS fetch phase continues unchanged
- Historical phase errors do NOT prevent Phase 2 from running
