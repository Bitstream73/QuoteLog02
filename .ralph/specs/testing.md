# Spec: Testing Strategy

## Existing Test Infrastructure

- **Framework**: Vitest
- **HTTP testing**: Supertest
- **App factory**: `createApp()` from `src/index.js` returns Express app (no server listening)
- **Test pattern**: Import `createApp`, create supertest agent, run assertions

## Test Helper: Auth Cookie Generator

Create a shared helper that existing and new tests can use:

```javascript
// tests/helpers/auth.js
import jwt from 'jsonwebtoken';
import config from '../../src/config/index.js';

export function getAuthCookie() {
  const token = jwt.sign(
    { id: 1, email: 'jakob@karlsmark.com' },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
  return `auth_token=${token}`;
}
```

Usage in tests:

```javascript
import { getAuthCookie } from './helpers/auth.js';

const authCookie = getAuthCookie();

// Use with supertest:
const res = await request(app)
  .get('/api/settings')
  .set('Cookie', authCookie);
```

## New Test File: `tests/auth.spec.js`

Tests for the auth endpoints:

```
describe('POST /api/auth/login')
  - returns 200 + sets auth_token cookie with correct credentials
  - returns 401 with wrong password
  - returns 401 with unknown email
  - returns 400 if email or password missing

describe('GET /api/auth/me')
  - returns { authenticated: true, email } with valid cookie
  - returns { authenticated: false } without cookie
  - returns { authenticated: false } with expired/invalid cookie

describe('POST /api/auth/logout')
  - clears the auth_token cookie

describe('POST /api/auth/forgot-password')
  - returns 200 success message for registered email
  - returns 200 success message for unregistered email (no enumeration)
  - creates a token in password_reset_tokens table

describe('POST /api/auth/reset-password')
  - changes password with valid token
  - returns 400 with expired token
  - returns 400 with already-used token
  - returns 400 with invalid token
  - returns 400 if password < 8 characters
  - after reset, old password fails and new password works
```

## New Test File: `tests/admin-routes.spec.js`

Tests that admin routes are protected and public routes remain open:

```
describe('Protected admin routes (no auth)')
  - GET /api/settings → 401
  - PUT /api/settings → 401
  - PATCH /api/settings → 401
  - GET /api/review → 401
  - GET /api/review/stats → 401
  - POST /api/review/1/merge → 401
  - POST /api/review/1/reject → 401
  - POST /api/review/1/skip → 401
  - POST /api/review/batch → 401
  - GET /api/logs → 401
  - GET /api/logs/stats → 401
  - GET /api/logs/export → 401
  - DELETE /api/logs → 401
  - POST /api/sources → 401
  - PATCH /api/sources/1 → 401
  - DELETE /api/sources/1 → 401

describe('Protected admin routes (with auth)')
  - GET /api/settings → 200
  - GET /api/review → 200
  - GET /api/review/stats → 200
  - GET /api/logs → 200

describe('Public routes (no auth)')
  - GET /api/health → 200
  - GET /api/quotes → 200
  - GET /api/authors → 200
  - GET /api/sources → 200
```

## Fixing Existing Tests

Some existing tests for settings, review, logs, and sources may now get 401. Fix by:

1. Import the auth helper
2. Add `.set('Cookie', getAuthCookie())` to requests that hit protected endpoints

Check ALL existing test files for calls to `/api/settings`, `/api/review`, `/api/logs`, and write endpoints on `/api/sources`. These are the tests most likely to break.

Existing test files to audit:
- `tests/settings.spec.js` (if exists)
- `tests/review.spec.js` (if exists)
- `tests/sources.spec.js` (if exists)
- `tests/logs.spec.js` (if exists)
- Any integration test that touches these endpoints

## Mocking Resend

In `tests/auth.spec.js`, mock the email service to prevent real emails:

```javascript
import { vi } from 'vitest';

// Mock the email service
vi.mock('../src/services/email.js', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));
```

## Running Tests

```bash
npm test                              # All tests
npm test -- tests/auth.spec.js       # Just auth tests
npm test -- tests/admin-routes.spec.js  # Just route protection tests
npm test -- --coverage                # With coverage
```

All tests must pass. Zero failures. If a test fails, fix it before moving to the next phase.
