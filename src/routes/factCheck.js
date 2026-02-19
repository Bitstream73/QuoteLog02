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
import { generateShareImage } from '../services/shareImage.js';
import { getDb } from '../config/database.js';
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

    // Check in-memory cache
    const cacheKey = `check:${quoteId || quoteText.substring(0, 100)}`;
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return res.json({ ...cached.data, fromCache: true });
    }

    // Check DB cache (survives server restarts)
    if (quoteId) {
      try {
        const db = getDb();
        const row = db.prepare(
          `SELECT fact_check_html, fact_check_references_json, fact_check_verdict, fact_check_agree_count, fact_check_disagree_count FROM quotes WHERE id = ?`
        ).get(quoteId);

        if (row && row.fact_check_html) {
          const dbCached = {
            combinedHtml: row.fact_check_html,
            html: row.fact_check_html,
            references: row.fact_check_references_json ? JSON.parse(row.fact_check_references_json) : null,
            verdict: row.fact_check_verdict || null,
            agree_count: row.fact_check_agree_count || 0,
            disagree_count: row.fact_check_disagree_count || 0,
            fromCache: true,
          };
          cache.set(cacheKey, { data: dbCached, timestamp: Date.now() });
          return res.json(dbCached);
        }
      } catch (err) {
        logger.warn('factcheck', 'db_cache_lookup_failed', { quoteId, error: err.message });
      }
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
        quoteId: quoteId || null,
      }
    );

    cache.set(cacheKey, { data: result, timestamp: Date.now() });

    // Pre-generate share images (fire-and-forget) so they're cached for later
    if (quoteId) {
      try {
        const db = getDb();
        const row = db.prepare(
          `SELECT q.id, q.text, q.context, q.fact_check_verdict, q.fact_check_claim, q.fact_check_explanation,
                  p.canonical_name, p.disambiguation, p.photo_url, p.category AS person_category
           FROM quotes q
           LEFT JOIN persons p ON q.person_id = p.id
           WHERE q.id = ?`
        ).get(quoteId);

        if (row) {
          const imgData = {
            quoteId: row.id,
            quoteText: row.text,
            authorName: row.canonical_name || 'Unknown',
            disambiguation: row.disambiguation || '',
            verdict: row.fact_check_verdict || null,
            category: row.person_category || null,
            photoUrl: row.photo_url || null,
            claim: row.fact_check_claim || '',
            explanation: row.fact_check_explanation || '',
          };
          Promise.all([
            generateShareImage(imgData, 'landscape'),
            generateShareImage(imgData, 'portrait'),
          ]).catch(err => logger.warn('factcheck', 'share_image_prewarm_failed', { quoteId, error: err.message }));
        }
      } catch (err) {
        logger.warn('factcheck', 'share_image_prewarm_query_failed', { quoteId, error: err.message });
      }
    }

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

// ---------------------------------------------------------------------------
// GET /:quoteId/feedback — Get current agree/disagree counts
// ---------------------------------------------------------------------------

router.get('/:quoteId/feedback', (req, res) => {
  try {
    const quoteId = parseInt(req.params.quoteId, 10);
    if (!quoteId || isNaN(quoteId)) {
      return res.status(400).json({ error: 'Invalid quoteId' });
    }

    const db = getDb();
    const row = db.prepare(
      `SELECT fact_check_agree_count, fact_check_disagree_count FROM quotes WHERE id = ?`
    ).get(quoteId);

    if (!row) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    return res.json({
      agree_count: row.fact_check_agree_count || 0,
      disagree_count: row.fact_check_disagree_count || 0,
    });
  } catch (err) {
    logger.error('factcheck', 'get_feedback_failed', { quoteId: req.params.quoteId }, err);
    return res.status(500).json({ error: 'Failed to get feedback counts' });
  }
});

// ---------------------------------------------------------------------------
// POST /:quoteId/feedback — Submit agree/disagree feedback
// ---------------------------------------------------------------------------

router.post('/:quoteId/feedback', (req, res) => {
  try {
    const quoteId = parseInt(req.params.quoteId, 10);
    if (!quoteId || isNaN(quoteId)) {
      return res.status(400).json({ error: 'Invalid quoteId' });
    }

    const { value } = req.body;
    if (!['agree', 'disagree'].includes(value)) {
      return res.status(400).json({ error: 'value must be "agree" or "disagree"' });
    }

    const db = getDb();

    // Verify quote exists
    const exists = db.prepare(`SELECT id FROM quotes WHERE id = ?`).get(quoteId);
    if (!exists) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Increment the appropriate counter
    const column = value === 'agree' ? 'fact_check_agree_count' : 'fact_check_disagree_count';
    db.prepare(`UPDATE quotes SET ${column} = ${column} + 1 WHERE id = ?`).run(quoteId);

    // Return updated counts
    const row = db.prepare(
      `SELECT fact_check_agree_count, fact_check_disagree_count FROM quotes WHERE id = ?`
    ).get(quoteId);

    return res.json({
      agree_count: row.fact_check_agree_count || 0,
      disagree_count: row.fact_check_disagree_count || 0,
    });
  } catch (err) {
    logger.error('factcheck', 'post_feedback_failed', { quoteId: req.params.quoteId }, err);
    return res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

export default router;
