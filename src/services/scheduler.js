import { getDb, getSettingValue } from '../config/database.js';
import logger from './logger.js';
import { fetchArticlesFromSource, processArticle } from './articleFetcher.js';
import { createBackup, pruneOldBackups } from './backup.js';
import { materializeTopics } from './topicMaterializer.js';
import { suggestTopics } from './topicSuggester.js';
import { recalculateTrendingScores } from './trendingCalculator.js';
import { runBackPropCycle } from './backPropagation.js';

let fetchTimer = null;
let appInstance = null;
let cycleRunning = false;
let lastCycleStartedAt = null;
let nextCycleAt = null;

/**
 * Start the fetch scheduler
 */
export function startFetchScheduler(app) {
  appInstance = app;
  stopFetchScheduler(); // clear any existing timer

  const intervalMinutes = parseInt(getSettingValue('fetch_interval_minutes', '5'), 10);
  const intervalMs = intervalMinutes * 60 * 1000;

  logger.info('scheduler', 'start', { intervalMinutes });

  // Run immediately on start (only if not already running)
  if (!cycleRunning) {
    runFetchCycle().catch(err => {
      logger.error('scheduler', 'fetch_cycle_error', { error: err.message });
    });
  }

  // Track next cycle time
  nextCycleAt = Date.now() + intervalMs;

  // Then run on interval
  fetchTimer = setInterval(() => {
    nextCycleAt = Date.now() + intervalMs;
    if (!cycleRunning) {
      runFetchCycle().catch(err => {
        logger.error('scheduler', 'fetch_cycle_error', { error: err.message });
      });
    } else {
      logger.info('scheduler', 'skip_cycle', { reason: 'previous_cycle_still_running' });
    }
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
  if (cycleRunning) {
    logger.info('scheduler', 'skip_cycle', { reason: 'already_running' });
    return;
  }
  cycleRunning = true;

  const startTime = Date.now();
  const db = getDb();
  const io = appInstance?.get('io');

  try {
    lastCycleStartedAt = Date.now();

    // Pre-fetch backup
    try {
      await createBackup();
      pruneOldBackups(5);
    } catch (backupErr) {
      logger.warn('scheduler', 'pre_fetch_backup_failed', { error: backupErr.message });
    }

    logger.info('scheduler', 'fetch_cycle_start', {});
    console.log('Starting fetch cycle...');

    const sources = db.prepare('SELECT * FROM sources WHERE enabled = 1').all();
    const lookbackHours = parseInt(getSettingValue('article_lookback_hours', '24'), 10);
    const maxArticlesPerSource = parseInt(getSettingValue('max_articles_per_source_per_cycle', '10'), 10);

    logger.info('scheduler', 'sources_loaded', {
      count: sources.length,
      domains: sources.map(s => s.domain),
    });

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

        if (io && historicalResult.newArticles > 0) {
          io.emit('historical_fetch_complete', {
            newArticles: historicalResult.newArticles,
            providers: historicalResult.providerResults,
          });
        }
      } catch (err) {
        logger.error('scheduler', 'historical_fetch_error', { error: err.message });
        // Historical fetch errors must NOT prevent Phase 2 from running
      }
    }

    // Phase 2: Process pending articles (per-source limit)
    // RSS articles
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

    // Historical articles
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

    // Post-fetch: materialize topics and suggest new ones
    // Also run materialization if quote_topics is empty (first deploy / fresh seed)
    const qtCount = db.prepare('SELECT COUNT(*) as cnt FROM quote_topics').get().cnt;
    if (totalNewQuotes > 0 || qtCount === 0) {
      try {
        const matResult = materializeTopics();
        logger.info('scheduler', 'topics_materialized', matResult);
      } catch (err) {
        logger.error('scheduler', 'topic_materialization_error', { error: err.message });
      }

      try {
        const sugResult = await suggestTopics();
        if (sugResult.suggested) {
          logger.info('scheduler', 'topic_suggested', { topicName: sugResult.topicName });
        }
      } catch (err) {
        logger.error('scheduler', 'topic_suggestion_error', { error: err.message });
      }

      try {
        recalculateTrendingScores();
        logger.info('scheduler', 'trending_scores_recalculated');
      } catch (err) {
        logger.error('scheduler', 'trending_recalculation_error', { error: err.message });
      }
    }

    // Phase 3: Back-propagation (optional — fills gaps in past days)
    const backpropEnabled = getSettingValue('backprop_enabled', '0') === '1';
    if (backpropEnabled) {
      try {
        const backpropResult = await runBackPropCycle(io);
        if (backpropResult.targetDate) {
          logger.info('scheduler', 'backprop_complete', backpropResult);
          totalNewArticles += backpropResult.articlesFound;
          totalNewQuotes += backpropResult.quotesExtracted;
        }
      } catch (err) {
        logger.error('scheduler', 'backprop_error', { error: err.message });
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
  } finally {
    cycleRunning = false;
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

/**
 * Trigger a fetch cycle immediately (manual "Fetch Now")
 */
export function triggerFetchNow() {
  if (cycleRunning) {
    return { started: false, reason: 'cycle_already_running' };
  }
  runFetchCycle().catch(err => {
    logger.error('scheduler', 'manual_fetch_error', { error: err.message });
  });
  return { started: true };
}

/**
 * Get scheduler status for the frontend countdown timer
 */
export function getSchedulerStatus() {
  const intervalMinutes = parseInt(getSettingValue('fetch_interval_minutes', '5'), 10);
  return {
    running: cycleRunning,
    intervalMinutes,
    lastCycleStartedAt: lastCycleStartedAt ? new Date(lastCycleStartedAt).toISOString() : null,
    nextCycleAt: nextCycleAt ? new Date(nextCycleAt).toISOString() : null,
  };
}

export default { startFetchScheduler, stopFetchScheduler, restartFetchScheduler, triggerFetchNow, getSchedulerStatus };
