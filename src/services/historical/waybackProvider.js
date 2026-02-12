import { HistoricalProvider } from './providerInterface.js';
import logger from '../logger.js';

const CDX_API = 'https://web.archive.org/cdx/search/cdx';
const RATE_LIMIT_MS = 1000;

const DECADE_RANGES = [
  { from: '20100101', to: '20191231', label: '2010s' },
  { from: '20000101', to: '20091231', label: '2000s' },
  { from: '19900101', to: '19991231', label: '1990s' },
  { from: '19800101', to: '19891231', label: '1980s' },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class WaybackProvider extends HistoricalProvider {
  constructor() {
    super('wayback', 'Wayback Machine');
  }

  async fetchArticles(limit, db, config) {
    const currentDomainIndex = config.currentDomainIndex || 0;
    const currentDecadeIndex = config.currentDecadeIndex || 0;
    const articles = [];

    try {
      // Get enabled RSS source domains
      const sources = db.prepare(
        'SELECT DISTINCT domain FROM sources WHERE enabled = 1 ORDER BY domain'
      ).all();

      if (sources.length === 0) return [];

      const domainIdx = currentDomainIndex % sources.length;
      const decadeIdx = currentDecadeIndex % DECADE_RANGES.length;
      const domain = sources[domainIdx].domain;
      const decade = DECADE_RANGES[decadeIdx];

      const cdxUrl = `${CDX_API}?url=${encodeURIComponent(domain)}/*&output=json&fl=timestamp,original,statuscode,mimetype&filter=statuscode:200&filter=mimetype:text/html&limit=${limit * 3}&from=${decade.from}&to=${decade.to}`;

      const response = await fetch(cdxUrl, {
        headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) return [];
      const data = await response.json();

      // CDX returns array of arrays, first row is headers
      if (!Array.isArray(data) || data.length < 2) return [];

      const rows = data.slice(1); // skip header row

      for (const row of rows) {
        if (articles.length >= limit) break;

        const [timestamp, originalUrl, statuscode, mimetype] = row;
        if (!originalUrl || statuscode !== '200') continue;

        // Use original URL for dedup
        const existing = db.prepare('SELECT id FROM articles WHERE url = ?').get(originalUrl);
        if (existing) continue;

        const archiveUrl = `https://web.archive.org/web/${timestamp}/${originalUrl}`;

        articles.push({
          url: originalUrl,
          title: `${domain} via Wayback (${decade.label}) - ${archiveUrl}`,
          text: null, // text will be fetched from archive URL at processing time
          published: `${timestamp.substring(0, 4)}-${timestamp.substring(4, 6)}-${timestamp.substring(6, 8)}`,
          sourceLabel: `Wayback Machine: ${domain} (${decade.label})`,
        });

        await sleep(RATE_LIMIT_MS);
      }

      // Advance domain/decade for next cycle
      let nextDomainIdx = currentDomainIndex;
      let nextDecadeIdx = currentDecadeIndex + 1;
      if (nextDecadeIdx >= DECADE_RANGES.length) {
        nextDecadeIdx = 0;
        nextDomainIdx = (currentDomainIndex + 1) % Math.max(sources.length, 1);
      }

      db.prepare(
        "UPDATE historical_sources SET config = json_set(json_set(config, '$.currentDomainIndex', ?), '$.currentDecadeIndex', ?) WHERE provider_key = 'wayback'"
      ).run(nextDomainIdx, nextDecadeIdx);

      return articles;

    } catch (err) {
      logger.error('historical', 'wayback_fetch_error', { error: err.message });
      return [];
    }
  }

  async testConnection() {
    try {
      const url = `${CDX_API}?url=cnn.com&output=json&limit=1`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}` };
      }

      const data = await response.json();
      return {
        success: Array.isArray(data) && data.length > 0,
        message: `CDX API responsive, ${data.length} rows returned`,
      };

    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}
