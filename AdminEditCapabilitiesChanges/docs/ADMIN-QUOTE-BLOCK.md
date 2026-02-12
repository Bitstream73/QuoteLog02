# Admin Quote Block Layout Spec

## Overview
When `isAdmin === true`, quote blocks throughout the app render in an expanded admin format with inline edit capabilities, keyword/topic management, and stats.

## HTML Structure

```html
<div class="admin-quote-block quote-block" data-quote-id="${q.id}"
     data-importance="${q.importants_count}" data-share-view="${shareViewScore}">

  <!-- Quote Text (full, no truncation) -->
  <div class="quote-block__text" onclick="navigate(event, '/author/${q.person_id}')">
    <span class="quote-mark">&ldquo;</span>${escapeHtml(q.text)}<span class="quote-mark">&rdquo;</span>
  </div>

  <!-- Context -->
  ${q.context ? `<div class="quote-block__context" onclick="navigate(event, '/article/${q.article_id}')">
    ${escapeHtml(q.context)}
  </div>` : ''}

  <!-- Datetime -->
  <div class="quote-block__datetime">${formatDatetime(q.quote_datetime)}</div>

  <!-- Author Row -->
  <div class="quote-block__author" onclick="navigate(event, '/author/${q.person_id}')">
    <div class="quote-block__headshot">
      ${q.photo_url
        ? `<img src="${escapeHtml(q.photo_url)}" alt="${escapeHtml(q.person_name)}">`
        : `<div class="quote-block__initial">${q.person_name?.charAt(0) || '?'}</div>`}
    </div>
    <div class="quote-block__author-info">
      <span class="quote-block__author-name">${escapeHtml(q.person_name)}</span>
      <span class="quote-block__author-desc">${escapeHtml(q.person_category_context || '')}</span>
    </div>
  </div>

  <!-- Source + Topics Row -->
  <div class="quote-block__links">
    <a href="${escapeHtml(q.article_url)}" onclick="navigate(event, '/article/${q.article_id}')" class="quote-block__source">
      ${escapeHtml(q.source_name || q.source_domain || 'Source')}
    </a>
    ${topics.slice(0, 2).map(t =>
      `<a href="/topic/${t.slug}" onclick="navigate(event, '/topic/${t.slug}')" class="topic-tag">${escapeHtml(t.name)}</a>`
    ).join('')}
  </div>

  <!-- Share + Important Row -->
  <div class="quote-block__share">
    ${buildShareButtonsHtml('quote', q.id, q.text, q.person_name)}
    ${renderImportantButton('quote', q.id, q.importants_count, isImportant)}
    <!-- SuperImportant button rendered by renderImportantButton when isAdmin -->
  </div>

  <!-- Stats Row (admin only) -->
  <div class="admin-stats-row">
    <span>${q.view_count || 0} views</span>
    <span>${q.share_count || 0} shares</span>
    <span>${q.importants_count || 0} importants</span>
  </div>

  <!-- Edit Buttons Row (admin only) -->
  <div class="admin-edit-buttons">
    <button onclick="adminEditQuoteText(${q.id})">Quote</button>
    <button onclick="adminEditQuoteContext(${q.id})">Context</button>
    <button onclick="adminEditQuoteTopics(${q.id})">Topics</button>
    <button onclick="navigate(event, '/article/${q.article_id}')">Sources</button>
    <button onclick="adminEditAuthorFromQuote(${q.person_id})">Author</button>
    <button onclick="adminChangeHeadshotFromQuote(${q.person_id})">Photo</button>
  </div>

  <!-- Keywords Section (admin only, lazy-loaded) -->
  <div class="admin-keywords-section" id="admin-keywords-${q.id}">
    <span class="admin-section-label">Keywords</span>
    <button class="admin-inline-btn" onclick="adminEditQuoteKeywords(${q.id})">Edit</button>
    <button class="admin-inline-btn" onclick="adminCreateKeyword(${q.id})">Create Keyword</button>
    <span>:</span>
    <div class="admin-chips" id="keyword-chips-${q.id}">
      <!-- Lazy-loaded keyword chips -->
    </div>
  </div>

  <!-- Topics Section (admin only, lazy-loaded) -->
  <div class="admin-topics-section" id="admin-topics-${q.id}">
    <span class="admin-section-label">Topics</span>
    <button class="admin-inline-btn" onclick="adminEditQuoteTopicsList(${q.id})">Edit</button>
    <button class="admin-inline-btn" onclick="adminCreateTopicForQuote(${q.id})">Create Topic</button>
    <span>:</span>
    <div class="admin-chips" id="topic-chips-${q.id}">
      <!-- Lazy-loaded topic chips -->
    </div>
  </div>
</div>
```

