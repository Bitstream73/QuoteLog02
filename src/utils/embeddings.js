import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/index.js';
import logger from '../services/logger.js';

let genAI = null;

function getClient() {
  if (!genAI && config.geminiApiKey) {
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return genAI;
}

export async function generateEmbedding(text) {
  const start = Date.now();
  const client = getClient();
  if (!client) throw new Error('Gemini API key not configured');

  const model = client.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  const duration = Date.now() - start;

  logger.info('ai', 'embedding_generated', { model: 'text-embedding-004', textLength: text.length, duration });

  return result.embedding.values;
}
