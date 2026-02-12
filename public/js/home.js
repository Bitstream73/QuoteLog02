// Homepage - 4-Tab System (Trending Topics, Trending Sources, Trending Quotes, All)

// Store full quote texts for show more/less toggle
const _quoteTexts = {};

// Store quote metadata for sharing
const _quoteMeta = {};

// Current active tab
let _activeTab = 'trending-topics';

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
      </button>
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
function buildQuoteBlockHtml(q, topics, isImportant) {
  // Admin mode: use expanded admin quote block
  if (typeof isAdmin !== 'undefined' && isAdmin) {
    return buildAdminQuoteBlockHtml(q, topics, isImportant);
  }

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
    ? (_isAdm
      ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(personName)}" class="quote-block__headshot admin-headshot-clickable" onclick="adminChangeHeadshot(${personId}, '${_safeName}')" title="Click to change photo" style="cursor:pointer" onerror="this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'" loading="lazy">`
      : `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(personName)}" class="quote-block__headshot" onerror="this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'" loading="lazy">`)
    : (_isAdm
      ? `<a href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent((personName || '') + ' ' + (personCategoryContext || ''))}" target="_blank" rel="noopener" class="admin-headshot-search" title="Search Google Images"><div class="quote-headshot-placeholder">${initial}</div></a>`
      : `<div class="quote-headshot-placeholder">${initial}</div>`);

  // Admin buttons
  const visibilityBtn = _isAdm && typeof q.is_visible !== 'undefined'
    ? `<button class="btn-visibility" onclick="toggleVisibility(event, ${q.id}, ${q.is_visible === 0 ? 'true' : 'false'})" title="${q.is_visible === 0 ? 'Show' : 'Hide'}">${q.is_visible === 0
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
    }</button>`
    : '';

  const editBtn = _isAdm
    ? `<button class="btn-edit-quote" onclick="editQuoteInline(event, ${q.id})" title="Edit quote"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`
    : '';

  return `
    <div class="quote-block" data-quote-id="${q.id}" data-track-type="quote" data-track-id="${q.id}" data-created-at="${q.created_at || ''}" data-importance="${(importantsCount + shareCount + viewCount) || 0}" data-share-view="${(shareCount + viewCount) || 0}">
      <div class="quote-block__text" onclick="navigateTo('/author/${personId}')">
        <span class="quote-mark quote-mark--open">\u201C</span>${escapeHtml(truncatedText)}${isLong ? `<a href="#" class="show-more-toggle" onclick="toggleQuoteText(event, ${q.id})">show more</a>` : ''}<span class="quote-mark quote-mark--close">\u201D</span>
      </div>

      <div class="quote-block__author" onclick="navigateTo('/author/${personId}')">
        ${headshotHtml}
        <div class="quote-block__author-info">
          <span class="quote-block__author-name">${escapeHtml(personName)}</span>
          ${personCategoryContext ? `<span class="quote-block__author-desc">${escapeHtml(personCategoryContext)}</span>` : ''}
        </div>
      </div>

      ${context ? `<div class="quote-block__context" onclick="navigateTo('/article/${articleId}')">${escapeHtml(context)}</div>` : ''}

      ${quoteDateTime || viewCount > 0 || visibilityBtn || editBtn ? `<div class="quote-block__meta-row">
        ${quoteDateTime ? `<span class="quote-block__datetime">${formatDateTime(quoteDateTime)}</span>` : ''}
        ${viewCount > 0 ? `<span class="quote-block__views">${viewCount} views</span>` : ''}
        ${visibilityBtn}
        ${editBtn}
      </div>` : ''}

      <div class="quote-block__footer">
        <div class="quote-block__links">
          ${articleId ? `<a class="quote-block__source-link" onclick="navigateTo('/article/${articleId}')">${escapeHtml(sourceName || sourceDomain || 'Source')}</a>` : ''}
          ${(topics || []).slice(0, 2).map(t =>
            `<a class="quote-block__topic-tag" onclick="navigateTo('/topic/${t.slug}')">${escapeHtml(t.name)}</a>`
          ).join('')}
        </div>
        <div class="quote-block__share">
          ${buildShareButtonsHtml('quote', q.id, q.text, personName)}
          ${shareCount > 0 ? `<span class="quote-block__share-count">${shareCount}</span>` : ''}
          ${renderImportantButton('quote', q.id, importantsCount, isImportant)}
        </div>
      </div>
      ${typeof buildAdminActionsHtml === 'function' ? buildAdminActionsHtml(q) : ''}
    </div>
  `;
}

