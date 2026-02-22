// Homepage - Tab System (Trending Quotes, Trending Authors, Trending Sources)

// Store full quote texts for show more/less toggle
const _quoteTexts = {};

// Store quote metadata for sharing
const _quoteMeta = {};

// Quotes scroll state
let _quotesSortBy = 'date';
let _quotesPage = 1;
let _quotesHasMore = true;
let _isLoadingMore = false;
let _infiniteScrollObserver = null;

// ======= Category Icon Mapping =======

function getCategoryIcon(categoryName) {
  if (!categoryName) return 'category';
  const name = categoryName.toLowerCase();
  const map = [
    [['politics', 'political', 'government'], 'account_balance'],
    [['business', 'economy', 'finance', 'market'], 'trending_up'],
    [['technology', 'tech', 'cyber', 'digital'], 'devices'],
    [['entertainment', 'celebrity', 'hollywood'], 'theater_comedy'],
    [['sports', 'athletic'], 'sports_soccer'],
    [['science', 'research'], 'science'],
    [['health', 'medical', 'healthcare'], 'health_and_safety'],
    [['world', 'international', 'global', 'foreign'], 'public'],
    [['education', 'school', 'academic'], 'school'],
    [['environment', 'climate', 'energy'], 'eco'],
    [['law', 'legal', 'justice', 'court'], 'gavel'],
    [['military', 'defense', 'war'], 'military_tech'],
    [['crime', 'criminal', 'police'], 'local_police'],
    [['culture', 'arts', 'art'], 'palette'],
    [['media', 'news', 'press', 'journalism'], 'newspaper'],
    [['religion', 'faith', 'church'], 'church'],
    [['space', 'nasa', 'astronomy'], 'rocket'],
  ];
  for (const [keywords, icon] of map) {
    if (keywords.some(k => name.includes(k))) return icon;
  }
  return 'category';
}

function buildCategoryAvatarHtml(imageUrl, iconName, categoryName, size) {
  const sizeClass = size === 'sm' ? ' category-icon-avatar--sm' : '';
  const cssClass = size === 'sm' ? 'noteworthy-card__avatar category-icon-avatar--sm' : 'noteworthy-card__avatar';
  if (imageUrl) {
    return `<img class="${cssClass}" src="${escapeHtml(imageUrl)}" alt="" onerror="this.outerHTML='<span class=\\'material-icons-outlined category-icon-avatar${sizeClass}\\'>${escapeHtml(iconName || getCategoryIcon(categoryName))}</span>'" style="border-radius:50%;object-fit:cover">`;
  }
  const icon = iconName || getCategoryIcon(categoryName);
  return `<span class="material-icons-outlined category-icon-avatar${sizeClass}">${escapeHtml(icon)}</span>`;
}

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
      <button class="share-btn share-btn--download" onclick="downloadShareImage(event, ${entityId})" title="Share Image">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>` : '';

  return `
    <div class="share-buttons" data-entity-type="${entityType}" data-entity-id="${entityId}">
      <button class="share-btn" onclick="shareEntity(event, '${entityType}', ${entityId}, 'twitter')" title="Share on X">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </button>
      <button class="share-btn" onclick="shareEntity(event, '${entityType}', ${entityId}, 'facebook')" title="Share on Facebook">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
      </button>
${downloadBtn}
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

// ======= Infinite Scroll =======

function setupInfiniteScroll() {
  if (_infiniteScrollObserver) {
    _infiniteScrollObserver.disconnect();
    _infiniteScrollObserver = null;
  }

  const sentinel = document.getElementById('infinite-scroll-sentinel');
  if (!sentinel) return;

  if (!_quotesHasMore) {
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
    await loadMoreQuotes();
  } finally {
    _isLoadingMore = false;
  }
}

async function loadMoreQuotes() {
  _quotesPage++;
  const sortParam = _quotesSortBy === 'importance' ? '&sort=importance' : '';
  const data = await API.get(`/analytics/trending-quotes?page=${_quotesPage}&limit=20${sortParam}`);

  const recentQuotes = data.recent_quotes || [];
  _quotesHasMore = recentQuotes.length >= 20 && (_quotesPage * 20) < data.total;

  if (recentQuotes.length > 0) {
    const entityKeys = recentQuotes.map(q => `quote:${q.id}`);
    await fetchImportantStatuses(entityKeys);

    let html = '';
    for (const q of recentQuotes) {
      html += buildQuoteBlockHtml(q, _importantStatuses[`quote:${q.id}`] || false);
    }
    const list = document.getElementById('quotes-list');
    if (list) list.insertAdjacentHTML('beforeend', html);
    initViewTracking();
  }

  updateSentinel();
}

