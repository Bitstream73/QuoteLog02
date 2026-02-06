import { getDb } from '../config/database.js';
import logger from './logger.js';

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

/**
 * Fetch a headshot URL from Wikipedia for a person name.
 * Uses the Wikipedia pageimages API to get a thumbnail.
 * @param {string} personName - Full name of the person
 * @returns {Promise<string|null>} URL of the headshot or null
 */
export async function fetchHeadshotUrl(personName) {
  try {
    const params = new URLSearchParams({
      action: 'query',
      titles: personName,
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
    logger.debug('personPhoto', 'fetch_failed', { name: personName, error: err.message });
    return null;
  }
}

/**
 * Fetch and store headshot for a person if they don't already have one.
 * @param {number} personId - Person ID in database
 * @param {string} personName - Full name for Wikipedia lookup
 * @returns {Promise<string|null>} The photo URL or null
 */
export async function fetchAndStoreHeadshot(personId, personName) {
  const db = getDb();

  // Skip if already has a photo
  const person = db.prepare('SELECT photo_url FROM persons WHERE id = ?').get(personId);
  if (person?.photo_url) return person.photo_url;

  const url = await fetchHeadshotUrl(personName);
  if (!url) return null;

  db.prepare('UPDATE persons SET photo_url = ? WHERE id = ?').run(url, personId);
  logger.debug('personPhoto', 'stored', { personId, name: personName });

  return url;
}

/**
 * Backfill headshots for persons that don't have one yet.
 * @param {number} limit - Max number of persons to process
 * @returns {Promise<{ processed: number, found: number }>}
 */
export async function backfillHeadshots(limit = 50) {
  const db = getDb();
  const persons = db.prepare(
    'SELECT id, canonical_name FROM persons WHERE photo_url IS NULL ORDER BY quote_count DESC LIMIT ?'
  ).all(limit);

  let found = 0;
  for (const person of persons) {
    const url = await fetchAndStoreHeadshot(person.id, person.canonical_name);
    if (url) found++;

    // Rate limit: 1 second between requests
    await new Promise(r => setTimeout(r, 1000));
  }

  logger.info('personPhoto', 'backfill_complete', { processed: persons.length, found });
  return { processed: persons.length, found };
}

export default { fetchHeadshotUrl, fetchAndStoreHeadshot, backfillHeadshots };
