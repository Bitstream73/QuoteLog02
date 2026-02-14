async function renderQuote(id) {
  const content = document.getElementById('content');
  content.innerHTML = typeof buildSkeletonHtml === 'function' ? buildSkeletonHtml(1) : '<div class="loading">Loading quote...</div>';
  try {
    const data = await API.get(`/quotes/${id}`);
    if (!data.quote) {
      content.innerHTML = '<div class="empty-state"><h3>Quote not found</h3><p><a href="/" onclick="navigate(event, \'/\')" style="color:var(--accent)">Back to home</a></p></div>';
      return;
    }
    const q = data.quote;

    // Build main quote using homepage quote block layout
    const mainQuoteData = {
      id: q.id,
      text: q.text,
      context: q.context || '',
      person_name: q.personName,
      person_id: q.personId,
      photo_url: q.photoUrl || '',
      person_category_context: q.personDisambiguation || '',
      importants_count: q.importantsCount || q.importants_count || 0,
      quote_datetime: q.quote_datetime || q.quoteDateTime || '',
      article_id: (data.articles && data.articles[0]) ? data.articles[0].id : '',
      article_title: (data.articles && data.articles[0]) ? data.articles[0].title : '',
      source_domain: (data.articles && data.articles[0]) ? (data.articles[0].domain || '') : '',
      source_name: (data.articles && data.articles[0]) ? (data.articles[0].source_name || '') : '',
      is_visible: q.isVisible,
    };
    const mainQuoteTopics = q.topics || [];

    // Hero quote layout
    const heroPersonName = q.personName || '';
    const heroPhotoUrl = q.photoUrl || '';
    const heroInitial = (heroPersonName || '?').charAt(0).toUpperCase();
    const heroAvatarHtml = heroPhotoUrl
      ? `<img src="${escapeHtml(heroPhotoUrl)}" alt="${escapeHtml(heroPersonName)}" class="quote-hero__avatar" onerror="this.outerHTML='<div class=\\'quote-hero__avatar-placeholder\\'>${heroInitial}</div>'" loading="lazy">`
      : `<div class="quote-hero__avatar-placeholder">${heroInitial}</div>`;

    const shareHtml = typeof buildShareButtonsHtml === 'function'
      ? buildShareButtonsHtml('quote', q.id, q.text, q.personName)
      : '';
    const importantHtml = typeof renderImportantButton === 'function'
      ? renderImportantButton('quote', q.id, q.importantsCount || q.importants_count || 0, false)
      : '';

    let html = `
      <p style="margin-bottom:1.5rem;font-family:var(--font-ui);font-size:var(--text-sm)">
        <a href="/" onclick="navigateBackToQuotes(event)" style="color:var(--accent);text-decoration:none">&larr; Back to quotes</a>
      </p>

      <div class="quote-hero">
        <div class="quote-hero__text">
          <span class="quote-mark quote-mark--open">\u201C</span>${escapeHtml(q.text)}<span class="quote-mark quote-mark--close">\u201D</span>
        </div>
        <div class="quote-hero__speaker" onclick="navigateTo('/author/${q.personId}')">
          ${heroAvatarHtml}
          <div>
            <span class="quote-hero__name">${escapeHtml(heroPersonName)}</span>
            ${q.personDisambiguation ? `<span class="quote-hero__role">${escapeHtml(q.personDisambiguation)}</span>` : ''}
          </div>
        </div>
        ${q.context ? `<div class="quote-hero__summary">${escapeHtml(q.context)}</div>` : ''}
        <div class="quote-hero__actions">
          ${shareHtml}
          ${importantHtml}
        </div>
      </div>
    `;

    // Articles / Sources — renamed "FROM"
    if (data.articles && data.articles.length > 0) {
      html += '<h2 class="quote-section-label">FROM</h2>';
      html += '<div class="quote-detail-sources">';
      for (const a of data.articles) {
        const sourceName = a.source_name || a.domain || 'Source';
        const articleDate = a.published_at ? formatDateTime(a.published_at) : '';
        html += `
          <div class="quote-detail-source-item">
            <a href="/article/${a.id}" onclick="navigate(event, '/article/${a.id}')" class="quote-article-title-link">${escapeHtml(a.title || 'Untitled Article')}</a>
            <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.25rem">
              <span class="quote-primary-source">${escapeHtml(sourceName)}</span>
              ${articleDate ? `<span class="quote-date-inline">${articleDate}</span>` : ''}
              ${a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" style="font-family:var(--font-ui);font-size:var(--text-xs);color:var(--accent);text-decoration:none">View original &rarr;</a>` : ''}
            </div>
          </div>
        `;
      }
      html += '</div>';
    }

    // AI Analysis section (auto-loading for all users)
    html += `
      <div id="context-container" style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--divider-light)">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem">
          <h2 class="quote-section-label" style="margin:0">AI ANALYSIS</h2>
          <button class="context-refresh-btn" id="context-refresh-btn" onclick="loadQuoteContext(${q.id}, true)" style="display:none" title="Refresh analysis">&#x21bb;</button>
        </div>
        <div id="context-content">
          <div class="context-loading">
            <div class="context-loading-spinner"></div>
            <span style="font-family:var(--font-ui);font-size:var(--text-sm);color:var(--text-muted)">Analyzing quote...</span>
          </div>
        </div>
      </div>
    `;

    // Fact Check section (auto-loading for all users)
    html += `
      <div id="fact-check-container" style="margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid var(--divider-light)">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem">
          <h2 class="quote-section-label" style="margin:0">FACT CHECK</h2>
          <button class="context-refresh-btn" id="fact-check-refresh-btn" onclick="runFactCheck(${q.id}, true)" style="display:none" title="Refresh fact check">&#x21bb;</button>
        </div>
        <div id="fact-check-content">
          <div class="context-loading">
            <div class="context-loading-spinner"></div>
            <span style="font-family:var(--font-ui);font-size:var(--text-sm);color:var(--text-muted)">Checking facts...</span>
          </div>
        </div>
      </div>
    `;

    // Smart Related Quotes section (auto-loading)
    html += `
      <div id="smart-related-section" style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--divider-light)">
        <h2 class="quote-section-label">RELATED QUOTES</h2>
        <div id="smart-related-content">
          <div class="smart-related-loading">
            <div class="context-loading-spinner"></div>
            <span style="font-family:var(--font-ui);font-size:var(--text-sm);color:var(--text-muted)">Loading related quotes...</span>
          </div>
        </div>
      </div>
    `;

    // Variants
    if (data.variants && data.variants.length > 0) {
      html += `<h2 style="margin:2.5rem 0 1rem;font-family:var(--font-headline);font-size:1.3rem;padding-top:1.5rem;border-top:1px solid var(--border)">Variants</h2>`;
      html += '<p style="font-family:var(--font-ui);font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem">Same quote reported with different wording across sources.</p>';
      for (const v of data.variants) {
        html += `<div class="quote-entry" style="padding:1rem 0"><p class="quote-text">${escapeHtml(v.text)}</p></div>`;
      }
    }

    content.innerHTML = html;

    // Reset annotation flag for this page render
    quoteTextAnnotated = false;

    // Auto-load all sections in parallel
    loadSmartRelated(q.id);
    loadQuoteContext(q.id);
    runFactCheck(q.id);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

/**
 * Load smart related quotes (contradictions, context, mentions) for a quote.
 */
async function loadSmartRelated(quoteId) {
  const container = document.getElementById('smart-related-content');
  if (!container) return;

  try {
    const data = await API.get(`/quotes/${quoteId}/smart-related`);
    let html = '';

    // Contradictions
    if (data.contradictions && data.contradictions.length > 0) {
      html += '<div id="contradictions-section" class="smart-related-group">';
      html += '<h3 class="smart-related-group-title" style="color:var(--danger, #dc3545)">Contradictions from Same Author</h3>';
      for (const c of data.contradictions) {
        html += buildSmartRelatedQuoteBlock(c);
      }
      html += '</div>';
    }

    // Supporting context
    if (data.supportingContext && data.supportingContext.length > 0) {
      html += '<div id="supporting-context-section" class="smart-related-group">';
      html += '<h3 class="smart-related-group-title">More Context from Same Author</h3>';
      for (const c of data.supportingContext) {
        html += buildSmartRelatedQuoteBlock(c);
      }
      html += '</div>';
    }

    // Mentions by others
    if (data.mentionsByOthers && data.mentionsByOthers.length > 0) {
      html += '<div id="mentions-section" class="smart-related-group">';
      html += '<h3 class="smart-related-group-title" style="color:var(--accent)">What Others Say</h3>';
      for (const m of data.mentionsByOthers) {
        html += buildSmartRelatedQuoteBlock(m);
      }
      html += '</div>';
    }

    if (!html) {
      html = '<p style="font-family:var(--font-ui);font-size:0.85rem;color:var(--text-muted)">No related quotes found.</p>';
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<p style="font-family:var(--font-ui);font-size:0.85rem;color:var(--text-muted)">Could not load related quotes.</p>';
  }
}

/**
 * Build a smart related quote using the homepage quote block layout.
 */
function buildSmartRelatedQuoteBlock(item) {
  if (typeof buildQuoteBlockHtml !== 'function') {
    // Fallback if buildQuoteBlockHtml not available
    return `<div class="quote-block"><p class="quote-block__text">${escapeHtml(item.text)}</p></div>`;
  }
  const quoteData = {
    id: item.id,
    text: item.text,
    context: item.context || '',
    person_name: item.person_name || item.authorName,
    person_id: item.person_id || '',
    photo_url: item.photo_url || '',
    importants_count: item.importants_count || 0,
    quote_datetime: item.quote_datetime || item.date || '',
    article_id: item.article_id || '',
    article_title: item.article_title || '',
    source_domain: item.source_domain || '',
    source_name: item.source_name || item.sourceName || '',
  };
  const topics = item.topics || [];
  return buildQuoteBlockHtml(quoteData, topics, false, { variant: 'compact', showAvatar: false, showSummary: false });
}

/**
 * Load AI context analysis for a quote (auto-loads on page render).
 */
async function loadQuoteContext(quoteId, force) {
  const container = document.getElementById('context-content');
  if (!container) return;

  // Check client-side cache (skip if force refresh)
  if (!force) {
    try {
      const raw = sessionStorage.getItem(CTX_CACHE_PREFIX + quoteId);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.timestamp < CTX_CACHE_TTL_MS) {
          renderContextResult(container, cached.data);
          showRefreshBtn('context-refresh-btn');
          return;
        }
        sessionStorage.removeItem(CTX_CACHE_PREFIX + quoteId);
      }
    } catch { /* ignore */ }
  }

  // Show loading spinner
  container.innerHTML = `
    <div class="context-loading">
      <div class="context-loading-spinner"></div>
      <span style="font-family:var(--font-ui);font-size:var(--text-sm);color:var(--text-muted)">Analyzing quote...</span>
    </div>
  `;

  try {
    const data = await API.post(`/quotes/${quoteId}/context${force ? '?force=true' : ''}`);

    // Cache result
    try {
      sessionStorage.setItem(CTX_CACHE_PREFIX + quoteId, JSON.stringify({
        data,
        timestamp: Date.now(),
      }));
    } catch { /* sessionStorage full */ }

    renderContextResult(container, data);
    showRefreshBtn('context-refresh-btn');
  } catch (err) {
    container.innerHTML = `<div class="context-error"><p>Analysis unavailable. ${escapeHtml(err.message)}</p><button class="context-btn" onclick="loadQuoteContext(${quoteId}, false)">Try Again</button></div>`;
  }
}

/**
 * Render context analysis result into a container.
 */
function renderContextResult(container, data) {
  let html = '';

  // Summary
  if (data.summary) {
    html += `<div class="context-summary">${escapeHtml(data.summary)}</div>`;
  }

  // Claims
  if (data.claims && data.claims.length > 0) {
    for (const claim of data.claims) {
      html += '<div class="context-claim">';
      html += `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">`;
      html += buildClaimTypeBadge(claim.type);
      html += `<span style="font-family:var(--font-headline);font-weight:600">${escapeHtml(claim.claim)}</span>`;
      html += '</div>';

      if (claim.supporting && claim.supporting.length > 0) {
        html += '<div class="context-evidence context-evidence-supporting">';
        html += '<div class="context-evidence-label">Supporting</div>';
        for (const ev of claim.supporting) {
          html += buildEvidenceItem(ev);
        }
        html += '</div>';
      }

      if (claim.contradicting && claim.contradicting.length > 0) {
        html += '<div class="context-evidence context-evidence-contradicting">';
        html += '<div class="context-evidence-label">Contradicting</div>';
        for (const ev of claim.contradicting) {
          html += buildEvidenceItem(ev);
        }
        html += '</div>';
      }

      if (claim.addingContext && claim.addingContext.length > 0) {
        html += '<div class="context-evidence context-evidence-context">';
        html += '<div class="context-evidence-label">Additional Context</div>';
        for (const ev of claim.addingContext) {
          html += buildEvidenceItem(ev);
        }
        html += '</div>';
      }

      html += '</div>';
    }
  }

  // Confidence note
  if (data.confidenceNote) {
    html += `<div class="context-confidence-note">${escapeHtml(data.confidenceNote)}</div>`;
  }

  container.innerHTML = html;
}

