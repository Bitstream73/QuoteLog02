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

    // Update page metadata
    if (typeof updatePageMeta === 'function') {
      const metaText = q.text.length > 100 ? q.text.substring(0, 100) + '...' : q.text;
      updatePageMeta(`"${metaText}" - ${q.personName}`, q.context || q.text.substring(0, 200), `/quote/${q.id}`);
    }

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
    // Author block
    const heroPersonName = q.personName || '';
    const heroPhotoUrl = q.photoUrl || '';
    const heroInitial = (heroPersonName || '?').charAt(0).toUpperCase();
    const heroAvatarHtml = heroPhotoUrl
      ? `<img src="${escapeHtml(heroPhotoUrl)}" alt="${escapeHtml(heroPersonName)}" class="quote-hero__avatar" onerror="if(!this.dataset.retry){this.dataset.retry='1';this.src=this.src}else{this.outerHTML='<div class=\\'quote-hero__avatar-placeholder\\'>${heroInitial}</div>'}" loading="lazy">`
      : `<div class="quote-hero__avatar-placeholder">${heroInitial}</div>`;

    const shareHtml = typeof buildShareButtonsHtml === 'function'
      ? buildShareButtonsHtml('quote', q.id, q.text, q.personName)
      : '';
    const importantHtml = typeof renderImportantButton === 'function'
      ? renderImportantButton('quote', q.id, q.importantsCount || q.importants_count || 0, false)
      : '';

    // Quote date
    const quoteDateStr = formatDateTime(q.quote_datetime || q.quoteDateTime || '');

    let html = `
      <p style="margin-bottom:1.5rem;font-family:var(--font-ui);font-size:var(--text-sm)">
        <a href="/" onclick="navigateBackToQuotes(event)" style="color:var(--accent);text-decoration:none">&larr; Back to quotes</a>
      </p>

      <!-- 1. Quote text — left-justified -->
      <div class="quote-page__text">
        <span class="quote-mark quote-mark--open">\u201C</span>${escapeHtml(q.text)}<span class="quote-mark quote-mark--close">\u201D</span>
      </div>

      <!-- 2. Author block — centered -->
      <div class="quote-page__author-block" onclick="navigateTo('/author/${q.personId}')" style="cursor:pointer">
        ${heroAvatarHtml}
        <span class="quote-hero__name">${escapeHtml(heroPersonName)}</span>
        ${q.personDisambiguation ? `<span class="quote-hero__role">${escapeHtml(q.personDisambiguation)}</span>` : ''}
      </div>

      <!-- 3. Context — date, context text, share + IMPORTANT -->
      <div class="quote-page__context">
        ${quoteDateStr ? `<div style="font-family:var(--font-ui);font-size:var(--text-sm);margin-bottom:0.5rem"><strong>Uttered:</strong> ${quoteDateStr}</div>` : ''}
        ${q.context ? `<div style="margin-bottom:0.5rem"><strong style="font-family:var(--font-ui);font-size:var(--text-sm)">Quote Context:</strong><div class="quote-hero__summary">${escapeHtml(q.context)}</div></div>` : ''}
        <div class="quote-hero__actions">
          ${shareHtml}
          ${importantHtml}
        </div>
      </div>
    `;

    // 4. Source — title (links to article), context, org + published date
    if (data.articles && data.articles.length > 0) {
      html += '<div class="quote-page__source">';
      html += `<strong style="font-family:var(--font-ui);font-size:var(--text-sm)">Quote Source:</strong>`;
      for (const a of data.articles) {
        const sourceName = a.source_name || a.domain || 'Source';
        const articleDate = a.published_at ? formatDateTime(a.published_at) : '';
        html += `
          <div class="quote-detail-source-item">
            <a href="/article/${a.id}" onclick="navigate(event, '/article/${a.id}')" class="quote-article-title-link">${escapeHtml(a.title || 'Untitled Article')}</a>
            ${a.context ? `<div style="font-family:var(--font-ui);font-size:var(--text-sm);color:var(--text-secondary);margin-top:0.25rem">${escapeHtml(a.context)}</div>` : ''}
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

    // 5. Fact Check section
    html += `
      <div id="fact-check-container" style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--divider-light)">
        <div id="fact-check-content">
        </div>
      </div>
    `;

    // 6. Related Quotes — two-column at 768px+
    html += `
      <div id="smart-related-section" style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--divider-light)">
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

    // Admin details panel (twirl-down)
    if (typeof isAdmin !== 'undefined' && isAdmin) {
      html += buildAdminQuoteDetailsPanel(data);
    }

    content.innerHTML = html;

    // Reset annotation flag for this page render
    quoteTextAnnotated = false;

    // Auto-load all sections in parallel
    loadSmartRelated(q.id);
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

    // Column 1: contradictions + supporting context (same author)
    let col1 = '';
    if (data.contradictions && data.contradictions.length > 0) {
      col1 += '<div class="smart-related-group">';
      col1 += '<h3 class="smart-related-group-title" style="color:var(--danger, #dc3545)">Contradictions</h3>';
      for (const c of data.contradictions) {
        col1 += buildSmartRelatedQuoteBlock(c);
      }
      col1 += '</div>';
    }
    if (data.supportingContext && data.supportingContext.length > 0) {
      col1 += '<div class="smart-related-group">';
      col1 += '<h3 class="smart-related-group-title">More Context from Same Author</h3>';
      for (const c of data.supportingContext.slice(0, 4)) {
        col1 += buildSmartRelatedQuoteBlock(c);
      }
      col1 += '</div>';
    }

    // Column 2: mentions by others
    let col2 = '';
    if (data.mentionsByOthers && data.mentionsByOthers.length > 0) {
      col2 += '<div class="smart-related-group">';
      col2 += '<h3 class="smart-related-group-title" style="color:var(--accent)">What Others Say</h3>';
      for (const m of data.mentionsByOthers.slice(0, 4)) {
        col2 += buildSmartRelatedQuoteBlock(m);
      }
      col2 += '</div>';
    }

    let html = '';
    if (!col1 && !col2) {
      html = '<p style="font-family:var(--font-ui);font-size:0.85rem;color:var(--text-muted)">No related quotes found.</p>';
    } else {
      html = '<div class="smart-related-columns">';
      html += `<div class="smart-related-col">${col1}</div>`;
      html += `<div class="smart-related-col">${col2}</div>`;
      html += '</div>';
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
    person_category_context: item.person_category_context || '',
    importants_count: item.importants_count || 0,
    quote_datetime: item.quote_datetime || item.date || '',
    article_id: item.article_id || '',
    article_title: item.article_title || '',
    source_domain: item.source_domain || '',
    source_name: item.source_name || item.sourceName || '',
  };
  return buildQuoteBlockHtml(quoteData, false, { variant: 'compact', showAvatar: true, showSummary: true });
}

