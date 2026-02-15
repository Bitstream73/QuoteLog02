import { getDb, getSettingValue } from '../config/database.js';
import logger from './logger.js';
import { fetchArticlesFromSource, processArticle } from './articleFetcher.js';

/**
 * Back-propagation service: fills in quote gaps for past days.
 *
 * Algorithm:
 * 1. Find the most recent past day that has NO visible quotes and is NOT already in backprop_log
 * 2. Fetch articles from enabled sources' RSS feeds for that day
 * 3. Process through the existing extraction pipeline
 * 4. Log results to backprop_log
 */

/**
 * Find the next target date for back-propagation.
 * Looks for the most recent past day with no visible quotes that hasn't been attempted.
 * @returns {string | null} ISO date string (YYYY-MM-DD) or null if no gaps found
 */
export function findNextGapDate() {
  const db = getDb();

  // Get all dates that have visible quotes (last 90 days)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const cutoff = ninetyDaysAgo.toISOString().split('T')[0];

  const datesWithQuotes = db.prepare(`
    SELECT DISTINCT DATE(COALESCE(quote_datetime, created_at)) as quote_date
    FROM quotes
    WHERE is_visible = 1 AND DATE(COALESCE(quote_datetime, created_at)) >= ?
    ORDER BY quote_date DESC
  `).all(cutoff).map(r => r.quote_date);

  const datesWithQuoteSet = new Set(datesWithQuotes);

  // Get all dates already attempted in backprop_log
  const attemptedDates = db.prepare(`
    SELECT target_date FROM backprop_log
  `).all().map(r => r.target_date);

  const attemptedSet = new Set(attemptedDates);

  // Walk backwards from yesterday, find the most recent gap
  const today = new Date();
  for (let i = 1; i <= 90; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];

    if (dateStr < cutoff) break;

    if (!datesWithQuoteSet.has(dateStr) && !attemptedSet.has(dateStr)) {
      return dateStr;
    }
  }

  return null;
}

/**
 * Run a back-propagation cycle for a specific date.
 * @param {string} targetDate - YYYY-MM-DD format
 * @param {object} [io] - Socket.IO instance for real-time updates
 * @returns {Promise<{ targetDate: string, status: string, articlesFound: number, quotesExtracted: number, error?: string }>}
 */
export async function runBackPropForDate(targetDate, io) {
  const db = getDb();
  const maxArticles = parseInt(getSettingValue('backprop_max_articles_per_cycle', '5'), 10);

  // Create log entry
  db.prepare(`
    INSERT OR REPLACE INTO backprop_log (target_date, status, started_at)
    VALUES (?, 'processing', datetime('now'))
  `).run(targetDate);

  try {
    const sources = db.prepare('SELECT * FROM sources WHERE enabled = 1').all();

    // For back-propagation, we look for articles published on the target date
    // We'll use a 36-hour window centered on the target date
    const targetStart = new Date(targetDate + 'T00:00:00Z');
    const lookbackHours = 36;

    let totalArticlesFound = 0;
    let totalQuotesExtracted = 0;

    for (const source of sources) {
      if (totalArticlesFound >= maxArticles) break;

      try {
        const articles = await fetchArticlesFromSource(source, lookbackHours);

        // Filter to only articles from the target date
        const targetArticles = articles.filter(a => {
          const pubDate = new Date(a.published).toISOString().split('T')[0];
          return pubDate === targetDate;
        });

        // Insert new articles (skip duplicates)
        const insertStmt = db.prepare(`
          INSERT OR IGNORE INTO articles (url, source_id, title, published_at, status)
          VALUES (?, ?, ?, ?, 'pending')
        `);

        for (const article of targetArticles) {
          if (totalArticlesFound >= maxArticles) break;

          const result = insertStmt.run(article.url, source.id, article.title, article.published);
          if (result.changes > 0) {
            totalArticlesFound++;

            // Process the article immediately
            const insertedArticle = db.prepare('SELECT a.*, s.domain FROM articles a JOIN sources s ON a.source_id = s.id WHERE a.url = ?').get(article.url);
            if (insertedArticle) {
              try {
                const quotes = await processArticle(insertedArticle, db, io);
                totalQuotesExtracted += quotes.length;
              } catch (err) {
                logger.warn('backprop', 'article_process_error', {
                  url: article.url,
                  error: err.message,
                });
              }
            }
          }
        }
      } catch (err) {
        logger.warn('backprop', 'source_fetch_error', {
          source: source.domain,
          targetDate,
          error: err.message,
        });
      }
    }

    // Update log entry
    db.prepare(`
      UPDATE backprop_log
      SET status = 'completed', articles_found = ?, quotes_extracted = ?, completed_at = datetime('now')
      WHERE target_date = ?
    `).run(totalArticlesFound, totalQuotesExtracted, targetDate);

    logger.info('backprop', 'cycle_complete', {
      targetDate,
      articlesFound: totalArticlesFound,
      quotesExtracted: totalQuotesExtracted,
    });

    return {
      targetDate,
      status: 'completed',
      articlesFound: totalArticlesFound,
      quotesExtracted: totalQuotesExtracted,
    };
  } catch (err) {
    db.prepare(`
      UPDATE backprop_log
      SET status = 'failed', error = ?, completed_at = datetime('now')
      WHERE target_date = ?
    `).run(err.message, targetDate);

    logger.error('backprop', 'cycle_failed', {
      targetDate,
      error: err.message,
    });

    return {
      targetDate,
      status: 'failed',
      articlesFound: 0,
      quotesExtracted: 0,
      error: err.message,
    };
  }
}

/**
 * Run a single back-propagation cycle (finds gap date automatically).
 * @param {object} [io] - Socket.IO instance
 * @returns {Promise<{ targetDate: string | null, status: string, articlesFound: number, quotesExtracted: number }>}
 */
export async function runBackPropCycle(io) {
  const targetDate = findNextGapDate();

  if (!targetDate) {
    logger.debug('backprop', 'no_gaps_found', {});
    return { targetDate: null, status: 'no_gaps', articlesFound: 0, quotesExtracted: 0 };
  }

  return runBackPropForDate(targetDate, io);
}

/**
 * Get back-propagation status/history.
 * @param {number} [limit=10] - Number of recent entries to return
 * @returns {Array}
 */
export function getBackPropStatus(limit = 10) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM backprop_log
    ORDER BY target_date DESC
    LIMIT ?
  `).all(limit);
}

export default {
  findNextGapDate,
  runBackPropForDate,
  runBackPropCycle,
  getBackPropStatus,
};