// ======= Admin Quote Block =======

/**
 * Build HTML for an admin quote block — expanded layout with inline editing
 */
function buildAdminQuoteBlockHtml(q, topics, isImportant) {
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

  // Author headshot
  const initial = (personName || '?').charAt(0).toUpperCase();
  const headshotHtml = photoUrl
    ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(personName)}" class="quote-block__headshot" onerror="this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'" loading="lazy">`
    : `<div class="quote-headshot-placeholder">${initial}</div>`;

  return `
    <div class="admin-quote-block quote-block" data-quote-id="${q.id}" data-track-type="quote" data-track-id="${q.id}" data-created-at="${q.created_at || ''}" data-importance="${(importantsCount + shareViewScore) || 0}" data-share-view="${shareViewScore}">

      <div class="quote-block__text" onclick="navigateTo('/author/${personId}')">
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
        ${(topics || []).slice(0, 2).map(t =>
          `<a class="quote-block__topic-tag" onclick="navigateTo('/topic/${t.slug}')">${escapeHtml(t.name)}</a>`
        ).join('')}
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
        <button onclick="adminEditQuoteTopics(${q.id})">Topics</button>
        <button onclick="navigateTo('/article/${articleId}')">Sources</button>
        <button onclick="adminEditAuthorFromQuote(${q.person_id || q.personId})">Author</button>
        <button onclick="adminChangeHeadshotFromQuote(${q.person_id || q.personId})">Photo</button>
      </div>

      <div class="admin-keywords-section" id="admin-keywords-${q.id}">
        <span class="admin-section-label">Keywords</span>
        <button class="admin-inline-btn" onclick="adminCreateKeyword(${q.id})">Create Keyword</button>
        <span>:</span>
        <div class="admin-chips" id="keyword-chips-${q.id}"></div>
      </div>

      <div class="admin-topics-section" id="admin-topics-${q.id}">
        <span class="admin-section-label">Topics</span>
        <button class="admin-inline-btn" onclick="adminCreateTopicForQuote(${q.id})">Create Topic</button>
        <span>:</span>
        <div class="admin-chips" id="topic-chips-${q.id}"></div>
      </div>
    </div>
  `;
}

// ======= Admin Quote Edit Functions =======

