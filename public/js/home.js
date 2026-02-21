// Homepage - Tab System (Trending Quotes, Trending Authors, Trending Sources)

// Store full quote texts for show more/less toggle
const _quoteTexts = {};

// Store quote metadata for sharing
const _quoteMeta = {};

// Current active tab
let _activeTab = 'trending-authors';

// Per-tab state: sort, page, search, hasMore
let _quotesSortBy = 'date';
let _quotesPage = 1;
let _quotesSearch = '';
let _quotesHasMore = true;

let _authorsPage = 1;
let _authorsSearch = '';
let _authorsHasMore = true;

let _sourcesPage = 1;
let _sourcesSearch = '';
let _sourcesHasMore = true;

let _isLoadingMore = false;
let _infiniteScrollObserver = null;
let _tabSearchDebounceTimer = null;

// ======= Verdict Badge =======

const VERDICT_COLORS = {
  TRUE: 'var(--success)', MOSTLY_TRUE: 'var(--success)',
  FALSE: 'var(--error)', MOSTLY_FALSE: 'var(--error)',
  MISLEADING: 'var(--warning)', LACKS_CONTEXT: 'var(--warning)',
  UNVERIFIABLE: 'var(--info)',
  OPINION: 'var(--text-muted)',
  FRAGMENT: 'var(--text-muted)',
};
const VERDICT_LABELS = {
  TRUE: '\u2713 True', MOSTLY_TRUE: '\u2248 Mostly True',
  FALSE: '\u2717 False', MOSTLY_FALSE: '\u2248 Mostly False',
  MISLEADING: '\u26A0 Misleading', LACKS_CONTEXT: '\u26A0 Lacks Context',
  UNVERIFIABLE: '? Unverifiable',
  OPINION: '\uD83D\uDCAC Opinion',
  FRAGMENT: '\u2014 Fragment',
};

function buildVerdictBadgeHtml(quoteId, verdict) {
  if (verdict && VERDICT_LABELS[verdict]) {
    const color = VERDICT_COLORS[verdict] || 'var(--text-muted)';
    return `<span class="wts-verdict-badge" style="background:${color}" onclick="event.stopPropagation(); navigateTo('/quote/${quoteId}')">${VERDICT_LABELS[verdict]}</span>`;
  }
  return `<button class="wts-verdict-badge wts-verdict-badge--pending" onclick="event.stopPropagation(); runInlineFactCheck(${quoteId}, this)">Run Fact Check</button>`;
}

async function runInlineFactCheck(quoteId, btn) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'One sec..';

  const meta = _quoteMeta[quoteId];
  if (!meta || !meta.text) {
    btn.disabled = false;
    btn.textContent = 'Run Fact Check';
    showToast('Quote data not available', 'error');
    return;
  }

  try {
    const result = await API.post('/fact-check/check', {
      quoteId,
      quoteText: meta.text,
      authorName: meta.personName || '',
      authorDescription: meta.personCategoryContext || '',
      context: meta.context || '',
    });

    // Async 202 — result will arrive via Socket.IO
    if (result.queued) {
      btn.textContent = result.position > 0 ? `Queued (#${result.position})...` : 'Checking...';
      btn.dataset.pendingQuoteId = quoteId;
      return;
    }

    const verdict = result.verdict || result.factCheck?.verdict;
    if (verdict && VERDICT_LABELS[verdict]) {
      const color = VERDICT_COLORS[verdict] || 'var(--text-muted)';
      const badge = document.createElement('span');
      badge.className = 'wts-verdict-badge';
      badge.style.background = color;
      badge.textContent = VERDICT_LABELS[verdict];
      badge.onclick = function(e) { e.stopPropagation(); navigateTo('/quote/' + quoteId); };
      btn.replaceWith(badge);
    } else {
      btn.disabled = false;
      btn.textContent = 'Run Fact Check';
      showToast('No verdict returned', 'info');
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Run Fact Check';
    showToast('Fact check failed: ' + (err.message || 'Unknown error'), 'error');
  }
}

