import gemini from '../services/ai/gemini.js';

export async function generateEmbedding(text) {
  return gemini.generateEmbedding(text);
}
