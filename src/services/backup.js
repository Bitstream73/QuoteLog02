import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import { getDb } from '../config/database.js';
import logger from './logger.js';

function getBackupDir() {
  return path.join(path.dirname(config.databasePath), 'backups');
}

/**
 * Ensure backup directory exists
 */
function ensureBackupDir() {
  const dir = getBackupDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Create a WAL-safe SQLite backup using better-sqlite3's .backup() API
 * @returns {Promise<{ path: string, size: number }>} Backup file info
 */
export async function createBackup() {
  ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(getBackupDir(), `backup-${timestamp}.sqlite`);

  const db = getDb();
  await db.backup(backupPath);

  const stats = fs.statSync(backupPath);
  logger.info('backup', 'created', { path: backupPath, sizeBytes: stats.size });
  return { path: backupPath, size: stats.size };
}

/**
 * List available backups sorted by date (newest first)
 * @returns {Array<{ filename: string, path: string, size: number, created: string }>}
 */
export function listBackups() {
  ensureBackupDir();
  const dir = getBackupDir();
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('backup-') && f.endsWith('.sqlite'))
    .map(f => {
      const fullPath = path.join(dir, f);
      const stats = fs.statSync(fullPath);
      return {
        filename: f,
        path: fullPath,
        size: stats.size,
        created: stats.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.created.localeCompare(a.created));

  return files;
}

/**
 * Prune old backups, keeping only the most recent N
 * @param {number} keepCount - Number of backups to keep (default 5)
 * @returns {number} Number of backups deleted
 */
export function pruneOldBackups(keepCount = 5) {
  const backups = listBackups();
  const toDelete = backups.slice(keepCount);

  for (const backup of toDelete) {
    fs.unlinkSync(backup.path);
    logger.debug('backup', 'pruned', { filename: backup.filename });
  }

  if (toDelete.length > 0) {
    logger.info('backup', 'prune_complete', { deleted: toDelete.length, kept: keepCount });
  }

  return toDelete.length;
}

/**
 * Export entire database as JSON (sources, persons, quotes, settings)
 * @returns {object} JSON-serializable database export
 */
export function exportDatabaseJson() {
  const db = getDb();

  const sources = db.prepare('SELECT * FROM sources').all();
  const persons = db.prepare('SELECT * FROM persons').all();
  const personAliases = db.prepare('SELECT * FROM person_aliases').all();
  const personPhonetics = db.prepare('SELECT * FROM person_phonetics').all();
  const quotes = db.prepare('SELECT * FROM quotes').all();
  const articles = db.prepare('SELECT * FROM articles').all();
  const quoteArticles = db.prepare('SELECT * FROM quote_articles').all();
  const quoteRelationships = db.prepare('SELECT * FROM quote_relationships').all();
  const personMerges = db.prepare('SELECT * FROM person_merges').all();
  const settings = db.prepare('SELECT * FROM settings').all();

  return {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    tables: {
      sources,
      persons,
      person_aliases: personAliases,
      person_phonetics: personPhonetics,
      quotes,
      articles,
      quote_articles: quoteArticles,
      quote_relationships: quoteRelationships,
      person_merges: personMerges,
      settings,
    },
  };
}

/**
 * Import database from JSON export. Clears existing data and replaces with import.
 * @param {object} data - JSON export from exportDatabaseJson()
 * @returns {{ imported: object }} Counts of imported rows per table
 */
export function importDatabaseJson(data) {
  if (!data || !data.tables) {
    throw new Error('Invalid import data: missing tables property');
  }

  const db = getDb();
  const counts = {};

  // Disable foreign keys during import to avoid constraint issues
  db.pragma('foreign_keys = OFF');

  // Use a transaction for atomicity
  const importTransaction = db.transaction(() => {
    // Delete in reverse dependency order
    db.exec('DELETE FROM quote_articles');
    db.exec('DELETE FROM quote_relationships');
    db.exec('DELETE FROM person_merges');
    db.exec('DELETE FROM quotes');
    db.exec('DELETE FROM person_phonetics');
    db.exec('DELETE FROM person_aliases');
    db.exec('DELETE FROM persons');
    db.exec('DELETE FROM articles');
    db.exec('DELETE FROM sources');

    // Import settings (upsert)
    if (data.tables.settings) {
      const upsertSetting = db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      );
      for (const row of data.tables.settings) {
        upsertSetting.run(row.key, row.value, row.updated_at);
      }
      counts.settings = data.tables.settings.length;
    }

    // Import sources
    if (data.tables.sources) {
      const insertSource = db.prepare(
        `INSERT INTO sources (id, domain, name, rss_url, enabled, consecutive_failures, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of data.tables.sources) {
        insertSource.run(row.id, row.domain, row.name, row.rss_url, row.enabled, row.consecutive_failures, row.created_at, row.updated_at);
      }
      counts.sources = data.tables.sources.length;
    }

    // Import articles
    if (data.tables.articles) {
      const insertArticle = db.prepare(
        `INSERT INTO articles (id, url, source_id, title, published_at, processed_at, quote_count, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of data.tables.articles) {
        insertArticle.run(row.id, row.url, row.source_id, row.title, row.published_at, row.processed_at, row.quote_count, row.status, row.error, row.created_at);
      }
      counts.articles = data.tables.articles.length;
    }

    // Import persons
    if (data.tables.persons) {
      const insertPerson = db.prepare(
        `INSERT INTO persons (id, canonical_name, disambiguation, wikidata_id, first_seen_at, last_seen_at, quote_count, metadata, photo_url, category, category_context)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of data.tables.persons) {
        insertPerson.run(row.id, row.canonical_name, row.disambiguation, row.wikidata_id, row.first_seen_at, row.last_seen_at, row.quote_count, row.metadata, row.photo_url ?? null, row.category ?? 'Other', row.category_context ?? null);
      }
      counts.persons = data.tables.persons.length;
    }

    // Import person_aliases
    if (data.tables.person_aliases) {
      const insertAlias = db.prepare(
        `INSERT INTO person_aliases (id, person_id, alias, alias_normalized, alias_type, confidence, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of data.tables.person_aliases) {
        insertAlias.run(row.id, row.person_id, row.alias, row.alias_normalized, row.alias_type, row.confidence, row.source, row.created_at);
      }
      counts.person_aliases = data.tables.person_aliases.length;
    }

    // Import person_phonetics
    if (data.tables.person_phonetics) {
      const insertPhonetic = db.prepare(
        `INSERT INTO person_phonetics (id, person_id, name_part, metaphone_code, part_type)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const row of data.tables.person_phonetics) {
        insertPhonetic.run(row.id, row.person_id, row.name_part, row.metaphone_code, row.part_type);
      }
      counts.person_phonetics = data.tables.person_phonetics.length;
    }

    // Import quotes
    if (data.tables.quotes) {
      const insertQuote = db.prepare(
        `INSERT INTO quotes (id, person_id, text, quote_type, context, canonical_quote_id, source_urls, first_seen_at, created_at, is_visible, rss_metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of data.tables.quotes) {
        insertQuote.run(row.id, row.person_id, row.text, row.quote_type, row.context, row.canonical_quote_id, row.source_urls, row.first_seen_at, row.created_at, row.is_visible ?? 1, row.rss_metadata ?? null);
      }
      counts.quotes = data.tables.quotes.length;
    }

    // Import quote_articles
    if (data.tables.quote_articles) {
      const insertQA = db.prepare(
        `INSERT INTO quote_articles (quote_id, article_id) VALUES (?, ?)`
      );
      for (const row of data.tables.quote_articles) {
        insertQA.run(row.quote_id, row.article_id);
      }
      counts.quote_articles = data.tables.quote_articles.length;
    }

    // Import quote_relationships
    if (data.tables.quote_relationships) {
      const insertQR = db.prepare(
        `INSERT INTO quote_relationships (id, quote_id_a, quote_id_b, relationship, confidence, canonical_quote_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of data.tables.quote_relationships) {
        insertQR.run(row.id, row.quote_id_a, row.quote_id_b, row.relationship, row.confidence, row.canonical_quote_id, row.created_at);
      }
      counts.quote_relationships = data.tables.quote_relationships.length;
    }

    // Import person_merges
    if (data.tables.person_merges) {
      const insertMerge = db.prepare(
        `INSERT INTO person_merges (id, surviving_person_id, merged_person_id, merged_at, merged_by, confidence, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of data.tables.person_merges) {
        insertMerge.run(row.id, row.surviving_person_id, row.merged_person_id, row.merged_at, row.merged_by, row.confidence, row.reason);
      }
      counts.person_merges = data.tables.person_merges.length;
    }
  });

  try {
    importTransaction();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  logger.info('backup', 'import_complete', { counts });
  return { imported: counts };
}

export default { createBackup, listBackups, pruneOldBackups, exportDatabaseJson, importDatabaseJson };
