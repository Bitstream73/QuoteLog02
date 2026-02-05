import jwt from 'jsonwebtoken';
import config from '../../src/config/index.js';

/**
 * Generate a valid auth cookie for test requests
 * @returns {string} Cookie string in format "auth_token=<jwt>"
 */
export function getAuthCookie() {
  const token = jwt.sign(
    { id: 1, email: 'jakob@karlsmark.com' },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
  return `auth_token=${token}`;
}
