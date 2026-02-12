import { HistoricalProvider } from './providerInterface.js';
import logger from '../logger.js';

const API_BASE = 'https://chroniclingamerica.loc.gov';
const RATE_LIMIT_MS = 1000;
const MIN_TEXT_LENGTH = 500;

const DEFAULT_SEARCH_TERMS = [
  'Abraham Lincoln', 'Theodore Roosevelt', 'Frederick Douglass',
  'Susan B. Anthony', 'Mark Twain', 'Woodrow Wilson',
  'Franklin Roosevelt', 'Eleanor Roosevelt', 'Martin Luther King',
  'Thomas Edison', 'Andrew Carnegie', 'Booker T. Washington',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if OCR text likely contains quotes (has quote marks and attribution verbs)
 */
function likelyContainsQuotes(text) {
  const hasQuoteMarks = /[""\u201C\u201D]/.test(text);
  const hasAttribution = /\b(said|says|stated|declared|remarked|replied|asked|answered|testified|wrote|exclaimed)\b/i.test(text);
  return hasQuoteMarks && hasAttribution;
}

export class ChroniclingAmericaProvider extends HistoricalProvider {
  constructor() {
    super('chronicling_america', 'Chronicling America');
  }

  async fetchArticles(limit, db, config) {
    const searchTerms = config.searchTerms || DEFAULT_SEARCH_TERMS;
    const currentIndex = config.currentIndex || 0;
    const currentPage = config.currentPage || 1;
    const articles = [];

    try {
      const searchTerm = searchTerms[currentIndex % searchTerms.length];
      const searchUrl = `${API_BASE}/search/pages/results/?andtext=${encodeURIComponent(searchTerm)}&format=json&page=${currentPage}`;

      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) return [];
      const data = await response.json();
      const items = data.items || [];

      for (const item of items) {
        if (articles.length >= limit) break;

        const pageUrl = item.url;
        if (!pageUrl) continue;

        // Check if we already have this URL
        const existing = db.prepare('SELECT id FROM articles WHERE url = ?').get(pageUrl);
        if (existing) continue;

        const ocrText = item.ocr_eng || '';

        // Skip pages with too little text
        if (ocrText.length < MIN_TEXT_LENGTH) continue;

        // Pre-filter: check for likely quotes
        if (!likelyContainsQuotes(ocrText)) continue;

        const published = item.date || null;

        articles.push({
          url: pageUrl,
          title: `${item.title || 'Newspaper page'} (${searchTerm})`,
          text: ocrText,
          published,
          sourceLabel: `Chronicling America: ${searchTerm}`,
        });

        await sleep(RATE_LIMIT_MS);
      }

      // Advance pagination/search term for next cycle
      const totalPages = Math.ceil((data.totalItems || 0) / (data.itemsPerPage || 20));
      let nextIndex = currentIndex;
      let nextPage = currentPage + 1;

      if (nextPage > totalPages || nextPage > 10) {
        // Move to next search term, reset page
        nextIndex = (currentIndex + 1) % searchTerms.length;
        nextPage = 1;
      }

      db.prepare(
        "UPDATE historical_sources SET config = json_set(json_set(json_set(config, '$.currentIndex', ?), '$.currentPage', ?), '$.searchTerms', json(?)) WHERE provider_key = 'chronicling_america'"
      ).run(nextIndex, nextPage, JSON.stringify(searchTerms));

      return articles;

    } catch (err) {
      logger.error('historical', 'chronicling_america_fetch_error', { error: err.message });
      return [];
    }
  }

  async testConnection() {
    try {
      const url = `${API_BASE}/search/pages/results/?andtext=president&format=json&page=1`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}` };
      }

      const data = await response.json();
      return {
        success: (data.totalItems || 0) > 0,
        message: `Found ${data.totalItems || 0} items`,
      };

    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}
