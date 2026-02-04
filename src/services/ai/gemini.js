import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../../config/index.js';
import logger from '../logger.js';

let genAI = null;
const TEXT_MODEL = 'gemini-2.5-flash';
const EMBEDDING_MODEL = 'text-embedding-004';

function getClient() {
  if (!genAI && config.geminiApiKey) {
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return genAI;
}

const gemini = {
  async generateText(prompt, options = {}) {
    const start = Date.now();
    const client = getClient();
    if (!client) throw new Error('Gemini API key not configured');
    const model = client.getGenerativeModel({ model: options.model || TEXT_MODEL });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const duration = Date.now() - start;
    logger.info('ai', 'gemini_text', { model: options.model || TEXT_MODEL, promptLength: prompt.length, responseLength: text.length, duration });
    return text;
  },
  async generateEmbedding(text) {
    const start = Date.now();
    const client = getClient();
    if (!client) throw new Error('Gemini API key not configured');
    const model = client.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    const duration = Date.now() - start;
    logger.info('ai', 'gemini_embedding', { model: EMBEDDING_MODEL, textLength: text.length, duration });
    return result.embedding.values;
  },
  async extractQuotes(articleText) {
    const start = Date.now();
    const prompt = `Extract all direct quotes from the following news article text. For each quote, identify the speaker/author.\n\nReturn a JSON array of objects with this exact structure:\n[{"quote": "the quoted text", "author": "Speaker Name"}]\n\nIf no quotes are found, return an empty array [].\nOnly return valid JSON, no other text.\n\nArticle text:\n${articleText}`;
    try {
      const responseText = await this.generateText(prompt);
      const jsonStr = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const quotes = JSON.parse(jsonStr);
      const duration = Date.now() - start;
      logger.info('ai', 'gemini_extract_quotes', { model: TEXT_MODEL, articleLength: articleText.length, quotesFound: quotes.length, duration });
      return quotes;
    } catch (error) {
      logger.error('ai', 'gemini_extract_quotes_failed', { articleLength: articleText.length }, error);
      return [];
    }
  },
  async chat(messages) {
    const start = Date.now();
    const client = getClient();
    if (!client) throw new Error('Gemini API key not configured');
    const model = client.getGenerativeModel({ model: TEXT_MODEL });
    const chat = model.startChat({ history: messages.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) });
    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    const text = result.response.text();
    const duration = Date.now() - start;
    logger.info('ai', 'gemini_chat', { model: TEXT_MODEL, messageCount: messages.length, responseLength: text.length, duration });
    return text;
  },
};

export default gemini;
