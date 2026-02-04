import gemini from './ai/gemini.js';
import logger from './logger.js';

const quoteExtractor = {
  async extractFromArticle(articleText, sourceName, sourceUrl) {
    const start = Date.now();

    try {
      const quotes = await gemini.extractQuotes(articleText);
      const duration = Date.now() - start;

      logger.info('system', 'quote_extraction_complete', {
        sourceName,
        quotesFound: quotes.length,
        duration,
      });

      return quotes.map(q => ({
        text: q.quote,
        author: q.author,
        sourceName,
        sourceUrl,
      }));
    } catch (error) {
      logger.error('system', 'quote_extraction_failed', { sourceName }, error);
      return [];
    }
  },
};

export default quoteExtractor;
