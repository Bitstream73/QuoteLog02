/**
 * factCheck.js — Express route handler for the fact-check API.
 *
 * Endpoints:
 *   POST /api/fact-check/check      — Full fact-check + reference pipeline
 *   POST /api/fact-check/classify   — Classification only (no evidence search)
 *   POST /api/fact-check/references — Reference extraction only
 *   GET  /api/fact-check/status     — Health check
 */

import express from 'express';
import { factCheckQuote, classifyAndVerify, extractAndEnrichReferences } from '../services/factCheck.js';
import config from '../config/index.js';
import logger from '../services/logger.js';

const router = express.Router();

// In-memory cache (24h TTL)
const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// POST /check — Full fact-check pipeline
// ---------------------------------------------------------------------------

router.post('/check', async (req, res) => {
  try {
    const {
      quoteId,
      quoteText,
      authorName,
      authorDescription,
      context,
      sourceName,
      sourceDate,
      tags,
      skipFactCheck,
      skipReferences,
    } = req.body;

    if (!quoteText) {
      return res.status(400).json({ error: 'quoteText is required' });
    }

    // Check cache
    const cacheKey = `check:${quoteId || quoteText.substring(0, 100)}`;
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return res.json({ ...cached.data, fromCache: true });
    }

    const result = await factCheckQuote(
      {
        quoteText,
        authorName: authorName || 'Unknown',
        authorDescription: authorDescription || '',
        context: context || '',
        sourceName: sourceName || 'Unknown',
        sourceDate: sourceDate || new Date().toISOString().split('T')[0],
        tags: tags || [],
      },
      {
        skipFactCheck: skipFactCheck || false,
        skipReferences: skipReferences || false,
      }
    );

    cache.set(cacheKey, { data: result, timestamp: Date.now() });

    // Prune old cache entries periodically
    if (cache.size > 1000) {
      const now = Date.now();
      for (const [key, val] of cache) {
        if (now - val.timestamp > CACHE_TTL_MS) cache.delete(key);
      }
    }

    return res.json(result);

  } catch (err) {
    logger.error('factcheck', 'check_failed', {}, err);
    return res.status(500).json({
      error: 'Fact-check pipeline failed',
      message: err.message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /references — Reference extraction only
// ---------------------------------------------------------------------------

router.post('/references', async (req, res) => {
  try {
    const { quoteId, quoteText, authorName, authorDescription, context, sourceName, sourceDate, tags } = req.body;

    if (!quoteText) {
      return res.status(400).json({ error: 'quoteText is required' });
    }

    const cacheKey = `refs:${quoteId || quoteText.substring(0, 100)}`;
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return res.json({ ...cached.data, fromCache: true });
    }

    const result = await factCheckQuote(
      {
        quoteText,
        authorName: authorName || 'Unknown',
        authorDescription: authorDescription || '',
        context: context || '',
        sourceName: sourceName || 'Unknown',
        sourceDate: sourceDate || new Date().toISOString().split('T')[0],
        tags: tags || [],
      },
      { skipFactCheck: true, skipReferences: false }
    );

    const refResult = {
      references: result.references,
      referencesHtml: result.referencesHtml,
      processingTimeMs: result.processingTimeMs,
    };

    cache.set(cacheKey, { data: refResult, timestamp: Date.now() });

    return res.json(refResult);

  } catch (err) {
    logger.error('factcheck', 'references_failed', {}, err);
    return res.status(500).json({
      error: 'Reference extraction failed',
      message: err.message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /classify — Classification only (fast, no search)
// ---------------------------------------------------------------------------

router.post('/classify', async (req, res) => {
  try {
    const { quoteText, authorName, authorDescription, context, sourceName, sourceDate, tags } = req.body;

    if (!quoteText) {
      return res.status(400).json({ error: 'quoteText is required' });
    }

    const classification = await classifyAndVerify({
      quoteText,
      authorName: authorName || 'Unknown',
      authorDescription: authorDescription || '',
      context: context || '',
      sourceName: sourceName || 'Unknown',
      sourceDate: sourceDate || new Date().toISOString().split('T')[0],
      tags: tags || [],
    });

    return res.json(classification);

  } catch (err) {
    logger.error('factcheck', 'classify_failed', {}, err);
    return res.status(500).json({
      error: 'Classification failed',
      message: err.message,
    });
  }
});

// ---------------------------------------------------------------------------
// GET /status — Health check
// ---------------------------------------------------------------------------

router.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    cacheSize: cache.size,
    geminiConfigured: !!config.geminiApiKey,
  });
});

export default router;
