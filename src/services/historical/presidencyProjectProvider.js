import { HistoricalProvider } from './providerInterface.js';
import logger from '../logger.js';

const BASE_URL = 'https://www.presidency.ucsb.edu';
const RATE_LIMIT_MS = 2000; // 2 seconds between requests (respectful scraping)

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Strip HTML tags from content to plain text
 */
function stripHtml(html) {
  return html
    .replace(/<script[^>]*>.*?<\/script>/gs, '')
    .replace(/<style[^>]*>.*?<\/style>/gs, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract document links and titles from search result HTML
 */
function parseSearchResults(html) {
  const results = [];
  // Match document links in the search results
  const linkPattern = /<a[^>]*href="(\/documents\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    results.push({
      path: match[1],
      title: match[2].trim(),
    });
  }
  return results;
}

export class PresidencyProjectProvider extends HistoricalProvider {
  constructor() {
    super('presidency_project', 'American Presidency Project');
  }

  async fetchArticles(limit, db, config) {
    const currentPage = config.currentPage || 0;
    const articles = [];

    try {
      const searchUrl = `${BASE_URL}/advanced-search?field-keywords=&field-keywords2=&field-keywords3=&from%5Bdate%5D=&to%5Bdate%5D=&person2=&items_per_page=25&page=${currentPage}`;

      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) return [];
      const html = await response.text();
      const docLinks = parseSearchResults(html);

      for (const doc of docLinks) {
        if (articles.length >= limit) break;

        const docUrl = `${BASE_URL}${doc.path}`;

        // Check if we already have this URL
        const existing = db.prepare('SELECT id FROM articles WHERE url = ?').get(docUrl);
        if (existing) continue;

        await sleep(RATE_LIMIT_MS);

        // Fetch document content
        const docResponse = await fetch(docUrl, {
          headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
          signal: AbortSignal.timeout(15000),
        });

        if (!docResponse.ok) continue;
        const docHtml = await docResponse.text();

        // Extract text from the document body
        // Look for the main content div
        const contentMatch = docHtml.match(/<div[^>]*class="[^"]*field-docs-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        const text = contentMatch ? stripHtml(contentMatch[1]) : stripHtml(docHtml);

        if (text.length < 200) continue;

        // Try to extract date from the page
        const dateMatch = docHtml.match(/<span[^>]*class="[^"]*date-display-single[^"]*"[^>]*>([^<]+)<\/span>/i);
        const published = dateMatch ? dateMatch[1].trim() : null;

        articles.push({
          url: docUrl,
          title: doc.title,
          text,
          published,
          sourceLabel: `Presidency Project: ${doc.title}`,
        });
      }

      // Advance page for next cycle
      db.prepare(
        "UPDATE historical_sources SET config = json_set(config, '$.currentPage', ?) WHERE provider_key = 'presidency_project'"
      ).run(currentPage + 1);

      return articles;

    } catch (err) {
      logger.error('historical', 'presidency_project_fetch_error', { error: err.message });
      return [];
    }
  }

  async testConnection() {
    try {
      const url = `${BASE_URL}/advanced-search?items_per_page=1`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}` };
      }

      const html = await response.text();
      return {
        success: html.includes('presidency.ucsb.edu'),
        message: response.ok ? 'Site accessible' : 'Invalid response',
      };

    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}
