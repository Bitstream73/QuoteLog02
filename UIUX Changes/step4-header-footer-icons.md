# Step 4: Header + Footer + SVG Icon System

## Goal
Refine the "masthead" and "colophon" that frame the entire publication. Add a date ribbon (like NYT), replace all emoji icons with proper SVGs that theme correctly in dark mode, and redesign the footer into a publication-style colophon.

## Files to Modify
- `public/index.html`
- `public/css/styles.css`
- `public/js/app.js`
- `public/js/home.js`

---

## 4.1 Date Ribbon in Header

**File**: `public/index.html`
**Location**: Inside `<header>`, add BEFORE `<nav>` (before line 17)

```html
<div class="date-ribbon">
  <span id="date-ribbon-text"></span>
</div>
```

**File**: `public/css/styles.css`
**Location**: Add in the header section

```css
.date-ribbon {
  text-align: center;
  font-family: var(--font-ui);
  font-size: 0.7rem;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--border);
}

@media (max-width: 768px) {
  .date-ribbon { display: none; }
}
```

**File**: `public/js/app.js`
**Location**: In the `DOMContentLoaded` handler, add after `applyTheme()`:

```javascript
// Populate date ribbon
const dateRibbon = document.getElementById('date-ribbon-text');
if (dateRibbon) {
  dateRibbon.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}
```

Do the same in the fallback `readyState` block.

---

## 4.2 SVG Search Icon

**File**: `public/index.html`
**Location**: Line 24 — the search button

```html
<!-- Change from: -->
<button class="search-btn" onclick="doHeaderSearch()" aria-label="Search">&#x1F50D;</button>

<!-- Change to: -->
<button class="search-btn" onclick="doHeaderSearch()" aria-label="Search">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
  </svg>
</button>
```

---

## 4.3 SVG Admin Icons

**File**: `public/js/home.js`
**Location**: In `buildQuoteEntryHtml()`, lines 235-241

Replace the emoji visibility toggle icons:

```javascript
// Change from (line 236):
${q.isVisible === 0 ? '&#x1f441;&#xfe0f;&#x200d;&#x1f5e8;' : '&#x1f441;'}

// Change to:
${q.isVisible === 0
  ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
  : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
}
```

Replace the emoji edit pencil:

```javascript
// Change from (line 241):
&#x270E;

// Change to:
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
```

---

## 4.4 Enhanced Footer

**File**: `public/index.html`
**Location**: Lines 54-56 — replace the entire `<footer>` block

```html
<!-- Change from: -->
<footer>
  <p>&copy; 2026 The Quote Log / GGM, LLC.</p>
</footer>

<!-- Change to: -->
<footer>
  <div class="footer-inner">
    <div class="footer-brand">
      <span class="footer-logo">Quote Log</span>
      <span class="footer-tagline">What, When, &amp; Why They Said It.</span>
    </div>
    <div class="footer-links">
      <a href="/" onclick="navigate(event, '/')">Home</a>
      <a href="/login" onclick="navigate(event, '/login')">Admin</a>
    </div>
    <div class="footer-copyright">
      &copy; 2026 The Quote Log / GGM, LLC.
    </div>
  </div>
</footer>
```

**File**: `public/css/styles.css`
**Location**: Replace the existing `footer` styles

```css
footer {
  border-top: 3px double var(--border-dark);
  padding: 2.5rem 2rem;
  background: var(--bg-secondary);
  margin-top: auto;
}

.footer-inner {
  max-width: var(--max-width);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  text-align: center;
}

.footer-logo {
  font-family: var(--font-headline);
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--text-primary);
  display: block;
}

.footer-tagline {
  font-family: var(--font-ui);
  font-size: 0.75rem;
  color: var(--text-muted);
  font-style: italic;
}

.footer-links {
  display: flex;
  gap: 1.5rem;
  font-family: var(--font-ui);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.footer-links a {
  color: var(--text-secondary);
  text-decoration: none;
}

.footer-links a:hover {
  color: var(--accent);
}

.footer-copyright {
  font-family: var(--font-ui);
  font-size: 0.7rem;
  color: var(--text-muted);
}
```

---

## Verification

1. Date ribbon shows "Sunday, February 9, 2026" (or current date) centered above nav
2. Date ribbon is hidden on screens < 768px
3. Search button has a crisp SVG magnifying glass icon (not emoji)
4. Admin visibility and edit icons are SVGs (not emoji) — check they're visible
5. Toggle dark mode — all SVG icons adapt (they use `currentColor`)
6. Footer shows: "Quote Log" wordmark, tagline, Home/Admin links, copyright
7. Footer has double-line top border and secondary background color
8. Footer links hover to accent color
9. Check dark mode — footer background is `--bg-secondary` dark variant

## Commit Message
```
feat: redesign header with date ribbon, SVG icons, and publication-style footer
```
