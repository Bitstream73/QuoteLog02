# Homepage Redesign — 4-Tab System & Quote Block UI

## Tab Bar

4 tabs visible at all times (portrait + landscape). Default tab: **Trending Topics**.

```html
<div class="homepage-tabs">
  <button class="homepage-tab active" data-tab="trending-topics">Trending Topics</button>
  <button class="homepage-tab" data-tab="trending-sources">Trending Sources</button>
  <button class="homepage-tab" data-tab="trending-quotes">Trending Quotes</button>
  <button class="homepage-tab" data-tab="all">All</button>
</div>
<div id="homepage-tab-content"></div>
```

**Tab CSS:**
```css
.homepage-tabs {
  display: flex;
  border-bottom: 2px solid var(--border);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  gap: 0;
  margin-bottom: 1rem;
}

.homepage-tab {
  flex: 1;
  min-width: fit-content;
  padding: 10px 16px;
  font-family: 'Inter', sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  cursor: pointer;
  color: var(--text-muted);
  white-space: nowrap;
}

.homepage-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
```

## Quote Block Layout

New layout for every quote across all pages:

```
+--------------------------------------+
| "Quote text spans full width..."     |
|                                      |
| [Quote context in italic]            |
| [IMPORTANT?]  [QuoteDateTime]  [Views: N] |
| (Circular   Author Name  [badges]   |
|  Portrait)  Author description       |
| [Source link]  [Topic 1] [Topic 2]   |
| [Share buttons]  [Share count]       |
+--------------------------------------+
```

### HTML Structure

