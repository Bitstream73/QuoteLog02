import { getDb, getSettingValue } from '../config/database.js';
import logger from './logger.js';
import { fetchArticlesFromSource, processArticle } from './articleFetcher.js';

let fetchTimer = null;
let appInstance = null;

/**
 * Start the fetch scheduler
 */
export function startFetchScheduler(app) {
  appInstance = app;
  stopFetchScheduler(); // clear any existing timer

  const intervalMinutes = parseInt(getSettingValue('fetch_interval_minutes', '15'), 10);
  const intervalMs = intervalMinutes * 60 * 1000;

  logger.info('scheduler', 'start', { intervalMinutes });

  // Run immediately on start
  runFetchCycle().catch(err => {
    logger.error('scheduler', 'fetch_cycle_error', { error: err.message });
  });

  // Then run on interval
  fetchTimer = setInterval(() => {
    runFetchCycle().catch(err => {
      logger.error('scheduler', 'fetch_cycle_error', { error: err.message });
    });
  }, intervalMs);

  console.log(`Fetch scheduler started: every ${intervalMinutes} minutes`);
}

/**
 * Stop the fetch scheduler
 */
export function stopFetchScheduler() {
  if (fetchTimer) {
    clearInterval(fetchTimer);
    fetchTimer = null;
    logger.info('scheduler', 'stop', {});
  }
}

/**
 * Restart the fetch scheduler (called when settings change)
 */
export function restartFetchScheduler(app) {
  if (app) appInstance = app;
  stopFetchScheduler();
  startFetchScheduler(appInstance);
}

/**
 * Run a single fetch cycle
 */
async function runFetchCycle() {
  const startTime = Date.now();
  const db = getDb();
  const io = appInstance?.get('io');

  logger.info('scheduler', 'fetch_cycle_start', {});
  console.log('Starting fetch cycle...');

  const sources = db.prepare('SELECT * FROM sources WHERE enabled = 1').all();
  const lookbackHours = parseInt(getSettingValue('article_lookback_hours', '24'), 10);
  const maxArticles = parseInt(getSettingValue('max_articles_per_cycle', '100'), 10);

  let totalNewArticles = 0;
  let totalNewQuotes = 0;
  const errors = [];

  // Phase 1: Discover articles from all sources
  for (const source of sources) {
    try {
      const articles = await fetchArticlesFromSource(source, lookbackHours);
      const newArticles = await insertNewArticles(articles, source.id, db);
      totalNewArticles += newArticles.length;

      // Reset consecutive failures on success
      if (source.consecutive_failures > 0) {
        db.prepare('UPDATE sources SET consecutive_failures = 0 WHERE id = ?').run(source.id);
      }
    } catch (err) {
      logger.error('scheduler', 'source_fetch_error', {
        source: source.domain,
        error: err.message,
      });
      errors.push({ source: source.domain, error: err.message });

      // Increment failure count
      db.prepare('UPDATE sources SET consecutive_failures = consecutive_failures + 1 WHERE id = ?')
        .run(source.id);

      // Disable source if 3 consecutive failures
      const updated = db.prepare('SELECT consecutive_failures FROM sources WHERE id = ?').get(source.id);
      if (updated && updated.consecutive_failures >= 3) {
        db.prepare('UPDATE sources SET enabled = 0 WHERE id = ?').run(source.id);
        logger.warn('scheduler', 'source_disabled', {
          source: source.domain,
          reason: 'consecutive_failures',
        });
        if (io) {
          io.emit('source_disabled', { domain: source.domain, reason: 'consecutive failures' });
        }
      }
    }
  }

  // Phase 2: Process pending articles (with global limit)
  const pending = db.prepare(`
    SELECT a.*, s.domain FROM articles a
    JOIN sources s ON a.source_id = s.id
    WHERE a.status = 'pending'
    ORDER BY a.created_at ASC
    LIMIT ?
  `).all(maxArticles);

  const newQuotes = [];
  for (const article of pending) {
    try {
      const quotes = await processArticle(article, db, io);
      totalNewQuotes += quotes.length;
      newQuotes.push(...quotes);
    } catch (err) {
      logger.error('scheduler', 'article_process_error', {
        url: article.url,
        error: err.message,
      });
      db.prepare("UPDATE articles SET status = 'failed', error = ? WHERE id = ?")
        .run(err.message, article.id);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info('scheduler', 'fetch_cycle_complete', {
    newArticles: totalNewArticles,
    newQuotes: totalNewQuotes,
    elapsed: parseFloat(elapsed),
    errors: errors.length,
  });

  console.log(`Fetch cycle complete: ${totalNewArticles} new articles, ${totalNewQuotes} new quotes (${elapsed}s)`);

  // Emit status update to connected clients
  if (io) {
    io.emit('fetch_cycle_complete', {
      newArticles: totalNewArticles,
      newQuotes: totalNewQuotes,
      elapsed: parseFloat(elapsed),
    });

    // Emit new quotes for real-time updates
    if (newQuotes.length > 0) {
      io.emit('new_quotes', { quotes: newQuotes });
    }
  }
}

/**
 * Insert new articles, skipping duplicates
 */
async function insertNewArticles(articles, sourceId, db) {
  const inserted = [];
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO articles (url, source_id, title, published_at, status)
    VALUES (?, ?, ?, ?, 'pending')
  `);

  for (const article of articles) {
    const result = stmt.run(article.url, sourceId, article.title, article.published);
    if (result.changes > 0) {
      inserted.push(article);
    }
  }

  return inserted;
}

export default { startFetchScheduler, stopFetchScheduler, restartFetchScheduler };
