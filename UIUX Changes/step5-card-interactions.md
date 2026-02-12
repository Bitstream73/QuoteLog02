# Step 5: Card Interactions + Micro-animations

## Goal
Add subtle interaction polish that makes the experience feel alive, mirroring the NYT/Guardian hover patterns. Share buttons reveal on hover, cards get a left-accent border, and page transitions are smooth.

## Files to Modify
- `public/css/styles.css`
- `public/js/app.js`

---

## 5.1 Card Hover Accent Border

**File**: `public/css/styles.css`
**Location**: Update the `.article-group` styles

Add a transparent left border that transitions to accent color on hover (signature NYT/Guardian pattern):

```css
.article-group {
  /* ...keep existing styles... */
  border-left: 3px solid transparent;
  transition: border-color 0.2s;
}

.article-group:hover {
  border-left-color: var(--accent);
}
```

Add a subtle background change on individual quote entries:

```css
.quote-entry {
  /* ...keep existing styles... */
  transition: background-color 0.15s;
}

.quote-entry:hover {
  background: var(--bg-secondary);
}
```

---

## 5.2 Share Buttons Reveal on Hover

**File**: `public/css/styles.css`
**Location**: Update the `.share-row` styles

Make share buttons invisible by default, appearing only on hover. Always visible on touch devices:

```css
.share-row {
  /* ...keep existing styles... */
  opacity: 0;
  transition: opacity 0.2s;
}

.quote-entry:hover .share-row,
.article-group-footer:hover .share-row,
.article-group:hover .share-row {
  opacity: 1;
}

/* Always visible on touch devices (no hover capability) */
@media (hover: none) {
  .share-row {
    opacity: 1;
  }
}
```

---

## 5.3 New Quotes Banner Restyle

**File**: `public/css/styles.css`
**Location**: Find existing `.new-quotes-banner` styles or add new ones

Restyle the Socket.IO "new quotes available" banner for a breaking-news feel:

```css
.new-quotes-banner {
  background: var(--accent);
  color: #fff;
  border: none;
  font-family: var(--font-ui);
  font-weight: 600;
  font-size: 0.85rem;
  letter-spacing: 0.02em;
  text-align: center;
  padding: 0.6rem 1rem;
  animation: banner-slide-in 0.3s ease-out;
}

@keyframes banner-slide-in {
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.new-quotes-banner button,
.new-quotes-refresh-btn {
  background: rgba(255,255,255,0.2);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.4);
  border-radius: var(--radius);
  padding: 0.25rem 0.75rem;
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: 0.8rem;
  margin-left: 0.5rem;
  transition: background 0.2s;
}

.new-quotes-banner button:hover,
.new-quotes-refresh-btn:hover {
  background: rgba(255,255,255,0.35);
}
```

---

## 5.4 Page Fade-In Transition

**File**: `public/css/styles.css`
**Location**: Add to the `main` / `#content` styles

```css
@keyframes page-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

#content {
  animation: page-fade-in 0.2s ease-out;
}
```

**File**: `public/js/app.js`
**Location**: In the `route()` function (line 97), before calling the render function

Re-trigger the animation on each navigation by briefly removing and re-adding the animation:

```javascript
function route() {
  const content = document.getElementById('content');
  // Re-trigger page fade-in animation
  if (content) {
    content.style.animation = 'none';
    content.offsetHeight; // force reflow
    content.style.animation = '';
  }

  const path = window.location.pathname;
  // ...rest of existing route() code...
}
```

---

## Verification

1. Hover over an article group — red left accent border appears smoothly
2. Hover over a single quote entry — subtle background color change
3. Share buttons (X, Facebook, Email, Copy) are hidden by default, appear on hover
4. On mobile/touch device — share buttons are always visible
5. When new quotes arrive via Socket.IO — banner slides in from top with red background
6. Navigate between pages — smooth 0.2s fade-in transition
7. Check all hover effects in dark mode — accent colors adapt
8. Verify the interactions don't conflict with the clickable article group areas

## Commit Message
```
style: add card hover interactions, share button reveal, and page transitions
```
