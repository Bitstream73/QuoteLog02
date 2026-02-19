import { getDb } from '../config/database.js';
import logger from './logger.js';

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

/**
 * Fetch an image URL from Wikipedia for an organization name.
 * Uses the Wikipedia pageimages API to get a thumbnail.
 * @param {string} orgName - Name of the organization
 * @returns {Promise<string|null>} URL of the image or null
 */
export async function fetchOrganizationImageUrl(orgName) {
  try {
    const params = new URLSearchParams({
      action: 'query',
      titles: orgName,
      prop: 'pageimages',
      pithumbsize: '200',
      format: 'json',
      redirects: '1',
    });

    const res = await fetch(`${WIKIPEDIA_API}?${params}`);
    if (!res.ok) return null;

    const data = await res.json();
    const pages = data.query?.pages;
    if (!pages) return null;

    for (const page of Object.values(pages)) {
      if (page.thumbnail?.source) {
        return page.thumbnail.source;
      }
    }

    return null;
  } catch (err) {
    logger.debug('sourceAuthorPhoto', 'fetch_failed', { name: orgName, error: err.message });
    return null;
  }
}

/**
 * Fetch and store image for a source author if they don't already have one.
 * @param {number} sourceAuthorId - Source author ID in database
 * @param {string} orgName - Organization name for Wikipedia lookup
 * @returns {Promise<string|null>} The image URL or null
 */
export async function fetchAndStoreSourceAuthorImage(sourceAuthorId, orgName) {
  const db = getDb();

  const sa = db.prepare('SELECT image_url FROM source_authors WHERE id = ?').get(sourceAuthorId);
  if (sa?.image_url) return sa.image_url;

  const url = await fetchOrganizationImageUrl(orgName);
  if (!url) return null;

  db.prepare("UPDATE source_authors SET image_url = ?, updated_at = datetime('now') WHERE id = ?").run(url, sourceAuthorId);
  logger.debug('sourceAuthorPhoto', 'stored', { sourceAuthorId, name: orgName });

  return url;
}

/**
 * Backfill images for source authors that don't have one yet.
 * @param {number} limit - Max number of source authors to process
 * @returns {Promise<{ processed: number, found: number }>}
 */
export async function backfillSourceAuthorImages(limit = 50) {
  const db = getDb();
  const authors = db.prepare(
    'SELECT id, name FROM source_authors WHERE image_url IS NULL ORDER BY id ASC LIMIT ?'
  ).all(limit);

  let found = 0;
  for (const sa of authors) {
    const url = await fetchAndStoreSourceAuthorImage(sa.id, sa.name);
    if (url) found++;

    // Rate limit: 1 second between requests
    await new Promise(r => setTimeout(r, 1000));
  }

  logger.info('sourceAuthorPhoto', 'backfill_complete', { processed: authors.length, found });
  return { processed: authors.length, found };
}

export default { fetchOrganizationImageUrl, fetchAndStoreSourceAuthorImage, backfillSourceAuthorImages };
