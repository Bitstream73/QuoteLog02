# Step 1: Dark Mode + CSS Foundation

## Goal
Add dark mode support — the single most expected modern feature. This establishes the CSS variable architecture all later steps build on.

## Files to Modify
- `public/css/styles.css`
- `public/js/app.js`
- `public/index.html`
- `public/js/settings.js`

---

## 1.1 Dark Mode CSS Variables

**File**: `public/css/styles.css`
**Location**: After the `:root` block (after line 31)

Add a `[data-theme="dark"]` selector that overrides all CSS custom properties:

```css
[data-theme="dark"] {
  --bg-primary: #1a1a1a;
  --bg-secondary: #242424;
  --bg-card: #1e1e1e;
  --text-primary: #e8e6e3;
  --text-secondary: #a8a5a0;
  --text-muted: #6b6966;
  --accent: #e85d75;
  --accent-hover: #d44a62;
  --accent-light: #2d1f22;
  --error: #e85d75;
  --warning: #e8a830;
  --info: #5b8def;
  --success: #3dba6a;
  --border: #333330;
  --border-dark: #444440;
  --shadow: 0 1px 3px rgba(0,0,0,0.3);
}
```

Also add dark-mode overrides for elements that use hardcoded colors or gradients:

```css
/* Dark mode: fade gradient for collapsed article groups */
[data-theme="dark"] .article-group-collapsed .article-group-fade {
  background: linear-gradient(to bottom, rgba(26,26,26,0), rgba(26,26,26,1));
}

/* Dark mode: auth feedback backgrounds */
[data-theme="dark"] .auth-error { background: #2d1f22; color: #e85d75; }
[data-theme="dark"] .auth-success { background: #1a2d1f; color: #3dba6a; }

/* Dark mode: input backgrounds */
[data-theme="dark"] input,
[data-theme="dark"] select,
[data-theme="dark"] textarea {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-color: var(--border);
}

/* Dark mode: modal */
[data-theme="dark"] .modal {
  background: var(--bg-card);
}

/* Dark mode: code/pre blocks */
[data-theme="dark"] pre,
[data-theme="dark"] code {
  background: var(--bg-secondary);
}
```

---

## 1.2 Theme Toggle Button in Header

**File**: `public/index.html`
**Location**: Inside `.nav-links` div (line 26), add before the Home link

```html
<button class="theme-toggle" onclick="toggleTheme()" aria-label="Toggle dark mode" title="Toggle dark mode">
  <svg class="theme-icon-light" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
  </svg>
  <svg class="theme-icon-dark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
</button>
```

---

## 1.3 Theme Toggle CSS

**File**: `public/css/styles.css`
**Location**: After the nav-links styles

```css
.theme-toggle {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.35rem 0.5rem;
  cursor: pointer;
  color: var(--text-muted);
  transition: color 0.2s, border-color 0.2s;
  display: inline-flex;
  align-items: center;
  line-height: 1;
}
.theme-toggle:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.theme-icon-dark { display: none; }
[data-theme="dark"] .theme-icon-light { display: none; }
[data-theme="dark"] .theme-icon-dark { display: block; }
```

---

## 1.4 Theme JavaScript Logic

**File**: `public/js/app.js`
**Location**: Add these functions before the `DOMContentLoaded` handler (before line 222)

```javascript
// Theme management
function applyTheme(theme) {
  if (!theme) {
    theme = localStorage.getItem('ql-theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('ql-theme', theme);
  // Update meta theme-color for mobile browsers
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#1a1a1a' : '#ffffff';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}
```

**Also in `app.js`**: In the `DOMContentLoaded` handler (line 223), call `applyTheme()` BEFORE `route()` to prevent flash of wrong theme:

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(); // <-- Add this line FIRST
  await checkAuth();
  updateNav();
  initSocket();
  updateHeaderHeight();
  route();
});
```

Do the same in the fallback block (line 235-243):

```javascript
if (document.readyState !== 'loading') {
  (async () => {
    applyTheme(); // <-- Add this line FIRST
    await checkAuth();
    updateNav();
    initSocket();
    updateHeaderHeight();
    route();
  })();
}
```

**Also**: Listen for OS theme changes:

```javascript
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('ql-theme')) {
    applyTheme(e.matches ? 'dark' : 'light');
  }
});
```

---

## 1.5 Wire Settings Theme Dropdown

**File**: `public/js/settings.js`
**Location**: The theme `<select>` at line 120

Change the onchange to also apply the theme immediately:

```javascript
// Current:
onchange="updateSetting('theme', this.value)"

// Change to:
onchange="updateSetting('theme', this.value); applyTheme(this.value)"
```

Also update the selected state to read from `localStorage` instead of only the server setting:

```javascript
// When building the select, use localStorage value:
const currentTheme = localStorage.getItem('ql-theme') || settings.theme || 'light';
// Then use currentTheme for the selected attribute
```

---

## Verification

1. Load the app — should display in light mode (or OS preference)
2. Click the theme toggle (sun/moon button) — entire page switches to dark mode
3. Reload the page — dark mode persists (no flash of white)
4. Check: header, quote cards, modals, settings page, article groups, footer all adapt
5. Check: form inputs (search bar, settings fields) have dark backgrounds
6. Check: the collapsed article group fade gradient works in dark mode
7. Go to Settings > Appearance — theme dropdown reflects current theme
8. Change theme in dropdown — applies immediately

## Commit Message
```
feat: add dark mode with theme toggle and CSS variable foundation
```
