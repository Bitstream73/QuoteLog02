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
    const dateStr = formatDateTime(q.createdAt);

    // Headshot
    const initial = (q.personName || '?').charAt(0).toUpperCase();
    const placeholderDiv = `<div class="quote-headshot-placeholder">${initial}</div>`;
    const headshotHtml = q.photoUrl
      ? `<img src="${escapeHtml(q.photoUrl)}" alt="${escapeHtml(q.personName)}" class="quote-headshot" onerror="this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'">`
      : (typeof isAdmin !== 'undefined' && isAdmin
        ? `<a href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent((q.personName || '') + ' ' + (q.personDisambiguation || ''))}" target="_blank" rel="noopener" class="admin-headshot-search" title="Search Google Images">${placeholderDiv}</a>`
        : placeholderDiv);

    // Quote type
    const quoteTypeHtml = q.quoteType === 'indirect'
      ? `<span class="quote-type-badge quote-type-indirect">Indirect</span>`
      : '';

    // Important? button for detail page
    const importantHtml = typeof renderImportantButton === 'function'
      ? renderImportantButton('quote', q.id, q.importantsCount || q.importants_count || 0, false)
      : '';

    let html = `
      <p style="margin-bottom:1.5rem;font-family:var(--font-ui);font-size:0.85rem">
        <a href="/" onclick="navigateBackToQuotes(event)" style="color:var(--accent);text-decoration:none">&larr; Back to quotes</a>
      </p>
      <div class="quote-detail-card">
        <div class="quote-layout" style="gap:1.25rem">
          <div class="quote-headshot-col">${headshotHtml}</div>
          <div class="quote-content-col">
            <div class="quote-detail-text">${escapeHtml(q.text)}</div>
            <div class="quote-author-block" style="margin-top:0.75rem">
              <div class="quote-author-row">
                <a href="/author/${q.personId}" onclick="navigate(event, '/author/${q.personId}')" class="author-link">${escapeHtml(q.personName)}</a>
                ${quoteTypeHtml}
              </div>
              ${q.personDisambiguation ? `<div class="quote-author-description">${escapeHtml(q.personDisambiguation)}</div>` : ''}
            </div>
            ${q.context ? `<div class="quote-context" style="margin-top:0.75rem">${escapeHtml(q.context)}</div>` : ''}
            ${q.quote_datetime || q.quoteDateTime ? `<div class="quote-date-inline" style="margin-top:0.5rem"><strong>Quote Date:</strong> ${escapeHtml(q.quote_datetime || q.quoteDateTime)}</div>` : ''}
            ${dateStr ? `<div class="quote-date-inline" style="margin-top:0.5rem">${dateStr}</div>` : ''}
            <div style="margin-top:0.75rem">${importantHtml}</div>
            ${typeof buildAdminActionsHtml === 'function' ? buildAdminActionsHtml({
              id: q.id, personId: q.personId, personName: q.personName,
              text: q.text, context: q.context, isVisible: q.isVisible,
              personCategory: null, personCategoryContext: null,
              disambiguation: q.personDisambiguation
            }) : ''}
          </div>
        </div>
      </div>
    `;

    // Articles / Sources
    if (data.articles && data.articles.length > 0) {
      html += '<h2 style="margin:2rem 0 1rem;font-family:var(--font-headline);font-size:1.3rem">Sources</h2>';
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
              ${a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" style="font-family:var(--font-ui);font-size:0.75rem;color:var(--accent);text-decoration:none">View original &rarr;</a>` : ''}
            </div>
          </div>
        `;
      }
      html += '</div>';
    }

    // Share buttons
    const shareHtml = typeof buildShareButtonsHtml === 'function'
      ? buildShareButtonsHtml('quote', q.id, q.text, q.personName)
      : '';
    html += `<div style="margin-top:1.5rem">${shareHtml}</div>`;

    // Context & Analysis section (Get More Context button)
    html += `
      <div class="context-analysis-section" style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
          <h2 style="margin:0;font-family:var(--font-headline);font-size:1.3rem">Context & Analysis</h2>
          <button class="context-btn" id="context-btn" onclick="loadQuoteContext(${q.id}, false)">Get More Context</button>
        </div>
        <div id="context-analysis-content"></div>
      </div>
    `;

    // Smart Related Quotes section (auto-loading)
    html += `
      <div id="smart-related-section" style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--border)">
        <h2 style="margin:0 0 1rem;font-family:var(--font-headline);font-size:1.3rem">Related Quotes</h2>
        <div id="smart-related-content">
          <div class="smart-related-loading">
            <div class="context-loading-spinner"></div>
            <span style="font-family:var(--font-ui);font-size:0.85rem;color:var(--text-muted)">Loading related quotes...</span>
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

    // Auto-load smart related quotes
    loadSmartRelated(q.id);
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
        html += buildSmartRelatedCard(c, 'smart-related-contradiction');
      }
      html += '</div>';
    }

    // Supporting context
    if (data.supportingContext && data.supportingContext.length > 0) {
      html += '<div id="supporting-context-section" class="smart-related-group">';
      html += '<h3 class="smart-related-group-title">More Context from Same Author</h3>';
      for (const c of data.supportingContext) {
        html += buildSmartRelatedCard(c, 'smart-related-context');
      }
      html += '</div>';
    }

    // Mentions by others
    if (data.mentionsByOthers && data.mentionsByOthers.length > 0) {
      html += '<div id="mentions-section" class="smart-related-group">';
      html += '<h3 class="smart-related-group-title" style="color:var(--accent)">What Others Say</h3>';
      for (const m of data.mentionsByOthers) {
        html += buildSmartRelatedCard(m, 'smart-related-mention');
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
 * Build a smart related quote card.
 */
function buildSmartRelatedCard(item, cssClass) {
  const dateStr = item.date ? formatDateTime(item.date) : '';
  return `
    <a href="/quote/${item.id}" class="card-link" onclick="navigate(event, '/quote/${item.id}')">
      <div class="smart-related-card ${cssClass}">
        <div class="quote-text" style="font-size:0.9rem">${escapeHtml(item.text)}</div>
        ${item.explanation ? `<div class="smart-related-explanation">${escapeHtml(item.explanation)}</div>` : ''}
        <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;margin-top:0.5rem">
          <span class="smart-related-author">${escapeHtml(item.authorName)}</span>
          ${dateStr ? `<span class="quote-date-inline">${dateStr}</span>` : ''}
          ${item.sourceUrl ? `<span class="evidence-source-cite" onclick="event.preventDefault();event.stopPropagation();window.open('${escapeHtml(item.sourceUrl)}','_blank')">Source: ${escapeHtml(item.sourceName || 'Article')} &rarr;</span>` : ''}
        </div>
      </div>
    </a>
  `;
}

/**
 * Load AI context analysis for a quote (triggered by button click).
 */
async function loadQuoteContext(quoteId, force) {
  const btn = document.getElementById('context-btn');
  const container = document.getElementById('context-analysis-content');
  if (!btn || !container) return;

  // Update button state
  btn.disabled = true;
  btn.innerHTML = '<span class="context-loading-spinner" style="display:inline-block;width:14px;height:14px;vertical-align:middle;margin-right:0.5rem"></span>Analyzing...';
  container.innerHTML = '';

  try {
    const data = await API.post(`/quotes/${quoteId}/context${force ? '?force=true' : ''}`);
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

        // Supporting evidence
        if (claim.supporting && claim.supporting.length > 0) {
          html += '<div class="context-evidence context-evidence-supporting">';
          html += '<div class="context-evidence-label">Supporting</div>';
          for (const ev of claim.supporting) {
            html += buildEvidenceItem(ev);
          }
          html += '</div>';
        }

        // Contradicting evidence
        if (claim.contradicting && claim.contradicting.length > 0) {
          html += '<div class="context-evidence context-evidence-contradicting">';
          html += '<div class="context-evidence-label">Contradicting</div>';
          for (const ev of claim.contradicting) {
            html += buildEvidenceItem(ev);
          }
          html += '</div>';
        }

        // Additional context
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

    // Update button to "Refresh Analysis"
    btn.disabled = false;
    btn.innerHTML = 'Refresh Analysis';
    btn.onclick = function() { loadQuoteContext(quoteId, true); };
  } catch (err) {
    container.innerHTML = `<div class="context-error"><p>Analysis unavailable. ${escapeHtml(err.message)}</p><button class="context-btn" onclick="loadQuoteContext(${quoteId}, false)">Try Again</button></div>`;
    btn.disabled = false;
    btn.innerHTML = 'Get More Context';
  }
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
