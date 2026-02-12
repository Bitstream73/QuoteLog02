import { HistoricalProvider } from './providerInterface.js';
import logger from '../logger.js';

const API_BASE = 'https://api.govinfo.gov';
const RATE_LIMIT_MS = 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Strip HTML tags from content to plain text
 */
function stripHtml(html) {
  return html
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

export class GovInfoProvider extends HistoricalProvider {
  constructor() {
    super('govinfo', 'Congressional Record');
  }

  async fetchArticles(limit, db, config) {
    const apiKey = process.env.GOVINFO_API_KEY;
    if (!apiKey) {
      logger.debug('historical', 'govinfo_no_api_key', { message: 'GOVINFO_API_KEY not set, skipping' });
      return [];
    }

    const offset = config.offset || 0;
    const articles = [];

    try {
      // Calculate date range: search last 30 days from offset
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - (offset * 30));
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 30);

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      const searchUrl = `${API_BASE}/search?query=collection:CREC+publishdate:range(${startStr},${endStr})&offset=0&pageSize=25&api_key=${apiKey}`;

      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) return [];
      const data = await response.json();
      const results = data.results || [];

      for (const result of results) {
        if (articles.length >= limit) break;

        const packageId = result.packageId;
        if (!packageId) continue;

        const docUrl = `https://www.govinfo.gov/content/pkg/${packageId}`;

        // Check if we already have this URL
        const existing = db.prepare('SELECT id FROM articles WHERE url = ?').get(docUrl);
        if (existing) continue;

        await sleep(RATE_LIMIT_MS);

        // Fetch HTML content
        const contentUrl = `${API_BASE}/packages/${packageId}/htm?api_key=${apiKey}`;
        const contentResponse = await fetch(contentUrl, {
          headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
          signal: AbortSignal.timeout(15000),
        });

        if (!contentResponse.ok) continue;
        const html = await contentResponse.text();
        const text = stripHtml(html);

        if (text.length < 200) continue;

        articles.push({
          url: docUrl,
          title: result.title || `Congressional Record: ${packageId}`,
          text,
          published: result.dateIssued || null,
          sourceLabel: `GovInfo: ${packageId}`,
        });
      }

      // Advance offset for next cycle
      db.prepare(
        "UPDATE historical_sources SET config = json_set(config, '$.offset', ?) WHERE provider_key = 'govinfo'"
      ).run(offset + 1);

      return articles;

    } catch (err) {
      logger.error('historical', 'govinfo_fetch_error', { error: err.message });
      return [];
    }
  }

  async testConnection() {
    const apiKey = process.env.GOVINFO_API_KEY;
    if (!apiKey) {
      return { success: false, message: 'GOVINFO_API_KEY not set' };
    }

    try {
      const url = `${API_BASE}/search?query=collection:CREC&pageSize=1&api_key=${apiKey}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}` };
      }

      const data = await response.json();
      return {
        success: (data.count || 0) > 0,
        message: `Found ${data.count || 0} Congressional Record entries`,
      };

    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}
