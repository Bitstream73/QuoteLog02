/**
 * factCheck.js — Core pipeline for quote fact-checking.
 *
 * Pipeline (grounded — uses Gemini's built-in Google Search):
 *   1. classifyAndVerify() — Single grounded Gemini call that classifies AND verifies
 *   2. renderHTML() — Template rendering (or Gemini for complex display types)
 *
 * Reference Pipeline (runs in parallel):
 *   R1. extractAndEnrichReferences() — Single grounded Gemini call that extracts AND enriches
 *   R2. renderReferencesHTML() — Template rendering
 */

import gemini from './ai/gemini.js';
import logger from './logger.js';
import {
  classifyAndVerifyPrompt,
  extractAndEnrichReferencesPrompt,
  htmlRenderingPrompt,
} from './factCheckPrompts.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const VERDICT_COLORS = {
  TRUE:           'var(--success)',
  MOSTLY_TRUE:    'var(--success)',
  FALSE:          'var(--error)',
  MOSTLY_FALSE:   'var(--error)',
  MISLEADING:     'var(--warning)',
  LACKS_CONTEXT:  'var(--warning)',
  UNVERIFIABLE:   'var(--info)',
};

const VERDICT_LABELS = {
  TRUE:           '\u2713 Verified True',
  MOSTLY_TRUE:    '\u2248 Mostly True',
  FALSE:          '\u2717 False',
  MOSTLY_FALSE:   '\u2248 Mostly False',
  MISLEADING:     '\u26A0 Misleading',
  LACKS_CONTEXT:  '\u26A0 Lacks Context',
  UNVERIFIABLE:   '? Unverifiable',
};

// ---------------------------------------------------------------------------
// Step 1: Classify and verify the quote (single grounded Gemini call)
// ---------------------------------------------------------------------------