function updateSentinel() {
  const sentinel = document.getElementById('infinite-scroll-sentinel');
  if (!_quotesHasMore && sentinel) {
    sentinel.innerHTML = '';
    if (_infiniteScrollObserver) {
      _infiniteScrollObserver.disconnect();
      _infiniteScrollObserver = null;
    }
  }
}

// ======= Author & Source Card Builders =======

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
          ${article.source_author_image_url ? `<img class="source-card__source-img" src="${escapeHtml(article.source_author_image_url)}" alt="" onerror="this.style.display='none'">` : ''}${article.source_name || article.source_domain ? `<span class="source-card__domain">${escapeHtml(article.source_name || article.source_domain)}</span>` : ''}
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
  return topQuotes.map(tq => {
    _quoteMeta[tq.id] = {
      text: tq.text || '',
      personName: tq.person_name || '',
      personCategoryContext: '',
      context: tq.context || '',
    };
    const verdictHtml = (typeof buildVerdictBadgeHtml === 'function')
      ? buildVerdictBadgeHtml(tq.id, tq.fact_check_verdict)
      : '';
    const avatarHtml = tq.photo_url
      ? `<img class="noteworthy-quote__avatar" src="${escapeHtml(tq.photo_url)}" alt="" onerror="this.style.display='none'">`
      : '';
    return `<div class="noteworthy-quote" onclick="event.stopPropagation(); navigateTo('/quote/${tq.id}')">
      <p class="noteworthy-quote__text"><span class="quote-mark quote-mark--open">\u201C</span>${escapeHtml(tq.text || '')}<span class="quote-mark quote-mark--close">\u201D</span></p>
      <div class="noteworthy-quote__meta">
        ${avatarHtml}
        ${verdictHtml}
        <span class="noteworthy-quote__author">${escapeHtml(tq.person_name || '')}</span>
      </div>
      ${tq.context ? `<p class="noteworthy-quote__context">${escapeHtml(tq.context)}</p>` : ''}
    </div>`;
  }).join('');
}

function buildMiniArticlesHtml(topArticles) {
  if (!topArticles || topArticles.length === 0) return '';
  return topArticles.map(a =>
    `<div class="noteworthy-quote" onclick="event.stopPropagation(); navigateTo('/article/${a.id}')">
      <p class="noteworthy-quote__text" style="font-style:normal">${escapeHtml(a.title || '')}</p>
    </div>`
  ).join('');
}

function buildNoteworthyCardHeader(avatarHtml, name, desc) {
  return `<div class="noteworthy-card__header">
    ${avatarHtml}
    <p class="noteworthy-card__name">${escapeHtml(name)}</p>
    ${desc ? `<span class="noteworthy-card__desc">${escapeHtml(desc)}</span>` : ''}
  </div>`;
}

