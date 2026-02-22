import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import logger from '../services/logger.js';

function isAuthenticatedAdmin(req) {
  const token = req.cookies?.auth_token;
  if (!token) return false;
  try {
    jwt.verify(token, config.jwtSecret);
    return true;
  } catch {
    return false;
  }
}

export function createRateLimiter(options = {}) {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 200,
    skip: (req) => {
      // Skip excluded paths (they have their own rate limiters)
      if (options.skipPaths?.some(p => req.path.startsWith(p))) return true;
      // Skip authenticated admins entirely
      return isAuthenticatedAdmin(req);
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
    skip: (req) => isAuthenticatedAdmin(req),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn('api', 'login_rate_limit_exceeded', { ip: req.ip });
      res.status(429).json({ error: 'Too many login attempts, please try again later.' });
    },
  });
}
