import { Router } from 'express';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { analyzeQuoteContext, getSmartRelatedQuotes } from '../services/quoteContext.js';
import logger from '../services/logger.js';

const router = Router();

// Tighter rate limit for context analysis (AI-intensive)
const contextRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });

/**
 * POST /api/quotes/:id/context
 * Trigger AI analysis of a quote's claims. Cached for 7 days.
 * ?force=true bypasses cache.
 */
router.post('/:id/context', contextRateLimit, async (req, res) => {
  try {
    const quoteId = parseInt(req.params.id, 10);
    if (isNaN(quoteId)) return res.status(400).json({ error: 'Invalid quote ID' });

    const force = req.query.force === 'true';
    const result = await analyzeQuoteContext(quoteId, { force });
    res.json(result);
  } catch (err) {
    logger.error('api', 'context_analysis_error', { quoteId: req.params.id, error: err.message });
    if (err.message === 'Quote not found') {
      return res.status(404).json({ error: 'Quote not found' });
    }
    res.status(500).json({ error: 'Analysis unavailable. ' + err.message });
  }
});

/**
 * GET /api/quotes/:id/smart-related
 * Get smart related quotes (contradictions, context, mentions).
 * Auto-generates on first request, then cached for 7 days.
 */
router.get('/:id/smart-related', async (req, res) => {
  try {
    const quoteId = parseInt(req.params.id, 10);
    if (isNaN(quoteId)) return res.status(400).json({ error: 'Invalid quote ID' });

    const result = await getSmartRelatedQuotes(quoteId);
    res.json(result);
  } catch (err) {
    logger.error('api', 'smart_related_error', { quoteId: req.params.id, error: err.message });
    if (err.message === 'Quote not found') {
      return res.status(404).json({ error: 'Quote not found' });
    }
    res.status(500).json({ error: 'Related quotes unavailable. ' + err.message });
  }
});

export default router;