```javascript
function buildQuoteBlockHtml(q, topics, isImportant) {
  return `
    <div class="quote-block" data-quote-id="${q.id}">
      <div class="quote-block__text" onclick="navigateTo('/author/${q.personId}')">
        <span class="quote-mark">${q.quoteType === 'direct' ? '"' : ''}</span>
        ${escapeHtml(q.text)}
        <span class="quote-mark">${q.quoteType === 'direct' ? '"' : ''}</span>
      </div>

      ${q.context ? `<div class="quote-block__context" onclick="navigateTo('/article/${q.articleId}')">${escapeHtml(q.context)}</div>` : ''}

      <div class="quote-block__meta-row">
        ${renderImportantButton('quote', q.id, q.importantsCount, isImportant)}
        ${q.quoteDateTime ? `<span class="quote-block__datetime">${formatDateTime(q.quoteDateTime)}</span>` : ''}
        ${q.viewCount > 0 ? `<span class="quote-block__views">${q.viewCount} views</span>` : ''}
      </div>

      <div class="quote-block__author" onclick="navigateTo('/author/${q.personId}')">
        <img class="quote-block__headshot" src="${q.photoUrl || '/img/default-avatar.svg'}"
             alt="${escapeHtml(q.personName)}" loading="lazy">
        <div class="quote-block__author-info">
          <span class="quote-block__author-name">${escapeHtml(q.personName)}</span>
          ${q.personCategoryContext ? `<span class="quote-block__author-desc">${escapeHtml(q.personCategoryContext)}</span>` : ''}
        </div>
      </div>

      <div class="quote-block__footer">
        <div class="quote-block__links">
          ${q.articleId ? `<a class="quote-block__source-link" onclick="navigateTo('/article/${q.articleId}')">${escapeHtml(q.primarySourceName || 'Source')}</a>` : ''}
          ${(topics || []).slice(0, 2).map(t =>
            `<a class="quote-block__topic-tag" onclick="navigateTo('/topic/${t.slug}')">${escapeHtml(t.name)}</a>`
          ).join('')}
        </div>
        <div class="quote-block__share">
          ${buildShareButtonsHtml('quote', q.id, q.text, q.personName)}
          ${q.shareCount > 0 ? `<span class="quote-block__share-count">${q.shareCount}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}
```

### Click Behavior
- Clicking quote text, author name/description/portrait -> author page (`/author/:id`)
- Clicking source URL or quote context -> source page (`/article/:id`)
- Clicking topic tag -> topic page (`/topic/:slug`)

## Important? Button Component

### `public/js/important.js`

```javascript
function renderImportantButton(entityType, entityId, importantsCount, isImportant) {
  const activeClass = isImportant ? 'important-btn--active' : '';
  return `
    <button class="important-btn ${activeClass}"
            data-entity-type="${entityType}" data-entity-id="${entityId}"
            onclick="handleImportantToggle(event, '${entityType}', ${entityId})">
      Important? <span class="important-count">${importantsCount || 0}</span>
    </button>
  `;
}

async function handleImportantToggle(event, entityType, entityId) {
  event.stopPropagation();
  const btn = event.currentTarget;
  // Optimistic toggle
  btn.classList.toggle('important-btn--active');
  try {
    const res = await API.post('/importants/toggle', { entity_type: entityType, entity_id: entityId });
    btn.querySelector('.important-count').textContent = res.importants_count;
    if (res.is_important) {
      btn.classList.add('important-btn--active');
    } else {
      btn.classList.remove('important-btn--active');
    }
  } catch (err) {
    btn.classList.toggle('important-btn--active'); // revert
    showToast('Failed to update', 'error');
  }
}

function initImportantSocket() {
  if (typeof socket !== 'undefined') {
    socket.on('important_update', ({ entity_type, entity_id, importants_count }) => {
      document.querySelectorAll(
        `.important-btn[data-entity-type="${entity_type}"][data-entity-id="${entity_id}"] .important-count`
      ).forEach(el => { el.textContent = importants_count; });
    });
  }
}
```

### Important Button CSS
```css
.important-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-family: 'Inter', sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: none;
  border: 1.5px solid var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-muted);
  transition: all 0.15s;
}

.important-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.important-btn--active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
```

## Trending Topics Tab

```javascript
async function renderTrendingTopicsTab(sortBy = 'date') {
  const data = await API.get('/analytics/trending-topics');
  // Each topic renders as a card with:
  // - Topic name (heading font)
  // - Topic context
  // - Sort toggle: Date (default) | Importance
  // - 3 quote blocks
  // - "See More" link -> /topic/:slug
  // - Important? button for the topic
  // - Share buttons for the topic
}
```

### Topic Card Structure
```html
<div class="topic-card">
  <h2 class="topic-card__name">[Topic Name]</h2>
  <p class="topic-card__context">[Topic context]</p>
  <div class="topic-card__sort">
    Sort by: <button class="sort-btn active" data-sort="date">Date</button>
    <button class="sort-btn" data-sort="importance">Importance</button>
  </div>
  [Quote Block 1]
  [Quote Block 2]
  [Quote Block 3]
  <a class="topic-card__see-more" onclick="navigateTo('/topic/slug')">See More</a>
  [Important? button for topic]
  [Share buttons for topic]
</div>
```

## Trending Sources Tab

Same structure as Trending Topics but for articles (displayed as "Sources"):
- Article title as heading (label says "Source" not "Article")
- 3 quote blocks per source
- "See More" -> `/article/:id`
- Important? button for the article
- Share buttons for the article

## Trending Quotes Tab

```html
<div class="trending-quotes">
  <h2>Quote of the Day</h2>
  [Quote Block - highest importants_count for today]

  <h2>Quote of the Week</h2>
  [Quote Block - highest importants_count for this week]

  <h2>Quote of the Month</h2>
  [Quote Block - highest importants_count for this month]

  <p class="trending-disclaimer"><em>*Trending quotes change over time as views and shares change</em></p>

  <h2>Recent Quotes</h2>
  <div class="trending-quotes__sort">
    Sort by: <button class="sort-btn active" data-sort="date">Date</button>
    <button class="sort-btn" data-sort="importance">Importance</button>
  </div>
  [Quote Block 1 - newest first]
  [Quote Block 2]
  [Quote Block 3]
  ...
</div>
```

## All Tab

Same card structure as Trending Sources but shows ALL articles/sources (not just trending), ordered newest first. No minimum importants_count filter.

## Topic Page (`/topic/:slug`)

Full page view for a single topic. Similar to the existing article page.

```html
<div class="topic-page">
  <h1>[Topic Name]</h1>
  <p>[Topic description/context]</p>
  [Important? button for topic]
  [Share buttons for topic]

  <div class="topic-page__sort">
    Sort by: <button>Date</button> <button>Importance</button>
  </div>

  [Quote Block 1]
  [Quote Block 2]
  [Quote Block 3]
  ...
  [Load More / Pagination]
</div>
```

Add to `public/js/app.js` router:
```javascript
{ path: '/topic/:slug', render: renderTopicPage }
```

## Share Buttons

Reuse/adapt existing share pattern. Share buttons for each entity type:

```javascript
function buildShareButtonsHtml(entityType, entityId, text, authorName) {
  const url = encodeURIComponent(window.location.origin + '/' + entityType + '/' + entityId);
  const shareText = encodeURIComponent(text ? `"${text.substring(0, 100)}..." - ${authorName}` : '');
  return `
    <div class="share-buttons" data-entity-type="${entityType}" data-entity-id="${entityId}">
      <button class="share-btn" onclick="shareEntity(event, '${entityType}', ${entityId}, 'twitter')" title="Share on X">𝕏</button>
      <button class="share-btn" onclick="shareEntity(event, '${entityType}', ${entityId}, 'facebook')" title="Share on Facebook">f</button>
      <button class="share-btn" onclick="shareEntity(event, '${entityType}', ${entityId}, 'copy')" title="Copy link">🔗</button>
    </div>
  `;
}

async function shareEntity(event, entityType, entityId, platform) {
  event.stopPropagation();
  // 1. POST /api/tracking/share to increment share_count
  // 2. Open share URL or copy to clipboard
  // 3. Show toast confirmation
}
```

## View Tracking

Fire a view event when content enters the viewport:

```javascript
function initViewTracking() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const type = el.dataset.trackType;
        const id = el.dataset.trackId;
        if (type && id && !el.dataset.tracked) {
          el.dataset.tracked = 'true';
          API.post('/tracking/view', { entity_type: type, entity_id: parseInt(id) }).catch(() => {});
        }
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('[data-track-type]').forEach(el => observer.observe(el));
}
```

Add `data-track-type` and `data-track-id` attributes to quote blocks, topic cards, and source cards.

## Frontend Label Changes

- "Articles" -> "Sources" everywhere in the UI (nav, headings, labels)
- The database `articles` table is NOT renamed — only UI labels change

## Test Expectations

### Frontend Unit Tests
1. `renderImportantButton` returns correct HTML with active/inactive state
2. Tab switching updates active class and renders correct content
3. `buildQuoteBlockHtml` includes all required elements (text, author, datetime, important, share)
4. Topic card renders with 3 quote blocks and "See More" link
5. Share buttons render for all entity types
6. Sort toggle switches between date and importance ordering
