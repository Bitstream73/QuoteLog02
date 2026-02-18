// Homepage - Tab System (Trending Quotes, Trending Authors, Trending Sources)

// Store full quote texts for show more/less toggle
const _quoteTexts = {};

// Store quote metadata for sharing
const _quoteMeta = {};

// Current active tab
let _activeTab = 'trending-quotes';

// Pending new quotes count (for non-jarring updates)
let _pendingNewQuotes = 0;

// Important status cache (entity_type:entity_id -> boolean)
let _importantStatuses = {};

/**
 * Format a timestamp as mm/dd/yyyy - hh:mm:ss
 */
function formatDateTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy} - ${hh}:${min}:${ss}`;
}

/**
 * Format a timestamp as a relative time string (e.g., "5m ago", "3h ago")
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  if (isNaN(then)) return '';
  const diff = now - then;
  if (diff < 0) return formatDateTime(timestamp);

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return formatDateTime(timestamp);
}

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

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ======= Share Buttons =======

/**
 * Build share buttons for any entity type
 */
function buildShareButtonsHtml(entityType, entityId, text, authorName) {
  const downloadBtn = entityType === 'quote' ? `
      <button class="share-btn share-btn--download" onclick="downloadShareImage(event, ${entityId})" title="Download Image">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
      </button>` : '';

  return `
    <div class="share-buttons" data-entity-type="${entityType}" data-entity-id="${entityId}">
      <button class="share-btn" onclick="shareEntity(event, '${entityType}', ${entityId}, 'twitter')" title="Share on X">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </button>
      <button class="share-btn" onclick="shareEntity(event, '${entityType}', ${entityId}, 'facebook')" title="Share on Facebook">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
      </button>
      <button class="share-btn" onclick="shareEntity(event, '${entityType}', ${entityId}, 'email')" title="Share via Email">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
      </button>
      <button class="share-btn" onclick="shareEntity(event, '${entityType}', ${entityId}, 'copy')" title="Copy link">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
      </button>${downloadBtn}
    </div>
  `;
}

/**
 * Handle share action for any entity type
 */
async function shareEntity(event, entityType, entityId, platform) {
  event.stopPropagation();
  event.preventDefault();

  // Increment share count via API
  try {
    await API.post('/tracking/share', { entity_type: entityType, entity_id: entityId });
  } catch (err) {
    // Non-blocking — sharing still works even if tracking fails
  }

  const url = window.location.origin + '/' + entityType + '/' + entityId;
  const meta = _quoteMeta[entityId] || {};
  const text = meta.text || '';
  const authorName = meta.personName || '';
  const fullText = text ? `"${text.substring(0, 200)}..." - ${authorName}` : '';

  switch (platform) {
    case 'twitter':
      window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(fullText)}&url=${encodeURIComponent(url)}`, '_blank');
      break;
    case 'facebook':
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
      break;
    case 'email': {
      const subject = encodeURIComponent(`Quote from ${authorName} - WhatTheySaid.News`);
      const body = encodeURIComponent(`${fullText}\n\nRead more: ${url}\n\n---\nShared from WhatTheySaid.News`);
      window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
      break;
    }
    case 'copy':
      navigator.clipboard.writeText(`${fullText}\n${url}`).then(() => {
        const btn = event.currentTarget;
        btn.classList.add('share-copied');
        setTimeout(() => btn.classList.remove('share-copied'), 1500);
        showToast('Link copied to clipboard', 'success');
      }).catch(() => {});
      break;
  }
}

/**
 * Download a share image (portrait format) for a quote
 */
async function downloadShareImage(event, quoteId) {
  event.stopPropagation();
  event.preventDefault();

  const btn = event.currentTarget;
  btn.classList.add('share-btn--loading');

  try {
    // Try native share with image on supported platforms (mobile)
    if (navigator.share && navigator.canShare) {
      const res = await fetch(`/api/quotes/${quoteId}/share-image?format=portrait`);
      if (!res.ok) throw new Error('Failed to fetch image');
      const blob = await res.blob();
      const file = new File([blob], `whattheysaid-quote-${quoteId}.jpg`, { type: 'image/jpeg' });

      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Quote from WhatTheySaid.News',
          url: window.location.origin + '/quote/' + quoteId,
        });
        btn.classList.remove('share-btn--loading');
        return;
      }
    }

    // Fallback: download the image
    const res = await fetch(`/api/quotes/${quoteId}/share-image?format=portrait`);
    if (!res.ok) throw new Error('Failed to fetch image');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whattheysaid-quote-${quoteId}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Image downloaded', 'success');
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('Failed to download image', 'error');
    }
  } finally {
    btn.classList.remove('share-btn--loading');
  }
}

// ======= View Tracking =======

/**
 * Initialize IntersectionObserver-based view tracking
 */
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

// ======= Quote Block =======

/**
 * Build HTML for a single quote block (new layout)
 */