/**
 * Show a refresh button by ID.
 */
function showRefreshBtn(btnId) {
  const btn = document.getElementById(btnId);
  if (btn) btn.style.display = '';
}

/**
 * Build a claim type badge.
 */
function buildClaimTypeBadge(type) {
  const colors = {
    factual: 'var(--accent, #2563eb)',
    opinion: '#d97706',
    prediction: '#7c3aed',
    promise: '#059669',
    accusation: '#dc2626',
  };
  const color = colors[type] || 'var(--text-muted)';
  return `<span class="claim-type-badge" style="background:${color}">${escapeHtml(type)}</span>`;
}

/**
 * Build an evidence item (supporting/contradicting/context) with source citation.
 */
function buildEvidenceItem(ev) {
  let html = '<div class="context-evidence-item">';

  // Cited quote with link
  if (ev.quoteId && ev.quoteText) {
    html += `<a href="/quote/${ev.quoteId}" onclick="navigate(event, '/quote/${ev.quoteId}')" class="evidence-quote-link">"${escapeHtml(ev.quoteText)}"</a>`;
    if (ev.authorName) {
      html += `<span class="evidence-author"> — ${escapeHtml(ev.authorName)}</span>`;
    }
  }

  html += `<div class="evidence-explanation">${escapeHtml(ev.explanation)}</div>`;

  // Source citation with hyperlink
  if (ev.sourceUrl) {
    const label = ev.sourceName || 'Source';
    html += `<a href="${escapeHtml(ev.sourceUrl)}" target="_blank" rel="noopener" class="evidence-source-cite">Source: ${escapeHtml(label)} &rarr;</a>`;
  } else if (ev.sourceName) {
    html += `<span class="evidence-source-cite">Source: ${escapeHtml(ev.sourceName)}</span>`;
  }

  html += '</div>';
  return html;
}

