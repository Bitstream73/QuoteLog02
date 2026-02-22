import { Pinecone } from '@pinecone-database/pinecone';
import config from '../config/index.js';
import logger from './logger.js';

let client = null;
let index = null;

function getClient() {
  if (!client && config.pineconeApiKey) {
    client = new Pinecone({ apiKey: config.pineconeApiKey });
    logger.debug('vectordb', 'connection', { indexHost: config.pineconeIndexHost });
  }
  return client;
}

function getIndex() {
  if (!index) {
    const pc = getClient();
    if (!pc) return null;
    index = pc.index('quotelog', config.pineconeIndexHost);
  }
  return index;
}

/**
 * Embed and store a quote in Pinecone using integrated sparse embedding.
 * The "quotelog" index uses pinecone-sparse-english-v0 with fieldMap text->text,
 * so we pass raw text and Pinecone generates sparse vectors automatically.
 * Context and personName are concatenated into the text field for search relevance
 * and stored as separate metadata fields for retrieval.
 */
export async function embedQuote(quoteId, text, personId, context = '', personName = '') {
  const idx = getIndex();
  if (!idx) {
    logger.debug('vectordb', 'skip_embed', { reason: 'not_configured' });
    return;
  }

  try {
    const ns = idx.namespace(config.pineconeNamespace);

    // Concatenate text + context + personName for richer sparse embedding
    const parts = [text, context || '', personName || ''].filter(Boolean);
    const enrichedText = parts.join(' | ').substring(0, 1000);

    await ns.upsertRecords({
      records: [{
        _id: `quote_${quoteId}`,
        text: enrichedText,
        quote_id: quoteId,
        person_id: personId,
        context: (context || '').substring(0, 500),
        person_name: (personName || '').substring(0, 200),
      }],
    });

    logger.debug('vectordb', 'quote_embedded', { quoteId, personId });
  } catch (err) {
    logger.error('vectordb', 'embed_failed', { quoteId, error: err.message });
    throw err;
  }
}

/**
 * Query for similar quotes from the same person using integrated sparse search.
 * Returns results in the same format as the old query() method for backward compatibility.
 */
export async function queryQuotes(text, personId, topK = 10) {
  const idx = getIndex();
  if (!idx) {
    return [];
  }

  try {
    const ns = idx.namespace(config.pineconeNamespace);

    const response = await ns.searchRecords({
      query: {
        topK,
        inputs: { text },
        filter: { person_id: { $eq: personId } },
      },
      fields: ['text', 'quote_id', 'person_id', 'context', 'person_name'],
    });

    // Map searchRecords response to match the old query() format
    // so callers (quoteDeduplicator) don't need changes
    const hits = response?.result?.hits || [];
    return hits.map(hit => ({
      id: hit._id,
      score: hit._score,
      metadata: hit.fields || {},
    }));
  } catch (err) {
    logger.error('vectordb', 'query_failed', { error: err.message });
    return [];
  }
}

/**
 * Search quotes across all authors (no personId filter).
 * Used for user-facing semantic search via the search bar.
 */
export async function searchQuotes(queryText, topK = 20) {
  const idx = getIndex();
  if (!idx) {
    return [];
  }

  try {
    const ns = idx.namespace(config.pineconeNamespace);

    const response = await ns.searchRecords({
      query: {
        topK,
        inputs: { text: queryText },
      },
      fields: ['text', 'quote_id', 'person_id', 'context', 'person_name'],
    });

    const hits = response?.result?.hits || [];
    return hits.map(hit => ({
      id: hit._id,
      score: hit._score,
      metadata: hit.fields || {},
    }));
  } catch (err) {
    logger.error('vectordb', 'search_failed', { error: err.message });
    return [];
  }
}

const vectorDb = {
  async upsertRecords(records, namespace = 'default') {
    const start = Date.now();
    const idx = getIndex();
    if (!idx) throw new Error('Pinecone not configured');

    const ns = idx.namespace(namespace);
    await ns.upsertRecords({ records });
    const duration = Date.now() - start;
    logger.info('vectordb', 'upsert', { count: records.length, namespace, duration });
  },

  async searchRecords(text, topK = 5, filter = undefined, namespace = 'default') {
    const start = Date.now();
    const idx = getIndex();
    if (!idx) throw new Error('Pinecone not configured');

    const ns = idx.namespace(namespace);
    const result = await ns.searchRecords({
      query: { topK, inputs: { text }, filter },
    });
    const duration = Date.now() - start;
    const hits = result?.result?.hits || [];
    logger.info('vectordb', 'query', { topK, namespace, matchCount: hits.length, duration });
    return result;
  },

  async deleteByIds(ids, namespace = 'default') {
    const idx = getIndex();
    if (!idx) throw new Error('Pinecone not configured');

    const ns = idx.namespace(namespace);
    for (const id of ids) {
      await ns.deleteOne(id);
    }
    logger.info('vectordb', 'delete', { count: ids.length, namespace });
  },

  async deleteManyByIds(ids, namespace = 'default') {
    const idx = getIndex();
    if (!idx) throw new Error('Pinecone not configured');
    if (ids.length === 0) return;
    const ns = idx.namespace(namespace);
    const BATCH = 100;
    for (let i = 0; i < ids.length; i += BATCH) {
      await ns.deleteMany({ ids: ids.slice(i, i + BATCH) });
    }
    logger.info('vectordb', 'delete_many', { count: ids.length, namespace });
  },

  async getIndexStats() {
    const idx = getIndex();
    if (!idx) throw new Error('Pinecone not configured');
    return await idx.describeIndexStats();
  },

  embedQuote,
  queryQuotes,
  searchQuotes,
};

export default vectorDb;