## Navigation Rules

| Element Clicked | Navigates To |
|---|---|
| Quote text | `/author/:personId` |
| Author name | `/author/:personId` |
| Author description | `/author/:personId` |
| Author portrait | `/author/:personId` |
| Source URL link | `/article/:articleId` |
| Quote context | `/article/:articleId` |
| Topic tag | `/topic/:slug` |

## Edit Button Behaviors

All edit buttons use `prompt()` dialogs (existing pattern — NO modals):

| Button | Action | API Call |
|---|---|---|
| Quote | `prompt('Edit quote:', q.text)` | `API.patch('/quotes/' + id, { text })` |
| Context | `prompt('Edit context:', q.context)` | `API.patch('/quotes/' + id, { context })` |
| Topics | Opens topic management (see below) | Uses quote-topic CRUD |
| Sources | Navigates to article page | `navigate(event, '/article/' + id)` |
| Author | `prompt('Edit name:', name)` | `API.patch('/authors/' + id, { canonicalName })` |
| Photo | `prompt('Photo URL:', url)` | `API.patch('/authors/' + id, { photoUrl })` |

## Keyword/Topic Lazy Loading

When an admin quote block renders, initiate a fetch for keywords and topics:

```javascript
async function loadQuoteKeywordsTopics(quoteId) {
  const data = await API.get(`/quotes/${quoteId}/keywords-topics`);
  renderKeywordChips(quoteId, data.keywords);
  renderTopicChips(quoteId, data.topics);
}
```

Call this after the quote block is inserted into the DOM. Use `requestAnimationFrame` or `setTimeout(0)` to avoid blocking render.

## Keyword Chip Actions

```html
<span class="keyword-chip" onclick="navigate(event, '/analytics/keyword/${kw.id}')">
  ${escapeHtml(kw.name)}
  <button class="chip-remove" onclick="event.stopPropagation(); adminRemoveQuoteKeyword(${quoteId}, ${kw.id})">x</button>
</span>
```

- Click chip → navigate to keyword detail page
- Click X → `DELETE /api/admin/quotes/:quoteId/keywords/:keywordId`, remove chip from DOM
- [Create Keyword] → `prompt('Keyword name:')` then `POST /api/admin/quotes/:quoteId/keywords`
- [Edit] → Show all keywords, each editable via prompt rename

## Topic Chip Actions

```html
<span class="topic-chip" onclick="navigate(event, '/topic/${t.slug}')">
  ${escapeHtml(t.name)}
  <button class="chip-remove" onclick="event.stopPropagation(); adminRemoveQuoteTopic(${quoteId}, ${t.id})">x</button>
</span>
```

- Click chip → navigate to topic page
- Click X → `DELETE /api/admin/quotes/:quoteId/topics/:topicId`, remove chip from DOM
- [Create Topic] → `prompt('Topic name:')` then `POST /api/admin/quotes/:quoteId/topics`

## Topic/Source Card Admin Additions

### Trending Topics Tab (admin view)
Extend `buildTopicCardHtml()`:
- Topic name as `<h3>` heading
- Topic context below heading
- Use admin quote blocks for the 3 quotes
- After quotes: topic-level Important? + SuperImportant + stats row
- [Topic] edit button → `prompt()` + `PUT /api/admin/topics/:id`
- Keywords section with chips (loaded from API response)

### Trending Sources Tab (admin view)
Extend `buildSourceCardHtml()`:
- Source name as `<h3>` heading
- Source context below heading
- Use admin quote blocks for the 3 quotes
- After quotes: source-level stats row
- Keywords/Topics management sections

### All Tab (admin view)
Uses same `buildSourceCardHtml()` — inherits admin formatting automatically.

### Trending Quotes Tab (admin view)
- Quote of Day/Week/Month use admin quote blocks (automatic via `buildQuoteBlockHtml()`)
- Add italic disclaimer: "*Trending quotes change over time as views and shares change"
- Recent Quotes sort toggles (Date/Importance) work with admin blocks

## CSS Classes to Create

- `.admin-quote-block` — expanded width, extra padding
- `.admin-stats-row` — muted text, flex row with spacing
- `.admin-edit-buttons` — flex row of small buttons with gaps
- `.admin-edit-buttons button` — small, outlined style
- `.admin-keywords-section`, `.admin-topics-section` — flex wrap sections
- `.admin-section-label` — bold label text
- `.admin-inline-btn` — small text button
- `.admin-chips` — flex-wrap container
- `.keyword-chip`, `.topic-chip` — inline pill with remove X
- `.chip-remove` — small X button inside chip