function handleFactCheckError(data) {
  const { quoteId, error } = data;
  if (!quoteId) return;

  // Re-enable any pending inline buttons for this quote
  document.querySelectorAll(`button.wts-verdict-badge--pending[data-pending-quote-id="${quoteId}"]`).forEach(btn => {
    btn.disabled = false;
    btn.textContent = 'Run Fact Check';
    delete btn.dataset.pendingQuoteId;
  });

  showToast('Fact check failed: ' + (error || 'Unknown error'), 'error');
}

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

  // Block sharing while fact-check is in progress
  if (entityType === 'quote' && typeof _factCheckInProgress !== 'undefined' && _factCheckInProgress) {
    showToast("It'll just be a sec. We're fact checking this quote for the first time...", 'info');
    return;
  }

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
      const subject = encodeURIComponent(`Quote from ${authorName} - TrueOrFalse.News`);
      const imageUrl = entityType === 'quote' ? `${window.location.origin}/api/quotes/${entityId}/share-image?orientation=landscape` : '';
      const bodyParts = [fullText, '', `Read more: ${url}`];
      if (imageUrl) bodyParts.push(`View quote image: ${imageUrl}`);
      bodyParts.push('', '---', 'Shared from TrueOrFalse.News');
      const body = encodeURIComponent(bodyParts.join('\n'));
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
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

  // Block download while fact-check is in progress
  if (typeof _factCheckInProgress !== 'undefined' && _factCheckInProgress) {
    showToast("It'll just be a sec. We're fact checking this quote for the first time...", 'info');
    return;
  }

  const btn = event.currentTarget;
  btn.classList.add('share-btn--loading');

  try {
    // Try native share with image on supported platforms (mobile)
    if (navigator.share && navigator.canShare) {
      const res = await fetch(`/api/quotes/${quoteId}/share-image?format=portrait&t=${Date.now()}`);
      if (!res.ok) throw new Error('Failed to fetch image');
      const blob = await res.blob();
      const file = new File([blob], `trueorfalse-quote-${quoteId}.jpg`, { type: 'image/jpeg' });

      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Quote from TrueOrFalse.News',
          url: window.location.origin + '/quote/' + quoteId,
        });
        btn.classList.remove('share-btn--loading');
        return;
      }
    }

    // Fallback: download the image
    const res = await fetch(`/api/quotes/${quoteId}/share-image?format=portrait&t=${Date.now()}`);
    if (!res.ok) throw new Error('Failed to fetch image');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trueorfalse-quote-${quoteId}.jpg`;
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
    ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(personName)}" class="quote-block__headshot" onerror="if(!this.dataset.retry){this.dataset.retry='1';this.src=this.src}else{this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'}" loading="lazy">`
    : `<div class="quote-headshot-placeholder">${initial}</div>`;

  // Share buttons + important
  const shareButtons = buildShareButtonsHtml('quote', q.id, q.text, personName);
  const importantButton = renderImportantButton('quote', q.id, importantsCount, isImportant);

  const variantClass = variant !== 'default' ? ' quote-block--' + variant : '';
  const verdict = q.fact_check_verdict || q.factCheckVerdict || null;

  return `
    <div class="quote-block${variantClass}" data-quote-id="${q.id}" data-track-type="quote" data-track-id="${q.id}" data-created-at="${quoteDateTime || q.created_at || ''}" data-importance="${(importantsCount + shareCount + viewCount) || 0}" data-share-view="${(shareCount + viewCount) || 0}">
      ${buildVerdictBadgeHtml(q.id, verdict)}
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
    ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(personName)}" class="quote-block__headshot admin-headshot-clickable" onclick="adminChangeHeadshot(${personId}, '${_safeName}')" title="Click to change photo" style="cursor:pointer" onerror="if(!this.dataset.retry){this.dataset.retry='1';this.src=this.src}else{this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'}" loading="lazy">`
    : `<div class="quote-headshot-placeholder admin-headshot-clickable" onclick="adminChangeHeadshot(${personId}, '${_safeName}')" title="Click to find photo" style="cursor:pointer">${initial}</div>`;

  const verdict = q.fact_check_verdict || q.factCheckVerdict || null;

  return `
    <div class="admin-quote-block quote-block" data-quote-id="${q.id}" data-track-type="quote" data-track-id="${q.id}" data-created-at="${q.created_at || ''}" data-importance="${(importantsCount + shareViewScore) || 0}" data-share-view="${shareViewScore}">

      ${buildVerdictBadgeHtml(q.id, verdict)}
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
        <button onclick="adminChangeHeadshot(${q.person_id || q.personId}, '${_safeName}')">Photo</button>
        <button onclick="adminDeleteQuote(${q.id}, function(){ location.reload(); }, this)" title="Delete quote" style="color:var(--danger,#dc2626)">Delete</button>
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

// ======= Tab Search + Sort Bar =======

function getTabSearchState(tabKey) {
  if (tabKey === 'trending-quotes') return { search: _quotesSearch, sort: _quotesSortBy };
  if (tabKey === 'trending-authors') return { search: _authorsSearch, sort: _authorsSortBy };
  if (tabKey === 'trending-sources') return { search: _sourcesSearch, sort: _sourcesSortBy };
  return { search: '', sort: 'date' };
}

function buildSearchSortBarHtml(tabKey) {
  const state = getTabSearchState(tabKey);
  const isExpanded = state.search.length > 0;
  const sortFn = tabKey === 'trending-quotes' ? 'switchQuotesSort'
    : tabKey === 'trending-authors' ? 'switchAuthorsSort' : 'switchSourcesSort';

  const searchIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`;

  if (isExpanded) {
    return `<div class="tab-search-sort-bar">
      <div class="tab-search-input-wrap">
        <input type="search" class="tab-search-input" id="tab-search-input" placeholder="Search..." value="${escapeHtml(state.search)}" onkeydown="onTabSearchKeydown(event)" oninput="onTabSearchInput()">
        <button class="tab-search-close" onclick="clearTabSearch()">&times;</button>
      </div>
    </div>`;
  }

  return `<div class="tab-search-sort-bar">
    <button class="tab-search-toggle" onclick="toggleTabSearch()" title="Search">${searchIcon}</button>
    <div class="tab-sort-buttons">
      Sort by:
      <button class="sort-btn ${state.sort === 'date' ? 'active' : ''}" onclick="${sortFn}('date')">Date</button>
      <button class="sort-btn ${state.sort === 'importance' ? 'active' : ''}" onclick="${sortFn}('importance')">Importance</button>
    </div>
  </div>`;
}

