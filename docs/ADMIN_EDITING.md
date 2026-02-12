# Admin Inline Editing Spec

## Overview
When logged in as admin, all quote and article information should be editable directly from any page — not just in the Quote Management section in settings.

## Shared Admin Actions Module

### New file: `public/js/admin-actions.js`

Extract these functions from `public/js/settings.js` into a shared module:

```javascript
// All functions check `isAdmin` before executing
// All functions use api.patch() and showToast() for feedback
// All functions accept a callback to refresh the UI after edit

async function adminEditQuoteText(quoteId, currentText, onUpdate)
// prompt() for new text → PATCH /api/quotes/:id { text }

async function adminEditContext(quoteId, currentContext, onUpdate)
// prompt() for new context → PATCH /api/quotes/:id { context }

async function adminToggleVisibility(quoteId, currentVisible, onUpdate)
// PATCH /api/quotes/:id/visibility { is_visible: !currentVisible }

async function adminEditCategory(personId, personName, currentCategory, currentContext, onUpdate)
// prompt() from category list → PATCH /api/authors/:id { category, categoryContext }

async function adminEditAuthor(personId, currentName, currentDisambiguation, onUpdate)
// prompt() for name + disambiguation → PATCH /api/authors/:id { canonicalName, disambiguation }

async function adminChangeHeadshot(personId, personName, onUpdate)
// prompt() for URL → PATCH /api/authors/:id { photoUrl }
```

### Category List (reuse existing)
```javascript
const CATEGORIES = [
  'Politician', 'Government Official', 'Business Leader',
  'Entertainer', 'Athlete', 'Pundit', 'Journalist',
  'Scientist/Academic', 'Legal/Judicial', 'Military/Defense',
  'Activist/Advocate', 'Religious Leader', 'Other'
];
```

## Pages to Add Admin Controls

### 1. Homepage Quote Cards (`public/js/home.js`)
In `buildQuoteEntryHtml()`, when `isAdmin`, add an admin toolbar below each quote:
```html
<div class="admin-quote-actions">
  <button onclick="adminEditQuoteText(${quoteId}, ...)" title="Edit text">Edit</button>
  <button onclick="adminEditContext(${quoteId}, ...)" title="Edit context">Context</button>
  <button onclick="adminToggleVisibility(${quoteId}, ...)" title="Toggle visibility">
    ${isVisible ? 'Hide' : 'Show'}
  </button>
  <button onclick="adminEditCategory(${personId}, ...)" title="Edit category">Category</button>
  <button onclick="adminEditAuthor(${personId}, ...)" title="Edit author">Author</button>
  <button onclick="adminChangeHeadshot(${personId}, ...)" title="Change photo">Photo</button>
</div>
```
- Use small icon buttons to avoid cluttering the UI
- Style with `.admin-quote-actions` class — subtle, compact row

### 2. Individual Quote Page (`public/js/quote.js`)
- Add admin toolbar in quote detail area
- Same buttons as homepage

### 3. Article Page (`public/js/article.js`)
- Add admin toolbar to each quote card displayed in the article
- Same buttons as homepage

### 4. Author Page (`public/js/author.js`)
- Add admin toolbar to each quote card in the author's quote list
- Also add edit controls in the author header: edit name, disambiguation, category, photo

## Google Image Search for Missing Photos

When `isAdmin` AND author has no photo (`!photoUrl`):
- Replace the placeholder initial circle with a **clickable link**
- The link opens Google Images in a new tab
- URL format: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(personName + ' ' + disambiguation)}`
- Apply to ALL pages where author photos appear:
  - Homepage quote cards (headshot placeholder)
  - Author detail page (avatar)
  - Article page quote cards
  - Quote detail page

### Implementation
```javascript
const googleSearchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent((personName || '') + ' ' + (disambiguation || ''))}`;

// When admin + no photo:
const headshotHtml = isAdmin
  ? `<a href="${googleSearchUrl}" target="_blank" rel="noopener" class="admin-photo-search" title="Search Google Images">
       <div class="quote-headshot-placeholder">${initial}</div>
     </a>`
  : `<div class="quote-headshot-placeholder">${initial}</div>`;
```

## CSS for Admin Controls
```css
.admin-quote-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-color);
}
.admin-quote-actions button {
  font-size: 0.7rem;
  padding: 2px 6px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 3px;
  cursor: pointer;
  color: var(--text-secondary);
}
.admin-quote-actions button:hover {
  background: var(--accent-color);
  color: white;
}
.admin-photo-search {
  text-decoration: none;
  cursor: pointer;
}
.admin-photo-search:hover .quote-headshot-placeholder {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}
```

## Test Expectations
- Frontend test: admin edit buttons render when `isAdmin=true`, hidden when `isAdmin=false`
- Frontend test: Google Image search link uses correct URL encoding with personName + disambiguation
- API test: existing PATCH endpoints work (already covered by existing tests — verify coverage)
- Frontend test: admin-actions.js functions exist and are callable
