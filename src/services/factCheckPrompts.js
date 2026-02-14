/**
 * factCheckPrompts.js — All Gemini prompt templates for the fact-check system.
 *
 * Uses Gemini's built-in Google Search grounding (tools: [{ googleSearch: {} }])
 * to collapse multi-step pipelines into single grounded calls.
 *
 * Prompts:
 *   1. classifyAndVerifyPrompt — Classify + verify in one grounded call
 *   2. extractAndEnrichReferencesPrompt — Extract + enrich references in one grounded call
 *   3. htmlRenderingPrompt — Generate custom HTML for complex display types
 */

/**
 * COMBINED: Classification + Verification Prompt (grounded)
 *
 * Classifies the quote into A/B/C, and if Category A, uses Google Search
 * grounding to find evidence and produce a verdict — all in one call.
 */
function classifyAndVerifyPrompt({ quoteText, authorName, authorDescription, context, sourceName, sourceDate, tags }) {
  return `You are a fact-check engine for a news quote aggregator. You will classify a quote and, if it contains verifiable claims, use Google Search to find evidence and produce a verdict.

## The Quote
"${quoteText}"

## Metadata
- **Speaker**: ${authorName}${authorDescription ? ` (${authorDescription})` : ''}
- **Source**: ${sourceName}
- **Date**: ${sourceDate}
- **Context**: ${context || 'No additional context provided.'}
- **Topic Tags**: ${tags?.join(', ') || 'None'}

## Step 1: Classify

Classify this quote into exactly ONE category:

### Category A — VERIFIABLE
The quote contains one or more **specific factual claims** that can be checked against real-world data. Examples:
- Statistical claims ("unemployment is at 3.5%", "the Dow has never been higher")
- Historical claims ("this hasn't happened since 1929")
- Comparative claims ("we have the largest economy in Europe")
- Attribution claims ("the study found that...")
- Quantitative claims ("we've created 10 million jobs")
- Status claims ("this law is still in effect", "they are the largest employer")

### Category B — SUBJECTIVE/OPINION
The quote expresses opinions, feelings, value judgments, predictions, or policy positions that **cannot be reduced to a data lookup**. The quote IS meaningful and coherent, it just isn't checkable. Examples:
- "This policy is a disaster for working families"
- "We need to invest more in education"

### Category C — UNVERIFIABLE FRAGMENT
The quote, even WITH its provided context, is too fragmentary, vague, or rhetorical to contain any checkable claim OR meaningful opinion. Examples:
- "was really surprising to me. It always is."
- "and that's what we're going to do"

## Step 2: If Category A, Verify

If the quote is Category A, you MUST use Google Search to find evidence for the primary claim. Then evaluate the evidence and produce a verdict.

Verdicts:
- **TRUE** — The claim is accurate according to reliable sources
- **MOSTLY_TRUE** — The claim is substantially accurate but may have minor inaccuracies
- **FALSE** — The claim is inaccurate according to reliable sources
- **MOSTLY_FALSE** — The claim is substantially inaccurate
- **MISLEADING** — The claim is technically true but presented in a way that creates a false impression
- **LACKS_CONTEXT** — The claim is true but omits important qualifying information
- **UNVERIFIABLE** — Insufficient evidence found to verify or refute the claim

## Response Format (JSON only, no markdown fences)

For Category A (verifiable):
{
  "category": "A",
  "confidence": 0.0-1.0,
  "reasoning": "One sentence explaining why this is verifiable.",
  "claims": [
    {
      "claim_text": "The specific factual assertion",
      "data_type": "statistic | historical_record | comparative | status | attribution",
      "verification_approach": "Brief description of how this was verified"
    }
  ],
  "summary_label": "Short label, e.g. 'Statistical claim about employment'",
  "verdict": "TRUE | FALSE | MOSTLY_TRUE | MOSTLY_FALSE | MISLEADING | LACKS_CONTEXT | UNVERIFIABLE",
  "verdict_explanation": "2-3 sentence plain-language explanation of the verdict based on evidence found.",
  "key_data_points": [
    {
      "label": "What this data point represents",
      "value": "The actual value/fact found",
      "source_name": "Name of the source",
      "source_url": "URL of the source",
      "date": "Date of the data point if applicable"
    }
  ],
  "display_type": "text | single_stat | comparison | timeline | excerpt",
  "display_rationale": "Why this display type best illustrates the evidence.",
  "timeline_data": [],
  "comparison_data": null,
  "citation": {
    "text": "Formatted citation text",
    "url": "Primary source URL"
  }
}

For Category B (opinion):
{
  "category": "B",
  "confidence": 0.0-1.0,
  "reasoning": "One sentence explaining why this is opinion/subjective.",
  "claims": [],
  "summary_label": "Short label, e.g. 'Opinion on trade policy'"
}

For Category C (fragment):
{
  "category": "C",
  "confidence": 0.0-1.0,
  "reasoning": "One sentence explaining why this is an unverifiable fragment.",
  "claims": [],
  "summary_label": "Short label, e.g. 'Rhetorical fragment'"
}

## RULES
- "claims" array should ONLY be populated for Category A. Empty array for B and C.
- Be conservative: if a claim MIGHT be verifiable but would require highly specialized non-public data, classify as B.
- If the quote contains BOTH verifiable claims AND opinions, classify as A and extract only the verifiable parts.
- For Category A: always include at least one key_data_point with a source_url. If you cannot find evidence, set verdict to UNVERIFIABLE.
- Be precise about dates. If the claim was made on ${sourceDate}, evaluate data AS OF that date.
- "MISLEADING" means technically true but presented in a way that creates a false impression.
- "LACKS_CONTEXT" means the claim is true but omits important qualifying information.
- "timeline_data" only populated when display_type is "timeline".
- "comparison_data" only populated when display_type is "comparison".`;
}


