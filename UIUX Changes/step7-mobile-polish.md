# Step 7: Mobile Polish + Accessibility + Scroll-to-top

## Goal
Final refinements: scroll-to-top for long feeds, keyboard navigation focus outlines, improved empty state, mobile header cleanup, and service worker cache bump.

## Files to Modify
- `public/css/styles.css`
- `public/js/app.js`
- `public/index.html`
- `public/js/home.js`
- `public/sw.js`

---

## 7.1 Scroll-to-Top Button

**File**: `public/index.html`
**Location**: Add before the toast container / closing `</body>` tag

```html
<button id="scroll-top-btn" class="scroll-top-btn" onclick="window.scrollTo({top:0,behavior:'smooth'})" aria-label="Scroll to top" style="display:none">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
</button>
```

**File**: `public/css/styles.css`

```css
.scroll-top-btn {
  position: fixed;
  bottom: 2rem;
  left: 2rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: var(--shadow);
  transition: opacity 0.2s, color 0.2s, border-color 0.2s;
  color: var(--text-secondary);
  z-index: 50;
}

.scroll-top-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

@media (max-width: 480px) {
  .scroll-top-btn {
    bottom: 1rem;
    left: 1rem;
    width: 36px;
    height: 36px;
  }
}
```

**File**: `public/js/app.js`
**Location**: Add after the existing event listeners

```javascript
// Show/hide scroll-to-top button based on scroll position
window.addEventListener('scroll', () => {
  const btn = document.getElementById('scroll-top-btn');
  if (btn) btn.style.display = window.scrollY > 400 ? 'flex' : 'none';
}, { passive: true });
```

---

## 7.2 Focus-Visible Outlines for Keyboard Navigation

**File**: `public/css/styles.css`
**Location**: Add near the top, after the base reset styles

```css
/* Keyboard navigation focus outlines (only for keyboard users, not mouse clicks) */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

button:focus:not(:focus-visible),
a:focus:not(:focus-visible) {
  outline: none;
}
```

---

## 7.3 Improved Empty State

**File**: `public/js/home.js`
**Location**: In `renderHome()`, the empty state block (lines 559-565)

Replace the plain text empty state with a styled version that includes an SVG quote icon:

```javascript
// Change from:
html += `
  <div class="empty-state">
    <h3>No quotes yet</h3>
    <p>Quotes will appear here as they are extracted from news articles.</p>
    <p>Add news sources in <a href="/settings" onclick="navigate(event, '/settings')" style="color:var(--accent)">Settings</a> to start extracting quotes.</p>
  </div>
`;

// Change to:
html += `
  <div class="empty-state">
    <svg width="64" height="64" viewBox="0 0 24 24" fill="var(--border)" style="margin-bottom:1rem">
      <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>
    </svg>
    <h3>No quotes yet</h3>
    <p>Quotes will appear here as they are extracted from news articles.</p>
    <p>Add news sources in <a href="/settings" onclick="navigate(event, '/settings')" style="color:var(--accent)">Settings</a> to start extracting quotes.</p>
  </div>
`;
```

---

## 7.4 Mobile Header Cleanup

**File**: `public/css/styles.css`
**Location**: Update the existing mobile breakpoints

Ensure the theme toggle button added in Step 1 doesn't break the header at narrow widths:

```css
@media (max-width: 768px) {
  /* ...existing mobile styles... */

  .theme-toggle {
    order: 2;
    margin-left: auto;
  }

  .nav-links {
    /* Ensure nav links wrap cleanly with the theme toggle */
    justify-content: center;
  }
}

@media (max-width: 400px) {
  /* ...existing mobile styles... */

  .theme-toggle {
    padding: 0.25rem 0.4rem;
  }

  .theme-toggle svg {
    width: 14px;
    height: 14px;
  }
}
```

---

## 7.5 Service Worker Cache Bump

**File**: `public/sw.js`
**Location**: Line 1

```javascript
// Change from:
const CACHE_NAME = 'quotelog-v12';

// Change to:
const CACHE_NAME = 'quotelog-v13';
```

This forces existing installations to purge old cached assets and pick up all the new CSS/JS changes.

---

## Verification

1. Scroll down on the homepage past 400px — circular up-arrow button appears in bottom-left corner
2. Click the scroll-to-top button — smooth scroll to top
3. Button disappears when back at the top
4. Tab through the page with keyboard — visible accent-colored focus outlines appear on interactive elements
5. Click with mouse — no ugly focus outlines (only on keyboard navigation)
6. Clear search to show empty state — SVG quote mark icon displays above the "No quotes yet" text
7. Resize browser to 400px — header doesn't overflow, theme toggle is compact
8. Resize to 768px — date ribbon is hidden, nav wraps cleanly
9. Hard refresh the page — service worker updates to v13, old cache purged

## Commit Message
```
feat: mobile polish, accessibility improvements, and scroll-to-top button
```
