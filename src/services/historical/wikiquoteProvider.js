import { HistoricalProvider } from './providerInterface.js';
import logger from '../logger.js';

const API_BASE = 'https://en.wikiquote.org/w/api.php';
const RATE_LIMIT_MS = 1000;

/**
 * Strip wiki markup to plain text.
 * [[link|text]] -> text, '''bold''' -> bold, {{...}} -> remove
 */
function stripWikiMarkup(text) {
  return text
    .replace(/\{\{[^}]*\}\}/g, '')           // {{templates}}
    .replace(/\[\[[^\]]*\|([^\]]*)\]\]/g, '$1') // [[link|text]] -> text
    .replace(/\[\[([^\]]*)\]\]/g, '$1')       // [[link]] -> link
    .replace(/'{2,3}/g, '')                    // '''bold''' / ''italic''
    .replace(/<ref[^>]*>.*?<\/ref>/gs, '')     // <ref>...</ref>
    .replace(/<[^>]+>/g, '')                   // HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse wikitext to extract quotes (lines starting with *)
 */
function extractQuotesFromWikitext(wikitext, personName) {
  const lines = wikitext.split('\n');
  const quotes = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Quote lines start with * (but not ** which are attributions/sources)
    if (trimmed.startsWith('*') && !trimmed.startsWith('**')) {
      const quoteText = stripWikiMarkup(trimmed.replace(/^\*+\s*/, ''));
      if (quoteText.length > 20 && quoteText.length < 2000) {
        quotes.push(quoteText);
      }
    }
  }

  return quotes;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class WikiquoteProvider extends HistoricalProvider {
  constructor() {
    super('wikiquote', 'Wikiquote');
  }

  async fetchArticles(limit, db, config) {
    const cmcontinue = config.cmcontinue || '';
    const articles = [];

    try {
      // Step 1: Get category members (notable people)
      const catUrl = `${API_BASE}?action=query&list=categorymembers&cmtitle=Category:People&cmlimit=${limit * 2}&cmtype=page&format=json${cmcontinue ? '&cmcontinue=' + encodeURIComponent(cmcontinue) : ''}`;

      const catResponse = await fetch(catUrl, {
        headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
        signal: AbortSignal.timeout(15000),
      });

      if (!catResponse.ok) return [];
      const catData = await catResponse.json();
      const members = catData.query?.categorymembers || [];

      // Save continue token for next cycle
      const newContinue = catData.continue?.cmcontinue || '';
      if (newContinue !== cmcontinue) {
        db.prepare(
          "UPDATE historical_sources SET config = json_set(config, '$.cmcontinue', ?) WHERE provider_key = 'wikiquote'"
        ).run(newContinue);
      }

      // Step 2: For each person, get their page content
      for (const member of members) {
        if (articles.length >= limit) break;

        const pageTitle = member.title;
        const pageUrl = `https://en.wikiquote.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`;

        // Check if we already have this URL
        const existing = db.prepare('SELECT id FROM articles WHERE url = ?').get(pageUrl);
        if (existing) continue;

        await sleep(RATE_LIMIT_MS);

        const parseUrl = `${API_BASE}?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext&format=json`;
        const parseResponse = await fetch(parseUrl, {
          headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
          signal: AbortSignal.timeout(15000),
        });

        if (!parseResponse.ok) continue;
        const parseData = await parseResponse.json();
        const wikitext = parseData.parse?.wikitext?.['*'] || '';

        const quotes = extractQuotesFromWikitext(wikitext, pageTitle);
        if (quotes.length === 0) continue;

        // Build pseudo-article text
        const text = `The following are quotes attributed to ${pageTitle}:\n\n` +
          quotes.map(q => `"${q}" - ${pageTitle}`).join('\n\n');

        articles.push({
          url: pageUrl,
          title: `Wikiquote: ${pageTitle}`,
          text,
          published: null,
          sourceLabel: `Wikiquote: ${pageTitle}`,
        });
      }

      return articles;

    } catch (err) {
      logger.error('historical', 'wikiquote_fetch_error', { error: err.message });
      return [];
    }
  }

  async testConnection() {
    try {
      const url = `${API_BASE}?action=query&meta=siteinfo&format=json`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'QuoteLog/1.0 (+https://quotelog.app)' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}` };
      }

      const data = await response.json();
      const siteName = data.query?.general?.sitename;
      return { success: !!siteName, message: siteName ? `Connected to ${siteName}` : 'Invalid response' };

    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}
