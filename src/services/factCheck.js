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
  TRUE:           '✓ Verified True',
  MOSTLY_TRUE:    '≈ Mostly True',
  FALSE:          '✗ False',
  MOSTLY_FALSE:   '≈ Mostly False',
  MISLEADING:     '⚠ Misleading',
  LACKS_CONTEXT:  '⚠ Lacks Context',
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

async function renderHTML(result) {
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
    return renderVerdictTemplate(result);
  }

  // For complex visualizations, use Gemini to generate custom HTML
  try {
    const prompt = htmlRenderingPrompt({
      verdict: result,
      claim: result.claims[0],
      displayType: result.display_type,
    });
    const html = await gemini.generateText(prompt);
    return html.replace(/^```html?\s*/i, '').replace(/```\s*$/, '').trim();
  } catch (err) {
    logger.error('factcheck', 'html_rendering_failed', {}, err);
    return renderVerdictTemplate(result);
  }
}

// ---------------------------------------------------------------------------
// Template Renderers (no Gemini call needed)
// ---------------------------------------------------------------------------

function renderCategoryLabel(type, title, reasoning, summaryLabel) {
  const iconMap = {
    opinion:  '💬',
    fragment: '—',
    error:    '⚠',
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
  </div>
  <p class="fc-explanation">${escapeHtml(reasoning)}</p>
  ${summaryLabel ? `<span class="fc-label">${escapeHtml(summaryLabel)}</span>` : ''}
</div>`;
}

function renderVerdictTemplate(v) {
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
          ? `<a class="fc-citation-link" href="${escapeHtml(v.citation.url)}" target="_blank" rel="noopener">View source →</a>`
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
</div>`;
}


// ---------------------------------------------------------------------------
// Reference Pipeline: Extract + Enrich (single grounded call) → Render
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
        <span class="fc-ref-type-badge fc-ref-type-badge--media_clip">📺 Watch the Clip</span>
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
          Watch on ${escapeHtml(mediaClip.enrichment.primary_source_name || 'YouTube')} →
        </a>
      ` : ''}
    </div>`;
  } else if (hasMediaClip && mediaClip.enrichment.primary_url) {
    mediaClipHTML = `
    <div class="fc-ref-card fc-ref-card--media_clip">
      <div class="fc-ref-card-header">
        <span class="fc-ref-type-badge fc-ref-type-badge--media_clip">📺 Clip</span>
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
    policy:         '📜',
    organization:   '🏛',
    person:         '👤',
    event:          '📅',
    concept:        '💡',
    location:       '📍',
    statistic:      '📊',
    media_clip:     '📺',
    legal_document: '⚖️',
  };

  const refCardsHTML = found.map(ref => {
    const e = ref.enrichment;
    const icon = TYPE_ICONS[ref.type] || '🔗';
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
  const { skipFactCheck = false, skipReferences = false } = options;

  const factCheckPromise = skipFactCheck
    ? Promise.resolve(null)
    : runFactCheckPipeline(quoteData);

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

async function runFactCheckPipeline(quoteData) {
  const result = await classifyAndVerify(quoteData);

  if (result.category !== 'A') {
    const html = await renderHTML(result);
    return { category: result.category, classification: result, verdict: null, html };
  }

  const html = await renderHTML(result);
  return { category: result.category, classification: result, verdict: result.verdict, html };
}

async function runReferencesPipeline(quoteData) {
  const enriched = await extractAndEnrichReferences(quoteData);

  if (enriched.references.length === 0 && !enriched.media_clip?.enrichment?.found) {
    return { enriched: null, html: '' };
  }

  const html = renderReferencesHTML(enriched);
  return { enriched, html };
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
 * Without this, escapeHtml double-encodes &amp; → &amp;amp; which
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
  VERDICT_COLORS,
  VERDICT_LABELS,
};