function toggleTabSearch() {
  // Store current sort/search state and show search input
  const tabKey = _activeTab;
  // Set a temporary flag so buildSearchSortBarHtml shows expanded mode
  if (tabKey === 'trending-quotes') _quotesSearch = ' ';
  else if (tabKey === 'trending-authors') _authorsSearch = ' ';
  else if (tabKey === 'trending-sources') _sourcesSearch = ' ';

  // Re-render just the search bar
  const bar = document.querySelector('.tab-search-sort-bar');
  if (bar) {
    const temp = document.createElement('div');
    temp.innerHTML = buildSearchSortBarHtml(tabKey);
    bar.replaceWith(temp.firstElementChild);
    const input = document.getElementById('tab-search-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    // Reset the search state back to empty (we just want the UI expanded)
    if (tabKey === 'trending-quotes') _quotesSearch = '';
    else if (tabKey === 'trending-authors') _authorsSearch = '';
    else if (tabKey === 'trending-sources') _sourcesSearch = '';
  }
}

function onTabSearchKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    clearTimeout(_tabSearchDebounceTimer);
    executeTabSearch();
  } else if (event.key === 'Escape') {
    clearTabSearch();
  }
}

function onTabSearchInput() {
  clearTimeout(_tabSearchDebounceTimer);
  _tabSearchDebounceTimer = setTimeout(() => executeTabSearch(), 300);
}

function executeTabSearch() {
  const input = document.getElementById('tab-search-input');
  const val = input ? input.value.trim() : '';
  const tabKey = _activeTab;

  if (tabKey === 'trending-quotes') { _quotesSearch = val; _quotesPage = 1; }
  else if (tabKey === 'trending-authors') { _authorsSearch = val; _authorsPage = 1; }
  else if (tabKey === 'trending-sources') { _sourcesSearch = val; _sourcesPage = 1; }

  renderTabContent(tabKey);
}

function clearTabSearch() {
  const tabKey = _activeTab;
  if (tabKey === 'trending-quotes') { _quotesSearch = ''; _quotesPage = 1; }
  else if (tabKey === 'trending-authors') { _authorsSearch = ''; _authorsPage = 1; }
  else if (tabKey === 'trending-sources') { _sourcesSearch = ''; _sourcesPage = 1; }

  renderTabContent(tabKey);
}

// ======= Infinite Scroll =======

