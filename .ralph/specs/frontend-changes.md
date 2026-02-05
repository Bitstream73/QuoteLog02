# Spec: Frontend Changes

## Overview

The frontend is a vanilla JS SPA (no framework). All JS files attach functions to the global scope. The router in `app.js` calls render functions by name. New pages follow the same pattern.

## New Files

### `public/js/login.js`

Exports a global `renderLogin()` function. Called by the router when path is `/login`.

```javascript
function renderLogin() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <h1 class="auth-title">Admin Login</h1>
        <form id="login-form" class="auth-form">
          <div class="form-group">
            <label for="login-email">Email</label>
            <input type="email" id="login-email" required autocomplete="email" placeholder="admin@example.com">
          </div>
          <div class="form-group">
            <label for="login-password">Password</label>
            <input type="password" id="login-password" required autocomplete="current-password" placeholder="Password">
          </div>
          <div id="login-error" class="auth-error" style="display:none;"></div>
          <button type="submit" class="btn btn-primary auth-btn">Log In</button>
        </form>
        <div class="auth-links">
          <a href="/forgot-password" onclick="navigate(event, '/forgot-password')">Forgot password?</a>
        </div>
      </div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.style.display = 'none';

    try {
      await API.post('/auth/login', { email, password });
      isAdmin = true;
      updateNav();
      navigate(null, '/');
    } catch (err) {
      errorEl.textContent = err.message || 'Invalid email or password';
      errorEl.style.display = 'block';
    }
  });
}
```

### `public/js/resetPassword.js`

Exports two globals: `renderForgotPassword()` and `renderResetPassword(token)`.

**Forgot password view**: email form → POST `/api/auth/forgot-password` → "Check your email" message.

**Reset password view** (when URL has `?token=xxx`): two password fields → POST `/api/auth/reset-password` → success message with link to login.

Pattern matches `renderLogin()` above — simple form, event listener, API call, error display.

## Modified Files

### `public/index.html`

**Navigation changes** — update the nav-links div:

```html
<div class="nav-links">
  <a href="/" onclick="navigate(event, '/')">Home</a>
  <a href="/review" onclick="navigate(event, '/review')" class="nav-link-review" id="nav-review" style="display:none;">
    Review
    <span class="review-badge" id="review-badge" style="display: none;">0</span>
  </a>
  <a href="/settings" onclick="navigate(event, '/settings')" id="nav-settings" style="display:none;">Settings</a>
  <a href="/login" onclick="navigate(event, '/login')" id="nav-login">Login</a>
  <a href="#" onclick="logout(event)" id="nav-logout" style="display:none;">Logout</a>
</div>
```

Key changes:
- Review link: add `id="nav-review"`, add `style="display:none;"` (hidden by default)
- Settings link: add `id="nav-settings"`, add `style="display:none;"` (hidden by default)
- New Login link: `id="nav-login"` (visible by default)
- New Logout link: `id="nav-logout"` (hidden by default)

**Script tags** — add before `app.js`:

```html
<script src="/js/login.js"></script>
<script src="/js/resetPassword.js"></script>
```

### `public/js/app.js`

**Add auth state + helper functions:**

```javascript
let isAdmin = false;

async function checkAuth() {
  try {
    const result = await API.get('/auth/me');
    isAdmin = result.authenticated;
  } catch {
    isAdmin = false;
  }
}

function updateNav() {
  const reviewLink = document.getElementById('nav-review');
  const settingsLink = document.getElementById('nav-settings');
  const loginLink = document.getElementById('nav-login');
  const logoutLink = document.getElementById('nav-logout');

  if (reviewLink) reviewLink.style.display = isAdmin ? '' : 'none';
  if (settingsLink) settingsLink.style.display = isAdmin ? '' : 'none';
  if (loginLink) loginLink.style.display = isAdmin ? 'none' : '';
  if (logoutLink) logoutLink.style.display = isAdmin ? '' : 'none';
}

async function logout(event) {
  if (event) event.preventDefault();
  try {
    await API.post('/auth/logout', {});
  } catch {
    // Ignore errors
  }
  isAdmin = false;
  updateNav();
  navigate(null, '/');
}
```

**Update `route()` function:**

```javascript
function route() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  if (path === '/' || path === '') {
    renderHome();
  } else if (path.startsWith('/quote/')) {
    const id = path.split('/')[2];
    renderQuote(id);
  } else if (path.startsWith('/author/')) {
    const id = path.split('/')[2];
    renderAuthor(id);
  } else if (path === '/login') {
    if (isAdmin) { navigate(null, '/'); return; }
    renderLogin();
  } else if (path === '/forgot-password') {
    renderForgotPassword();
  } else if (path === '/reset-password') {
    renderResetPassword(params.get('token'));
  } else if (path === '/settings') {
    if (!isAdmin) { navigate(null, '/login'); return; }
    renderSettings();
  } else if (path === '/review') {
    if (!isAdmin) { navigate(null, '/login'); return; }
    renderReview();
  } else {
    renderHome();
  }

  // Only update review badge if admin
  if (isAdmin) {
    updateReviewBadgeAsync();
  }
}
```

**Update initialization:**

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  updateNav();
  initSocket();
  route();
});

// Also run immediately in case DOMContentLoaded already fired
if (document.readyState !== 'loading') {
  (async () => {
    await checkAuth();
    updateNav();
    initSocket();
    route();
  })();
}
```

### `public/js/api.js`

Add global 401 handling. Modify each method to check for 401:

```javascript
// Add to the error handling in each method (get, post, put, patch, delete):
if (res.status === 401 && !path.startsWith('/auth/')) {
  isAdmin = false;
  if (typeof updateNav === 'function') updateNav();
  if (typeof navigate === 'function') navigate(null, '/login');
}
```

This ensures that if a token expires mid-session, the user gets bounced to login.

### `public/css/styles.css`

Add auth-specific styles:

```css
/* Auth Pages */
.auth-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 60vh;
  padding: 2rem;
}

.auth-card {
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #d4d4d4);
  padding: 2.5rem;
  max-width: 400px;
  width: 100%;
}

.auth-title {
  font-family: var(--heading-font, 'Georgia', serif);
  text-align: center;
  margin-bottom: 1.5rem;
  font-size: 1.5rem;
}

.auth-form .form-group {
  margin-bottom: 1rem;
}

.auth-form label {
  display: block;
  margin-bottom: 0.25rem;
  font-weight: 600;
  font-size: 0.875rem;
}

.auth-form input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border-color, #d4d4d4);
  font-size: 1rem;
  box-sizing: border-box;
}

.auth-btn {
  width: 100%;
  margin-top: 0.5rem;
}

.auth-error {
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  padding: 0.5rem;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
}

.auth-links {
  text-align: center;
  margin-top: 1rem;
  font-size: 0.875rem;
}

.auth-links a {
  color: var(--link-color, #1a1a1a);
}

.auth-success {
  color: #065f46;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  padding: 0.75rem;
  text-align: center;
  font-size: 0.875rem;
}
```

## Flow Summary

1. Page loads → `checkAuth()` calls `GET /api/auth/me` → sets `isAdmin`
2. `updateNav()` shows/hides Review, Settings, Login, Logout links
3. `route()` guards `/settings` and `/review` — redirects to `/login` if not admin
4. Login form → POST `/api/auth/login` → server sets httpOnly cookie → frontend sets `isAdmin = true` → redirect to home
5. Logout → POST `/api/auth/logout` → clear state → redirect to home
6. Any 401 from API → auto-redirect to login