function buildQuoteBlockHtml(q, isImportant, options = {}) {
  // Admin mode: use expanded admin quote block
  if (typeof isAdmin !== 'undefined' && isAdmin) {
    return buildAdminQuoteBlockHtml(q, isImportant);
  }

  const variant = options.variant || 'default';  // 'default'|'compact'|'hero'|'featured'
  const showAvatar = options.showAvatar !== undefined ? options.showAvatar : true;
  const showSummary = options.showSummary !== undefined ? options.showSummary : true;

  const isLong = q.text && q.text.length > 280;
  const truncatedText = isLong ? q.text.substring(0, 280) + '...' : (q.text || '');
  if (q.text) _quoteTexts[q.id] = q.text;

  // Store metadata for sharing
  _quoteMeta[q.id] = {
    text: q.text,
    personName: q.person_name || q.personName || '',
    personCategoryContext: q.person_category_context || q.personCategoryContext || '',
    context: q.context || '',
  };

  const personName = q.person_name || q.personName || '';
  const personId = q.person_id || q.personId || '';
  const photoUrl = q.photo_url || q.photoUrl || '';
  const personCategoryContext = q.person_category_context || q.personCategoryContext || q.category_context || '';
  const articleId = q.article_id || q.articleId || '';
  const articleTitle = q.article_title || q.articleTitle || '';
  const articleUrl = q.article_url || q.articleUrl || '';
  const sourceDomain = q.source_domain || q.primarySourceDomain || '';
  const sourceName = q.source_name || q.primarySourceName || '';
  const importantsCount = q.importants_count || q.importantsCount || 0;
  const shareCount = q.share_count || q.shareCount || 0;
  const quoteDateTime = q.quote_datetime || q.quoteDateTime || '';
  const viewCount = q.view_count || q.viewCount || 0;
  const context = q.context || '';

  // Headshot
  const initial = (personName || '?').charAt(0).toUpperCase();
  const _isAdm = typeof isAdmin !== 'undefined' && isAdmin;
  const _safeName = escapeHtml((personName || '').replace(/'/g, "\\'"));
  const headshotHtml = photoUrl
    ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(personName)}" class="quote-block__headshot" onerror="this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'" loading="lazy">`
    : `<div class="quote-headshot-placeholder">${initial}</div>`;

  // Share buttons + important
  const shareButtons = buildShareButtonsHtml('quote', q.id, q.text, personName);
  const importantButton = renderImportantButton('quote', q.id, importantsCount, isImportant);

  const variantClass = variant !== 'default' ? ' quote-block--' + variant : '';

  return `
    <div class="quote-block${variantClass}" data-quote-id="${q.id}" data-track-type="quote" data-track-id="${q.id}" data-created-at="${quoteDateTime || q.created_at || ''}" data-importance="${(importantsCount + shareCount + viewCount) || 0}" data-share-view="${(shareCount + viewCount) || 0}">
      <div class="quote-block__text" onclick="navigateTo('/quote/${q.id}')">
        <span class="quote-mark quote-mark--open">\u201C</span>${escapeHtml(truncatedText)}${isLong ? `<a href="#" class="show-more-toggle" onclick="toggleQuoteText(event, ${q.id})">show more</a>` : ''}<span class="quote-mark quote-mark--close">\u201D</span>
      </div>

      <div class="quote-block__byline" onclick="navigateTo('/author/${personId}')">
        ${showAvatar ? headshotHtml : ''}
        <span class="quote-block__attribution">
          &mdash; ${escapeHtml(personName)}${personCategoryContext ? ', ' + escapeHtml(personCategoryContext) : ''}
        </span>
      </div>

      ${showSummary && context ? `<div class="quote-block__summary">${escapeHtml(context)}</div>` : ''}

      <div class="quote-block__footer">
        <div class="quote-block__footer-always">
          ${sourceName || sourceDomain ? `<a class="quote-block__source-name" onclick="navigateTo('/article/${articleId}')">${escapeHtml(sourceName || sourceDomain)}</a>` : ''}
          ${quoteDateTime ? `<span class="quote-block__time">${formatRelativeTime(quoteDateTime)}</span>` : ''}
        </div>
        <div class="quote-block__footer-hover">
          ${shareButtons}
          ${shareCount > 0 ? `<span class="quote-block__share-count">${shareCount}</span>` : ''}
          ${importantButton}
        </div>
      </div>
      ${typeof buildAdminActionsHtml === 'function' ? buildAdminActionsHtml(q) : ''}
    </div>
    <hr class="quote-divider">
  `;
}

// ======= Admin Quote Block =======

/**
 * Build HTML for an admin quote block — expanded layout with inline editing
 */
function buildAdminQuoteBlockHtml(q, isImportant) {
  // Store text and metadata
  if (q.text) _quoteTexts[q.id] = q.text;
  _quoteMeta[q.id] = {
    text: q.text,
    personName: q.person_name || q.personName || '',
    personCategoryContext: q.person_category_context || q.personCategoryContext || '',
    context: q.context || '',
  };

  const personName = q.person_name || q.personName || '';
  const personId = q.person_id || q.personId || '';
  const photoUrl = q.photo_url || q.photoUrl || '';
  const personCategoryContext = q.person_category_context || q.personCategoryContext || q.category_context || '';
  const articleId = q.article_id || q.articleId || '';
  const articleUrl = q.article_url || q.articleUrl || '';
  const sourceDomain = q.source_domain || q.primarySourceDomain || '';
  const sourceName = q.source_name || q.primarySourceName || '';
  const importantsCount = q.importants_count || q.importantsCount || 0;
  const shareCount = q.share_count || q.shareCount || 0;
  const quoteDateTime = q.quote_datetime || q.quoteDateTime || '';
  const viewCount = q.view_count || q.viewCount || 0;
  const context = q.context || '';
  const shareViewScore = (shareCount + viewCount) || 0;

  // Author headshot (admin: clickable to change, searchable if missing)
  const initial = (personName || '?').charAt(0).toUpperCase();
  const _safeName = escapeHtml((personName || '').replace(/'/g, "\\'"));
  const headshotHtml = photoUrl
    ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(personName)}" class="quote-block__headshot admin-headshot-clickable" onclick="adminChangeHeadshot(${personId}, '${_safeName}')" title="Click to change photo" style="cursor:pointer" onerror="this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'" loading="lazy">`
    : `<a href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent((personName || '') + ' ' + (personCategoryContext || ''))}" target="_blank" rel="noopener" class="admin-headshot-search" title="Search Google Images"><div class="quote-headshot-placeholder">${initial}</div></a>`;

  return `
    <div class="admin-quote-block quote-block" data-quote-id="${q.id}" data-track-type="quote" data-track-id="${q.id}" data-created-at="${q.created_at || ''}" data-importance="${(importantsCount + shareViewScore) || 0}" data-share-view="${shareViewScore}">

      <div class="quote-block__text" onclick="navigateTo('/quote/${q.id}')">
        <span class="quote-mark quote-mark--open">\u201C</span>${escapeHtml(q.text || '')}<span class="quote-mark quote-mark--close">\u201D</span>
      </div>

      ${context ? `<div class="quote-block__context" onclick="navigateTo('/article/${articleId}')">${escapeHtml(context)}</div>` : ''}

      ${quoteDateTime ? `<div class="quote-block__datetime">${formatDateTime(quoteDateTime)}</div>` : ''}

      <div class="quote-block__author" onclick="navigateTo('/author/${personId}')">
        <div class="quote-block__headshot-wrap">
          ${headshotHtml}
        </div>
        <div class="quote-block__author-info">
          <span class="quote-block__author-name">${escapeHtml(personName)}</span>
          ${personCategoryContext ? `<span class="quote-block__author-desc">${escapeHtml(personCategoryContext)}</span>` : ''}
        </div>
      </div>

      <div class="quote-block__links">
        ${articleId ? `<a class="quote-block__source-link" onclick="navigateTo('/article/${articleId}')">${escapeHtml(sourceName || sourceDomain || 'Source')}</a>` : ''}
      </div>

      <div class="quote-block__share">
        ${buildShareButtonsHtml('quote', q.id, q.text, personName)}
        ${renderImportantButton('quote', q.id, importantsCount, isImportant)}
      </div>

      <div class="admin-stats-row">
        <span>${viewCount} views</span>
        <span>${shareCount} shares</span>
        <span>${importantsCount} importants</span>
      </div>

      <div class="admin-edit-buttons">
        <button onclick="adminEditQuoteText(${q.id}, _quoteTexts[${q.id}] || '')">Quote</button>
        <button onclick="adminEditContext(${q.id}, _quoteMeta[${q.id}]?.context || '')">Context</button>
        <button onclick="navigateTo('/article/${articleId}')">Sources</button>
        <button onclick="adminEditAuthorFromQuote(${q.person_id || q.personId})">Author</button>
        <button onclick="adminChangeHeadshotFromQuote(${q.person_id || q.personId})">Photo</button>
      </div>

      <details class="admin-details-panel admin-details-panel--list" ontoggle="loadListAdminDetails(this, ${q.id})">
        <summary class="admin-details-panel__summary">
          <span class="admin-details-panel__title">Admin Details</span>
        </summary>
        <div class="admin-details-panel__body" id="admin-details-body-${q.id}">
        </div>
      </details>
    </div>
  `;
}

// ======= Admin Quote Edit Functions =======

async function adminEditAuthorFromQuote(personId) {
  const newName = prompt('Edit author name:');
  if (newName === null || newName.trim() === '') return;
  try {
    await API.patch(`/authors/${personId}`, { canonicalName: newName.trim() });
    showToast('Author name updated', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function adminChangeHeadshotFromQuote(personId) {
  const newUrl = prompt('Enter new headshot URL:');
  if (newUrl === null) return;
  try {
    await API.patch(`/authors/${personId}`, { photoUrl: newUrl.trim() || null });
    showToast('Headshot updated', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// ======= Lazy-Load Admin Details for List View =======

async function loadListAdminDetails(detailsEl, quoteId) {
  if (!detailsEl.open) return;
  const body = detailsEl.querySelector('.admin-details-panel__body');
  if (body.dataset.loaded) return;

  body.innerHTML = '<div class="context-loading"><div class="context-loading-spinner"></div><span style="font-family:var(--font-ui);font-size:var(--text-sm);color:var(--text-muted)">Loading admin details...</span></div>';

  try {
    const data = await API.get(`/quotes/${quoteId}`);
    const fullPanel = buildAdminQuoteDetailsPanel(data);
    // Extract just the body content from the full panel HTML
    const temp = document.createElement('div');
    temp.innerHTML = fullPanel;
    const panelBody = temp.querySelector('.admin-details-panel__body');
    body.innerHTML = panelBody ? panelBody.innerHTML : '<p class="admin-details-empty">No details available</p>';
    body.dataset.loaded = 'true';
  } catch (err) {
    body.innerHTML = `<p class="admin-details-empty">Error loading details: ${escapeHtml(err.message)}</p>`;
  }
}

// ======= Navigation Helper =======

function navigateTo(path) {
  if (typeof navigate === 'function') {
    navigate(null, path);
  } else {
    window.location.href = path;
  }
}

// ======= Tab System =======

/**
 * Build the 4-tab bar HTML
 */
function buildTabBarHtml(activeTab) {
  const tabs = [
    { key: 'trending-quotes', label: 'Trending Quotes' },
    { key: 'trending-authors', label: 'Trending Authors' },
    { key: 'trending-sources', label: 'Trending Sources' },
  ];

  return `
    <div class="homepage-tabs">
      ${tabs.map(t => `<button class="homepage-tab ${t.key === activeTab ? 'active' : ''}" data-tab="${t.key}" onclick="switchHomepageTab('${t.key}')">${t.label}<span class="tab-badge" id="tab-count-${t.key}"></span></button>`).join('')}
    </div>
    <div id="homepage-tab-content"></div>
  `;
}

/**
 * Switch homepage tab
 */
function switchHomepageTab(tabKey) {
  _activeTab = tabKey;
  // Update active tab styling
  document.querySelectorAll('.homepage-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabKey);
  });
  // Render tab content
  renderTabContent(tabKey);
}

/**
 * Render the content for the selected tab
 */
async function renderTabContent(tabKey) {
  const container = document.getElementById('homepage-tab-content');
  if (!container) return;
  container.innerHTML = buildSkeletonHtml(4);

  try {
    switch (tabKey) {
      case 'trending-quotes':
        await renderTrendingQuotesTab(container);
        break;
      case 'trending-authors':
        await renderTrendingAuthorsTab(container);
        break;
      case 'trending-sources':
        await renderTrendingSourcesTab(container);
        break;
    }
    // Initialize view tracking for newly rendered content
    initViewTracking();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error loading content</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

// ======= Trending Authors Tab =======

let _authorsSortBy = 'date';

async function renderTrendingAuthorsTab(container, sortBy) {
  _authorsSortBy = sortBy || 'date';
  const sortParam = _authorsSortBy === 'importance' ? '?sort=importance' : '';
  const data = await API.get('/analytics/trending-authors' + sortParam);
  const authors = data.authors || [];

  if (authors.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>No trending authors yet</h3><p>Authors will appear as quotes are extracted.</p></div>`;
    return;
  }

  // Collect all quote IDs for importance status
  const entityKeys = [];
  for (const a of authors) {
    entityKeys.push(`person:${a.id}`);
    for (const q of (a.quotes || [])) {
      entityKeys.push(`quote:${q.id}`);
    }
  }
  await fetchImportantStatuses(entityKeys);

  let html = `<div class="tab-sort-controls">
    Sort: <a class="sort-toggle-text ${_authorsSortBy === 'date' ? 'active' : ''}" onclick="switchAuthorsSort('date')">Date</a>
    <span class="sort-toggle-divider">|</span>
    <a class="sort-toggle-text ${_authorsSortBy === 'importance' ? 'active' : ''}" onclick="switchAuthorsSort('importance')">Importance</a>
  </div>`;

  for (const author of authors) {
    html += buildAuthorCardHtml(author);
  }

  container.innerHTML = html;
}

function switchAuthorsSort(sortBy) {
  const container = document.getElementById('homepage-tab-content');
  if (container) renderTrendingAuthorsTab(container, sortBy);
}

function buildAuthorCardHtml(author) {
  const quotes = author.quotes || [];
  const _isAdm = typeof isAdmin !== 'undefined' && isAdmin;
  const initial = (author.canonical_name || '?').charAt(0).toUpperCase();
  const photoHtml = author.photo_url
    ? `<img src="${escapeHtml(author.photo_url)}" alt="${escapeHtml(author.canonical_name)}" class="author-card__photo" onerror="this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'" loading="lazy">`
    : `<div class="quote-headshot-placeholder">${initial}</div>`;

  const quotesHtml = quotes.slice(0, 4).map((q, i) => {
    const isQImp = _importantStatuses[`quote:${q.id}`] || false;
    return buildQuoteBlockHtml(q, isQImp, { showAvatar: false });
  }).join('');

  const isPersonImp = _importantStatuses[`person:${author.id}`] || false;

  return `
    <div class="author-card" data-track-type="person" data-track-id="${author.id}">
      <div class="author-card__header" onclick="navigateTo('/author/${author.id}')">
        ${photoHtml}
        <div class="author-card__info">
          <h2 class="author-card__name">${escapeHtml(author.canonical_name)}</h2>
          ${author.category_context ? `<span class="author-card__role">${escapeHtml(author.category_context)}</span>` : ''}
          <span class="author-card__stats">${author.quote_count} quotes</span>
        </div>
      </div>
      <div class="card-quotes-container">
        ${quotesHtml}
      </div>
      ${quotes.length > 0 ? `<a class="topic-card__see-all" onclick="navigateTo('/author/${author.id}')">See all ${author.quote_count} quotes by ${escapeHtml(author.canonical_name)} &rarr;</a>` : ''}
    </div>
  `;
}

/**
 * Sort quotes within a topic/source card by date or importance
 */
function sortCardQuotes(btn, cardId, sortBy) {
  // Update active button in this card's sort toggle
  const toggle = btn.closest('.card-sort-toggle');
  if (toggle) {
    toggle.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  const container = document.getElementById(`card-quotes-${cardId}`);
  if (!container) return;

  const quotes = Array.from(container.querySelectorAll('.quote-block'));
  quotes.sort((a, b) => {
    if (sortBy === 'importance') {
      return (parseInt(b.dataset.importance) || 0) - (parseInt(a.dataset.importance) || 0);
    }
    // Date sort: newest first
    return (b.dataset.createdAt || '').localeCompare(a.dataset.createdAt || '');
  });

  quotes.forEach(q => container.appendChild(q));
}

// ======= Trending Sources Tab =======

let _sourcesSortBy = 'date';

async function renderTrendingSourcesTab(container, sortBy) {
  _sourcesSortBy = sortBy || 'date';
  const sortParam = _sourcesSortBy === 'importance' ? '?sort=importance' : '';
  const data = await API.get('/analytics/trending-sources' + sortParam);
  const articles = data.articles || [];

  if (articles.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>No trending sources yet</h3><p>Sources will appear as articles are processed.</p></div>`;
    return;
  }

  await fetchImportantStatuses(articles.map(a => `article:${a.id}`));

  let html = `<div class="tab-sort-controls">
    Sort: <a class="sort-toggle-text ${_sourcesSortBy === 'date' ? 'active' : ''}" onclick="switchSourcesSort('date')">Date</a>
    <span class="sort-toggle-divider">|</span>
    <a class="sort-toggle-text ${_sourcesSortBy === 'importance' ? 'active' : ''}" onclick="switchSourcesSort('importance')">Importance</a>
  </div>`;
  for (const article of articles) {
    const isImp = _importantStatuses[`article:${article.id}`] || false;
    html += buildSourceCardHtml(article, isImp);
  }

  container.innerHTML = html;
}

function switchSourcesSort(sortBy) {
  const container = document.getElementById('homepage-tab-content');
  if (container) renderTrendingSourcesTab(container, sortBy);
}

function buildSourceCardHtml(article, isImportant) {
  const quotes = article.quotes || [];
  const _isAdm = typeof isAdmin !== 'undefined' && isAdmin;

  // First quote expanded, rest collapsed
  const firstQuoteHtml = quotes.length > 0
    ? buildQuoteBlockHtml(quotes[0], _importantStatuses[`quote:${quotes[0].id}`] || false)
    : '';

  const extraCount = quotes.length - 1;

  const dateStr = formatRelativeTime(article.published_at);

  // Admin: stats row
  const adminStatsHtml = _isAdm ? `
    <div class="admin-stats-row">
      <span>${article.view_count || 0} views</span>
      <span>${article.share_count || 0} shares</span>
      <span>${article.importants_count || 0} importants</span>
    </div>` : '';

  return `
    <div class="source-card" data-track-type="article" data-track-id="${article.id}">
      <div class="source-card__header">
        <h2 class="source-card__title" onclick="navigateTo('/article/${article.id}')">${escapeHtml(article.title || 'Untitled Source')}</h2>
        <div class="source-card__meta">
          ${article.source_name || article.source_domain ? `<span class="source-card__domain">${escapeHtml(article.source_name || article.source_domain)}</span>` : ''}
          ${dateStr ? `<time class="source-card__date">${dateStr}</time>` : ''}
        </div>
      </div>
      <div class="card-quotes-container" id="card-quotes-source-${article.id}">
        ${firstQuoteHtml}
      </div>
      ${extraCount > 0 ? `<button class="article-group-expander" onclick="expandSourceQuotes(this, ${article.id})">+${extraCount} more quote${extraCount !== 1 ? 's' : ''}</button>` : ''}
      <div class="source-card__extra-quotes" id="extra-quotes-source-${article.id}" style="display:none">
        ${quotes.slice(1).map(q => {
          const isQImp = _importantStatuses[`quote:${q.id}`] || false;
          return buildQuoteBlockHtml(q, isQImp, { showAvatar: false });
        }).join('')}
      </div>
      ${adminStatsHtml}
    </div>
  `;
}

function expandSourceQuotes(btn, articleId) {
  const container = document.getElementById(`extra-quotes-source-${articleId}`);
  if (container) {
    container.style.display = '';
    btn.style.display = 'none';
  }
}

// ======= Trending Quotes Tab =======

async function renderTrendingQuotesTab(container) {
  const data = await API.get('/analytics/trending-quotes');

  // Collect all quote IDs for important status batch fetch
  const allQuoteIds = [];
  if (data.quote_of_day) allQuoteIds.push(`quote:${data.quote_of_day.id}`);
  if (data.quote_of_week) allQuoteIds.push(`quote:${data.quote_of_week.id}`);
  if (data.quote_of_month) allQuoteIds.push(`quote:${data.quote_of_month.id}`);
  (data.recent_quotes || []).forEach(q => allQuoteIds.push(`quote:${q.id}`));
  await fetchImportantStatuses(allQuoteIds);

  let html = '';

  // Quote of the Day
  if (data.quote_of_day) {
    html += `<div class="trending-section-header"><hr class="topic-section-rule"><h2 class="trending-section-heading">QUOTE OF THE DAY</h2><hr class="topic-section-rule"></div>`;
    html += buildQuoteBlockHtml(data.quote_of_day, _importantStatuses[`quote:${data.quote_of_day.id}`] || false, { variant: 'hero' });
  }

  // Quote of the Week
  if (data.quote_of_week) {
    html += `<div class="trending-section-header"><hr class="topic-section-rule"><h2 class="trending-section-heading">QUOTE OF THE WEEK</h2><hr class="topic-section-rule"></div>`;
    html += buildQuoteBlockHtml(data.quote_of_week, _importantStatuses[`quote:${data.quote_of_week.id}`] || false, { variant: 'featured' });
  }

  // Quote of the Month
  if (data.quote_of_month) {
    html += `<div class="trending-section-header"><hr class="topic-section-rule"><h2 class="trending-section-heading">QUOTE OF THE MONTH</h2><hr class="topic-section-rule"></div>`;
    html += buildQuoteBlockHtml(data.quote_of_month, _importantStatuses[`quote:${data.quote_of_month.id}`] || false, { variant: 'featured' });
  }

  html += `<p class="trending-disclaimer"><em>*Trending quotes change over time as views and shares change</em></p>`;

  // Recent Quotes
  const recentQuotes = data.recent_quotes || [];
  if (recentQuotes.length > 0) {
    html += `<h2 class="trending-section-heading">Recent Quotes</h2>`;
    html += `<div class="trending-quotes__sort">
      Sort by: <button class="sort-btn active" data-sort="date" onclick="sortRecentQuotes('date')">Date</button>
      <button class="sort-btn" data-sort="importance" onclick="sortRecentQuotes('importance')">Importance</button>
    </div>`;
    html += `<div id="recent-quotes-list" class="quotes-grid">`;
    for (const q of recentQuotes) {
      html += buildQuoteBlockHtml(q, _importantStatuses[`quote:${q.id}`] || false);
    }
    html += `</div>`;
  }

  if (!data.quote_of_day && !data.quote_of_week && !data.quote_of_month && recentQuotes.length === 0) {
    html = `<div class="empty-state"><h3>No quotes yet</h3><p>Quotes will appear here as they are extracted from news articles.</p></div>`;
  }

  container.innerHTML = html;
}

async function sortRecentQuotes(sortBy) {
  // Update active sort button
  document.querySelectorAll('.trending-quotes__sort .sort-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === sortBy);
  });

  const sortParam = sortBy === 'importance' ? '&sort=importance' : '';
  const data = await API.get('/analytics/trending-quotes?limit=20' + sortParam);
  const recentQuotes = data.recent_quotes || [];
  const listEl = document.getElementById('recent-quotes-list');
  if (!listEl) return;

  let html = '';
  for (const q of recentQuotes) {
    html += buildQuoteBlockHtml(q, _importantStatuses[`quote:${q.id}`] || false);
  }
  listEl.innerHTML = html;
  initViewTracking();
}

// ======= All Tab =======

let _allSortBy = 'date';
let _allPage = 1;

function getDateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const articleDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (articleDay.getTime() === today.getTime()) return 'TODAY';
  if (articleDay.getTime() === yesterday.getTime()) return 'YESTERDAY';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
}

async function renderAllTab(container, page, sortBy) {
  _allPage = page || 1;
  _allSortBy = sortBy || 'date';

  const sortParam = _allSortBy === 'importance' ? '&sort=importance' : '';
  const data = await API.get(`/analytics/all-sources?page=${_allPage}&limit=20${sortParam}`);
  const articles = data.articles || [];

  let html = `<div class="all-tab__sort">
    Sort: <a class="sort-toggle-text ${_allSortBy === 'date' ? 'active' : ''}" onclick="switchAllSort('date')">Date</a>
    <span class="sort-toggle-divider">|</span>
    <a class="sort-toggle-text ${_allSortBy === 'importance' ? 'active' : ''}" onclick="switchAllSort('importance')">Importance</a>
  </div>`;

  if (articles.length === 0) {
    html += `<div class="empty-state"><h3>No sources yet</h3><p>Sources will appear here as articles are processed.</p></div>`;
  } else {
    await fetchImportantStatuses(articles.map(a => `article:${a.id}`));

    html += '<div class="quotes-grid">';
    let lastDateLabel = '';
    for (const article of articles) {
      // Date header grouping
      const dateLabel = getDateLabel(article.published_at);
      if (dateLabel && dateLabel !== lastDateLabel) {
        html += `<div class="date-header">${dateLabel}</div>`;
        lastDateLabel = dateLabel;
      }
      const isImp = _importantStatuses[`article:${article.id}`] || false;
      html += buildSourceCardHtml(article, isImp);
    }
    html += '</div>';

    // Pagination
    if (data.total > 20) {
      const totalPages = Math.ceil(data.total / 20);
      html += '<div class="pagination">';
      for (let i = 1; i <= Math.min(totalPages, 10); i++) {
        html += `<button class="page-btn ${i === _allPage ? 'active' : ''}" onclick="loadAllPage(${i})">${i}</button>`;
      }
      if (totalPages > 10) {
        html += `<span class="pagination-ellipsis">...</span>`;
        html += `<button class="page-btn" onclick="loadAllPage(${totalPages})">${totalPages}</button>`;
      }
      html += '</div>';
    }
  }

  container.innerHTML = html;
}

function switchAllSort(sortBy) {
  const container = document.getElementById('homepage-tab-content');
  if (container) renderAllTab(container, 1, sortBy);
}

function loadAllPage(page) {
  const container = document.getElementById('homepage-tab-content');
  if (container) renderAllTab(container, page, _allSortBy);
}

// ======= Important Status Batch Fetch =======

async function fetchImportantStatuses(entityKeys) {
  if (!entityKeys || entityKeys.length === 0) return;
  // Filter out already cached
  const uncached = entityKeys.filter(k => _importantStatuses[k] === undefined);
  if (uncached.length === 0) return;

  try {
    const res = await API.get('/importants/status?entities=' + encodeURIComponent(uncached.join(',')));
    if (res.statuses) {
      Object.assign(_importantStatuses, res.statuses);
    }
  } catch (err) {
    // Non-blocking
  }
}

// ======= Admin Functions =======

/**
 * Toggle quote visibility (admin PATCH call)
 */
async function toggleVisibility(event, quoteId, newVisible) {
  event.preventDefault();
  event.stopPropagation();
  try {
    await API.patch(`/quotes/${quoteId}/visibility`, { isVisible: newVisible });
    const entry = document.querySelector(`.quote-block[data-quote-id="${quoteId}"]`);
    if (entry) {
      const btn = entry.querySelector('.btn-visibility');
      if (btn) {
        btn.setAttribute('onclick', `toggleVisibility(event, ${quoteId}, ${!newVisible})`);
        btn.setAttribute('title', newVisible ? 'Hide' : 'Show');
        btn.innerHTML = newVisible
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
      }
    }
  } catch (err) {
    console.error('Failed to toggle visibility:', err);
  }
}

/**
 * Inline edit a quote (admin only)
 */
async function editQuoteInline(event, quoteId) {
  event.preventDefault();
  event.stopPropagation();
  const textEl = document.querySelector(`.quote-block[data-quote-id="${quoteId}"] .quote-block__text`);
  if (!textEl) return;

  const currentText = _quoteTexts[quoteId] || textEl.textContent.trim();
  const newText = prompt('Edit quote text:', currentText);
  if (newText === null || newText.trim() === '' || newText.trim() === currentText) return;

  try {
    await API.patch(`/quotes/${quoteId}`, { text: newText.trim() });
    _quoteTexts[quoteId] = newText.trim();
    textEl.textContent = newText.trim();
  } catch (err) {
    console.error('Failed to edit quote:', err);
  }
}

/**
 * Toggle between truncated and full quote text
 */
function toggleQuoteText(event, quoteId) {
  event.preventDefault();
  event.stopPropagation();
  const block = document.querySelector(`.quote-block[data-quote-id="${quoteId}"] .quote-block__text`);
  const toggle = event.target;
  const fullText = _quoteTexts[quoteId];
  if (!block || !fullText) return;

  if (toggle.textContent === 'show more') {
    // Replace only the text content, keep the toggle link
    const textNode = block.childNodes[0];
    if (textNode) textNode.textContent = fullText + ' ';
    toggle.textContent = 'show less';
  } else {
    const textNode = block.childNodes[0];
    if (textNode) textNode.textContent = fullText.substring(0, 280) + '... ';
    toggle.textContent = 'show more';
  }
}

// ======= Noteworthy Section =======

/**
 * Build the noteworthy section HTML (horizontal scroll on mobile, grid on desktop).
 */
function buildNoteworthySectionHtml(items) {
  let cardsHtml = '';

  for (const item of items) {
    if (item.entity_type === 'quote') {
      // Quote card — use buildQuoteBlockHtml if available
      if (typeof buildQuoteBlockHtml === 'function') {
        const quoteData = {
          id: item.entity_id,
          text: item.entity_label || '',
          context: '',
          person_name: item.person_name || '',
          person_id: '',
          photo_url: item.photo_url || '',
          importants_count: 0,
          quote_datetime: '',
          article_id: '',
          article_title: '',
          source_domain: '',
          source_name: '',
        };
        cardsHtml += `<div class="noteworthy-card">${buildQuoteBlockHtml(quoteData, false, { variant: 'compact', showAvatar: true, showSummary: false })}</div>`;
      } else {
        cardsHtml += `<div class="noteworthy-card noteworthy-card--quote" onclick="navigateTo('/quote/${item.entity_id}')">
          <p class="noteworthy-card__text">${escapeHtml((item.entity_label || '').substring(0, 120))}${(item.entity_label || '').length > 120 ? '...' : ''}</p>
          ${item.person_name ? `<span class="noteworthy-card__author">${escapeHtml(item.person_name)}</span>` : ''}
        </div>`;
      }
    } else if (item.entity_type === 'article') {
      cardsHtml += `<div class="noteworthy-card noteworthy-card--article" onclick="navigateTo('/article/${item.entity_id}')">
        <span class="noteworthy-card__type">Source</span>
        <p class="noteworthy-card__title">${escapeHtml(item.entity_label || 'Untitled')}</p>
      </div>`;
    } else if (item.entity_type === 'person') {
      cardsHtml += `<div class="noteworthy-card noteworthy-card--person" onclick="navigateTo('/author/${item.entity_id}')">
        <span class="noteworthy-card__type">Author</span>
        <p class="noteworthy-card__title">${escapeHtml(item.entity_label || 'Unknown Author')}</p>
      </div>`;
    } else if (item.entity_type === 'category') {
      cardsHtml += `<div class="noteworthy-card noteworthy-card--category">
        <span class="noteworthy-card__type">Category</span>
        <p class="noteworthy-card__title">${escapeHtml(item.entity_label || 'Unknown Category')}</p>
      </div>`;
    }
  }

  return `
    <div class="noteworthy-section">
      <h2 class="noteworthy-section__heading">Noteworthy</h2>
      <div class="noteworthy-section__scroll">
        ${cardsHtml}
      </div>
    </div>
  `;
}

// ======= Main Render Function =======

/**
 * Render the homepage with the 4-tab system
 */
async function renderHome() {
  const content = document.getElementById('content');

  // Check for search query
  const params = new URLSearchParams(window.location.search);
  const searchQuery = params.get('search') || '';

  if (searchQuery) {
    // If there's a search query, render search results instead of tabs
    await renderSearchResults(content, searchQuery);
    return;
  }

  // Fetch noteworthy items before rendering tabs
  let noteworthyHtml = '';
  try {
    const nwData = await API.get('/search/noteworthy?limit=10');
    if (nwData.items && nwData.items.length > 0) {
      noteworthyHtml = buildNoteworthySectionHtml(nwData.items);
    }
  } catch { /* noteworthy section is optional */ }

  // Update page metadata
  if (typeof updatePageMeta === 'function') {
    updatePageMeta(null, 'Track what public figures say with AI-powered quote extraction from news sources.', '/');
  }

  // Render noteworthy + tab bar with visually-hidden H1
  content.innerHTML = '<h1 class="sr-only">WhatTheySaid.News - Accountability Through Quotes</h1>' + noteworthyHtml + buildTabBarHtml(_activeTab);

  // Render active tab content
  await renderTabContent(_activeTab);

  // Restore scroll position if returning
  if (_pendingScrollRestore) {
    _pendingScrollRestore = false;
    requestAnimationFrame(() => {
      window.scrollTo(0, _homeScrollY);
    });
  }
}

/**
 * Render search results (preserves existing search functionality)
 */
let _searchActiveTab = 'persons';

async function renderSearchResults(content, searchQuery) {
  content.innerHTML = buildSkeletonHtml(6);

  const searchInput = document.getElementById('header-search-input');
  if (searchInput) searchInput.value = searchQuery;

  try {
    const data = await API.get('/search/unified?q=' + encodeURIComponent(searchQuery) + '&limit=20');

    const quotesCount = (data.quotes || []).length;
    const personsCount = (data.persons || []).length;
    const articlesCount = (data.articles || []).length;
    const totalCount = quotesCount + personsCount + articlesCount;

    let html = `<div class="search-results-header">
      <h2>Search results for "${escapeHtml(searchQuery)}"</h2>
      <button class="btn btn-secondary btn-sm" onclick="clearSearch()">Clear Search</button>
    </div>`;

    if (totalCount === 0) {
      html += `<div class="empty-state"><h3>No results found</h3></div>`;
    } else {
      // Tab bar
      html += `<div class="search-results-tabs">
        <button class="search-tab ${_searchActiveTab === 'persons' ? 'active' : ''}" onclick="switchSearchTab('persons')">Authors <span class="tab-count">${personsCount}</span></button>
        <button class="search-tab ${_searchActiveTab === 'quotes' ? 'active' : ''}" onclick="switchSearchTab('quotes')">Quotes <span class="tab-count">${quotesCount}</span></button>
        <button class="search-tab ${_searchActiveTab === 'articles' ? 'active' : ''}" onclick="switchSearchTab('articles')">Sources <span class="tab-count">${articlesCount}</span></button>
      </div>`;

      // Authors tab content
      html += `<div class="search-tab-content" id="search-tab-persons" style="display:${_searchActiveTab === 'persons' ? '' : 'none'}">`;
      if (personsCount === 0) {
        html += `<p class="empty-message">No authors match your search.</p>`;
      } else {
        for (const p of data.persons) {
          const initial = (p.canonical_name || '?').charAt(0).toUpperCase();
          const photoHtml = p.photo_url
            ? `<img src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.canonical_name)}" class="search-author__photo" onerror="this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'" loading="lazy">`
            : `<div class="quote-headshot-placeholder">${initial}</div>`;
          html += `<div class="search-author-row" onclick="navigateTo('/author/${p.id}')">
            ${photoHtml}
            <div class="search-author__info">
              <span class="search-author__name">${escapeHtml(p.canonical_name)}</span>
              ${p.category_context ? `<span class="search-author__desc">${escapeHtml(p.category_context)}</span>` : ''}
              <span class="search-author__stats">${p.quote_count || 0} quotes</span>
            </div>
          </div>`;
        }
      }
      html += `</div>`;

      // Quotes tab content
      html += `<div class="search-tab-content" id="search-tab-quotes" style="display:${_searchActiveTab === 'quotes' ? '' : 'none'}">`;
      if (quotesCount === 0) {
        html += `<p class="empty-message">No quotes match your search.</p>`;
      } else {
        for (const q of data.quotes) {
          html += buildQuoteBlockHtml(q, false);
        }
      }
      html += `</div>`;

      // Sources tab content
      html += `<div class="search-tab-content" id="search-tab-articles" style="display:${_searchActiveTab === 'articles' ? '' : 'none'}">`;
      if (articlesCount === 0) {
        html += `<p class="empty-message">No sources match your search.</p>`;
      } else {
        for (const a of data.articles) {
          html += `<div class="search-article-row" onclick="navigateTo('/article/${a.id}')">
            <span class="search-article__title">${escapeHtml(a.title || 'Untitled')}</span>
            <span class="search-article__meta">${escapeHtml(a.source_name || a.source_domain || '')} ${a.published_at ? formatRelativeTime(a.published_at) : ''}</span>
          </div>`;
        }
      }
      html += `</div>`;
    }

    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error searching</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function switchSearchTab(tabKey) {
  _searchActiveTab = tabKey;
  document.querySelectorAll('.search-tab').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase().startsWith(tabKey === 'persons' ? 'author' : tabKey));
  });
  document.querySelectorAll('.search-tab-content').forEach(el => {
    el.style.display = el.id === `search-tab-${tabKey}` ? '' : 'none';
  });
}

function clearSearch() {
  const searchInput = document.getElementById('header-search-input');
  if (searchInput) searchInput.value = '';
  window.history.pushState({}, '', '/');
  renderHome();
}

// ======= Socket.IO Handlers =======

/**
 * Handle new quotes from Socket.IO
 */
function handleNewQuotes(quotes) {
  if (window.location.pathname === '/' || window.location.pathname === '') {
    _pendingNewQuotes += (quotes ? quotes.length : 0);
    showNewQuotesBanner();
  }
}

function showNewQuotesBanner() {
  if (_pendingNewQuotes <= 0) return;

  let banner = document.getElementById('new-quotes-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'new-quotes-banner';
    banner.className = 'new-quotes-snackbar';
    const content = document.getElementById('content');
    if (content && content.firstChild) {
      content.insertBefore(banner, content.firstChild);
    }
  }

  const label = _pendingNewQuotes === 1 ? '1 new quote' : `${_pendingNewQuotes} new quotes`;
  banner.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> ${label}`;
  banner.style.display = '';
  banner.onclick = function() { loadNewQuotes(); };

  // Auto-dismiss after 10 seconds
  if (banner._autoDismiss) clearTimeout(banner._autoDismiss);
  banner._autoDismiss = setTimeout(() => {
    if (banner) banner.style.display = 'none';
  }, 10000);
}

function loadNewQuotes() {
  _pendingNewQuotes = 0;
  const banner = document.getElementById('new-quotes-banner');
  if (banner) banner.remove();
  _importantStatuses = {}; // Clear cache on refresh
  renderHome();
}

/**
 * Update the review badge count
 */
function updateReviewBadge(count) {
  const badge = document.getElementById('review-badge');
  if (badge) {
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  }
}
