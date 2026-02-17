import { getDb } from '../config/database.js';

/**
 * Hardcoded default prompt templates.
 * Used as fallback when a prompt_key is not found in the gemini_prompts table.
 * Keys must match gemini_prompts.prompt_key values.
 */
const HARDCODED_DEFAULTS = {
  quote_extraction: {
    name: 'Quote Extraction',
    description: 'Main prompt for extracting quotes from news articles via Gemini',
    category: 'extraction',
    template: `You are a precise news quote extraction system. Extract ONLY direct, verbatim quotes from this news article.

Article published: {{published_at}}
Article title: {{title}}

For each quote, return:
- quote_text: The exact quoted text as it appears in quotation marks. Use the verbatim words only.
- speaker: The full name of the person being quoted. Never use pronouns — resolve "he", "she", "they" to the actual name.
- speaker_title: Their role, title, or affiliation as mentioned in the article (e.g., "CEO of Apple", "U.S. Senator"). Null if not mentioned.
- speaker_category: One of: "Politician", "Government Official", "Business Leader", "Entertainer", "Athlete", "Pundit", "Journalist", "Scientist/Academic", "Legal/Judicial", "Military/Defense", "Activist/Advocate", "Religious Leader", "Other". Choose based on the speaker's primary public role.
- speaker_category_context: Brief context for the category. For Politicians: party and office (e.g. "Republican, U.S. Senator from Texas"). For Athletes: team and sport (e.g. "Los Angeles Lakers, NBA"). For Business Leaders: company and title. For Entertainers: medium and notable works. For Pundits/Journalists: outlet. For others: relevant affiliation. Null if unknown.
- quote_type: Always "direct".
- context: One sentence describing what the quote is about and why it was said.
- quote_date: The date when this quote was actually spoken/written, in ISO format (YYYY-MM-DD).
  * For current news quotes: use the article's publication date provided above.
  * For historical quotes (quoting someone from the past, reprinting old statements): use the original date if mentioned in the article. If only a year is known, use "YYYY-01-01" (e.g., "2001-01-01"). If only year and month, use "YYYY-MM-01". If no date context at all, return "unknown".
  * For "yesterday"/"last week" references: compute the actual date relative to the article publication date.
  * If the speaker is deceased or the quote clearly predates the article, do NOT use the article date.
- topics: Array of 1-3 SPECIFIC subject categories. Use the most specific applicable name:

  Politics: "U.S. Presidential Politics", "U.S. Congressional Politics", "UK Politics", "EU Politics", "State/Local Politics", "Voting Rights"
  Government: "U.S. Foreign Policy", "Diplomacy", "Intelligence & Espionage", "Military & Defense", "Governance"
  Law: "Supreme Court", "Criminal Justice", "Constitutional Law", "Civil Rights & Liberties", "Law Enforcement"
  Economy: "U.S. Finance", "Global Economy", "Federal Reserve", "Trade & Tariffs", "Labor & Employment", "Cryptocurrency"
  Business: "Big Tech", "Startups", "Corporate Governance", "Energy Industry"
  Social: "Healthcare", "Education", "Immigration", "Housing", "Gun Control", "Reproductive Rights"
  Science: "Climate & Environment", "Space Exploration", "Artificial Intelligence", "Public Health"
  Culture: "Film & Television", "Music", "Olympic Sports", "NFL", "NBA", "MLB", "Soccer", "Social Media"
  World: "Middle East Conflict", "Ukraine War", "China-Taiwan Relations", "African Affairs", "Latin American Affairs"
  Media: "Journalism", "Misinformation", "Media Industry"
  Philosophy: "Philosophy", "Ethics", "Religion"

  IMPORTANT: Use specific names, NOT broad ones. "U.S. Finance" not "Business". "UK Politics" not "Politics". "Olympic Sports" not "Sports". "Supreme Court" not "Law".

- keywords: Array of 2-5 specific named entities relevant to this quote. Follow these rules STRICTLY:

  GOOD keywords (use as models):
  "Donald Trump", "Supreme Court", "January 6th Committee", "Affordable Care Act",
  "European Union", "Silicon Valley", "Paris Climate Agreement", "Federal Reserve",
  "2026 Winter Olympics", "Senate Judiciary Committee"

  BAD keywords (NEVER produce these):
  "Trump" (incomplete — use "Donald Trump"), "critical" (adjective), "emphasizes" (verb),
  "policy" (too vague), "Donald" (first name only), "innovation" (generic noun),
  "business" (generic), "groups" (generic), "competition" (generic), "strength" (generic)

  Rules:
  1. ALWAYS use FULL proper names: "Donald Trump" not "Trump", "Federal Reserve" not "Fed"
  2. Multi-word entities are ONE keyword: "January 6th Committee" is one keyword
  3. Every keyword MUST be a proper noun, named event, specific organization, legislation, or geographic location
  4. NEVER include: verbs, adjectives, generic nouns, common words, the speaker's own name
  5. Single-word keywords are ONLY allowed for proper nouns (e.g., "NATO", "OPEC", "Brexit", "Hamas")
  6. If no specific named entities exist in the quote, return an EMPTY array — never fill with generic words

- significance: Integer 1-10 rating of how noteworthy this quote is:
  9-10: Historic or landmark statement (declaring war, resignation, major policy)
  7-8: Strong claim, bold prediction, headline-worthy, reveals new information
  5-6: Substantive opinion, meaningful analysis, newsworthy reaction
  3-4: Routine statement, standard commentary, generic encouragement
  1-2: Vague platitude, meaningless fragment, purely descriptive, no substance

  HIGH (5+): makes a specific, checkable claim; sets a measurable goal; predicts a concrete outcome; reveals new information; makes a direct accusation; provides genuine analytical insight
  LOW (1-4): "We need to do better" (platitude), "It was a nice event" (descriptive), "The meeting begins at noon" (procedural), fragments without assertion, pure rhetoric without a specific claim ("For 47 years, they've been talking and talking"), descriptions of routine actions ("Investigative actions are being carried out"), vague motivational statements

- fact_check_category: Classify this quote's verifiability:
  "A" - Contains SPECIFIC, VERIFIABLE factual claims (statistics, dates, quantities, named events, measurable outcomes)
  "B" - Expresses opinion, value judgment, policy position, or prediction — substantive but not verifiable by data lookup
  "C" - Vague platitude, procedural statement, meaningless fragment, or purely rhetorical with no substance
  Examples: "Unemployment is at 3.5%" = A, "This policy is a disaster for working families" = B, "We need to do better" = C
- fact_check_score: Float 0.0-1.0 confidence in the fact_check_category assignment (1.0 = certain, 0.5 = borderline)

Rules:
- Do NOT extract quotes that are purely rhetorical, procedural, or vague. A quote must contain at least one specific claim, assertion, opinion, accusation, or prediction to be worth extracting.
- ONLY extract verbatim quotes that appear inside quotation marks.
- Do NOT extract indirect/reported speech, paraphrases, or descriptions of what someone said.
- Only extract quotes attributed to a specific named person. Skip unattributed quotes.
- If a quote spans multiple paragraphs, combine into one entry.
- If a person is quoted multiple times, create separate entries for each distinct statement.
- Do NOT fabricate or embellish quotes. Only extract what is in the article.
- For speaker names, use the most complete version that appears in the article.

Additionally, extract all notable entities and key themes from the entire article (not just the quotes). For each entity, provide:
- name: The full proper name of the entity (e.g., "Donald Trump", not "Trump")
- type: One of "person", "organization", "place", "event", or "theme"

Entity extraction rules:
- Extract people, organizations, places, events, and broad themes/topics discussed in the article
- Use full proper names: "Donald Trump" not "Trump", "Federal Reserve" not "Fed"
- For themes, use concise noun phrases: "tariffs", "immigration reform", "climate change"
- Do NOT include the speakers already listed in the quotes — focus on other entities mentioned
- Aim for 5-15 entities that capture the key subjects of the article

Return a JSON object: { "quotes": [...], "extracted_entities": [{"name": "...", "type": "..."}] }
If there are no attributable direct quotes, return: { "quotes": [], "extracted_entities": [...] }
Always return extracted_entities even if quotes is empty.

Article text:
{{article_text}}`,
  },

  classify_and_verify: {
    name: 'Classify and Verify',
    description: 'Fact-check prompt: classifies quotes (A/B/C) and verifies Category A claims via Google Search grounding',
    category: 'fact_check',
    template: `You are a fact-check engine for a news quote aggregator. You will classify a quote and, if it contains verifiable claims, use Google Search to find evidence and produce a verdict.

## The Quote
"{{quote_text}}"

## Metadata
- **Speaker**: {{author_name}}{{author_description}}
- **Source**: {{source_name}}
- **Date**: {{source_date}}
- **Context**: {{context}}
- **Topic Tags**: {{tags}}

## Step 1: Classify

Classify this quote into exactly ONE category:

### Category A — VERIFIABLE
The quote contains one or more **specific factual claims** that can be checked against real-world data.

### Category B — SUBJECTIVE/OPINION
The quote expresses opinions, feelings, value judgments, predictions, or policy positions that **cannot be reduced to a data lookup**.

### Category C — UNVERIFIABLE FRAGMENT
The quote is too fragmentary, vague, or rhetorical to contain any checkable claim OR meaningful opinion.

## Step 2: If Category A, Verify

If the quote is Category A, you MUST use Google Search to find evidence for the primary claim. Then evaluate the evidence and produce a verdict.

Verdicts: TRUE, MOSTLY_TRUE, FALSE, MOSTLY_FALSE, MISLEADING, LACKS_CONTEXT, UNVERIFIABLE

## Response Format (JSON only, no markdown fences)

For Category A: { "category": "A", "confidence": 0.0-1.0, "reasoning": "...", "claims": [...], "summary_label": "...", "verdict": "...", "verdict_explanation": "...", "key_data_points": [...], "display_type": "text|single_stat|comparison|timeline|excerpt", "display_rationale": "...", "timeline_data": [], "comparison_data": null, "citation": { "text": "...", "url": "..." } }
For Category B: { "category": "B", "confidence": 0.0-1.0, "reasoning": "...", "claims": [], "summary_label": "..." }
For Category C: { "category": "C", "confidence": 0.0-1.0, "reasoning": "...", "claims": [], "summary_label": "..." }`,
  },

  extract_and_enrich_references: {
    name: 'Extract and Enrich References',
    description: 'Identifies references in quotes and uses Google Search to find URLs, summaries, and media embeds',
    category: 'fact_check',
    template: `You are a reference extraction and enrichment engine for a news quote aggregator. Identify concepts, entities, and references in a quote, then use Google Search to find authoritative links and summaries.

## The Quote
"{{quote_text}}"

## Metadata
- **Speaker**: {{author_name}}{{author_description}}
- **Source**: {{source_name}}
- **Date**: {{source_date}}
- **Context**: {{context}}
- **Topic Tags**: {{tags}}

Identify every referenceable item in the quote. For each, use Google Search to find the most authoritative URL and a concise 2-3 sentence summary.

## Response Format (JSON only, no markdown fences)
{ "references": [...], "media_clip": null }`,
  },

  html_rendering: {
    name: 'HTML Rendering',
    description: 'Generates custom HTML for complex fact-check display types (timeline, comparison)',
    category: 'fact_check',
    template: `You are an HTML renderer for a fact-check widget. Generate clean, semantic HTML using the site's CSS variables.

## Data to Render
{{verdict_json}}

## Display Type: {{display_type}}

Produce a single HTML fragment for a <div class="fact-check-result"> container. The output should be ONLY the HTML fragment, no explanation.`,
  },
};