/**
 * Show a refresh button by ID.
 */
function showRefreshBtn(btnId) {
  const btn = document.getElementById(btnId);
  if (btn) btn.style.display = '';
}

// ---------------------------------------------------------------------------
// Client-side caching
// ---------------------------------------------------------------------------

const FC_CACHE_PREFIX = 'fc_cache_';
const FC_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Guard against double annotation of quote text
let quoteTextAnnotated = false;

// ---------------------------------------------------------------------------
// Fact-check loading animation
// ---------------------------------------------------------------------------

const FACT_CHECK_LOADING_MESSAGES = [
  'Pulling the original document\u2026',
  'Fetching primary sources\u2026',
  'Checking the public record\u2026',
  'Retrieving filings and transcripts\u2026',
  'Verifying dates, names, and numbers\u2026',
  'Cross-referencing multiple sources\u2026',
  'Comparing official statements over time\u2026',
  'Triangulating claims with data\u2026',
  'Confirming the chain of custody\u2026',
  'Checking archived versions for edits\u2026',
  'Matching quotes to the earliest known appearance\u2026',
  'Checking whether a clip is missing context\u2026',
  'Searching the archives\u2026',
  'Dusting off the microfilm\u2026',
  'Paging through old editions\u2026',
  'Hunting for buried PDFs\u2026',
  'Following the paper trail\u2026',
  'Digging through meeting minutes\u2026',
  'Scanning footnotes and appendices\u2026',
  'Pulling records from the stacks\u2026',
  'Sifting through decades of coverage\u2026',
  'Revisiting prior reporting\u2026',
  'Comparing revisions across snapshots\u2026',
  'Mapping citations back to the source\u2026',
  'Tracking a story across years, not hours\u2026',
  'Cleaning the dataset\u2026',
  'Standardizing messy numbers\u2026',
  'Running a sanity check on the stats\u2026',
  'Rebuilding the timeline\u2026',
  'Plotting key events\u2026',
  'Looking for outliers and inconsistencies\u2026',
  'Checking denominators (because they matter)\u2026',
  'Translating jargon into plain English\u2026',
  'Comparing claims to historical baselines\u2026',
  'Looking for what\u2019s missing, not just what\u2019s there\u2026',
  'Compiling evidence packets\u2026',
  'Building a source map\u2026',
  'Logging what we know\u2014and what we don\u2019t\u2026',
  'Marking unverified details as unverified\u2026',
  'Separating reporting from speculation\u2026',
  'Updating the working notes\u2026',
  'Putting on the \u201Cdocument detective\u201D hat\u2026',
  'Following the breadcrumbs\u2026',
  'Doing a quick \u201Ctrust, but verify\u201D pass\u2026',
  'Asking the archives nicely to cooperate\u2026',
  'Making the timeline behave\u2026',
  'Chasing citations down rabbit holes\u2026',
  'Squinting at fine print so you don\u2019t have to\u2026',
  'Holding a magnifying glass to the details\u2026',
  'Turning \u201Csomeone said\u201D into \u201Chere\u2019s the source\u201D\u2026',
  'Watching for the classic \u201Cchart without axes\u201D move\u2026',
  'Checking if the numbers are doing that thing where they lie\u2026',
  'Staying up late to comb the archives (so you can sleep)\u2026',
];