async function classifyAndVerify(quoteData) {
  const prompt = classifyAndVerifyPrompt(quoteData);
  const result = await gemini.generateGroundedJSON(prompt);

  if (!['A', 'B', 'C'].includes(result.category)) {
    throw new Error(`Invalid category: ${result.category}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Step 2: Render HTML
// ---------------------------------------------------------------------------

async function renderHTML(result, quoteId) {
  if (result.category === 'B') {
    return renderCategoryLabel(
      'opinion',
      'Opinion / Subjective',
      result.reasoning,
      result.summary_label
    );
  }

  if (result.category === 'C') {
    return renderCategoryLabel(
      'fragment',
      'Unverifiable Fragment',
      result.reasoning,
      result.summary_label
    );
  }

  // Category A — use verdict data from the grounded response
  if (!result.verdict) {
    return renderCategoryLabel(
      'error',
      'Verification Error',
      'Evidence evaluation data was not available.',
      ''
    );
  }

  // For simple verdicts, use template rendering (fast, no extra Gemini call)
  if (['text', 'single_stat', 'excerpt'].includes(result.display_type)) {
    return renderVerdictTemplate(result, quoteId);
  }

  // For complex visualizations, use Gemini to generate custom HTML
  try {
    const prompt = htmlRenderingPrompt({
      verdict: result,
      claim: result.claims[0],
      displayType: result.display_type,
    });
    const html = await gemini.generateText(prompt);
    const rendered = html.replace(/^```html?\s*/i, '').replace(/```\s*$/, '').trim();
    return rendered + renderFeedbackButtons(quoteId);
  } catch (err) {
    logger.error('factcheck', 'html_rendering_failed', {}, err);
    return renderVerdictTemplate(result, quoteId);
  }
}

// ---------------------------------------------------------------------------
// Template Renderers (no Gemini call needed)
// ---------------------------------------------------------------------------

function renderCategoryLabel(type, title, reasoning, summaryLabel) {
  const iconMap = {
    opinion:  '\uD83D\uDCAC',
    fragment: '\u2014',
    error:    '\u26A0',
  };

  const colorMap = {
    opinion:  'var(--text-muted)',
    fragment: 'var(--text-muted)',
    error:    'var(--warning)',
  };

  return `
<div class="fc-widget fc-widget--${type}">
  <div class="fc-header">
    <span class="fc-badge" style="background: ${colorMap[type]};">${iconMap[type]} ${title}</span>
    <button class="fc-bug-btn" onclick="showBugReportModal(window._currentQuoteId)" title="Report issue with this fact-check">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3.003 3.003 0 116 0v1"/>
        <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6"/>
        <path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M6 17l-4 1M17.47 9c1.93-.2 3.53-1.9 3.53-4M18 13h4M18 17l4 1"/>
      </svg>
    </button>
  </div>
  <p class="fc-explanation">${escapeHtml(reasoning)}</p>
  ${summaryLabel ? `<span class="fc-label">${escapeHtml(summaryLabel)}</span>` : ''}
</div>`;
}

function renderFeedbackButtons(quoteId) {
  if (!quoteId) return '';
  return `
  <div class="fc-feedback" data-quote-id="${quoteId}">
    <span class="fc-feedback-label">Do you agree with this fact-check?</span>
    <div class="fc-feedback-buttons">
      <button class="fc-feedback-btn fc-feedback-agree" onclick="handleFactCheckFeedback(event, ${quoteId}, 'agree')">
        Agree <span class="fc-feedback-count">(0)</span>
      </button>
      <button class="fc-feedback-btn fc-feedback-disagree" onclick="handleFactCheckFeedback(event, ${quoteId}, 'disagree')">
        Disagree <span class="fc-feedback-count">(0)</span>
      </button>
    </div>
  </div>`;
}

function renderVerdictTemplate(v, quoteId) {
  const verdictColor = VERDICT_COLORS[v.verdict] || 'var(--text-muted)';
  const verdictLabel = VERDICT_LABELS[v.verdict] || v.verdict;

  let dataPointsHTML = '';
  if (v.key_data_points && v.key_data_points.length > 0) {
    const points = v.key_data_points.map(dp => `
      <div class="fc-data-point">
        <span class="fc-data-label">${escapeHtml(dp.label)}</span>
        <span class="fc-data-value">${escapeHtml(dp.value)}</span>
        ${dp.source_url
          ? `<a class="fc-data-source" href="${escapeHtml(dp.source_url)}" target="_blank" rel="noopener">${escapeHtml(dp.source_name || 'Source')}</a>`
          : dp.source_name ? `<span class="fc-data-source">${escapeHtml(dp.source_name)}</span>` : ''
        }
      </div>
    `).join('');

    dataPointsHTML = `<div class="fc-data-points">${points}</div>`;
  }

  let statHTML = '';
  if (v.display_type === 'single_stat' && v.key_data_points?.[0]) {
    const dp = v.key_data_points[0];
    statHTML = `
      <div class="fc-single-stat">
        <div class="fc-stat-value">${escapeHtml(dp.value)}</div>
        <div class="fc-stat-label">${escapeHtml(dp.label)}</div>
      </div>
    `;
  }

  let excerptHTML = '';
  if (v.display_type === 'excerpt' && v.key_data_points?.[0]) {
    const dp = v.key_data_points[0];
    excerptHTML = `
      <blockquote class="fc-excerpt">
        <p>${escapeHtml(dp.value)}</p>
        <cite>
          ${dp.source_url
            ? `<a href="${escapeHtml(dp.source_url)}" target="_blank" rel="noopener">${escapeHtml(dp.source_name || 'Source')}</a>`
            : escapeHtml(dp.source_name || '')
          }
        </cite>
      </blockquote>
    `;
  }

  let citationHTML = '';
  if (v.citation) {
    citationHTML = `
      <div class="fc-citation">
        <span class="fc-citation-text">${escapeHtml(v.citation.text)}</span>
        ${v.citation.url
          ? `<a class="fc-citation-link" href="${escapeHtml(v.citation.url)}" target="_blank" rel="noopener">View source \u2192</a>`
          : ''
        }
      </div>
    `;
  }

  return `
<div class="fc-widget fc-widget--verdict">
  <div class="fc-header">
    <span class="fc-badge" style="background: ${verdictColor};">${verdictLabel}</span>
    <span class="fc-badge-sub">Automated Fact-Check</span>
  </div>
  <p class="fc-explanation">${escapeHtml(v.verdict_explanation)}</p>
  ${statHTML}
  ${excerptHTML}
  ${dataPointsHTML}
  ${citationHTML}
  ${renderFeedbackButtons(quoteId)}
</div>`;
}


// ---------------------------------------------------------------------------
// Reference Pipeline: Extract + Enrich (single grounded call) \u2192 Render
// ---------------------------------------------------------------------------

async function extractAndEnrichReferences(quoteData) {
  const prompt = extractAndEnrichReferencesPrompt(quoteData);
  const result = await gemini.generateGroundedJSON(prompt);

  if (!result.references) result.references = [];

  return result;
}

function renderReferencesHTML(enrichedData) {
  const { references, media_clip: mediaClip } = enrichedData;

  const found = references.filter(r => r.enrichment?.found);
  const hasMediaClip = mediaClip?.enrichment?.found;

  if (found.length === 0 && !hasMediaClip) {
    return '';
  }

  let mediaClipHTML = '';
  if (hasMediaClip && mediaClip.enrichment.media_embed?.type === 'youtube' && mediaClip.enrichment.media_embed?.url) {
    const embedUrl = cleanUrl(mediaClip.enrichment.media_embed.url);
    const videoTitle = escapeHtml(mediaClip.enrichment.media_embed.title || 'Video clip');
    mediaClipHTML = `
    <div class="fc-ref-media-clip">
      <div class="fc-ref-media-header">
        <span class="fc-ref-type-badge fc-ref-type-badge--media_clip">\uD83D\uDCFA Watch the Clip</span>
        ${mediaClip.enrichment.date_context ? `<span class="fc-ref-date">${escapeHtml(mediaClip.enrichment.date_context)}</span>` : ''}
      </div>
      <div class="fc-ref-video-container">
        <iframe
          src="${escapeHtml(embedUrl)}"
          title="${videoTitle}"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
          loading="lazy">
        </iframe>
      </div>
      ${mediaClip.enrichment.summary ? `<p class="fc-ref-summary">${escapeHtml(mediaClip.enrichment.summary)}</p>` : ''}
      ${mediaClip.enrichment.primary_url ? `
        <a class="fc-ref-primary-link" href="${escapeHtml(cleanUrl(mediaClip.enrichment.primary_url))}" target="_blank" rel="noopener">
          Watch on ${escapeHtml(mediaClip.enrichment.primary_source_name || 'YouTube')} \u2192
        </a>
      ` : ''}
    </div>`;
  } else if (hasMediaClip && mediaClip.enrichment.primary_url) {
    mediaClipHTML = `
    <div class="fc-ref-card fc-ref-card--media_clip">
      <div class="fc-ref-card-header">
        <span class="fc-ref-type-badge fc-ref-type-badge--media_clip">\uD83D\uDCFA Clip</span>
        <a class="fc-ref-title" href="${escapeHtml(cleanUrl(mediaClip.enrichment.primary_url))}" target="_blank" rel="noopener">
          ${escapeHtml(mediaClip.enrichment.title || 'Watch the clip')}
        </a>
      </div>
      ${mediaClip.enrichment.summary ? `<p class="fc-ref-summary">${escapeHtml(mediaClip.enrichment.summary)}</p>` : ''}
      <div class="fc-ref-card-footer">
        <span class="fc-ref-source">${escapeHtml(mediaClip.enrichment.primary_source_name || '')}</span>
        ${mediaClip.enrichment.date_context ? `<span class="fc-ref-date">${escapeHtml(mediaClip.enrichment.date_context)}</span>` : ''}
      </div>
    </div>`;
  }

  const TYPE_ICONS = {
    policy:         '\uD83D\uDCDC',
    organization:   '\uD83C\uDFDB',
    person:         '\uD83D\uDC64',
    event:          '\uD83D\uDCC5',
    concept:        '\uD83D\uDCA1',
    location:       '\uD83D\uDCCD',
    statistic:      '\uD83D\uDCCA',
    media_clip:     '\uD83D\uDCFA',
    legal_document: '\u2696\uFE0F',
  };

  const refCardsHTML = found.map(ref => {
    const e = ref.enrichment;
    const icon = TYPE_ICONS[ref.type] || '\uD83D\uDD17';
    const categoryTag = e.category_tag ? escapeHtml(e.category_tag) : ref.type;

    let additionalLinksHTML = '';
    if (e.additional_links && e.additional_links.length > 0) {
      const links = e.additional_links.slice(0, 2).map(link =>
        `<a class="fc-ref-additional-link" href="${escapeHtml(cleanUrl(link.url))}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>`
      ).join('');
      additionalLinksHTML = `<div class="fc-ref-additional-links">${links}</div>`;
    }

    let inlineVideoHTML = '';
    if (e.media_embed?.type === 'youtube' && e.media_embed?.url) {
      inlineVideoHTML = `
        <div class="fc-ref-video-container fc-ref-video-container--inline">
          <iframe
            src="${escapeHtml(cleanUrl(e.media_embed.url))}"
            title="${escapeHtml(e.media_embed.title || 'Video')}"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            loading="lazy">
          </iframe>
        </div>`;
    }

    return `
    <div class="fc-ref-card fc-ref-card--${escapeHtml(ref.type)}" data-ref-span="${escapeHtml(ref.text_span)}" data-ref-priority="${ref.priority || 'medium'}">
      <div class="fc-ref-card-header">
        <span class="fc-ref-type-badge fc-ref-type-badge--${escapeHtml(ref.type)}">${icon} ${categoryTag}</span>
        ${e.primary_url
          ? `<a class="fc-ref-title" href="${escapeHtml(cleanUrl(e.primary_url))}" target="_blank" rel="noopener">${escapeHtml(e.title || ref.display_name)}</a>`
          : `<span class="fc-ref-title">${escapeHtml(e.title || ref.display_name)}</span>`
        }
      </div>
      ${e.summary ? `<p class="fc-ref-summary">${escapeHtml(e.summary)}</p>` : ''}
      ${inlineVideoHTML}
      <div class="fc-ref-card-footer">
        ${e.primary_source_name ? `<span class="fc-ref-source">${escapeHtml(e.primary_source_name)}</span>` : ''}
        ${e.date_context ? `<span class="fc-ref-date">${escapeHtml(e.date_context)}</span>` : ''}
      </div>
      ${additionalLinksHTML}
    </div>`;
  }).join('');

  return `
<div class="fc-references">
  <div class="fc-references-header">
    <h4 class="fc-references-title">Referenced in this Quote</h4>
    <span class="fc-references-count">${found.length} reference${found.length !== 1 ? 's' : ''}${hasMediaClip ? ' + clip' : ''}</span>
  </div>
  ${mediaClipHTML}
  <div class="fc-ref-cards">
    ${refCardsHTML}
  </div>
</div>`;
}


// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

async function factCheckQuote(quoteData, options = {}) {
  const startTime = Date.now();
  const { skipFactCheck = false, skipReferences = false, quoteId = null } = options;

  const factCheckPromise = skipFactCheck
    ? Promise.resolve(null)
    : runFactCheckPipeline(quoteData, quoteId);

  const referencesPromise = skipReferences
    ? Promise.resolve(null)
    : runReferencesPipeline(quoteData);

  const [factCheckResult, referencesResult] = await Promise.all([
    factCheckPromise,
    referencesPromise,
  ]);

  const factCheckHtml = factCheckResult?.html || '';
  const referencesHtml = referencesResult?.html || '';

  const combinedHtml = [factCheckHtml, referencesHtml].filter(Boolean).join('\n');

  // Persist verdict data + rendered HTML/references to the quote record
  if (quoteId) {
    try {
      const { getDb } = await import('../config/database.js');
      const db = getDb();

      if (factCheckResult) {
        const classification = factCheckResult.classification || {};
        const verdict = factCheckResult.verdict || null;
        const claim = classification.claims?.[0]?.claim_text || classification.summary_label || null;
        const explanation = classification.verdict_explanation || classification.reasoning || null;

        db.prepare(`
          UPDATE quotes
          SET fact_check_verdict = ?, fact_check_claim = ?, fact_check_explanation = ?,
              fact_check_html = ?, fact_check_references_json = ?
          WHERE id = ?
        `).run(
          verdict, claim, explanation,
          combinedHtml || null,
          referencesResult?.enriched ? JSON.stringify(referencesResult.enriched) : null,
          quoteId
        );
      } else if (combinedHtml || referencesResult?.enriched) {
        // References-only run (skipFactCheck=true) — still persist HTML + refs
        db.prepare(`
          UPDATE quotes
          SET fact_check_html = ?, fact_check_references_json = ?
          WHERE id = ?
        `).run(
          combinedHtml || null,
          referencesResult?.enriched ? JSON.stringify(referencesResult.enriched) : null,
          quoteId
        );
      }
    } catch (err) {
      logger.warn('factcheck', 'persist_verdict_failed', { quoteId, error: err.message });
    }
  }

  return {
    category: factCheckResult?.category || null,
    classification: factCheckResult?.classification || null,
    verdict: factCheckResult?.verdict || null,
    html: factCheckHtml,
    references: referencesResult?.enriched || null,
    referencesHtml,
    combinedHtml,
    processingTimeMs: Date.now() - startTime,
  };
}

