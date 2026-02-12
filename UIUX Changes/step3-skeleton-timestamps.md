# Step 3: Skeleton Loading + Relative Timestamps

## Goal
Replace "Loading..." text with animated skeleton placeholder cards (like NYT/BBC) and switch from absolute timestamps to relative "5m ago" style (like every modern news site). These two changes eliminate the most obvious "not a real news site" tells.

## Files to Modify
- `public/css/styles.css`
- `public/js/home.js`
- `public/js/quote.js`
- `public/js/author.js`
- `public/js/article.js`
- `public/js/app.js`

---

## 3.1 Skeleton Loading CSS

**File**: `public/css/styles.css`
**Location**: Add a new section for skeleton styles

```css
/* ===================================
   Skeleton Loading States
   =================================== */
@keyframes skeleton-pulse {
  0% { opacity: 0.6; }
  50% { opacity: 0.3; }
  100% { opacity: 0.6; }
}

.skeleton {
  background: var(--bg-secondary);
  border-radius: var(--radius);
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-text {
  height: 1rem;
  margin-bottom: 0.5rem;
  border-radius: 2px;
}

.skeleton-text-short { width: 60%; }
.skeleton-text-long { width: 90%; }
.skeleton-text-medium { width: 75%; }

.skeleton-heading {
  height: 1.5rem;
  width: 70%;
  margin-bottom: 0.75rem;
  border-radius: 2px;
}

.skeleton-avatar {
  width: 112px;
  height: 112px;
  border-radius: 2px;
  flex-shrink: 0;
}

.skeleton-card {
  display: flex;
  gap: 1rem;
  padding: 1.5rem 0;
  border-bottom: 1px solid var(--border);
}

.skeleton-card:last-child {
  border-bottom: none;
}

@media (max-width: 400px) {
  .skeleton-avatar {
    width: 40px;
    height: 40px;
  }
}
```

---

## 3.2 Skeleton HTML Generator Function

**File**: `public/js/home.js`
**Location**: Add near the top of the file (after the utility functions, around line 50)

```javascript
/**
 * Generate skeleton loading placeholder cards
 */
function buildSkeletonHtml(count = 5) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-card">
        <div class="skeleton skeleton-avatar"></div>
        <div style="flex:1">
          <div class="skeleton skeleton-text skeleton-text-long"></div>
          <div class="skeleton skeleton-text skeleton-text-long"></div>
          <div class="skeleton skeleton-text skeleton-text-short"></div>
          <div class="skeleton skeleton-text skeleton-text-medium" style="margin-top:0.75rem;height:0.9rem"></div>
        </div>
      </div>`;
  }
  return html;
}
```

---

## 3.3 Replace Loading Text with Skeletons

Replace all instances of `'<div class="loading">Loading...</div>'` with skeleton calls:

**File**: `public/js/home.js` line 516
```javascript
// Change from:
content.innerHTML = '<div class="loading">Loading quotes...</div>';
// Change to:
content.innerHTML = buildSkeletonHtml(6);
```

**File**: `public/js/quote.js` line 3
```javascript
// Change from:
content.innerHTML = '<div class="loading">Loading quote...</div>';
// Change to:
content.innerHTML = typeof buildSkeletonHtml === 'function' ? buildSkeletonHtml(1) : '<div class="loading">Loading quote...</div>';
```

**File**: `public/js/author.js` line 79
```javascript
// Change from:
content.innerHTML = '<div class="loading">Loading author...</div>';
// Change to:
content.innerHTML = typeof buildSkeletonHtml === 'function' ? buildSkeletonHtml(3) : '<div class="loading">Loading author...</div>';
```

**File**: `public/js/article.js` line 3
```javascript
// Change from:
content.innerHTML = '<div class="loading">Loading article...</div>';
// Change to:
content.innerHTML = typeof buildSkeletonHtml === 'function' ? buildSkeletonHtml(3) : '<div class="loading">Loading article...</div>';
```

Note: Leave the loading text in `settings.js` and `review.js` as-is since those are admin-only pages where skeleton loading is less important.

---

## 3.4 Relative Timestamp Function

**File**: `public/js/home.js`
**Location**: Add after `formatDateTime()` (after line 37)

```javascript
/**
 * Format a timestamp as a relative time string (e.g., "5m ago", "3h ago")
 * Falls back to formatDateTime() for dates older than 7 days.
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  if (isNaN(then)) return '';
  const diff = now - then;

  if (diff < 0) return formatDateTime(timestamp); // future dates

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  // Older than 7 days — fall back to full date
  return formatDateTime(timestamp);
}
```

---

## 3.5 Apply Relative Timestamps to Quote Cards

**File**: `public/js/home.js`

**In `buildQuoteEntryHtml()`** (line 230-231):

```javascript
// Change from:
const dateStr = formatDateTime(q.articlePublishedAt);
const dateHtml = !insideGroup && dateStr ? `<span class="quote-date-inline">${dateStr}</span>` : '';

// Change to:
const dateStr = formatRelativeTime(q.articlePublishedAt);
const dateHtml = !insideGroup && dateStr
  ? `<time class="quote-date-inline" datetime="${q.articlePublishedAt ? new Date(q.articlePublishedAt).toISOString() : ''}" title="${formatDateTime(q.articlePublishedAt)}">${dateStr}</time>`
  : '';
```

**In `buildArticleGroupHtml()`** (line 302):

```javascript
// Change from:
const dateStr = formatDateTime(group.articlePublishedAt);

// Change to:
const dateStr = formatRelativeTime(group.articlePublishedAt);
```

Also update the date element in the group header (line 335) to use a `<time>` tag:

```javascript
// Change from:
<span class="article-group-date">${dateStr}</span>

// Change to:
<time class="article-group-date" datetime="${group.articlePublishedAt ? new Date(group.articlePublishedAt).toISOString() : ''}" title="${formatDateTime(group.articlePublishedAt)}">${dateStr}</time>
```

---

## 3.6 Live-Updating Timestamps

**File**: `public/js/app.js`
**Location**: Add after the resize event listener (after line 232)

```javascript
// Live-update relative timestamps every 60 seconds
setInterval(() => {
  document.querySelectorAll('time[datetime]').forEach(el => {
    const iso = el.getAttribute('datetime');
    if (iso && typeof formatRelativeTime === 'function') {
      const newText = formatRelativeTime(iso);
      if (newText && el.textContent !== newText) {
        el.textContent = newText;
      }
    }
  });
}, 60000);
```

---

## Verification

1. Navigate to homepage — skeleton placeholder cards (pulsing gray shapes) appear briefly before quotes load
2. Throttle network to "Slow 3G" in DevTools — skeleton cards are clearly visible for several seconds
3. Quote timestamps show relative format: "Just now", "5m ago", "3h ago", "2d ago"
4. Hover over a timestamp — tooltip shows the full absolute date/time
5. Wait 60 seconds on the page — timestamps update automatically (e.g., "4m ago" becomes "5m ago")
6. Quotes older than 7 days show the full date format
7. Check skeleton loading on quote detail, author, and article pages too
8. Check at 400px width — skeleton avatars shrink to 40px

## Commit Message
```
feat: add skeleton loading states and relative timestamps
```