function setupInfiniteScroll() {
  if (_infiniteScrollObserver) {
    _infiniteScrollObserver.disconnect();
    _infiniteScrollObserver = null;
  }

  const sentinel = document.getElementById('infinite-scroll-sentinel');
  if (!sentinel) return;

  // Check if current tab has more items
  const tabKey = _activeTab;
  let hasMore = false;
  if (tabKey === 'trending-quotes') hasMore = _quotesHasMore;
  else if (tabKey === 'trending-authors') hasMore = _authorsHasMore;
  else if (tabKey === 'trending-sources') hasMore = _sourcesHasMore;

  if (!hasMore) {
    sentinel.innerHTML = '';
    return;
  }

  sentinel.innerHTML = '<div class="infinite-scroll-loading" style="visibility:hidden">Loading more...</div>';

  _infiniteScrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      loadMoreItems();
    }
  }, { rootMargin: '200px' });

  _infiniteScrollObserver.observe(sentinel);
}

async function loadMoreItems() {
  if (_isLoadingMore) return;
  _isLoadingMore = true;

  const sentinel = document.getElementById('infinite-scroll-sentinel');
  if (sentinel) sentinel.innerHTML = '<div class="infinite-scroll-loading">Loading more...</div>';

  try {
    const tabKey = _activeTab;
    if (tabKey === 'trending-quotes') await loadMoreQuotes();
    else if (tabKey === 'trending-authors') await loadMoreAuthors();
    else if (tabKey === 'trending-sources') await loadMoreSources();
  } finally {
    _isLoadingMore = false;
  }
}

async function loadMoreQuotes() {
  _quotesPage++;
  const searchParam = _quotesSearch.length >= 2 ? `&search=${encodeURIComponent(_quotesSearch)}` : '';
  const sortParam = _quotesSortBy === 'importance' ? '&sort=importance' : '';
  const data = await API.get(`/analytics/trending-quotes?page=${_quotesPage}&limit=20${sortParam}${searchParam}`);

  if (_activeTab !== 'trending-quotes') return; // Tab changed during fetch

  const recentQuotes = data.recent_quotes || [];
  _quotesHasMore = recentQuotes.length >= 20 && (_quotesPage * 20) < data.total;

  if (recentQuotes.length > 0) {
    const entityKeys = recentQuotes.map(q => `quote:${q.id}`);
    await fetchImportantStatuses(entityKeys);

    let html = '';
    for (const q of recentQuotes) {
      html += buildQuoteBlockHtml(q, _importantStatuses[`quote:${q.id}`] || false);
    }
    const list = document.getElementById('tab-items-list');
    if (list) list.insertAdjacentHTML('beforeend', html);
    initViewTracking();
  }

  updateSentinel();
}

async function loadMoreAuthors() {
  _authorsPage++;
  const searchParam = _authorsSearch.length >= 2 ? `&search=${encodeURIComponent(_authorsSearch)}` : '';
  const sortParam = _authorsSortBy === 'importance' ? '&sort=importance' : '';
  const data = await API.get(`/analytics/trending-authors?page=${_authorsPage}&limit=20${sortParam}${searchParam}`);

  if (_activeTab !== 'trending-authors') return;

  const authors = data.authors || [];
  _authorsHasMore = authors.length >= 20 && (_authorsPage * 20) < data.total;

  if (authors.length > 0) {
    const entityKeys = authors.map(a => `person:${a.id}`);
    await fetchImportantStatuses(entityKeys);

    let html = '';
    for (const author of authors) {
      html += buildAuthorCardHtml(author);
    }
    const list = document.getElementById('tab-items-list');
    if (list) list.insertAdjacentHTML('beforeend', html);
    initViewTracking();
  }

  updateSentinel();
}

async function loadMoreSources() {
  _sourcesPage++;
  const searchParam = _sourcesSearch.length >= 2 ? `&search=${encodeURIComponent(_sourcesSearch)}` : '';
  const sortParam = _sourcesSortBy === 'importance' ? '&sort=importance' : '';
  const data = await API.get(`/analytics/trending-sources?page=${_sourcesPage}&limit=20${sortParam}${searchParam}`);

  if (_activeTab !== 'trending-sources') return;

  const articles = data.articles || [];
  _sourcesHasMore = articles.length >= 20 && (_sourcesPage * 20) < data.total;

  if (articles.length > 0) {
    await fetchImportantStatuses(articles.map(a => `article:${a.id}`));

    let html = '';
    for (const article of articles) {
      const isImp = _importantStatuses[`article:${article.id}`] || false;
      html += buildSourceCardHtml(article, isImp);
    }
    const list = document.getElementById('tab-items-list');
    if (list) list.insertAdjacentHTML('beforeend', html);
    initViewTracking();
  }

  updateSentinel();
}