async function adminEditQuoteTopics(quoteId) {
  const name = prompt('Enter topic name to add to this quote:');
  if (name === null || name.trim() === '') return;
  try {
    await API.post(`/admin/quotes/${quoteId}/topics`, { name: name.trim() });
    showToast('Topic linked', 'success');
    loadQuoteKeywordsTopics(quoteId);
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

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

async function adminCreateKeyword(quoteId) {
  const name = prompt('Keyword name:');
  if (name === null || name.trim() === '') return;
  try {
    await API.post(`/admin/quotes/${quoteId}/keywords`, { name: name.trim() });
    showToast('Keyword created and linked', 'success');
    loadQuoteKeywordsTopics(quoteId);
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function adminCreateTopicForQuote(quoteId) {
  const name = prompt('Topic name:');
  if (name === null || name.trim() === '') return;
  try {
    await API.post(`/admin/quotes/${quoteId}/topics`, { name: name.trim() });
    showToast('Topic created and linked', 'success');
    loadQuoteKeywordsTopics(quoteId);
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function adminRemoveQuoteKeyword(quoteId, keywordId) {
  try {
    await API.delete(`/admin/quotes/${quoteId}/keywords/${keywordId}`);
    const chip = document.querySelector(`#keyword-chips-${quoteId} [data-keyword-id="${keywordId}"]`);
    if (chip) chip.remove();
    showToast('Keyword unlinked', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function adminRemoveQuoteTopic(quoteId, topicId) {
  try {
    await API.delete(`/admin/quotes/${quoteId}/topics/${topicId}`);
    const chip = document.querySelector(`#topic-chips-${quoteId} [data-topic-id="${topicId}"]`);
    if (chip) chip.remove();
    showToast('Topic unlinked', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// ======= Keyword/Topic Lazy Loading =======

async function loadQuoteKeywordsTopics(quoteId) {
  try {
    const data = await API.get(`/quotes/${quoteId}/keywords-topics`);
    renderKeywordChips(quoteId, data.keywords || []);
    renderTopicChips(quoteId, data.topics || []);
  } catch (err) {
    // Non-blocking
  }
}

function renderKeywordChips(quoteId, keywords) {
  const container = document.getElementById(`keyword-chips-${quoteId}`);
  if (!container) return;
  container.innerHTML = keywords.map(kw =>
    `<span class="keyword-chip" data-keyword-id="${kw.id}">
      ${escapeHtml(kw.name)}
      <button class="chip-remove" onclick="event.stopPropagation(); adminRemoveQuoteKeyword(${quoteId}, ${kw.id})">x</button>
    </span>`
  ).join('');
}

function renderTopicChips(quoteId, topics) {
  const container = document.getElementById(`topic-chips-${quoteId}`);
  if (!container) return;
  container.innerHTML = topics.map(t =>
    `<span class="topic-chip" data-topic-id="${t.id}" onclick="navigateTo('/topic/${escapeHtml(t.slug)}')">
      ${escapeHtml(t.name)}
      <button class="chip-remove" onclick="event.stopPropagation(); adminRemoveQuoteTopic(${quoteId}, ${t.id})">x</button>
    </span>`
  ).join('');
}

/**
 * Trigger lazy loading of keywords/topics for all admin quote blocks on the page
 */
function initAdminQuoteBlocks() {
  document.querySelectorAll('.admin-quote-block').forEach(block => {
    const quoteId = block.dataset.quoteId;
    if (quoteId && !block.dataset.adminLoaded) {
      block.dataset.adminLoaded = 'true';
      setTimeout(() => loadQuoteKeywordsTopics(parseInt(quoteId)), 0);
    }
  });
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
    { key: 'trending-topics', label: 'Trending Topics' },
    { key: 'trending-sources', label: 'Trending Sources' },
    { key: 'trending-quotes', label: 'Trending Quotes' },
    { key: 'all', label: 'All' },
  ];

  return `
    <div class="homepage-tabs">
      ${tabs.map(t => `<button class="homepage-tab ${t.key === activeTab ? 'active' : ''}" data-tab="${t.key}" onclick="switchHomepageTab('${t.key}')">${t.label}</button>`).join('')}
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
      case 'trending-topics':
        await renderTrendingTopicsTab(container);
        break;
      case 'trending-sources':
        await renderTrendingSourcesTab(container);
        break;
      case 'trending-quotes':
        await renderTrendingQuotesTab(container);
        break;
      case 'all':
        await renderAllTab(container);
        break;
    }
    // Initialize view tracking for newly rendered content
    initViewTracking();
    // Lazy-load keywords/topics for admin quote blocks
    if (typeof isAdmin !== 'undefined' && isAdmin) {
      initAdminQuoteBlocks();
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error loading content</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

// ======= Trending Topics Tab =======

async function renderTrendingTopicsTab(container) {
  const data = await API.get('/analytics/trending-topics');
  const topics = data.topics || [];

  if (topics.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>No trending topics yet</h3><p>Topics will appear as quotes are extracted and categorized.</p></div>`;
    return;
  }

  // Fetch important statuses for all topics
  await fetchImportantStatuses(topics.map(t => `topic:${t.id}`));

  let html = '';
  for (const topic of topics) {
    const isImp = _importantStatuses[`topic:${topic.id}`] || false;
    html += buildTopicCardHtml(topic, isImp);
  }

  container.innerHTML = html;
}

function buildTopicCardHtml(topic, isImportant) {
  const quotes = topic.quotes || [];

  // Fetch important statuses for quotes
  const quoteKeys = quotes.map(q => `quote:${q.id}`);
  // These will be fetched in batch, use cached values
  const quotesHtml = quotes.map(q => {
    const isQImp = _importantStatuses[`quote:${q.id}`] || false;
    return buildQuoteBlockHtml(q, q.topics || [], isQImp);
  }).join('');

  return `
    <div class="topic-card" data-track-type="topic" data-track-id="${topic.id}">
      <h2 class="topic-card__name" onclick="navigateTo('/topic/${escapeHtml(topic.slug)}')">${escapeHtml(topic.name)}</h2>
      ${topic.context ? `<p class="topic-card__context">${escapeHtml(topic.context)}</p>` : ''}
      <div class="card-sort-toggle" data-card-id="topic-${topic.id}">
        Sort by: <button class="sort-btn active" onclick="sortCardQuotes(this, 'topic-${topic.id}', 'date')">Date</button>
        <button class="sort-btn" onclick="sortCardQuotes(this, 'topic-${topic.id}', 'importance')">Importance</button>
      </div>
      <div class="card-quotes-container" id="card-quotes-topic-${topic.id}">
        ${quotesHtml}
      </div>
      <div class="topic-card__actions">
        <a class="topic-card__see-more" onclick="navigateTo('/topic/${escapeHtml(topic.slug)}')">See More</a>
        ${renderImportantButton('topic', topic.id, topic.importants_count || 0, isImportant)}
        ${buildShareButtonsHtml('topic', topic.id, topic.name, '')}
      </div>
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

async function renderTrendingSourcesTab(container) {
  const data = await API.get('/analytics/trending-sources');
  const articles = data.articles || [];

  if (articles.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>No trending sources yet</h3><p>Sources will appear as articles are processed.</p></div>`;
    return;
  }

  await fetchImportantStatuses(articles.map(a => `article:${a.id}`));

  let html = '';
  for (const article of articles) {
    const isImp = _importantStatuses[`article:${article.id}`] || false;
    html += buildSourceCardHtml(article, isImp);
  }

  container.innerHTML = html;
}

function buildSourceCardHtml(article, isImportant) {
  const quotes = article.quotes || [];
  const quotesHtml = quotes.map(q => {
    const isQImp = _importantStatuses[`quote:${q.id}`] || false;
    return buildQuoteBlockHtml(q, q.topics || [], isQImp);
  }).join('');

  const dateStr = formatRelativeTime(article.published_at);

  return `
    <div class="source-card" data-track-type="article" data-track-id="${article.id}">
      <div class="source-card__header">
        <h2 class="source-card__title" onclick="navigateTo('/article/${article.id}')">${escapeHtml(article.title || 'Untitled Source')}</h2>
        <div class="source-card__meta">
          ${article.source_name || article.source_domain ? `<span class="source-card__domain">${escapeHtml(article.source_name || article.source_domain)}</span>` : ''}
          ${dateStr ? `<time class="source-card__date">${dateStr}</time>` : ''}
        </div>
      </div>
      <div class="card-sort-toggle" data-card-id="source-${article.id}">
        Sort by: <button class="sort-btn active" onclick="sortCardQuotes(this, 'source-${article.id}', 'date')">Date</button>
        <button class="sort-btn" onclick="sortCardQuotes(this, 'source-${article.id}', 'importance')">Importance</button>
      </div>
      <div class="card-quotes-container" id="card-quotes-source-${article.id}">
        ${quotesHtml}
      </div>
      <div class="source-card__actions">
        <a class="source-card__see-more" onclick="navigateTo('/article/${article.id}')">See More</a>
        ${renderImportantButton('article', article.id, article.importants_count || 0, isImportant)}
        ${buildShareButtonsHtml('article', article.id, article.title, '')}
      </div>
    </div>
  `;
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
    html += `<h2 class="trending-section-heading">Quote of the Day</h2>`;
    html += buildQuoteBlockHtml(data.quote_of_day, data.quote_of_day.topics || [], _importantStatuses[`quote:${data.quote_of_day.id}`] || false);
  }

  // Quote of the Week
  if (data.quote_of_week) {
    html += `<h2 class="trending-section-heading">Quote of the Week</h2>`;
    html += buildQuoteBlockHtml(data.quote_of_week, data.quote_of_week.topics || [], _importantStatuses[`quote:${data.quote_of_week.id}`] || false);
  }

  // Quote of the Month
  if (data.quote_of_month) {
    html += `<h2 class="trending-section-heading">Quote of the Month</h2>`;
    html += buildQuoteBlockHtml(data.quote_of_month, data.quote_of_month.topics || [], _importantStatuses[`quote:${data.quote_of_month.id}`] || false);
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
    html += `<div id="recent-quotes-list">`;
    for (const q of recentQuotes) {
      html += buildQuoteBlockHtml(q, q.topics || [], _importantStatuses[`quote:${q.id}`] || false);
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
    html += buildQuoteBlockHtml(q, q.topics || [], _importantStatuses[`quote:${q.id}`] || false);
  }
  listEl.innerHTML = html;
  initViewTracking();
  if (typeof isAdmin !== 'undefined' && isAdmin) initAdminQuoteBlocks();
}

// ======= All Tab =======

let _allSortBy = 'date';
let _allPage = 1;

async function renderAllTab(container, page, sortBy) {
  _allPage = page || 1;
  _allSortBy = sortBy || 'date';

  const sortParam = _allSortBy === 'importance' ? '&sort=importance' : '';
  const data = await API.get(`/analytics/all-sources?page=${_allPage}&limit=20${sortParam}`);
  const articles = data.articles || [];

  let html = `<div class="all-tab__sort">
    Sort by: <button class="sort-btn ${_allSortBy === 'date' ? 'active' : ''}" data-sort="date" onclick="switchAllSort('date')">Date</button>
    <button class="sort-btn ${_allSortBy === 'importance' ? 'active' : ''}" data-sort="importance" onclick="switchAllSort('importance')">Importance</button>
  </div>`;

  if (articles.length === 0) {
    html += `<div class="empty-state"><h3>No sources yet</h3><p>Sources will appear here as articles are processed.</p></div>`;
  } else {
    await fetchImportantStatuses(articles.map(a => `article:${a.id}`));

    for (const article of articles) {
      const isImp = _importantStatuses[`article:${article.id}`] || false;
      html += buildSourceCardHtml(article, isImp);
    }

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

  // Render tab bar
  content.innerHTML = buildTabBarHtml(_activeTab);

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
async function renderSearchResults(content, searchQuery) {
  content.innerHTML = buildSkeletonHtml(6);

  const searchInput = document.getElementById('header-search-input');
  if (searchInput) searchInput.value = searchQuery;

  try {
    const searchParams = new URLSearchParams({ q: searchQuery, page: '1', limit: '50' });
    const quotesData = await API.get('/quotes/search?' + searchParams.toString());

    let html = `<div class="search-results-header">
      <h2>Search results for "${escapeHtml(searchQuery)}"${quotesData.searchMethod === 'semantic' ? ' (semantic)' : ''}</h2>
      <button class="btn btn-secondary btn-sm" onclick="clearSearch()">Clear Search</button>
    </div>`;

    if (quotesData.quotes.length === 0) {
      html += `<div class="empty-state"><h3>No results found</h3></div>`;
    } else {
      html += `<p class="quote-count">${quotesData.total} quotes found</p>`;
      for (const q of quotesData.quotes) {
        html += buildQuoteBlockHtml(q, q.topics || [], false);
      }
    }

    content.innerHTML = html;
    if (typeof isAdmin !== 'undefined' && isAdmin) initAdminQuoteBlocks();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error searching</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
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
    banner.className = 'new-quotes-banner';
    const content = document.getElementById('content');
    if (content && content.firstChild) {
      content.insertBefore(banner, content.firstChild);
    }
  }

  const label = _pendingNewQuotes === 1 ? '1 new quote' : `${_pendingNewQuotes} new quotes`;
  banner.innerHTML = `${label} available <button class="new-quotes-refresh-btn" onclick="loadNewQuotes()">Refresh</button>`;
  banner.style.display = '';
}

function loadNewQuotes() {
  _pendingNewQuotes = 0;
  const banner = document.getElementById('new-quotes-banner');
  if (banner) banner.remove();
  _importantStatuses = {}; // Clear cache on refresh
  renderHome();
}

// ======= Topic Page =======

/**
 * Render a full topic page at /topic/:slug
 */
async function renderTopicPage(slug) {
  const content = document.getElementById('content');
  content.innerHTML = buildSkeletonHtml(4);

  try {
    const data = await API.get(`/topics/${slug}`);
    if (!data.topic) {
      content.innerHTML = '<div class="empty-state"><h3>Topic not found</h3><p><a href="/" onclick="navigate(event, \'/\')" style="color:var(--accent)">Back to home</a></p></div>';
      return;
    }

    const topic = data.topic;
    const quotes = data.quotes || [];

    // Fetch important statuses
    const entityKeys = [`topic:${topic.id}`, ...quotes.map(q => `quote:${q.id}`)];
    await fetchImportantStatuses(entityKeys);

    const isTopicImportant = _importantStatuses[`topic:${topic.id}`] || false;

    let html = `
      <div class="topic-page">
        <p style="margin-bottom:1rem;font-family:var(--font-ui);font-size:0.85rem">
          <a href="/" onclick="navigate(event, '/')" style="color:var(--accent);text-decoration:none">&larr; Back to home</a>
        </p>
        <h1>${escapeHtml(topic.name)}</h1>
        ${topic.description ? `<p class="topic-page__description">${escapeHtml(topic.description)}</p>` : ''}
        ${topic.context ? `<p class="topic-page__description">${escapeHtml(topic.context)}</p>` : ''}
        <div class="topic-page__actions">
          ${renderImportantButton('topic', topic.id, topic.importants_count || 0, isTopicImportant)}
          ${buildShareButtonsHtml('topic', topic.id, topic.name, '')}
        </div>
    `;

    if (quotes.length === 0) {
      html += '<div class="empty-state"><h3>No quotes in this topic yet</h3></div>';
    } else {
      html += `<p class="quote-count">${data.total || quotes.length} quotes</p>`;
      for (const q of quotes) {
        const isQImp = _importantStatuses[`quote:${q.id}`] || false;
        html += buildQuoteBlockHtml(q, q.topics || [], isQImp);
      }

      // Pagination
      const total = data.total || quotes.length;
      const limit = data.limit || 20;
      const page = data.page || 1;
      const totalPages = Math.ceil(total / limit);
      if (totalPages > 1) {
        html += '<div class="pagination">';
        for (let i = 1; i <= Math.min(totalPages, 10); i++) {
          html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="loadTopicPage('${escapeHtml(slug)}', ${i})">${i}</button>`;
        }
        html += '</div>';
      }
    }

    html += '</div>';
    content.innerHTML = html;
    initViewTracking();
    if (typeof isAdmin !== 'undefined' && isAdmin) initAdminQuoteBlocks();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function loadTopicPage(slug, page) {
  const content = document.getElementById('content');
  content.innerHTML = buildSkeletonHtml(4);
  try {
    const data = await API.get(`/topics/${slug}?page=${page}`);
    // Re-render the full page
    renderTopicPage(slug);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
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