function buildNoteworthySectionHtml(items) {
  let cardsHtml = '';
  const singleClass = items.length === 1 ? ' noteworthy-section__scroll--single' : '';
  const oddClass = items.length > 1 && items.length % 2 !== 0 ? ' noteworthy-section__scroll--odd' : '';

  for (const item of items) {
    let headerHtml = '';
    let contentHtml = '';
    let clickTarget = '';

    if (item.entity_type === 'quote') {
      clickTarget = `/quote/${item.entity_id}`;
      const avatarHtml = item.photo_url
        ? `<img class="noteworthy-card__avatar" src="${escapeHtml(item.photo_url)}" alt="" onerror="this.style.display='none'">`
        : `<div class="noteworthy-card__avatar-placeholder">${escapeHtml((item.person_name || '?')[0])}</div>`;
      headerHtml = buildNoteworthyCardHeader(avatarHtml, item.person_name || '', item.person_category_context || '');
      _quoteMeta[item.entity_id] = {
        text: item.entity_label || '',
        personName: item.person_name || '',
        personCategoryContext: item.person_category_context || '',
        context: item.context || '',
      };
      const verdictHtml = (typeof buildVerdictBadgeHtml === 'function')
        ? buildVerdictBadgeHtml(item.entity_id, item.fact_check_verdict) : '';
      contentHtml = `<div class="noteworthy-quote">
        <p class="noteworthy-quote__text"><span class="quote-mark quote-mark--open">\u201C</span>${escapeHtml(item.entity_label || '')}<span class="quote-mark quote-mark--close">\u201D</span></p>
        <div class="noteworthy-quote__meta">
          ${verdictHtml}
          <span class="noteworthy-quote__author">${escapeHtml(item.person_name || '')}</span>
        </div>
        ${item.context ? `<p class="noteworthy-quote__context">${escapeHtml(item.context)}</p>` : ''}
      </div>`;

    } else if (item.entity_type === 'person') {
      clickTarget = `/author/${item.entity_id}`;
      const avatarHtml = item.photo_url
        ? `<img class="noteworthy-card__avatar" src="${escapeHtml(item.photo_url)}" alt="" onerror="this.style.display='none'">`
        : `<div class="noteworthy-card__avatar-placeholder">${escapeHtml((item.entity_label || '?')[0])}</div>`;
      const desc = [item.category, item.category_context].filter(Boolean).join(' — ');
      headerHtml = buildNoteworthyCardHeader(avatarHtml, item.entity_label || 'Unknown Author', desc);
      contentHtml = buildMiniQuotesHtml(item.top_quotes);

    } else if (item.entity_type === 'topic') {
      clickTarget = `/topic/${item.slug || item.entity_id}`;
      const initial = (item.entity_label || '?')[0];
      const avatarHtml = `<div class="noteworthy-card__avatar-placeholder">${escapeHtml(initial)}</div>`;
      headerHtml = buildNoteworthyCardHeader(avatarHtml, item.entity_label || 'Unknown Topic', item.description || '');
      contentHtml = buildMiniQuotesHtml(item.top_quotes);

    } else if (item.entity_type === 'category') {
      clickTarget = `/category/${item.slug || item.entity_id}`;
      const avatarHtml = buildCategoryAvatarHtml(item.image_url, item.icon_name, item.entity_label);
      headerHtml = buildNoteworthyCardHeader(avatarHtml, item.entity_label || 'Unknown Category', '');
      contentHtml = buildMiniQuotesHtml(item.top_quotes);

    } else if (item.entity_type === 'article') {
      clickTarget = `/article/${item.entity_id}`;
      const initial = (item.entity_label || '?')[0];
      const avatarHtml = `<div class="noteworthy-card__avatar-placeholder">${escapeHtml(initial)}</div>`;
      headerHtml = buildNoteworthyCardHeader(avatarHtml, item.entity_label || 'Untitled', item.source_name || '');
      contentHtml = buildMiniArticlesHtml(item.top_articles);
    }

    cardsHtml += `<div class="noteworthy-card noteworthy-card--${item.entity_type}${item.full_width ? ' noteworthy-card--full-width' : ''}" onclick="navigateTo('${clickTarget}')">
      ${headerHtml}
      <div class="noteworthy-card__content">${contentHtml}</div>
    </div>`;
  }

  return `
    <div class="noteworthy-section">
      <h2 class="noteworthy-section__heading">Latest Claims</h2>
      <div class="noteworthy-section__scroll${singleClass}${oddClass}">
        ${cardsHtml}
      </div>
    </div>
  `;
}

// ======= Peppered Card Renderers =======

function buildTimedQuoteCardHtml(card) {
  const q = card.data;
  if (!q) return '';
  const verdictHtml = (typeof buildVerdictBadgeHtml === 'function')
    ? buildVerdictBadgeHtml(q.id, q.fact_check_verdict) : '';
  return `
    <div class="noteworthy-card noteworthy-card--timed-quote" data-href="/quote/${q.id}" onclick="slideToDetail('/quote/${q.id}')">
      <div class="noteworthy-card__header">
        <div class="noteworthy-card__badge">${escapeHtml(card.custom_title || '')}</div>
      </div>
      <div class="noteworthy-card__content">
        <div class="noteworthy-quote__text">\u201C${escapeHtml((q.text || '').substring(0, 200))}\u201D</div>
        <div class="noteworthy-quote__byline">
          ${q.photo_url ? `<img class="noteworthy-quote__avatar" src="${escapeHtml(q.photo_url)}" alt="" onerror="this.style.display='none'">` : ''}
          ${verdictHtml}
          \u2014 ${escapeHtml(q.person_name || '')}
        </div>
      </div>
    </div>
  `;
}

