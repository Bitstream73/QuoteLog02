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