// ---------------------------------------------------------------------------
// Client-side caching
// ---------------------------------------------------------------------------

const CTX_CACHE_PREFIX = 'ctx_cache_';
const CTX_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const FC_CACHE_PREFIX = 'fc_cache_';
const FC_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Guard against double annotation of quote text
let quoteTextAnnotated = false;

/**
 * Run fact-check + reference enrichment for a quote (auto-loads on page render).
 */
async function runFactCheck(quoteId, force) {
  const container = document.getElementById('fact-check-content');
  if (!container) return;

  // Check client-side cache (skip if force refresh)
  if (!force) {
    try {
      const raw = sessionStorage.getItem(FC_CACHE_PREFIX + quoteId);
      if (raw) {
        const cached = JSON.parse(raw);
        if (Date.now() - cached.timestamp < FC_CACHE_TTL_MS) {
          renderFactCheckResult(container, cached.data);
          annotateQuoteText(cached.data);
          showRefreshBtn('fact-check-refresh-btn');
          return;
        }
        sessionStorage.removeItem(FC_CACHE_PREFIX + quoteId);
      }
    } catch { /* ignore */ }
  }

  // Show loading spinner
  container.innerHTML = `
    <div class="context-loading">
      <div class="context-loading-spinner"></div>
      <span style="font-family:var(--font-ui);font-size:var(--text-sm);color:var(--text-muted)">Checking facts...</span>
    </div>
  `;

  // Gather quote data from the DOM (use quote-hero on detail page)
  const heroText = document.querySelector('.quote-hero__text');
  const quoteText = heroText?.textContent?.replace(/["\u201C\u201D]/g, '').trim() || '';
  const heroName = document.querySelector('.quote-hero__name');
  const authorName = heroName?.textContent?.trim() || '';
  const heroRole = document.querySelector('.quote-hero__role');
  const authorDesc = heroRole?.textContent?.trim() || '';
  const heroSummary = document.querySelector('.quote-hero__summary');
  const contextText = heroSummary?.textContent?.trim() || '';
  const sourceEl = document.querySelector('.quote-primary-source');
  const sourceName = sourceEl?.textContent?.trim() || '';
  const tagEls = document.querySelectorAll('.quote-block__topic-tag') || [];
  const tags = [...tagEls].map(t => t.textContent.trim());
  const dateEl = document.querySelector('.quote-date-inline');
  const sourceDate = dateEl?.textContent?.trim() || new Date().toISOString().split('T')[0];

  try {
    const result = await API.post('/fact-check/check', {
      quoteId,
      quoteText,
      authorName,
      authorDescription: authorDesc,
      context: contextText,
      sourceName,
      sourceDate,
      tags,
    });

    // Cache result
    try {
      sessionStorage.setItem(FC_CACHE_PREFIX + quoteId, JSON.stringify({
        data: result,
        timestamp: Date.now(),
      }));
    } catch { /* sessionStorage full */ }

    renderFactCheckResult(container, result);
    annotateQuoteText(result);
    showRefreshBtn('fact-check-refresh-btn');

  } catch (err) {
    container.innerHTML = `<div class="context-error"><p>Fact check unavailable.</p><button class="context-btn" onclick="runFactCheck(${quoteId}, false)">Try Again</button></div>`;
  }
}

function renderFactCheckResult(container, result) {
  container.innerHTML = result.combinedHtml || result.html || '';
}

/**
 * After rendering reference cards, annotate the quote text with inline links
 * for referenced phrases. Guarded against double-run.
 */
function annotateQuoteText(result) {
  if (quoteTextAnnotated) return;
  if (!result.references?.references) return;

  const quoteTextEl = document.querySelector('.quote-hero__text') || document.querySelector('.quote-block__text');
  if (!quoteTextEl) return;

  const foundRefs = result.references.references.filter(r => r.enrichment?.found && r.enrichment?.primary_url);
  if (foundRefs.length === 0) return;

  // Sort by text_span length descending to handle longer matches first
  const sorted = [...foundRefs].sort((a, b) => (b.text_span?.length || 0) - (a.text_span?.length || 0));

  for (const ref of sorted) {
    const span = ref.text_span;
    if (!span) continue;

    const walker = document.createTreeWalker(quoteTextEl, NodeFilter.SHOW_TEXT);
    let node;
    let replaced = false;
    while (!replaced && (node = walker.nextNode())) {
      const idx = node.textContent.indexOf(span);
      if (idx === -1) continue;

      const url = cleanUrlForAttr(ref.enrichment.primary_url);
      const title = ref.enrichment.title || ref.display_name || span;
      const type = ref.type || 'concept';

      const link = document.createElement('a');
      link.className = `fc-inline-ref fc-inline-ref--${type}`;
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = title;
      link.dataset.refType = type;
      link.textContent = span;

      const after = node.splitText(idx);
      after.textContent = after.textContent.substring(span.length);
      node.parentNode.insertBefore(link, after);
      replaced = true;
    }
  }

  quoteTextEl.innerHTML = html;
  quoteTextAnnotated = true;
}

/** Decode HTML entities that AI models sometimes embed in URLs. */
function cleanUrlForAttr(url) {
  if (!url) return '';
  return String(url)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