function buildTimedAuthorCardHtml(card) {
  const entity = card.data?.entity;
  if (!entity) return '';
  const avatarHtml = entity.photo_url
    ? `<img class="noteworthy-card__avatar" src="${escapeHtml(entity.photo_url)}" alt="" onerror="this.style.display='none'">`
    : `<div class="noteworthy-card__avatar-placeholder">${escapeHtml((entity.canonical_name || '?')[0])}</div>`;
  const desc = [entity.category, entity.category_context].filter(Boolean).join(' \u2014 ');
  return `
    <div class="noteworthy-card noteworthy-card--timed-author" data-href="/author/${entity.id}" onclick="slideToDetail('/author/${entity.id}')">
      <div class="noteworthy-card__header">
        <div class="noteworthy-card__badge">${escapeHtml(card.custom_title || '')}</div>
      </div>
      ${buildNoteworthyCardHeader(avatarHtml, entity.canonical_name || '', desc)}
      <div class="noteworthy-card__content">${buildMiniQuotesHtml(card.data.top_quotes)}</div>
    </div>
  `;
}

function buildTimedSourceCardHtml(card) {
  const entity = card.data?.entity;
  if (!entity) return '';
  const avatarHtml = entity.image_url
    ? `<img class="noteworthy-card__avatar" src="${escapeHtml(entity.image_url)}" alt="" onerror="this.style.display='none'">`
    : `<div class="noteworthy-card__avatar-placeholder">${escapeHtml((entity.name || '?')[0])}</div>`;
  return `
    <div class="noteworthy-card noteworthy-card--timed-source" onclick="event.stopPropagation()">
      <div class="noteworthy-card__header">
        <div class="noteworthy-card__badge">${escapeHtml(card.custom_title || '')}</div>
      </div>
      ${buildNoteworthyCardHeader(avatarHtml, entity.name || '', entity.domain || '')}
      <div class="noteworthy-card__content">${buildMiniQuotesHtml(card.data.top_quotes)}</div>
    </div>
  `;
}

function buildTimedTopicCardHtml(card) {
  const entity = card.data?.entity;
  if (!entity) return '';
  const initial = (entity.name || '?')[0];
  const avatarHtml = `<div class="noteworthy-card__avatar-placeholder">${escapeHtml(initial)}</div>`;
  return `
    <div class="noteworthy-card noteworthy-card--timed-topic" data-href="/topic/${entity.slug || entity.id}" onclick="slideToDetail('/topic/${entity.slug || entity.id}')">
      <div class="noteworthy-card__header">
        <div class="noteworthy-card__badge">${escapeHtml(card.custom_title || '')}</div>
      </div>
      ${buildNoteworthyCardHeader(avatarHtml, entity.name || '', entity.description || '')}
      <div class="noteworthy-card__content">${buildMiniQuotesHtml(card.data.top_quotes)}</div>
    </div>
  `;
}

function buildTimedCategoryCardHtml(card) {
  const entity = card.data?.entity;
  if (!entity) return '';
  const avatarHtml = buildCategoryAvatarHtml(entity.image_url, entity.icon_name, entity.name);
  return `
    <div class="noteworthy-card noteworthy-card--timed-category" data-href="/category/${entity.slug || entity.id}" onclick="slideToDetail('/category/${entity.slug || entity.id}')">
      <div class="noteworthy-card__header">
        <div class="noteworthy-card__badge">${escapeHtml(card.custom_title || '')}</div>
      </div>
      ${buildNoteworthyCardHeader(avatarHtml, entity.name || '', '')}
      <div class="noteworthy-card__content">${buildMiniQuotesHtml(card.data.top_quotes)}</div>
    </div>
  `;
}

function buildSearchCardHtml(card) {
  const st = card.data?.search_type || '';
  const labels = {
    topic: 'Search by news topic',
    quote_text: 'Search by quote text',
    source_author: 'Search by quote author',
    source: 'Search by news source'
  };
  return `
    <div class="noteworthy-card noteworthy-card--search noteworthy-card--full-width">
      <div class="noteworthy-card__header">
        <div class="noteworthy-card__badge">${escapeHtml(card.custom_title || '')}</div>
      </div>
      <p class="search-card__subhead">${escapeHtml(labels[st] || 'Search')}</p>
      <div class="search-card__input-wrap">
        <input type="search" class="search-card__input" placeholder="Type to search..."
               oninput="searchCardAutocomplete(this, '${escapeHtml(st)}')"
               onkeydown="searchCardKeydown(event, this, '${escapeHtml(st)}')">
        <div class="search-card__results"></div>
      </div>
    </div>
  `;
}

