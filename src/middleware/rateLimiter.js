import rateLimit from 'express-rate-limit';
import logger from '../services/logger.js';

export function createRateLimiter(options = {}) {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn('api', 'rate_limit_exceeded', { ip: req.ip, path: req.path });
      res.status(429).json({ error: 'Too many requests, please try again later.' });
    },
  });
}
