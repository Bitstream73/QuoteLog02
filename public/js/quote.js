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

    let html = `
      <p style="margin-bottom:1.5rem;font-family:var(--font-ui);font-size:0.85rem">
        <a href="/" onclick="navigateBackToQuotes(event)" style="color:var(--accent);text-decoration:none">&larr; Back to quotes</a>
      </p>
      ${typeof buildQuoteBlockHtml === 'function'
        ? buildQuoteBlockHtml(mainQuoteData, mainQuoteTopics, false)
        : `<div class="quote-detail-card"><div class="quote-detail-text">${escapeHtml(q.text)}</div></div>`
      }
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
  return buildQuoteBlockHtml(quoteData, topics, false);
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