/**
 * COMBINED: Reference Extraction + Enrichment Prompt (grounded)
 *
 * Identifies references in the quote AND uses Google Search to find
 * URLs, summaries, and media embeds for each — all in one call.
 */
function extractAndEnrichReferencesPrompt({ quoteText, authorName, authorDescription, context, sourceName, sourceDate, tags }) {
  return `You are a reference extraction and enrichment engine for a news quote aggregator. Your job is to identify concepts, entities, and references in a quote, then use Google Search to find authoritative links and summaries for each.

## The Quote
"${quoteText}"

## Metadata
- **Speaker**: ${authorName}${authorDescription ? ` (${authorDescription})` : ''}
- **Source**: ${sourceName}
- **Date**: ${sourceDate}
- **Context**: ${context || 'No additional context provided.'}
- **Topic Tags**: ${tags?.join(', ') || 'None'}

## Step 1: Identify References

Identify every referenceable item in the quote — anything a reader might not immediately understand, want to learn more about, or want to see primary source material for.

### Reference Types

**policy** — Named policies, executive orders, legislative acts, agreements
**organization** — Companies, agencies, international bodies, NGOs
**person** — People referenced in the quote (NOT the speaker themselves)
**event** — Named events, hearings, summits, incidents, historical events
**concept** — Economic concepts, legal terms, technical jargon
**location** — Specific places, regions, jurisdictions referenced
**statistic** — Referenced data points, studies, reports, indices
**media_clip** — If the speaker is a media personality and the quote is from a broadcast
**legal_document** — Court rulings, legal filings, constitutional provisions

## Step 2: Enrich Each Reference

For EACH reference you identify, use Google Search to find:
- The most authoritative URL (official sites > major news > Wikipedia)
- A concise 2-3 sentence factual summary
- Optional additional links (0-2 max)
- If it's a media_clip type, look for the actual video (YouTube preferred)

## Response Format (JSON only, no markdown fences)

{
  "references": [
    {
      "text_span": "Exact text from the quote",
      "type": "policy | organization | person | event | concept | location | statistic | media_clip | legal_document",
      "display_name": "Human-readable name",
      "why_relevant": "One sentence on why a reader would want this link",
      "priority": "high | medium | low",
      "enrichment": {
        "found": true,
        "title": "The reference title",
        "summary": "2-3 sentence factual explanation (under 60 words)",
        "primary_url": "Best URL for more information",
        "primary_source_name": "Source name (e.g., 'Wikipedia', 'Congress.gov')",
        "additional_links": [
          {
            "url": "Secondary useful link",
            "label": "Short label",
            "source_name": "Source name"
          }
        ],
        "media_embed": {
          "type": "youtube | none",
          "url": "Embeddable URL if video found, null otherwise",
          "title": "Video title",
          "timestamp_seconds": null
        },
        "date_context": "Relevant date if applicable (e.g., 'Signed January 20, 2025')",
        "category_tag": "Short tag (e.g., 'Executive Order', 'TV Clip', 'Federal Agency')"
      }
    }
  ],
  "media_clip": null
}

If the speaker is a media personality (TV host, comedian, podcaster) AND the quote sounds like it's from a broadcast, include a "media_clip" object:
{
  "media_clip": {
    "text_span": "First ~80 chars of the quote",
    "type": "media_clip",
    "display_name": "Speaker name clip",
    "why_relevant": "Reason",
    "priority": "high",
    "enrichment": {
      "found": true | false,
      "title": "Clip title",
      "summary": "Brief description",
      "primary_url": "URL to the clip",
      "primary_source_name": "YouTube or show name",
      "additional_links": [],
      "media_embed": {
        "type": "youtube",
        "url": "https://www.youtube.com/embed/VIDEO_ID",
        "title": "Video title",
        "timestamp_seconds": null
      },
      "date_context": "Air date",
      "category_tag": "TV Clip"
    }
  }
}

## RULES

1. **Be selective, not exhaustive.** Don't flag common words or universally understood concepts. "the economy" doesn't need a link. "the Smoot-Hawley Tariff Act" does.
2. **Context matters.** If the context already explains something, it's lower priority.
3. **The speaker themselves are NOT a reference.**
4. **Priority guide**:
   - **high**: Named policies, specific legislation, technical terms most readers wouldn't know
   - **medium**: Well-known organizations, widely reported events
   - **low**: Very well-known entities (e.g., "Congress"), general locations
5. **text_span must be an EXACT substring** of the quote text.
6. **Prefer 2-5 references per quote.** Only exceed for very dense quotes. Never more than 8.
7. **For quotes with no meaningful references**, return an empty references array and null media_clip.
8. For YouTube URLs, convert to embed format: "https://www.youtube.com/embed/VIDEO_ID"
9. If enrichment search finds nothing relevant for a reference, set enrichment.found to false.
10. "summary" should be in your OWN words, factual and neutral, under 60 words.`;
}