let _searchCardDebounce = null;

async function searchCardAutocomplete(inputEl, searchType) {
  clearTimeout(_searchCardDebounce);
  const query = inputEl.value.trim();
  const resultsEl = inputEl.parentElement.querySelector('.search-card__results');
  if (query.length < 2) {
    resultsEl.innerHTML = '';
    resultsEl.style.display = 'none';
    return;
  }
  _searchCardDebounce = setTimeout(async () => {
    try {
      const typeParam = searchType === 'quote_text' ? '' : `&type=${searchType}`;
      const data = await API.get('/search/autocomplete?q=' + encodeURIComponent(query) + typeParam + '&limit=6');
      const suggestions = data.suggestions || [];
      if (suggestions.length === 0) {
        resultsEl.innerHTML = '';
        resultsEl.style.display = 'none';
        return;
      }
      resultsEl.innerHTML = suggestions.map(s => {
        let onclick = '';
        if (s.type === 'person') onclick = `navigateTo('/author/${s.id}')`;
        else if (s.type === 'topic') onclick = `navigateTo('/topic/${s.id}')`;
        else onclick = `navigateTo('/?search=${encodeURIComponent(s.label)}')`;
        return `<div class="search-card__result-item" onclick="${onclick}">${escapeHtml(s.label)}</div>`;
      }).join('');
      resultsEl.style.display = 'block';
    } catch (err) {
      // Silent fail
    }
  }, 200);
}

function searchCardKeydown(event, inputEl, searchType) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const query = inputEl.value.trim();
    if (query.length >= 2) {
      navigateTo('/?search=' + encodeURIComponent(query));
    }
  } else if (event.key === 'Escape') {
    inputEl.value = '';
    const resultsEl = inputEl.parentElement.querySelector('.search-card__results');
    resultsEl.innerHTML = '';
    resultsEl.style.display = 'none';
  }
}

function buildInfoCardHtml(card) {
  const infoType = card.data?.info_type || '';
  const content = {
    importance: {
      title: 'What does IMPORTANT? do?',
      body: 'Tap the IMPORTANT? button on any quote to mark it as noteworthy. This helps surface the most significant quotes and influences trending rankings.',
      icon: 'star'
    },
    fact_check: {
      title: 'What does RUN FACT CHECK do?',
      body: 'Tap RUN FACT CHECK to have AI verify factual claims in a quote using real-time web search. Results include a verdict (TRUE, FALSE, MISLEADING, etc.) with cited sources.',
      icon: 'search'
    },
    bug: {
      title: 'Found a bug?',
      body: 'Tap the bug icon on any page to report an issue. Include what you expected vs what happened. Bug reports help us improve the app.',
      icon: 'bug_report'
    },
    donate: {
      title: 'Support QuoteLog',
      body: 'QuoteLog is free and open source. If you find it valuable, consider supporting development.',
      icon: 'favorite'
    }
  };
  const c = content[infoType] || { title: '', body: '', icon: 'info' };
  return `
    <div class="noteworthy-card noteworthy-card--info">
      <div class="noteworthy-card__header">
        <span class="info-card__icon material-icons-outlined">${escapeHtml(c.icon)}</span>
        <div class="noteworthy-card__badge">${escapeHtml(c.title)}</div>
      </div>
      <div class="noteworthy-card__content">
        <p class="info-card__body">${escapeHtml(c.body)}</p>
      </div>
    </div>
  `;
}