async function runFactCheckPipeline(quoteData, quoteId) {
  const result = await classifyAndVerify(quoteData);

  if (result.category !== 'A') {
    const html = await renderHTML(result, quoteId);
    return { category: result.category, classification: result, verdict: null, html };
  }

  const html = await renderHTML(result, quoteId);
  return { category: result.category, classification: result, verdict: result.verdict, html };
}

async function runReferencesPipeline(quoteData) {
  const enriched = await extractAndEnrichReferences(quoteData);
  await validateReferenceUrls(enriched);

  if (enriched.references.length === 0 && !enriched.media_clip?.enrichment?.found) {
    return { enriched: null, html: '' };
  }

  const html = renderReferencesHTML(enriched);
  return { enriched, html };
}

/**
 * Validate all reference URLs with HEAD requests.
 * Broken URLs (4xx/5xx/timeout) are removed or replaced:
 * - If primary_url is broken, promote the first working additional_link
 * - Remove broken entries from additional_links
 * Mutates enrichedData in place.
 */
async function validateReferenceUrls(enrichedData) {
  if (!enrichedData) return enrichedData;

  const hasRefs = enrichedData.references?.length > 0;
  const hasClip = enrichedData.media_clip?.enrichment?.found;
  if (!hasRefs && !hasClip) return enrichedData;

  // Collect all unique URLs to validate
  const urlSet = new Set();
  for (const ref of (enrichedData.references || [])) {
    const e = ref.enrichment;
    if (!e) continue;
    if (e.primary_url) urlSet.add(cleanUrl(e.primary_url));
    if (e.additional_links) {
      for (const link of e.additional_links) {
        if (link.url) urlSet.add(cleanUrl(link.url));
      }
    }
  }

  // Also collect media clip URLs
  if (hasClip) {
    const clipE = enrichedData.media_clip.enrichment;
    if (clipE.primary_url) urlSet.add(cleanUrl(clipE.primary_url));
    if (clipE.media_embed?.url) urlSet.add(cleanUrl(clipE.media_embed.url));
  }

  if (urlSet.size === 0) return enrichedData;

  // Validate all URLs in parallel
  const results = new Map();
  await Promise.all(
    [...urlSet].map(async (url) => {
      try {
        const res = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(4000),
        });
        results.set(url, res.ok);
      } catch {
        results.set(url, false);
      }
    })
  );

  // Apply results to references
  for (const ref of (enrichedData.references || [])) {
    const e = ref.enrichment;
    if (!e) continue;

    // Filter broken additional_links first
    if (e.additional_links) {
      e.additional_links = e.additional_links.filter(link => {
        const ok = results.get(cleanUrl(link.url));
        if (!ok) logger.warn('references', 'broken_additional_link', { url: link.url, ref: ref.display_name });
        return ok;
      });
    }

    // Check primary_url
    if (e.primary_url && !results.get(cleanUrl(e.primary_url))) {
      logger.warn('references', 'broken_primary_url', { url: e.primary_url, ref: ref.display_name });

      // Promote first working additional_link
      if (e.additional_links?.length > 0) {
        const promoted = e.additional_links.shift();
        e.primary_url = promoted.url;
        e.primary_source_name = promoted.label || e.primary_source_name;
      } else {
        e.primary_url = null;
      }
    }
  }

  // Apply results to media clip — remove broken embed/primary URLs
  if (hasClip) {
    const clipE = enrichedData.media_clip.enrichment;

    if (clipE.media_embed?.url && !results.get(cleanUrl(clipE.media_embed.url))) {
      logger.warn('references', 'broken_media_embed_url', { url: clipE.media_embed.url });
      clipE.media_embed.url = null;
    }

    if (clipE.primary_url && !results.get(cleanUrl(clipE.primary_url))) {
      logger.warn('references', 'broken_media_clip_url', { url: clipE.primary_url });
      clipE.primary_url = null;
    }
  }

  return enrichedData;
}


// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Decode HTML entities that AI models sometimes embed in URLs
 * (e.g. &amp; instead of &) before we HTML-escape for attributes.
 * Without this, escapeHtml double-encodes &amp; \u2192 &amp;amp; which
 * leaves a literal "&amp;" in the browser's resolved href.
 */
function cleanUrl(url) {
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
// Exports
// ---------------------------------------------------------------------------

export {
  classifyAndVerify,
  factCheckQuote,
  extractAndEnrichReferences,
  validateReferenceUrls,
  VERDICT_COLORS,
  VERDICT_LABELS,
};
