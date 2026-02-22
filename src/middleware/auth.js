import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { getDb } from '../config/database.js';

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

    // Session invalidation: reject tokens issued before the last password change
    const db = getDb();
    const user = db.prepare('SELECT password_changed_at FROM admin_users WHERE id = ?').get(decoded.id);
    if (user && user.password_changed_at) {
      const changedAt = Math.floor(new Date(user.password_changed_at + 'Z').getTime() / 1000);
      if (decoded.iat && decoded.iat < changedAt) {
        return res.status(401).json({ error: 'Session expired due to password change' });
      }
    }

    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
