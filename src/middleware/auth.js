import jwt from 'jsonwebtoken';
import config from '../config/index.js';

/**
 * Middleware that requires admin authentication via JWT cookie
 */
export function requireAdmin(req, res, next) {
  const token = req.cookies?.auth_token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
