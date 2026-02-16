import Parser from 'rss-parser';
import logger from './logger.js';

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)',
  },
});

const MAX_ATTEMPTS = 20;

/**
 * Fetch articles for a specific date using multi-strategy approach.
 * Strategies tried in order: Google News RSS, GDELT DOC API, Wayback Machine CDX.
 * @param {string} targetDate - YYYY-MM-DD format
 * @param {number} maxArticles - Maximum articles to return
 * @param {object} db - Database instance (used to get enabled source domains)
 * @returns {Promise<{ articles: Array<{url: string, title: string, published: string}>, attempts: Array<{strategy: string, success: boolean, error?: string, count?: number}> }>}
 */
export async function fetchArticlesForDate(targetDate, maxArticles, db) {
  const attempts = [];
  const seenUrls = new Set();
  const articles = [];

  // Get enabled source domains for domain-specific strategies
  const sources = db.prepare('SELECT * FROM sources WHERE enabled = 1').all();
  const domains = [...new Set(sources.map(s => s.domain))];

  // Strategy 1: Google News RSS date search
  if (attempts.length < MAX_ATTEMPTS && articles.length < maxArticles) {
    try {
      const googleArticles = await fetchGoogleNewsForDate(targetDate);
      attempts.push({ strategy: 'google_news', success: true, count: googleArticles.length });

      for (const a of googleArticles) {
        if (articles.length >= maxArticles) break;
        if (!seenUrls.has(a.url)) {
          seenUrls.add(a.url);
          articles.push(a);
        }
      }
    } catch (err) {
      attempts.push({ strategy: 'google_news', success: false, error: err.message });
      logger.warn('backprop_fetch', 'google_news_failed', { targetDate, error: err.message });
    }
  }

  // Strategy 2: GDELT DOC API (per enabled source domain)
  if (attempts.length < MAX_ATTEMPTS && articles.length < maxArticles) {
    for (const domain of domains) {
      if (attempts.length >= MAX_ATTEMPTS || articles.length >= maxArticles) break;

      try {
        const gdeltArticles = await fetchGdeltForDate(targetDate, domain);
        attempts.push({ strategy: 'gdelt', success: true, count: gdeltArticles.length, domain });

        for (const a of gdeltArticles) {
          if (articles.length >= maxArticles) break;
          if (!seenUrls.has(a.url)) {
            seenUrls.add(a.url);
            articles.push(a);
          }
        }
      } catch (err) {
        attempts.push({ strategy: 'gdelt', success: false, error: err.message, domain });
        logger.warn('backprop_fetch', 'gdelt_failed', { targetDate, domain, error: err.message });
      }
    }
  }

  // Strategy 3: Wayback Machine CDX (per enabled source domain)
  if (attempts.length < MAX_ATTEMPTS && articles.length < maxArticles) {
    for (const domain of domains) {
      if (attempts.length >= MAX_ATTEMPTS || articles.length >= maxArticles) break;

      try {
        const waybackArticles = await fetchWaybackForDate(targetDate, domain);
        attempts.push({ strategy: 'wayback', success: true, count: waybackArticles.length, domain });

        for (const a of waybackArticles) {
          if (articles.length >= maxArticles) break;
          if (!seenUrls.has(a.url)) {
            seenUrls.add(a.url);
            articles.push(a);
          }
        }
      } catch (err) {
        attempts.push({ strategy: 'wayback', success: false, error: err.message, domain });
        logger.warn('backprop_fetch', 'wayback_failed', { targetDate, domain, error: err.message });
      }
    }
  }

  logger.info('backprop_fetch', 'fetch_complete', {
    targetDate,
    totalArticles: articles.length,
    totalAttempts: attempts.length,
    strategies: attempts.map(a => a.strategy),
  });

  return { articles, attempts };
}

/**
 * Strategy 1: Google News RSS with date range search.
 * Uses after:/before: search operators to find articles from a specific date.
 */
