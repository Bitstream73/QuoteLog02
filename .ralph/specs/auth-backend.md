# Spec: Backend Authentication

## Database Tables

### `admin_users`

```sql
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `password_reset_tokens`

```sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Seed Data

In `initializeTables()`, after creating the tables, seed the admin user. Use `bcryptjs.hashSync('Ferret@00', 12)`. Since `database.js` runs on every startup, use `INSERT OR IGNORE`:

```javascript
import bcryptjs from 'bcryptjs';

// Inside initializeTables(), after CREATE TABLE admin_users:
const adminHash = bcryptjs.hashSync('Ferret@00', 12);
db.prepare('INSERT OR IGNORE INTO admin_users (email, password_hash) VALUES (?, ?)')
  .run('jakob@karlsmark.com', adminHash);
```

**IMPORTANT**: `bcryptjs` (pure JS) — NOT `bcrypt` (native C++ addon that requires build tools). The Dockerfile uses `node:20-alpine` and native `bcrypt` will fail.

## Config Updates

In `src/config/index.js`, add:

```javascript
import crypto from 'crypto';

const config = {
  // ... existing keys ...
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  resendApiKey: process.env.RESEND_API_KEY || '',
  appUrl: process.env.APP_URL || `http://localhost:${parseInt(process.env.PORT || '3000', 10)}`,
  adminEmail: process.env.ADMIN_EMAIL || 'jakob@karlsmark.com',
};
```

The `jwtSecret` auto-generates in dev so it works without env vars, but tokens won't survive restarts. In production, `JWT_SECRET` must be set.

## Middleware: `src/middleware/auth.js`

```javascript
import jwt from 'jsonwebtoken';
import config from '../config/index.js';

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
```

## Routes: `src/routes/auth.js`

### `POST /api/auth/login`

Request body: `{ email: string, password: string }`

1. Validate both fields present
2. Query `admin_users` by email (case-insensitive: `LOWER(email) = LOWER(?)`)
3. `bcryptjs.compareSync(password, row.password_hash)`
4. If match: sign JWT `{ id: row.id, email: row.email }` with 7-day expiry
5. Set cookie: `res.cookie('auth_token', token, { httpOnly: true, secure: config.env === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 })`
6. Return `{ success: true, email: row.email }`
7. If no match: return `res.status(401).json({ error: 'Invalid email or password' })`

### `POST /api/auth/logout`

1. `res.clearCookie('auth_token', { path: '/' })`
2. Return `{ success: true }`

### `GET /api/auth/me`

1. Try to read + verify JWT from `auth_token` cookie
2. If valid: `{ authenticated: true, email: decoded.email }`
3. If invalid/missing: `{ authenticated: false }` (200, not 401 — this is a status check)

### `POST /api/auth/forgot-password`

Request body: `{ email: string }`

1. Always return `{ success: true, message: 'If that email is registered, a reset link has been sent.' }` (prevent email enumeration)
2. Look up `admin_users` by email
3. If found:
   - Generate token: `crypto.randomBytes(32).toString('hex')`
   - Store in `password_reset_tokens` with `expires_at = datetime('now', '+1 hour')`
   - Send email via `sendPasswordResetEmail(email, ${config.appUrl}/reset-password?token=${token})`
4. If not found: still return success (do nothing)

### `POST /api/auth/reset-password`

Request body: `{ token: string, password: string }`

1. Validate password is at least 8 characters
2. Look up `password_reset_tokens` where `token = ?` AND `used = 0` AND `expires_at > datetime('now')`
3. If not found: return `res.status(400).json({ error: 'Invalid or expired reset token' })`
4. If found:
   - Hash new password with `bcryptjs.hashSync(password, 12)`
   - Update `admin_users SET password_hash = ?, updated_at = datetime('now') WHERE email = ?`
   - Mark token used: `UPDATE password_reset_tokens SET used = 1 WHERE id = ?`
   - Return `{ success: true }`

## Email Service: `src/services/email.js`

```javascript
import { Resend } from 'resend';
import config from '../config/index.js';

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

export async function sendPasswordResetEmail(to, resetUrl) {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — password reset email not sent');
    console.log(`Reset URL (dev): ${resetUrl}`);
    return;
  }

  await resend.emails.send({
    from: 'Quote Log <noreply@updates.karlsmark.com>',
    to,
    subject: 'Password Reset — The Quote Log',
    html: `
      <h2>Password Reset</h2>
      <p>You requested a password reset for your Quote Log admin account.</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:4px;">Reset Password</a></p>
      <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    `,
  });
}
```

**Note on `from` address**: Resend requires a verified domain. Use whatever domain is configured in the user's Resend account. The `noreply@updates.karlsmark.com` is a reasonable default — adjust if Resend rejects it. In dev without `RESEND_API_KEY`, the function logs the reset URL to console.

## Middleware Stack Changes in `src/index.js`

Add `cookie-parser` to the middleware stack:

```javascript
import cookieParser from 'cookie-parser';
// ...
// After express.urlencoded():
app.use(cookieParser());
```

Mount auth routes:

```javascript
import authRouter from './routes/auth.js';
// ...
// With other API routes:
app.use('/api/auth', authRouter);
```

## Route Protection Summary

| File | Route | Auth? |
|------|-------|-------|
| `sources.js` | `GET /` | Public |
| `sources.js` | `POST /` | `requireAdmin` |
| `sources.js` | `PATCH /:id` | `requireAdmin` |
| `sources.js` | `DELETE /:id` | `requireAdmin` |
| `settings.js` | `GET /` | `requireAdmin` |
| `settings.js` | `PUT /` | `requireAdmin` |
| `settings.js` | `PATCH /` | `requireAdmin` |
| `review.js` | ALL routes | `requireAdmin` |
| `logs.js` | ALL routes | `requireAdmin` |
| `quotes.js` | ALL routes | Public |
| `authors.js` | ALL routes | Public |
| `auth.js` | ALL routes | Public (auth endpoints) |
