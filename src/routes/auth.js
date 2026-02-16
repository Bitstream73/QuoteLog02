import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import crypto from 'crypto';
import config from '../config/index.js';
import { getDb } from '../config/database.js';
import { sendPasswordResetEmail } from '../services/email.js';
import { createLoginRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

const loginLimiter = createLoginRateLimiter();

function validatePasswordStrength(password) {
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
  return null;
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);

  if (!user || !bcryptjs.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email },
    config.jwtSecret,
    { expiresIn: '7d' }
  );

  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  res.json({ success: true, email: user.email });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('auth_token', { path: '/' });
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const token = req.cookies?.auth_token;

  if (!token) {
    return res.json({ authenticated: false });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    res.json({ authenticated: true, email: decoded.email });
  } catch {
    res.json({ authenticated: false });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  // Always return success to prevent email enumeration
  res.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' });

  // Do the actual work in background
  if (!email) return;

  const db = getDb();
  const user = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);

  if (!user) return;

  // Generate reset token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  db.prepare("INSERT INTO password_reset_tokens (email, token, expires_at) VALUES (?, ?, ?)")
    .run(email, token, expiresAt);

  const resetUrl = `${config.appUrl}/reset-password?token=${token}`;

  try {
    await sendPasswordResetEmail(email, resetUrl);
  } catch (err) {
    console.error('Failed to send password reset email:', err);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password are required' });
  }

  const db = getDb();

  // Find valid token first (before password validation — better UX for invalid links)
  const resetToken = db.prepare(
    "SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > datetime('now')"
  ).get(token);

  if (!resetToken) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  // Hash new password and update user, set password_changed_at for session invalidation
  const hash = bcryptjs.hashSync(password, 12);
  db.prepare("UPDATE admin_users SET password_hash = ?, password_changed_at = datetime('now'), updated_at = datetime('now') WHERE email = ?")
    .run(hash, resetToken.email);

  // Mark token as used
  db.prepare("UPDATE password_reset_tokens SET used = 1 WHERE id = ?")
    .run(resetToken.id);

  res.json({ success: true });
});

export { validatePasswordStrength };
export default router;