function updateSentinel() {
  const tabKey = _activeTab;
  let hasMore = false;
  if (tabKey === 'trending-quotes') hasMore = _quotesHasMore;
  else if (tabKey === 'trending-authors') hasMore = _authorsHasMore;
  else if (tabKey === 'trending-sources') hasMore = _sourcesHasMore;

  const sentinel = document.getElementById('infinite-scroll-sentinel');
  if (!hasMore && sentinel) {
    sentinel.innerHTML = '';
    if (_infiniteScrollObserver) {
      _infiniteScrollObserver.disconnect();
      _infiniteScrollObserver = null;
    }
  }
}

// ======= Tab System =======

/**
 * Build the 3-tab bar HTML
 */
function buildTabBarHtml(activeTab) {
  const tabs = [
    { key: 'trending-quotes', label: 'Quotes' },
    { key: 'trending-authors', label: 'Authors' },
    { key: 'trending-sources', label: 'Sources' },
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

let _authorsSortBy = 'importance';

async function renderTrendingAuthorsTab(container) {
  const searchParam = _authorsSearch.length >= 2 ? `&search=${encodeURIComponent(_authorsSearch)}` : '';
  const sortParam = _authorsSortBy === 'importance' ? '&sort=importance' : '';
  const data = await API.get(`/analytics/trending-authors?page=1&limit=20${sortParam}${searchParam}`);
  const authors = data.authors || [];
  const total = data.total || 0;

  _authorsPage = 1;
  _authorsHasMore = authors.length >= 20 && 20 < total;

  if (authors.length === 0) {
    const msg = _authorsSearch ? 'No authors match your search.' : 'No trending authors yet';
    container.innerHTML = buildSearchSortBarHtml('trending-authors') + `<div class="empty-state"><h3>${msg}</h3><p>Authors will appear as quotes are extracted.</p></div>`;
    return;
  }

  // Collect person IDs for importance status
  const entityKeys = authors.map(a => `person:${a.id}`);
  await fetchImportantStatuses(entityKeys);

  let html = buildSearchSortBarHtml('trending-authors');
  html += `<div id="tab-items-list">`;
  for (const author of authors) {
    html += buildAuthorCardHtml(author);
  }
  html += `</div>`;
  html += `<div id="infinite-scroll-sentinel"></div>`;

  container.innerHTML = html;
  setupInfiniteScroll();
}

function switchAuthorsSort(sortBy) {
  _authorsSortBy = sortBy;
  _authorsPage = 1;
  renderTabContent('trending-authors');
}

function buildAuthorCardHtml(author) {
  const initial = (author.canonical_name || '?').charAt(0).toUpperCase();
  const photoHtml = author.photo_url
    ? `<img src="${escapeHtml(author.photo_url)}" alt="${escapeHtml(author.canonical_name)}" class="author-card__photo" onerror="if(!this.dataset.retry){this.dataset.retry='1';this.src=this.src}else{this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'}" loading="lazy">`
    : `<div class="quote-headshot-placeholder">${initial}</div>`;

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

async function renderTrendingSourcesTab(container) {
  const searchParam = _sourcesSearch.length >= 2 ? `&search=${encodeURIComponent(_sourcesSearch)}` : '';
  const sortParam = _sourcesSortBy === 'importance' ? '&sort=importance' : '';
  const data = await API.get(`/analytics/trending-sources?page=1&limit=20${sortParam}${searchParam}`);
  const articles = data.articles || [];
  const total = data.total || 0;

  _sourcesPage = 1;
  _sourcesHasMore = articles.length >= 20 && 20 < total;

  if (articles.length === 0) {
    const msg = _sourcesSearch ? 'No sources match your search.' : 'No trending sources yet';
    container.innerHTML = buildSearchSortBarHtml('trending-sources') + `<div class="empty-state"><h3>${msg}</h3><p>Sources will appear as articles are processed.</p></div>`;
    return;
  }

  await fetchImportantStatuses(articles.map(a => `article:${a.id}`));

  let html = buildSearchSortBarHtml('trending-sources');
  html += `<div id="tab-items-list">`;
  for (const article of articles) {
    const isImp = _importantStatuses[`article:${article.id}`] || false;
    html += buildSourceCardHtml(article, isImp);
  }
  html += `</div>`;
  html += `<div id="infinite-scroll-sentinel"></div>`;

  container.innerHTML = html;
  setupInfiniteScroll();
}

function switchSourcesSort(sortBy) {
  _sourcesSortBy = sortBy;
  _sourcesPage = 1;
  renderTabContent('trending-sources');
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
  const searchParam = _quotesSearch.length >= 2 ? `&search=${encodeURIComponent(_quotesSearch)}` : '';
  const sortParam = _quotesSortBy === 'importance' ? '&sort=importance' : '';
  const data = await API.get(`/analytics/trending-quotes?page=1&limit=20${sortParam}${searchParam}`);

  // Collect recent quote IDs for important status batch fetch
  const allQuoteIds = [];
  (data.recent_quotes || []).forEach(q => allQuoteIds.push(`quote:${q.id}`));
  await fetchImportantStatuses(allQuoteIds);

  const recentQuotes = data.recent_quotes || [];
  const total = data.total || 0;

  _quotesPage = 1;
  _quotesHasMore = recentQuotes.length >= 20 && 20 < total;

  let html = buildSearchSortBarHtml('trending-quotes');

  if (recentQuotes.length > 0) {
    html += `<div id="tab-items-list">`;
    for (const q of recentQuotes) {
      html += buildQuoteBlockHtml(q, _importantStatuses[`quote:${q.id}`] || false);
    }
    html += `</div>`;
    html += `<div id="infinite-scroll-sentinel"></div>`;
  } else {
    const msg = _quotesSearch ? 'No quotes match your search.' : 'No quotes yet';
    html += `<div class="empty-state"><h3>${msg}</h3><p>Quotes will appear here as they are extracted from news articles.</p></div>`;
  }

  container.innerHTML = html;
  setupInfiniteScroll();
}

function switchQuotesSort(sortBy) {
  _quotesSortBy = sortBy;
  _quotesPage = 1;
  renderTabContent('trending-quotes');
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
function buildMiniQuotesHtml(topQuotes) {
  if (!topQuotes || topQuotes.length === 0) return '';
  return `<div class="noteworthy-mini-quotes">${topQuotes.map(tq =>
    `<div class="noteworthy-mini-quote" onclick="event.stopPropagation(); navigateTo('/quote/${tq.id}')">
      <span class="noteworthy-mini-quote__text">${escapeHtml((tq.text || '').substring(0, 200))}${(tq.text || '').length > 200 ? '...' : ''}</span>
      ${tq.context ? `<span class="noteworthy-mini-quote__context">${escapeHtml((tq.context || '').substring(0, 100))}</span>` : ''}
      <span class="noteworthy-mini-quote__author">${escapeHtml(tq.person_name || '')}</span>
    </div>`
  ).join('')}</div>`;
}

function buildMiniArticlesHtml(topArticles) {
  if (!topArticles || topArticles.length === 0) return '';
  return `<div class="noteworthy-mini-quotes">${topArticles.map(a =>
    `<div class="noteworthy-mini-quote" onclick="event.stopPropagation(); navigateTo('/article/${a.id}')">
      <span class="noteworthy-mini-quote__text">${escapeHtml((a.title || '').substring(0, 80))}${(a.title || '').length > 80 ? '...' : ''}</span>
    </div>`
  ).join('')}</div>`;
}

function buildNoteworthySectionHtml(items) {
  let cardsHtml = '';
  const singleClass = items.length === 1 ? ' noteworthy-section__scroll--single' : '';
  const oddClass = items.length > 1 && items.length % 2 !== 0 ? ' noteworthy-section__scroll--odd' : '';

  for (const item of items) {
    if (item.entity_type === 'quote') {
      // Quote card with verdict badge + always-visible Important button
      const verdictHtml = (item.fact_check_verdict && typeof buildVerdictBadgeHtml === 'function')
        ? `<div class="noteworthy-card__verdict">${buildVerdictBadgeHtml(item.entity_id, item.fact_check_verdict)}</div>`
        : '';
      const importantHtml = (typeof renderImportantButton === 'function')
        ? `<div class="noteworthy-card__important">${renderImportantButton('quote', item.entity_id, item.importants_count || 0, false)}</div>`
        : '';

      if (typeof buildQuoteBlockHtml === 'function') {
        const quoteData = {
          id: item.entity_id,
          text: item.entity_label || '',
          context: item.context || item.entity_context || '',
          person_name: item.person_name || '',
          person_id: '',
          photo_url: item.photo_url || '',
          importants_count: item.importants_count || 0,
          quote_datetime: '',
          article_id: '',
          article_title: '',
          source_domain: '',
          source_name: '',
        };
        cardsHtml += `<div class="noteworthy-card noteworthy-card--quote">${verdictHtml}${buildQuoteBlockHtml(quoteData, false, { variant: 'compact', showAvatar: true, showSummary: true })}${importantHtml}</div>`;
      } else {
        cardsHtml += `<div class="noteworthy-card noteworthy-card--quote" onclick="navigateTo('/quote/${item.entity_id}')">
          ${verdictHtml}
          <p class="noteworthy-card__text">${escapeHtml((item.entity_label || '').substring(0, 120))}${(item.entity_label || '').length > 120 ? '...' : ''}</p>
          ${item.person_name ? `<span class="noteworthy-card__author">${escapeHtml(item.person_name)}</span>` : ''}
          ${importantHtml}
        </div>`;
      }
    } else if (item.entity_type === 'article') {
      cardsHtml += `<div class="noteworthy-card noteworthy-card--article" onclick="navigateTo('/article/${item.entity_id}')">
        <p class="noteworthy-card__title">${escapeHtml(item.entity_label || 'Untitled')}</p>
        ${item.source_name ? `<span class="noteworthy-card__meta">${escapeHtml(item.source_name)}</span>` : ''}
        ${buildMiniArticlesHtml(item.top_articles)}
        <a class="noteworthy-card__see-more" href="/article/${item.entity_id}" onclick="event.stopPropagation(); navigateTo('/article/${item.entity_id}')">See more...</a>
      </div>`;
    } else if (item.entity_type === 'person') {
      cardsHtml += `<div class="noteworthy-card noteworthy-card--person" onclick="navigateTo('/author/${item.entity_id}')">
        ${item.photo_url ? `<img class="noteworthy-card__avatar" src="${escapeHtml(item.photo_url)}" alt="" onerror="this.style.display='none'">` : ''}
        <p class="noteworthy-card__title">${escapeHtml(item.entity_label || 'Unknown Author')}</p>
        ${item.category_context ? `<span class="noteworthy-card__meta">${escapeHtml(item.category_context)}</span>` : ''}
        ${buildMiniQuotesHtml(item.top_quotes)}
        <a class="noteworthy-card__see-more" href="/author/${item.entity_id}" onclick="event.stopPropagation(); navigateTo('/author/${item.entity_id}')">See more...</a>
      </div>`;
    } else if (item.entity_type === 'topic') {
      cardsHtml += `<div class="noteworthy-card noteworthy-card--topic" onclick="navigateTo('/topic/${item.slug || item.entity_id}')">
        <p class="noteworthy-card__title">${escapeHtml(item.entity_label || 'Unknown Topic')}</p>
        ${item.description ? `<span class="noteworthy-card__meta">${escapeHtml((item.description || '').substring(0, 80))}</span>` : ''}
        ${buildMiniQuotesHtml(item.top_quotes)}
        <a class="noteworthy-card__see-more" href="/topic/${item.slug || item.entity_id}" onclick="event.stopPropagation(); navigateTo('/topic/${item.slug || item.entity_id}')">See more...</a>
      </div>`;
    } else if (item.entity_type === 'category') {
      cardsHtml += `<div class="noteworthy-card noteworthy-card--category" onclick="navigateTo('/category/${item.slug || item.entity_id}')">
        <p class="noteworthy-card__title">${escapeHtml(item.entity_label || 'Unknown Category')}</p>
        ${buildMiniQuotesHtml(item.top_quotes)}
        <a class="noteworthy-card__see-more" href="/category/${item.slug || item.entity_id}" onclick="event.stopPropagation(); navigateTo('/category/${item.slug || item.entity_id}')">See more...</a>
      </div>`;
    }
  }

  return `
    <div class="noteworthy-section">
      <h2 class="noteworthy-section__heading">Noteworthy</h2>
      <div class="noteworthy-section__scroll${singleClass}${oddClass}">
        ${cardsHtml}
      </div>
    </div>
  `;
}

function buildTopAuthorsBarHtml(authors) {
  if (!authors || authors.length === 0) return '';
  const items = authors.map(a => {
    const avatarHtml = a.photo_url
      ? `<img class="top-author-bar__avatar" src="${escapeHtml(a.photo_url)}" alt="" onerror="this.style.display='none'">`
      : `<div class="top-author-bar__avatar top-author-bar__avatar--placeholder">${escapeHtml((a.canonical_name || '?')[0])}</div>`;
    return `<div class="top-author-bar__item" onclick="navigateTo('/author/${a.id}')">
      ${avatarHtml}
      <span class="top-author-bar__name">${escapeHtml(a.canonical_name || '')}</span>
    </div>`;
  }).join('');

  return `
    <div class="top-author-bar">
      <div class="top-author-bar__list">${items}</div>
      <a class="top-author-bar__see-more" href="/analytics" onclick="navigate(event, '/analytics')">See more</a>
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

  // Fetch noteworthy items + top authors in parallel
  let noteworthyHtml = '';
  let topAuthorsHtml = '';
  try {
    const [nwData, taData] = await Promise.all([
      API.get('/search/noteworthy?limit=10'),
      API.get('/analytics/top-authors?limit=5').catch(() => ({ authors: [] })),
    ]);
    if (nwData.items && nwData.items.length > 0) {
      noteworthyHtml = buildNoteworthySectionHtml(nwData.items);
    }
    if (taData.authors && taData.authors.length > 0) {
      topAuthorsHtml = buildTopAuthorsBarHtml(taData.authors);
    }
  } catch { /* noteworthy section is optional */ }

  // Update page metadata
  if (typeof updatePageMeta === 'function') {
    updatePageMeta(null, 'Track what public figures say with AI-powered quote extraction from news sources.', '/');
  }

  // Render noteworthy + top authors bar + tab bar with visually-hidden H1
  content.innerHTML = '<h1 class="sr-only">TrueOrFalse.News - What they said - Fact Checked</h1>' + noteworthyHtml + topAuthorsHtml + buildTabBarHtml(_activeTab);

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
    const categoriesCount = (data.categories || []).length;
    const totalCount = quotesCount + personsCount + articlesCount + categoriesCount;

    let html = `<div class="search-results-header">
      <h2>Search results for "${escapeHtml(searchQuery)}"</h2>
      <button class="btn btn-secondary btn-sm" onclick="clearSearch()">Clear Search</button>
    </div>`;

    if (totalCount === 0) {
      html += `<div class="empty-state"><h3>No results found</h3></div>`;
    } else {
      // Category pills above tabs
      if (categoriesCount > 0) {
        html += `<div class="search-categories-section">`;
        for (const cat of data.categories) {
          html += `<div class="search-category-pill" onclick="navigateTo('/category/${cat.id}')">
            <span class="search-category-pill__name">${escapeHtml(cat.name)}</span>
            <span class="search-category-pill__count">${cat.quote_count || 0} quotes</span>
          </div>`;
        }
        html += `</div>`;
      }

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
            ? `<img src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.canonical_name)}" class="search-author__photo" onerror="if(!this.dataset.retry){this.dataset.retry='1';this.src=this.src}else{this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'}" loading="lazy">`
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
 * Handle Socket.IO fact_check_complete event — update verdict badges sitewide
 */
function handleFactCheckComplete(data) {
  const { quoteId, verdict } = data;
  if (!quoteId) return;

  // Update all verdict badges for this quote on the page
  document.querySelectorAll(`.quote-block[data-quote-id="${quoteId}"]`).forEach(block => {
    const badge = block.querySelector('.wts-verdict-badge, .wts-verdict-badge--pending');
    if (badge) {
      const newHtml = buildVerdictBadgeHtml(quoteId, verdict);
      const temp = document.createElement('div');
      temp.innerHTML = newHtml;
      badge.replaceWith(temp.firstElementChild);
    }
  });

  // Clear sessionStorage fact-check cache for this quote
  try { sessionStorage.removeItem(`fc:${quoteId}`); } catch {}
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
