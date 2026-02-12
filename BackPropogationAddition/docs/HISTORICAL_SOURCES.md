# Historical Source Providers

## Provider Interface

All providers extend a base class. Create `src/services/historical/providerInterface.js`:

```javascript
export class HistoricalProvider {
  constructor(key, name) {
    this.key = key;        // matches provider_key in historical_sources table
    this.name = name;
  }

  /**
   * Fetch historical articles not yet in the database.
   * @param {number} limit - Max articles to return this cycle
   * @param {object} db - better-sqlite3 database instance
   * @param {object} config - Provider-specific config from historical_sources.config JSON
   * @returns {Promise<Array<{url: string, title: string, text: string|null, published: string|null, sourceLabel: string}>>}
   *
   * Each returned article MUST have:
   * - url: Unique URL (used for dedup against articles.url)
   * - title: Article/document title
   * - text: Full text content (plain text, no HTML) OR null if text must be fetched from URL
   * - published: ISO date string or null if unknown
   * - sourceLabel: Human-readable label (e.g., "Wikiquote: Abraham Lincoln")
   */
  async fetchArticles(limit, db, config) {
    throw new Error('fetchArticles() must be implemented');
  }

  /**
   * Test if the provider can connect and return data.
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented');
  }
}
```

## Provider Registry (`src/services/historical/index.js`)

```javascript
import { getDb } from '../../config/database.js';
import { WikiquoteProvider } from './wikiquoteProvider.js';
import { ChroniclingAmericaProvider } from './chroniclingAmericaProvider.js';
import { WaybackProvider } from './waybackProvider.js';
import { GovInfoProvider } from './govInfoProvider.js';
import { PresidencyProjectProvider } from './presidencyProjectProvider.js';

const providers = new Map();

function registerProvider(provider) {
  providers.set(provider.key, provider);
}

registerProvider(new WikiquoteProvider());
registerProvider(new ChroniclingAmericaProvider());
registerProvider(new WaybackProvider());
registerProvider(new GovInfoProvider());
registerProvider(new PresidencyProjectProvider());

export function getAllProviders() { return [...providers.values()]; }
export function getProviderByKey(key) { return providers.get(key); }

export function getEnabledProviders() {
  const db = getDb();
  const enabled = db.prepare(
    "SELECT provider_key FROM historical_sources WHERE enabled = 1 AND status != 'disabled'"
  ).all();
  return enabled.map(row => providers.get(row.provider_key)).filter(Boolean);
}
```

## Provider 1: Wikiquote (`wikiquoteProvider.js`)

**API:** MediaWiki Action API at `https://en.wikiquote.org/w/api.php`

**Strategy:** Fetch pages of notable public figures from Wikiquote, extract their quotes, build pseudo-articles for Gemini extraction.

**API Calls:**
1. Get category members: `action=query&list=categorymembers&cmtitle=Category:People&cmlimit=50&cmtype=page&format=json&cmcontinue={offset}`
2. Get page content: `action=parse&page={title}&prop=wikitext&format=json`

**Rate Limit:** 1 request/second (Wikimedia policy)

**URL Format:** `https://en.wikiquote.org/wiki/{PageTitle}` (for dedup via `articles.url`)

**Text Processing:**
- Parse wikitext to extract lines starting with `*` (quote lines) under section headers
- Strip wiki markup: `[[link|text]]` -> `text`, `'''bold'''` -> `bold`, `{{...}}` -> remove
- Build pseudo-article text: `"The following are quotes attributed to {Person Name}:\n\n"{quote1}" - {Person}\n"{quote2}" - {Person}\n...`
- Set `text` field (prefetched) since there's no article URL to fetch from

**Dedup:** Check `articles.url` for existing wikiquote URLs. Track `cmcontinue` offset in `historical_sources.config`.

**testConnection:** Fetch `action=query&meta=siteinfo&format=json` -- should return site name.

## Provider 2: Chronicling America (`chroniclingAmericaProvider.js`)

**API:** Library of Congress at `https://chroniclingamerica.loc.gov/`

**Strategy:** Search historical newspaper pages for notable figure mentions. Focus on pages containing quote marks and attribution verbs.

**API Calls:**
1. Search: `https://chroniclingamerica.loc.gov/search/pages/results/?andtext={query}&format=json&page={n}`
2. OCR text: Each result includes `ocr_eng` field with full OCR text

**Search Terms:** Rotate through notable historical figures. Maintain a search terms list and current index in `config`:
```json
{
  "searchTerms": ["Abraham Lincoln", "Theodore Roosevelt", "Frederick Douglass", "Susan B. Anthony", ...],
  "currentIndex": 0,
  "currentPage": 1
}
```

**Rate Limit:** 1 request/second

**URL Format:** Result `url` field (unique per newspaper page)

**Text Processing:**
- OCR text quality varies -- skip pages with less than 500 characters of text
- Pre-filter: check for quote marks and attribution verbs before including
- Set `text` field (prefetched) with OCR text
- Set `published` from result `date` field

**testConnection:** Fetch `https://chroniclingamerica.loc.gov/search/pages/results/?andtext=president&format=json&page=1` -- check for `totalItems > 0`.

