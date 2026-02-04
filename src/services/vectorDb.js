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
    for (const id of ids) { await ns.deleteOne(id); }
    logger.info('vectordb', 'delete', { count: ids.length, namespace });
  },
  async getIndexStats() {
    const idx = getIndex();
    if (!idx) throw new Error('Pinecone not configured');
    return await idx.describeIndexStats();
  },
};

export default vectorDb;
