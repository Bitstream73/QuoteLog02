# Review Page & Settings UI Changes Spec

## Review Page Changes

### Tab Reorder

**File:** `public/js/review.js`

1. Change default tab: `let _reviewActiveTab = 'quotes';` (was `'disambiguation'`)
2. Swap tab button order in the HTML template so Quote Management appears FIRST (left), Disambiguation Review appears SECOND (right)
3. When page loads, Quote Management content renders by default

### Disambiguation Tab Badge

Add a notification badge INSIDE the Disambiguation Review tab button:

```html
<button class="review-tab ${_reviewActiveTab === 'disambiguation' ? 'active' : ''}"
        onclick="switchReviewTab('disambiguation')">
  Disambiguation Review
  <span class="disambig-tab-badge" id="disambig-tab-badge"
        style="${pendingCount > 0 ? '' : 'display:none'}">
    ${pendingCount > 99 ? '99+' : pendingCount}
  </span>
</button>
```

Add an update function:
```javascript
function updateDisambigTabBadge(count) {
  const badge = document.getElementById('disambig-tab-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}
```

Call `updateDisambigTabBadge()` alongside `updateReviewBadge()` wherever disambiguation stats are fetched:
- On review page render (from `API.get('/review/stats')`)
- After merge/reject actions (from response data)
- On Socket.IO `review_queue_update` events

### Badge CSS

```css
.disambig-tab-badge {
  display: inline-block;
  background: var(--color-danger, #dc3545);
  color: white;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 10px;
  margin-left: 4px;
  min-width: 16px;
  text-align: center;
  vertical-align: middle;
}
```

This matches the existing `#review-badge` style in the nav header.

---

## Important Button Non-Admin Change

### File: `public/js/important.js`

**Current behavior:** `renderImportantButton()` always shows "Important? {count}"

**New behavior:**
- Non-admin (`isAdmin === false`): Show "Important?" text only — NO count number
- Admin (`isAdmin === true`): Show "Important? {count}" PLUS SuperImportant button

Modify `renderImportantButton(entityType, entityId, importantsCount, isImportant)`:

```javascript
function renderImportantButton(entityType, entityId, importantsCount, isImportant) {
  const activeClass = isImportant ? 'important-btn--active' : '';
  const adminOnly = typeof isAdmin !== 'undefined' && isAdmin;

  let html = `<button class="important-btn ${activeClass}"
    onclick="handleImportantToggle(event, '${entityType}', ${entityId})">
    Important?${adminOnly ? ` <span class="important-count">${importantsCount}</span>` : ''}
  </button>`;

  if (adminOnly) {
    html += ` <button class="super-important-btn"
      onclick="handleSuperImportant(event, '${entityType}', ${entityId})">
      SuperImportant
    </button>`;
  }

  return html;
}
```

**Important:** The Socket.IO handler `initImportantSocket()` updates `.important-count` spans. In non-admin mode there won't be a count span — that's fine, the selector simply won't match.

---

## Settings Page Source Twirl-Down

### File: `public/js/settings.js`

**Current behavior:** Sources list renders as a flat div below the Add Source form

**New behavior:** Sources list wrapped in an HTML5 `<details>` disclosure element, closed by default

### Layout

```
┌──────────────────────────────────────┐
│ Data Management — Sources            │
│                                      │
│ [ e.g., reuters.com        ]         │
│ [ Display name (optional)  ]         │
│ [ RSS feed URL (optional)  ]         │
│ [ Add Source ]                       │
│                                      │
│ ▶ Sources (N)                        │  ← <details> closed by default
│   ┌──────────────────────────────┐   │
│   │ source row 1                 │   │  ← only visible when opened
│   │ source row 2                 │   │
│   └──────────────────────────────┘   │
└──────────────────────────────────────┘
```

### Implementation

In the sources section render function, wrap the list:

```html
<details class="sources-details">
  <summary>Sources (${sources.length})</summary>
  <div id="sources-list">
    ${sources.map(renderSourceRow).join('')}
  </div>
</details>
```

The Add Source form stays ABOVE the `<details>` element (not inside it).

After adding a source successfully, update the summary count and optionally open the details:
```javascript
const details = document.querySelector('.sources-details');
const summary = details?.querySelector('summary');
if (summary) summary.textContent = `Sources (${newCount})`;
```

### CSS

```css
.sources-details {
  margin-top: 1rem;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  overflow: hidden;
}
.sources-details summary {
  padding: 10px 14px;
  cursor: pointer;
  font-weight: 600;
  background: var(--bg-secondary, #f5f5f5);
  user-select: none;
}
.sources-details summary:hover {
  background: var(--bg-hover, #eee);
}
.sources-details[open] summary {
  border-bottom: 1px solid var(--border-color, #ddd);
}
```

## Test Requirements

### Review Page Tests
- Default `_reviewActiveTab` value is `'quotes'`
- Tab buttons render Quote Management before Disambiguation Review
- Disambiguation tab badge element exists with correct ID
- Badge updates correctly when count changes (0 hides, >0 shows, >99 shows "99+")

### Important Button Tests
- Non-admin render: output contains "Important?" but NOT `.important-count` span
- Admin render: output contains "Important?" WITH `.important-count` span AND `.super-important-btn`
- SuperImportant button has correct onclick handler signature

### Settings Tests
- Sources list renders inside `<details>` element
- `<details>` is not open by default (no `open` attribute)
- Summary text includes source count
