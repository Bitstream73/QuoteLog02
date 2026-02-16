import Parser from 'rss-parser';
import { extract } from '@extractus/article-extractor';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import pLimit from 'p-limit';
import logger from './logger.js';
import { extractQuotesFromArticle } from './quoteExtractor.js';

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)',
  },
});

// Domain-specific rate limiters
const domainLimiters = new Map();

function getLimiter(domain) {
  if (!domainLimiters.has(domain)) {
    domainLimiters.set(domain, pLimit(2)); // max 2 concurrent per domain
  }
  return domainLimiters.get(domain);
}

// Delay between requests to same domain
const domainLastRequest = new Map();
const DOMAIN_DELAY_MS = 1000;

async function respectRateLimit(domain) {
  const lastRequest = domainLastRequest.get(domain);
  if (lastRequest) {
    const elapsed = Date.now() - lastRequest;
    if (elapsed < DOMAIN_DELAY_MS) {
      await new Promise(resolve => setTimeout(resolve, DOMAIN_DELAY_MS - elapsed));
    }
  }
  domainLastRequest.set(domain, Date.now());
}

/**
 * Fetch articles from a source's RSS feed
 */
export async function fetchArticlesFromSource(source, lookbackHours) {
  const feedUrl = source.rss_url || `https://news.google.com/rss/search?q=site:${source.domain}`;

  logger.debug('fetcher', 'fetch_feed', { domain: source.domain, url: feedUrl });

  const limiter = getLimiter(source.domain);

  return limiter(async () => {
    await respectRateLimit(source.domain);

    const feed = await parser.parseURL(feedUrl);
    const cutoffTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const articles = [];
    for (const item of feed.items || []) {
      const published = item.pubDate ? new Date(item.pubDate) : new Date();

      // Filter by time window
      if (published < cutoffTime) continue;

      // Extract the actual article URL (Google News wraps URLs)
      let url = item.link || '';

      // Handle Google News URL unwrapping
      if (url.includes('news.google.com')) {
        const match = url.match(/url=([^&]+)/);
        if (match) {
          url = decodeURIComponent(match[1]);
        }
      }

      // Only include articles from the source domain
      // Match if hostname ends with the source domain (handles subdomains like www.cnn.com matching cnn.com)
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();
        if (hostname !== source.domain && !hostname.endsWith('.' + source.domain)) continue;
      } catch {
        continue;
      }

      articles.push({
        url,
        title: item.title || '',
        published: published.toISOString(),
      });
    }

    logger.info('fetcher', 'feed_parsed', {
      domain: source.domain,
      feedUrl,
      total: feed.items?.length || 0,
      filtered: articles.length,
    });

    return articles;
  });
}

/**
 * Extract text from an article URL using @extractus/article-extractor
 */
async function extractArticleText(url) {
  try {
    const article = await extract(url, {
      headers: {
        'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)',
      },
    });

    if (!article || !article.content) {
      return null;
    }

    // Strip HTML tags to get plain text
    const plainText = article.content
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      title: article.title,
      text: plainText,
      author: article.author,
      published: article.published,
    };
  } catch (err) {
    logger.debug('fetcher', 'extract_primary_failed', { url, error: err.message });
    return null;
  }
}

/**
 * Fallback extraction using @mozilla/readability + jsdom
 */
async function extractWithReadability(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return null;

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();

    return article?.textContent?.trim() || null;
  } catch (err) {
    logger.debug('fetcher', 'extract_readability_failed', { url, error: err.message });
    return null;
  }
}

/**
 * Process a single article - extract text and quotes
 */
export async function processArticle(article, db, io) {
  db.prepare("UPDATE articles SET status = 'processing' WHERE id = ?").run(article.id);

  // Domain fallback: extract from URL when source_id is NULL (backprop articles)
  if (!article.domain && article.url) {
    try {
      const urlObj = new URL(article.url);
      article.domain = urlObj.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      article.domain = 'unknown';
    }
  }

  const limiter = getLimiter(article.domain || 'unknown');

  return limiter(async () => {
    await respectRateLimit(article.domain);

    // Step 1: Extract article text
    // Check for prefetched text (historical articles)
    let extracted;
    if (article.prefetched_text && article.prefetched_text.length >= 200) {
      extracted = { text: article.prefetched_text, title: article.title };
    } else {
      extracted = await extractArticleText(article.url);

      // Fallback to Readability if primary fails or text too short
      if (!extracted || !extracted.text || extracted.text.length < 200) {
        const readabilityText = await extractWithReadability(article.url);
        if (readabilityText && readabilityText.length >= 200) {
          extracted = { text: readabilityText, title: article.title };
        }
      }
    }

    if (!extracted || !extracted.text || extracted.text.length < 200) {
      db.prepare("UPDATE articles SET status = 'failed', error = 'Text too short or extraction failed' WHERE id = ?")
        .run(article.id);
      return [];
    }

    // Step 2 & 3: Extract quotes and entities (includes pre-filter and Gemini extraction)
    const extractionResult = await extractQuotesFromArticle(extracted.text, article, db, io);
    const quotes = extractionResult.quotes;

    // Step 4: Update article status
    const status = quotes.length > 0 ? 'completed' : 'no_quotes';
    db.prepare(`UPDATE articles SET status = ?, quote_count = ?, processed_at = datetime('now') WHERE id = ?`)
      .run(status, quotes.length, article.id);

    return extractionResult;
  });
}

export default { fetchArticlesFromSource, processArticle };
