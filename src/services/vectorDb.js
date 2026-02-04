import { Pinecone } from '@pinecone-database/pinecone';
import { GoogleGenerativeAI } from '@google/generative-ai';
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
 * Generate embeddings using Gemini text-embedding-004
 */
async function generateEmbedding(text) {
  if (!config.geminiApiKey) {
    throw new Error('Gemini API key not configured');
  }

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

  const result = await model.embedContent(text);
  return result.embedding.values;
}

/**
 * Embed and store a quote in Pinecone
 */
export async function embedQuote(quoteId, text, personId) {
  const idx = getIndex();
  if (!idx) {
    logger.debug('vectordb', 'skip_embed', { reason: 'not_configured' });
    return;
  }

  try {
    const embedding = await generateEmbedding(text);
    const ns = idx.namespace('quotes');

    await ns.upsert([{
      id: `quote_${quoteId}`,
      values: embedding,
      metadata: {
        quote_id: quoteId,
        person_id: personId,
        text: text.substring(0, 1000), // Truncate for metadata storage
      },
    }]);

    logger.debug('vectordb', 'quote_embedded', { quoteId, personId });
  } catch (err) {
    logger.error('vectordb', 'embed_failed', { quoteId, error: err.message });
    throw err;
  }
}

/**
 * Query for similar quotes from the same person
 */
export async function queryQuotes(text, personId, topK = 10) {
  const idx = getIndex();
  if (!idx) {
    return [];
  }

  try {
    const embedding = await generateEmbedding(text);
    const ns = idx.namespace('quotes');

    const result = await ns.query({
      vector: embedding,
      topK,
      includeMetadata: true,
      filter: { person_id: personId },
    });

    return result.matches || [];
  } catch (err) {
    logger.error('vectordb', 'query_failed', { error: err.message });
    return [];
  }
}

const vectorDb = {
  async upsertEmbeddings(vectors, namespace = 'default') {
    const start = Date.now();
    const idx = getIndex();
    if (!idx) throw new Error('Pinecone not configured');

    const ns = idx.namespace(namespace);
    const result = await ns.upsert(vectors);
    const duration = Date.now() - start;
    logger.info('vectordb', 'upsert', { count: vectors.length, namespace, duration });
    return result;
  },

  async queryByVector(vector, topK = 5, filter = undefined, namespace = 'default') {
    const start = Date.now();
    const idx = getIndex();
    if (!idx) throw new Error('Pinecone not configured');

    const ns = idx.namespace(namespace);
    const result = await ns.query({ vector, topK, includeMetadata: true, filter });
    const duration = Date.now() - start;
    logger.info('vectordb', 'query', { topK, namespace, matchCount: result.matches?.length, duration });
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

  async getIndexStats() {
    const idx = getIndex();
    if (!idx) throw new Error('Pinecone not configured');
    return await idx.describeIndexStats();
  },

  // Export new functions
  embedQuote,
  queryQuotes,
  generateEmbedding,
};

export default vectorDb;