/**
 * HTML Rendering Prompt
 *
 * For complex display types (timeline, comparison) that need custom HTML.
 * Simple types (text, single_stat, excerpt) use template rendering instead.
 */
function htmlRenderingPrompt({ verdict, claim, displayType }) {
  return `You are an HTML renderer for a fact-check widget on WhatTheySaid.News. Generate clean, semantic HTML that uses the site's existing CSS variables.

## Site Design System
The site uses these CSS custom properties:
- --bg-primary, --bg-secondary, --bg-card (backgrounds)
- --text-primary, --text-secondary, --text-muted (text colors)
- --accent: #c41e3a (primary red accent)
- --success: #16a34a (green - for TRUE verdicts)
- --warning: #d4880f (amber - for MISLEADING/LACKS_CONTEXT)
- --error: #c41e3a (red - for FALSE verdicts)
- --info: #2563eb (blue - for UNVERIFIABLE)
- --border, --border-dark (borders)
- --radius: 2px
- --font-headline: 'Playfair Display', serif
- --font-body: 'Source Serif 4', serif
- --font-ui: 'Inter', sans-serif
- --font-mono: 'Fira Code', monospace

The site supports dark mode via a .dark-mode class on <body>.

## Data to Render
${JSON.stringify(verdict, null, 2)}

## Display Type: ${displayType}

## Generate HTML

Produce a single HTML fragment (no <html>, <head>, or <body> tags) that can be inserted into a <div class="fact-check-result"> container.

Requirements:
1. Use the fact-check-widget CSS classes defined below. Do NOT use inline styles except for dynamic values (like chart widths).
2. Include the verdict badge, explanation, key data points with citations, and the appropriate visualization.
3. For "timeline" display_type: render a simple CSS bar chart or sparkline using div elements (no JS charting libraries needed).
4. For "comparison" display_type: render a side-by-side comparison (claimed vs actual).
5. For "single_stat" display_type: render a large highlighted number with context.
6. For "text" display_type: render the explanation with cited excerpts.
7. For "excerpt" display_type: render a blockquote-style excerpt from the source.
8. All source links should open in new tabs.
9. Keep it compact — this sits inside an existing quote detail page.

The output should be ONLY the HTML fragment, no explanation.`;
}


export {
  classifyAndVerifyPrompt,
  extractAndEnrichReferencesPrompt,
  htmlRenderingPrompt,
};
