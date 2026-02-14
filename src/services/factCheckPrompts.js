/**
 * factCheckPrompts.js — All Gemini prompt templates for the fact-check system.
 *
 * Uses Gemini's built-in Google Search grounding (tools: [{ googleSearch: {} }])
 * to collapse multi-step pipelines into single grounded calls.
 *
 * Prompt templates are loaded from the gemini_prompts DB table via promptManager,
 * with hardcoded fallbacks if the DB row is missing.
 *
 * Prompts:
 *   1. classifyAndVerifyPrompt — Classify + verify in one grounded call
 *   2. extractAndEnrichReferencesPrompt — Extract + enrich references in one grounded call
 *   3. htmlRenderingPrompt — Generate custom HTML for complex display types
 */

import { getPromptTemplate } from './promptManager.js';

/**
 * Helper: substitute {{placeholder}} tokens in a template string.
 */
function fillTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value ?? '');
  }
  return result;
}

/**
 * COMBINED: Classification + Verification Prompt (grounded)
 *
 * Classifies the quote into A/B/C, and if Category A, uses Google Search
 * grounding to find evidence and produce a verdict — all in one call.
 */
function classifyAndVerifyPrompt({ quoteText, authorName, authorDescription, context, sourceName, sourceDate, tags }) {
  const template = getPromptTemplate('classify_and_verify');
  return fillTemplate(template, {
    quote_text: quoteText,
    author_name: authorName,
    author_description: authorDescription ? ` (${authorDescription})` : '',
    context: context || 'No additional context provided.',
    source_name: sourceName,
    source_date: sourceDate,
    tags: tags?.join(', ') || 'None',
  });
}


/**
 * COMBINED: Reference Extraction + Enrichment Prompt (grounded)
 *
 * Identifies references in the quote AND uses Google Search to find
 * URLs, summaries, and media embeds for each — all in one call.
 */
function extractAndEnrichReferencesPrompt({ quoteText, authorName, authorDescription, context, sourceName, sourceDate, tags }) {
  const template = getPromptTemplate('extract_and_enrich_references');
  return fillTemplate(template, {
    quote_text: quoteText,
    author_name: authorName,
    author_description: authorDescription ? ` (${authorDescription})` : '',
    context: context || 'No additional context provided.',
    source_name: sourceName,
    source_date: sourceDate,
    tags: tags?.join(', ') || 'None',
  });
}


/**
 * HTML Rendering Prompt
 *
 * For complex display types (timeline, comparison) that need custom HTML.
 * Simple types (text, single_stat, excerpt) use template rendering instead.
 */
function htmlRenderingPrompt({ verdict, claim, displayType }) {
  const template = getPromptTemplate('html_rendering');
  return fillTemplate(template, {
    verdict_json: JSON.stringify(verdict, null, 2),
    display_type: displayType,
  });
}


export {
  classifyAndVerifyPrompt,
  extractAndEnrichReferencesPrompt,
  htmlRenderingPrompt,
};
