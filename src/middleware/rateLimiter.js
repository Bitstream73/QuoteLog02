import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import logger from '../services/logger.js';

export function createRateLimiter(options = {}) {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: (req) => {
      const token = req.cookies?.auth_token;
      if (!token) return options.max || 200;
      try {
        jwt.verify(token, config.jwtSecret);
        return options.authenticatedMax || 1000;
      } catch {
        return options.max || 200;
      }
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn('api', 'rate_limit_exceeded', { ip: req.ip, path: req.path });
      res.status(429).json({ error: 'Too many requests, please try again later.' });
    },
  });
}

export function createLoginRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    // No skip — login rate limiter applies to everyone
    handler: (req, res) => {
      logger.warn('api', 'login_rate_limit_exceeded', { ip: req.ip });
      res.status(429).json({ error: 'Too many login attempts, please try again later.' });
    },
  });
}