let _fcLoadingTimer = null;

function startFactCheckLoadingAnimation(container) {
  stopFactCheckLoadingAnimation();
  container.innerHTML = `
    <div class="context-loading" style="flex-direction:column;align-items:flex-start;gap:0.5rem">
      <div style="font-family:var(--font-ui);font-size:var(--text-sm);color:var(--text-muted);margin-bottom:0.25rem">
        Just a sec. We're researching this for the first time.
      </div>
      <div style="display:flex;align-items:center;gap:0.5rem">
        <div class="context-loading-spinner"></div>
        <span id="fc-loading-msg" style="font-family:var(--font-ui);font-size:var(--text-sm);color:var(--text-muted)"></span>
      </div>
    </div>
  `;
  function cycle() {
    const el = document.getElementById('fc-loading-msg');
    if (!el) { _fcLoadingTimer = null; return; }
    el.textContent = FACT_CHECK_LOADING_MESSAGES[Math.floor(Math.random() * FACT_CHECK_LOADING_MESSAGES.length)];
    const delay = (Math.floor(Math.random() * 3) + 1) * 1000;
    _fcLoadingTimer = setTimeout(cycle, delay);
  }
  cycle();
}

function stopFactCheckLoadingAnimation() {
  if (_fcLoadingTimer) { clearTimeout(_fcLoadingTimer); _fcLoadingTimer = null; }
}

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
          return;
        }
        sessionStorage.removeItem(FC_CACHE_PREFIX + quoteId);
      }
    } catch { /* ignore */ }
  }

  // Show animated loading messages
  startFactCheckLoadingAnimation(container);

  // Gather quote data from the DOM
  const heroText = document.querySelector('.quote-page__text') || document.querySelector('.quote-hero__text');
  const quoteText = heroText?.textContent?.replace(/["\u201C\u201D]/g, '').trim() || '';
  const heroName = document.querySelector('.quote-hero__name');
  const authorName = heroName?.textContent?.trim() || '';
  const heroRole = document.querySelector('.quote-hero__role');
  const authorDesc = heroRole?.textContent?.trim() || '';
  const heroSummary = document.querySelector('.quote-hero__summary');
  const contextText = heroSummary?.textContent?.trim() || '';
  const sourceEl = document.querySelector('.quote-primary-source');
  const sourceName = sourceEl?.textContent?.trim() || '';
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

  } catch (err) {
    stopFactCheckLoadingAnimation();
    container.innerHTML = `<div class="context-error"><p>Fact check unavailable.</p><button class="context-btn" onclick="runFactCheck(${quoteId}, false)">Try Again</button></div>`;
  }
}

function renderFactCheckResult(container, result) {
  stopFactCheckLoadingAnimation();
  container.innerHTML = result.combinedHtml || result.html || '';
}