async function fetchGoogleNewsForDate(targetDate) {
  const targetDateObj = new Date(targetDate + 'T00:00:00Z');
  const dayBefore = new Date(targetDateObj);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const dayAfter = new Date(targetDateObj);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);

  const afterDate = dayBefore.toISOString().split('T')[0];
  const beforeDate = dayAfter.toISOString().split('T')[0];

  const url = `https://news.google.com/rss/search?q=after:${afterDate}+before:${beforeDate}&hl=en-US&gl=US&ceid=US:en`;

  logger.debug('backprop_fetch', 'google_news_request', { url, targetDate });

  const feed = await parser.parseURL(url);
  const articles = [];

  for (const item of feed.items || []) {
    let articleUrl = item.link || '';

    // Unwrap Google News redirect URLs
    if (articleUrl.includes('news.google.com')) {
      const match = articleUrl.match(/url=([^&]+)/);
      if (match) {
        articleUrl = decodeURIComponent(match[1]);
      }
    }

    if (!articleUrl || !articleUrl.startsWith('http')) continue;

    articles.push({
      url: articleUrl,
      title: item.title || '',
      published: item.pubDate ? new Date(item.pubDate).toISOString() : new Date(targetDate + 'T12:00:00Z').toISOString(),
    });
  }

  return articles;
}

/**
 * Strategy 2: GDELT DOC API for a specific domain and date.
 * GDELT indexes global news and supports date-range queries.
 */
async function fetchGdeltForDate(targetDate, domain) {
  const dateCompact = targetDate.replace(/-/g, '');
  const startDatetime = `${dateCompact}000000`;
  const endDatetime = `${dateCompact}235959`;

  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=domain:${domain}&mode=artlist&startdatetime=${startDatetime}&enddatetime=${endDatetime}&maxrecords=25&format=json`;

  logger.debug('backprop_fetch', 'gdelt_request', { url, targetDate, domain });

  const response = await fetch(url, {
    headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`GDELT API returned ${response.status}`);
  }

  const data = await response.json();
  const articles = [];

  for (const item of data.articles || []) {
    if (!item.url || !item.url.startsWith('http')) continue;

    // Parse GDELT seendate format: YYYYMMDDTHHMMSSZ
    let published = new Date(targetDate + 'T12:00:00Z').toISOString();
    if (item.seendate) {
      try {
        const sd = item.seendate;
        const parsed = new Date(
          `${sd.slice(0, 4)}-${sd.slice(4, 6)}-${sd.slice(6, 8)}T${sd.slice(9, 11)}:${sd.slice(11, 13)}:${sd.slice(13, 15)}Z`
        );
        if (!isNaN(parsed.getTime())) {
          published = parsed.toISOString();
        }
      } catch {
        // Use default
      }
    }

    articles.push({
      url: item.url,
      title: item.title || '',
      published,
    });
  }

  return articles;
}

/**
 * Strategy 3: Wayback Machine CDX API for a specific domain and date.
 * Returns archived URLs from the Internet Archive's index.
 */
async function fetchWaybackForDate(targetDate, domain) {
  const dateCompact = targetDate.replace(/-/g, '');

  const url = `https://web.archive.org/cdx/search/cdx?url=${domain}/*&from=${dateCompact}&to=${dateCompact}&output=text&fl=original,timestamp,mimetype,statuscode&filter=mimetype:text/html&filter=statuscode:200&collapse=urlkey&limit=25`;

  logger.debug('backprop_fetch', 'wayback_request', { url, targetDate, domain });

  const response = await fetch(url, {
    headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Wayback CDX API returned ${response.status}`);
  }

  const text = await response.text();
  const articles = [];

  for (const line of text.trim().split('\n')) {
    if (!line.trim()) continue;

    const parts = line.split(' ');
    if (parts.length < 2) continue;

    const originalUrl = parts[0];
    const timestamp = parts[1];

    if (!originalUrl || !originalUrl.startsWith('http')) continue;

    // Skip non-article URLs (homepages, asset files, etc.)
    if (originalUrl.endsWith('/') && originalUrl.split('/').length <= 4) continue;

    // Parse timestamp YYYYMMDDHHMMSS
    let published = new Date(targetDate + 'T12:00:00Z').toISOString();
    if (timestamp && timestamp.length >= 14) {
      try {
        const parsed = new Date(
          `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}Z`
        );
        if (!isNaN(parsed.getTime())) {
          published = parsed.toISOString();
        }
      } catch {
        // Use default
      }
    }

    // Derive title from URL path
    const urlPath = new URL(originalUrl).pathname;
    const title = urlPath
      .split('/')
      .pop()
      .replace(/[-_]/g, ' ')
      .replace(/\.\w+$/, '')
      .trim() || 'Archived article';

    articles.push({
      url: originalUrl,
      title,
      published,
    });
  }

  return articles;
}

export default { fetchArticlesForDate };