/**
 * Get a prompt template by key.
 * Loads from gemini_prompts DB table first, falls back to hardcoded default.
 * @param {string} key - The prompt_key to look up
 * @returns {{ template: string, source: 'db' | 'hardcoded' } | null}
 */
export function getPrompt(key) {
  const db = getDb();

  // Try DB first
  const row = db.prepare(
    'SELECT template FROM gemini_prompts WHERE prompt_key = ? AND is_active = 1'
  ).get(key);

  if (row) {
    return { template: row.template, source: 'db' };
  }

  // Fall back to hardcoded
  const hardcoded = HARDCODED_DEFAULTS[key];
  if (hardcoded) {
    return { template: hardcoded.template, source: 'hardcoded' };
  }

  return null;
}

/**
 * Get just the template string for a prompt key.
 * Convenience wrapper that returns the template or null.
 * @param {string} key
 * @returns {string | null}
 */
export function getPromptTemplate(key) {
  const result = getPrompt(key);
  return result ? result.template : null;
}

/**
 * Update a prompt template (admin action).
 * @param {string} key - The prompt_key to update
 * @param {string} template - New template text
 * @returns {{ success: boolean, error?: string }}
 */
export function updatePrompt(key, template) {
  const db = getDb();

  const existing = db.prepare('SELECT id FROM gemini_prompts WHERE prompt_key = ?').get(key);
  if (!existing) {
    return { success: false, error: `Prompt key "${key}" not found` };
  }

  db.prepare(
    "UPDATE gemini_prompts SET template = ?, updated_at = datetime('now') WHERE prompt_key = ?"
  ).run(template, key);

  return { success: true };
}