/**
 * After rendering reference cards, annotate the quote text with inline links
 * for referenced phrases. Uses DOM TreeWalker to only match inside text nodes,
 * preventing accidental replacement inside href URLs or HTML attributes.
 * Guarded against double-run.
 */
function annotateQuoteText(result) {
  if (quoteTextAnnotated) return;
  if (!result.references?.references) return;

  const quoteTextEl = document.querySelector('.quote-page__text') || document.querySelector('.quote-hero__text') || document.querySelector('.quote-block__text');
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

// ---------------------------------------------------------------------------
// Admin Details Panel
// ---------------------------------------------------------------------------

function buildAdminQuoteDetailsPanel(data) {
  const q = data.quote;
  const author = data.adminAuthor;
  const sources = data.adminSources || [];
  const topics = data.adminTopics || [];
  const keywords = data.adminKeywords || [];
  const extractedKeywords = data.adminExtractedKeywords || [];

  // Filter keywords that are NOT in any topic (topics have their own keywords)
  const topicNames = new Set(topics.map(t => t.name.toLowerCase()));

  let html = `
    <details class="admin-details-panel" id="admin-details-panel">
      <summary class="admin-details-panel__summary">
        <span class="admin-details-panel__title">Admin Details</span>
      </summary>
      <div class="admin-details-panel__body">
  `;

  // --- Topics section ---
  html += `<div class="admin-details-section">
    <h4 class="admin-details-section__title">Topics</h4>`;
  if (topics.length > 0) {
    html += '<div class="admin-details-tags">';
    for (const t of topics) {
      html += `<span class="admin-details-tag admin-details-tag--topic">${escapeHtml(t.name)}<span class="admin-details-tag__status">${t.status}</span></span>`;
    }
    html += '</div>';
  } else {
    html += '<p class="admin-details-empty">No topics associated</p>';
  }
  html += '</div>';

  // --- Keywords section ---
  const matchedNames = new Set(keywords.map(k => k.name.toLowerCase()));
  const pendingExtracted = extractedKeywords.filter(ek => !matchedNames.has(ek.toLowerCase()));

  html += `<div class="admin-details-section">
    <h4 class="admin-details-section__title">Keywords</h4>`;
  if (keywords.length > 0 || pendingExtracted.length > 0) {
    html += '<div class="admin-details-tags">';
    for (const k of keywords) {
      html += `<span class="admin-details-tag admin-details-tag--keyword">${escapeHtml(k.name)}${k.confidence ? `<span class="admin-details-tag__confidence">${k.confidence}</span>` : ''}</span>`;
    }
    for (const ek of pendingExtracted) {
      html += `<span class="admin-details-tag admin-details-tag--keyword admin-details-tag--pending">${escapeHtml(ek)}<span class="admin-details-tag__confidence">pending</span></span>`;
    }
    html += '</div>';
  } else {
    html += '<p class="admin-details-empty">No keywords associated</p>';
  }
  html += '</div>';

  // --- Quote Fields section ---
  html += `<div class="admin-details-section">
    <h4 class="admin-details-section__title">Quote Fields</h4>
    <table class="admin-details-table">
      <tbody>
        ${adminFieldRow('ID', q.id, false)}
        ${adminFieldRow('Text', q.text, true, 'textarea', q.id, 'quote', 'text')}
        ${adminFieldRow('Context', q.context || '', true, 'textarea', q.id, 'quote', 'context')}
        ${adminFieldRow('Type', q.quoteType || 'direct', true, 'select:direct,indirect', q.id, 'quote', 'quoteType')}
        ${adminFieldRow('Visible', q.isVisible ? 'Yes' : 'No', true, 'toggle', q.id, 'quote', 'isVisible')}
        ${adminFieldRow('Quote Date', q.quoteDateTime || '', true, 'text', q.id, 'quote', 'quoteDateTime')}
        ${adminFieldRow('First Seen', q.firstSeenAt || '', false)}
        ${adminFieldRow('Created', q.createdAt || '', false)}
        ${adminFieldRow('Canonical Quote ID', q.canonicalQuoteId || 'None', false)}
        ${adminFieldRow('Importants', q.importantsCount || 0, false)}
        ${adminFieldRow('Shares', q.shareCount || 0, false)}
        ${adminFieldRow('Trending Score', q.trendingScore || 0, false)}
        ${adminFieldRow('Fact Check', q.factCheckCategory ? q.factCheckCategory + (q.factCheckConfidence != null ? ' (' + (q.factCheckConfidence * 100).toFixed(0) + '%)' : '') : 'None', false)}
        ${adminFieldRow('Source URLs', (q.sourceUrls || []).length > 0 ? q.sourceUrls.map(u => '<a href="' + escapeHtml(u) + '" target="_blank" rel="noopener" style="color:var(--accent);word-break:break-all">' + escapeHtml(u) + '</a>').join('<br>') : 'None', false, 'html')}
        ${q.rssMetadata ? adminFieldRow('RSS Article', '<a href="' + escapeHtml(q.rssMetadata.articleUrl || '') + '" target="_blank" rel="noopener" style="color:var(--accent)">' + escapeHtml(q.rssMetadata.articleTitle || '') + '</a><br><span style="color:var(--text-muted)">' + escapeHtml(q.rssMetadata.domain || '') + ' &middot; ' + escapeHtml(q.rssMetadata.publishedAt || '') + '</span>', false, 'html') : ''}
      </tbody>
    </table>
  </div>`;

  // --- Author Fields section ---
  if (author) {
    html += `<div class="admin-details-section">
      <h4 class="admin-details-section__title">Author Fields</h4>
      <table class="admin-details-table">
        <tbody>
          ${adminFieldRow('ID', author.id, false)}
          ${adminFieldRow('Name', author.canonicalName || '', true, 'text', author.id, 'author', 'canonicalName')}
          ${adminFieldRow('Disambiguation', author.disambiguation || '', true, 'text', author.id, 'author', 'disambiguation')}
          ${adminFieldRow('Photo URL', author.photoUrl || '', true, 'text', author.id, 'author', 'photoUrl')}
          ${adminFieldRow('Category', author.category || 'Other', true, 'text', author.id, 'author', 'category')}
          ${adminFieldRow('Category Context', author.categoryContext || '', true, 'text', author.id, 'author', 'categoryContext')}
          ${adminFieldRow('Wikidata ID', author.wikidataId || 'None', false)}
          ${adminFieldRow('First Seen', author.firstSeenAt || '', false)}
          ${adminFieldRow('Last Seen', author.lastSeenAt || '', false)}
          ${adminFieldRow('Quote Count', author.quoteCount || 0, false)}
          ${adminFieldRow('Importants', author.importantsCount || 0, false)}
          ${adminFieldRow('Shares', author.shareCount || 0, false)}
          ${adminFieldRow('Views', author.viewCount || 0, false)}
          ${adminFieldRow('Trending Score', author.trendingScore || 0, false)}
          ${(author.organizations || []).length > 0 ? adminFieldRow('Organizations', author.organizations.join(', '), false) : ''}
          ${(author.titles || []).length > 0 ? adminFieldRow('Titles', author.titles.join(', '), false) : ''}
        </tbody>
      </table>
    </div>`;
  }

  // --- Source Fields section ---
  if (sources.length > 0) {
    for (const src of sources) {
      html += `<div class="admin-details-section">
        <h4 class="admin-details-section__title">Source: ${escapeHtml(src.name || src.domain)}</h4>
        <table class="admin-details-table">
          <tbody>
            ${adminFieldRow('ID', src.id, false)}
            ${adminFieldRow('Domain', src.domain || '', true, 'text', src.id, 'source', 'domain')}
            ${adminFieldRow('Name', src.name || '', true, 'text', src.id, 'source', 'name')}
            ${adminFieldRow('RSS URL', src.rssUrl || '', true, 'text', src.id, 'source', 'rss_url')}
            ${adminFieldRow('Enabled', src.enabled ? 'Yes' : 'No', true, 'toggle', src.id, 'source', 'enabled')}
            ${adminFieldRow('Top Story', src.isTopStory ? 'Yes' : 'No', true, 'toggle', src.id, 'source', 'is_top_story')}
            ${adminFieldRow('Failures', src.consecutiveFailures || 0, false)}
            ${adminFieldRow('Created', src.createdAt || '', false)}
            ${adminFieldRow('Updated', src.updatedAt || '', false)}
          </tbody>
        </table>
      </div>`;
    }
  }

  html += '</div></details>';
  return html;
}

function adminFieldRow(label, value, editable, inputType, entityId, entityType, fieldName) {
  const displayValue = inputType === 'html' ? value : escapeHtml(String(value));

  if (!editable) {
    return `<tr class="admin-details-row">
      <td class="admin-details-row__label">${escapeHtml(label)}</td>
      <td class="admin-details-row__value">${displayValue}</td>
    </tr>`;
  }

  const editId = `admin-edit-${entityType}-${fieldName}-${entityId}`;
  return `<tr class="admin-details-row">
    <td class="admin-details-row__label">${escapeHtml(label)}</td>
    <td class="admin-details-row__value admin-details-row__value--editable">
      <span id="${editId}-display" onclick="adminStartInlineEdit('${editId}', '${inputType}', '${entityType}', '${fieldName}', ${entityId})">${displayValue}</span>
      <button class="admin-details-edit-btn" onclick="adminStartInlineEdit('${editId}', '${inputType}', '${entityType}', '${fieldName}', ${entityId})" title="Edit">&#9998;</button>
    </td>
  </tr>`;
}

function adminStartInlineEdit(editId, inputType, entityType, fieldName, entityId) {
  const display = document.getElementById(editId + '-display');
  if (!display || display.style.display === 'none') return;

  const currentValue = display.textContent.trim();
  display.style.display = 'none';

  // Hide the edit button
  const editBtn = display.nextElementSibling;
  if (editBtn) editBtn.style.display = 'none';

  let inputHtml;
  if (inputType === 'textarea') {
    inputHtml = `<textarea id="${editId}-input" class="admin-details-input" rows="3">${escapeHtml(currentValue)}</textarea>`;
  } else if (inputType.startsWith('select:')) {
    const options = inputType.substring(7).split(',');
    inputHtml = `<select id="${editId}-input" class="admin-details-input">
      ${options.map(o => `<option value="${o}" ${o === currentValue ? 'selected' : ''}>${o}</option>`).join('')}
    </select>`;
  } else if (inputType === 'toggle') {
    const isOn = currentValue === 'Yes';
    inputHtml = `<select id="${editId}-input" class="admin-details-input">
      <option value="true" ${isOn ? 'selected' : ''}>Yes</option>
      <option value="false" ${!isOn ? 'selected' : ''}>No</option>
    </select>`;
  } else {
    inputHtml = `<input id="${editId}-input" type="text" class="admin-details-input" value="${escapeHtml(currentValue)}">`;
  }

  const actionsHtml = `<div id="${editId}-actions" class="admin-details-actions">
    ${inputHtml}
    <div class="admin-details-actions__buttons">
      <button class="admin-details-save-btn" onclick="adminSaveInlineEdit('${editId}', '${inputType}', '${entityType}', '${fieldName}', ${entityId})">Save</button>
      <button class="admin-details-cancel-btn" onclick="adminCancelInlineEdit('${editId}')">Cancel</button>
    </div>
  </div>`;

  display.insertAdjacentHTML('afterend', actionsHtml);

  // Focus the input
  const input = document.getElementById(editId + '-input');
  if (input) input.focus();
}

function adminCancelInlineEdit(editId) {
  const actions = document.getElementById(editId + '-actions');
  if (actions) actions.remove();
  const display = document.getElementById(editId + '-display');
  if (display) display.style.display = '';
  // Show the edit button again
  if (display && display.nextElementSibling) display.nextElementSibling.style.display = '';
}

async function adminSaveInlineEdit(editId, inputType, entityType, fieldName, entityId) {
  const input = document.getElementById(editId + '-input');
  if (!input) return;

  let newValue = input.value;

  // Convert toggle values
  if (inputType === 'toggle') {
    newValue = newValue === 'true';
  }

  // Build the API call
  let url, body;
  if (entityType === 'quote') {
    url = `/quotes/${entityId}`;
    body = { [fieldName]: newValue };
  } else if (entityType === 'author') {
    url = `/authors/${entityId}`;
    body = { [fieldName]: newValue };
  } else if (entityType === 'source') {
    url = `/sources/${entityId}`;
    body = { [fieldName]: newValue };
  }

  try {
    await API.patch(url, body);
    showToast('Updated successfully', 'success');

    // Update the display value
    const display = document.getElementById(editId + '-display');
    if (display) {
      if (inputType === 'toggle') {
        display.textContent = newValue ? 'Yes' : 'No';
      } else {
        display.textContent = input.value;
      }
    }
    adminCancelInlineEdit(editId);
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