## Provider 3: Wayback Machine (`waybackProvider.js`)

**API:** CDX Server API at `https://web.archive.org/cdx/search/cdx`

**Strategy:** For each enabled RSS source domain in the main `sources` table, fetch historical snapshots of that domain's articles. Extends existing sources backwards in time.

**API Calls:**
1. CDX query: `https://web.archive.org/cdx/search/cdx?url={domain}/*&output=json&fl=timestamp,original,statuscode,mimetype&filter=statuscode:200&filter=mimetype:text/html&limit={limit}&from={yyyyMMdd}&to={yyyyMMdd}`
2. Fetch archived page: `https://web.archive.org/web/{timestamp}/{original_url}`

**Strategy Details:**
- Query CDX for each enabled RSS source's domain from the `sources` table
- Pick date ranges from the past: rotate through decades (2010s, 2000s, 1990s, etc.)
- Track current domain index and date range in `config`
- Return URLs as `original_url` (not archive.org URL) for dedup
- Set `text` to null -- the archived page will be fetched by `processArticle` using the archive.org URL

**Rate Limit:** 1 request/second (Internet Archive policy)

**URL Format:** Use `original_url` for `articles.url` dedup. Store archive.org URL in title for fetching.

**testConnection:** Fetch `https://web.archive.org/cdx/search/cdx?url=cnn.com&output=json&limit=1` -- check for non-empty response.

## Provider 4: GovInfo -- Congressional Record (`govInfoProvider.js`)

**API:** GovInfo API at `https://api.govinfo.gov`

**Auth:** Free API key from api.data.gov. Read from `process.env.GOVINFO_API_KEY`. If not set, provider returns empty array and testConnection reports missing key.

**API Calls:**
1. Search: `https://api.govinfo.gov/search?query=collection:CREC+publishdate:range({startDate},{endDate})&offset={offset}&pageSize=25&api_key={key}`
2. Package summary: `https://api.govinfo.gov/packages/{packageId}/summary?api_key={key}`
3. Content: `https://api.govinfo.gov/packages/{packageId}/htm?api_key={key}`

**Strategy:**
- Search Congressional Record entries in reverse chronological order
- Focus on HOUSE and SENATE sections (skip DIGEST, EXTENSIONS)
- Track current date offset in `config`
- HTML content needs tag stripping to plain text

**Rate Limit:** 1000 requests/hour (api.data.gov)

**URL Format:** `https://www.govinfo.gov/content/pkg/{packageId}` (unique per package)

**Text Processing:**
- Strip HTML tags from content
- Congressional Record is well-structured: speaker names in caps preceding remarks
- Set `text` field (prefetched) with stripped HTML content

**testConnection:** If no API key, return `{success: false, message: 'GOVINFO_API_KEY not set'}`. Otherwise fetch `https://api.govinfo.gov/search?query=collection:CREC&pageSize=1&api_key={key}` and check response.

## Provider 5: American Presidency Project (`presidencyProjectProvider.js`)

**API:** No official API. Scrape from `https://www.presidency.ucsb.edu`

**Strategy:** Fetch presidential speeches, press conferences, and public remarks. Rich in direct quotes.

**Fetching:**
1. Document list: `https://www.presidency.ucsb.edu/advanced-search?field-keywords=&field-keywords2=&field-keywords3=&from%5Bdate%5D=&to%5Bdate%5D=&person2=&items_per_page=25&page={n}`
2. Document content: Individual document URLs

**Approach:**
- Use `@extractus/article-extractor` (already installed) to extract text from document pages
- Rotate through pages of the document index
- Track current page offset in `config`
- Start from earliest documents and work forward

**Rate Limit:** 2 seconds between requests (respectful scraping)

**URL Format:** `https://www.presidency.ucsb.edu/documents/{slug}` (unique per document)

**Text Processing:**
- Article extractor handles HTML -> text conversion
- Set `text` to null if using article extractor at processing time, OR prefetch text and set `text` field
- Speaker is the president, but press conferences contain quotes from reporters and officials too

**testConnection:** Fetch `https://www.presidency.ucsb.edu/advanced-search?items_per_page=1` -- check for valid HTML response.

## Error Handling (All Providers)

Every provider MUST:
1. Wrap all HTTP calls in try/catch
2. Return empty array on failure (never throw from `fetchArticles`)
3. Log errors via `logger.error('historical', 'provider_fetch_error', { provider: this.key, error: err.message })`
4. The orchestrator (`historicalFetcher.js`) updates `historical_sources.consecutive_failures` and `last_error`
5. Auto-set `status='failed'` after 5 consecutive failures
6. Reset `consecutive_failures` to 0 on success

## Test Expectations (Per Provider)

For each provider, mock HTTP responses using `vi.fn()` / `vi.spyOn(global, 'fetch')`:
- `fetchArticles()` returns array of objects with `{ url, title, text, published, sourceLabel }`
- `testConnection()` returns `{ success: boolean, message: string }`
- Error handling: mock a 500 response, confirm empty array returned (no throw)
- URL dedup: pre-insert a URL in articles table, confirm provider skips it