function buildPepperedCardHtml(card) {
  if (!card || !card.type) return '';
  switch (card.type) {
    case 'quote': return buildTimedQuoteCardHtml(card);
    case 'author': return buildTimedAuthorCardHtml(card);
    case 'source': return buildTimedSourceCardHtml(card);
    case 'topic': return buildTimedTopicCardHtml(card);
    case 'category': return buildTimedCategoryCardHtml(card);
    case 'search': return buildSearchCardHtml(card);
    case 'info': return buildInfoCardHtml(card);
    default: return '';
  }
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
 * Load a page of quotes into the quotes list
 */
async function loadQuotesPage(page) {
  _quotesPage = page;
  const sortParam = _quotesSortBy === 'importance' ? '&sort=importance' : '';
  const data = await API.get(`/analytics/trending-quotes?page=${page}&limit=20${sortParam}`);

  const recentQuotes = data.recent_quotes || [];
  const total = data.total || 0;
  _quotesHasMore = recentQuotes.length >= 20 && (page * 20) < total;

  if (recentQuotes.length > 0) {
    const entityKeys = recentQuotes.map(q => `quote:${q.id}`);
    await fetchImportantStatuses(entityKeys);

    let html = '';
    for (const q of recentQuotes) {
      html += buildQuoteBlockHtml(q, _importantStatuses[`quote:${q.id}`] || false);
    }
    const list = document.getElementById('quotes-list');
    if (list) {
      if (page === 1) {
        list.innerHTML = html;
      } else {
        list.insertAdjacentHTML('beforeend', html);
      }
    }
    initViewTracking();
  } else if (page === 1) {
    const list = document.getElementById('quotes-list');
    if (list) {
      list.innerHTML = '<div class="empty-state"><h3>No quotes yet</h3><p>Quotes will appear here as they are extracted from news articles.</p></div>';
    }
  }
}

/**
 * Render the homepage with quotes scroll
 */
async function renderHome() {
  const content = document.getElementById('content');

  // Check for search query
  const params = new URLSearchParams(window.location.search);
  const searchQuery = params.get('search') || '';

  if (searchQuery) {
    await renderSearchResults(content, searchQuery);
    return;
  }

  // Update page metadata
  if (typeof updatePageMeta === 'function') {
    updatePageMeta(null, 'Track what public figures say with AI-powered quote extraction from news sources.', '/');
  }

  // Simplified: just quotes scroll, no tabs, no standalone noteworthy
  content.innerHTML = `
    <h1 class="sr-only">TrueOrFalse.News - What they said - Fact Checked</h1>
    <div id="home-quotes-scroll" class="slide-container">
      <div class="slide-panel slide-panel--main" id="slide-main">
        <div id="quotes-list"></div>
        <div id="infinite-scroll-sentinel" class="infinite-scroll-sentinel"></div>
      </div>
      <div class="slide-panel slide-panel--detail" id="slide-detail"></div>
    </div>
  `;

  // Load first page of quotes
  await loadQuotesPage(1);
  setupInfiniteScroll();

  // Wire up swipe gestures
  const slideContainer = document.getElementById('home-quotes-scroll');
  if (slideContainer && typeof initSwipeHandlers === 'function') {
    initSwipeHandlers(slideContainer, {
      onSwipeLeft: (e) => {
        const quoteBlock = e.target.closest('.quote-block');
        const card = e.target.closest('.noteworthy-card');
        if (quoteBlock) {
          const quoteId = quoteBlock.dataset.quoteId;
          if (quoteId) slideToDetail(`/quote/${quoteId}`);
        } else if (card && card.dataset.href) {
          slideToDetail(card.dataset.href);
        }
      },
      onSwipeRight: () => slideBack()
    });
  }

  // Restore scroll position if returning
  if (_pendingScrollRestore) {
    _pendingScrollRestore = false;
    requestAnimationFrame(() => {
      window.scrollTo(0, _homeScrollY);
    });
  }
}

/**
 * Slide to a detail page (quote, author, etc.)
 */
function slideToDetail(path) {
  _homeScrollY = window.scrollY;
  const container = document.getElementById('home-quotes-scroll');
  if (container) {
    container.classList.add('slide-active');
  }
  // Navigate to the detail page using existing router
  if (typeof navigate === 'function') {
    navigate(null, path);
  } else {
    window.location.href = path;
  }
}

/**
 * Slide back to the quotes scroll
 */
function slideBack() {
  const container = document.getElementById('home-quotes-scroll');
  if (container) {
    container.classList.remove('slide-active');
  }
  requestAnimationFrame(() => window.scrollTo(0, _homeScrollY));
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
          const catIcon = cat.icon_name || getCategoryIcon(cat.name);
          html += `<div class="search-category-pill" onclick="navigateTo('/category/${cat.slug || cat.id}')">
            <span class="material-icons-outlined" style="font-size:16px;vertical-align:middle;margin-right:4px">${escapeHtml(catIcon)}</span>
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
