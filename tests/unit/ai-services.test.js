import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
vi.mock('../../src/config/index.js', () => ({
  default: {
    env: 'test',
    port: 3000,
    databasePath: ':memory:',
    geminiApiKey: 'test-key',
    pineconeApiKey: '',
    pineconeIndexHost: '',
  }
}));

// Mock logger
vi.mock('../../src/services/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn()
    }),
  }
}));

// Mock Gemini SDK
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: 'Gemini response' }),
      embedContent: vi.fn().mockResolvedValue({ embeddings: [{ values: new Array(768).fill(0.1) }] }),
    },
    chats: {
      create: vi.fn().mockReturnValue({
        sendMessage: vi.fn().mockResolvedValue({ text: 'Chat response' })
      })
    }
  }))
}));

describe('AI Services', () => {
  describe('Gemini Service', () => {
    let gemini;

    beforeEach(async () => {
      vi.resetModules();

      vi.doMock('../../src/config/index.js', () => ({
        default: {
          env: 'test',
          port: 3000,
          databasePath: ':memory:',
          geminiApiKey: 'test-key',
          pineconeApiKey: '',
          pineconeIndexHost: '',
        }
      }));

      vi.doMock('../../src/services/logger.js', () => ({
        default: {
          info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
          child: vi.fn().mockReturnValue({
            info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn()
          }),
        }
      }));

      vi.doMock('@google/genai', () => ({
        GoogleGenAI: vi.fn().mockImplementation(() => ({
          models: {
            generateContent: vi.fn().mockResolvedValue({ text: 'Gemini response' }),
            embedContent: vi.fn().mockResolvedValue({ embeddings: [{ values: new Array(768).fill(0.1) }] }),
          },
          chats: {
            create: vi.fn().mockReturnValue({
              sendMessage: vi.fn().mockResolvedValue({ text: 'Chat response' })
            })
          }
        }))
      }));

      const module = await import('../../src/services/ai/gemini.js');
      gemini = module.default;
    });

    it('should generate text content', async () => {
      const result = await gemini.generateText('Test prompt');
      expect(result).toBe('Gemini response');
    });

    it('should generate embeddings', async () => {
      const result = await gemini.generateEmbedding('Test text');
      expect(result).toHaveLength(768);
      expect(result[0]).toBe(0.1);
    });

    it('should extract quotes from article text', async () => {
      const result = await gemini.extractQuotes('Article text with quotes...');
      expect(Array.isArray(result)).toBe(true);
    });

    it('should log API calls with timing', async () => {
      const loggerModule = await import('../../src/services/logger.js');
      const infoSpy = loggerModule.default.info;

      await gemini.generateText('Test prompt');

      expect(infoSpy).toHaveBeenCalledWith(
        'ai',
        expect.stringContaining('gemini'),
        expect.objectContaining({
          model: expect.any(String),
          duration: expect.any(Number)
        })
      );
    });
  });
});