/**
 * Reset a prompt to its hardcoded default.
 * @param {string} key - The prompt_key to reset
 * @returns {{ success: boolean, error?: string }}
 */
export function resetPrompt(key) {
  const hardcoded = HARDCODED_DEFAULTS[key];
  if (!hardcoded) {
    return { success: false, error: `No hardcoded default for prompt key "${key}"` };
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM gemini_prompts WHERE prompt_key = ?').get(key);
  if (!existing) {
    return { success: false, error: `Prompt key "${key}" not found in database` };
  }

  db.prepare(
    "UPDATE gemini_prompts SET template = ?, updated_at = datetime('now') WHERE prompt_key = ?"
  ).run(hardcoded.template, key);

  return { success: true };
}

/**
 * List all prompts with metadata.
 * @returns {Array<{ prompt_key: string, name: string, description: string, category: string, is_active: number, template_length: number, created_at: string, updated_at: string }>}
 */
export function listPrompts() {
  const db = getDb();
  return db.prepare(`
    SELECT prompt_key, name, description, category, is_active,
           LENGTH(template) as template_length, created_at, updated_at
    FROM gemini_prompts
    ORDER BY category, name
  `).all();
}

/**
 * Get a single prompt with full details (including template text).
 * @param {string} key
 * @returns {object | null}
 */
export function getPromptFull(key) {
  const db = getDb();
  const row = db.prepare(
    'SELECT prompt_key, name, description, template, category, is_active, created_at, updated_at FROM gemini_prompts WHERE prompt_key = ?'
  ).get(key);

  if (!row) return null;

  // Include whether a hardcoded default exists
  row.has_default = key in HARDCODED_DEFAULTS;
  return row;
}

export default {
  getPrompt,
  getPromptTemplate,
  updatePrompt,
  resetPrompt,
  listPrompts,
  getPromptFull,
};
