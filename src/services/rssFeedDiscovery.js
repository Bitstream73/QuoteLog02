// RSS Feed Auto-Discovery

const COMMON_RSS_PATHS = [
  '/rss',
  '/feed',
  '/rss.xml',
  '/feed.xml',
  '/feeds/all.rss',
  '/feeds/rss.xml',
  '/atom.xml',
  '/index.xml',
  '/feed/rss',
  '/rss/index.xml',
];

/**
 * Attempts to discover the RSS feed URL for a given domain
 * @param {string} domain - The domain to find RSS feed for (e.g., "reuters.com")
 * @returns {Promise<string|null>} - The RSS URL or null if not found
 */
export async function discoverRssFeed(domain) {
  const baseUrl = `https://${domain}`;

  // Try common RSS paths first
  for (const path of COMMON_RSS_PATHS) {
    const url = `${baseUrl}${path}`;
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (
          contentType.includes('xml') ||
          contentType.includes('rss') ||
          contentType.includes('atom')
        ) {
          return url;
        }
      }
    } catch {
      // Continue to next path
    }
  }

  // Try to find RSS link in homepage HTML
  try {
    const response = await fetch(baseUrl, {
      headers: {
        'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const html = await response.text();

      // Look for RSS/Atom link tags
      const rssLinkMatch = html.match(
        /<link[^>]*rel=["']alternate["'][^>]*type=["']application\/(rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i
      );

      if (rssLinkMatch) {
        let feedUrl = rssLinkMatch[2];
        // Handle relative URLs
        if (feedUrl.startsWith('/')) {
          feedUrl = baseUrl + feedUrl;
        } else if (!feedUrl.startsWith('http')) {
          feedUrl = baseUrl + '/' + feedUrl;
        }
        return feedUrl;
      }

      // Try alternate pattern (href before type)
      const altMatch = html.match(
        /<link[^>]*href=["']([^"']+)["'][^>]*type=["']application\/(rss|atom)\+xml["']/i
      );

      if (altMatch) {
        let feedUrl = altMatch[1];
        if (feedUrl.startsWith('/')) {
          feedUrl = baseUrl + feedUrl;
        } else if (!feedUrl.startsWith('http')) {
          feedUrl = baseUrl + '/' + feedUrl;
        }
        return feedUrl;
      }
    }
  } catch {
    // Fall through to Google News fallback
  }

  // Fallback to Google News RSS
  return `https://news.google.com/rss/search?q=site:${domain}`;
}

export default { discoverRssFeed };
