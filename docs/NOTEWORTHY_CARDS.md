# Noteworthy Card Types: Evaluation & Rendering

## Phase 7: Time-Based Evaluation Engine

### File: `src/services/noteworthyEvaluator.js`

#### Time Window Helper

```javascript
export function getTimeWindowStart(period) {
  const now = new Date();
  switch (period) {
    case 'hour': return new Date(now - 60 * 60 * 1000).toISOString();
    case 'day': return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case 'week': return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'month': return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    default: throw new Error(`Invalid period: ${period}`);
  }
}
```

#### Quote Evaluator

```javascript
export function evaluateQuoteOfPeriod(db, period, config = {}) {
  const since = getTimeWindowStart(period);
  let sql = `
    SELECT q.*, p.canonical_name as person_name, p.photo_url, p.category_context as person_category_context
    FROM quotes q
    JOIN persons p ON p.id = q.person_id
    WHERE q.is_visible = 1 AND q.created_at >= ?
  `;
  const params = [since];

  // Optional filter from card config
  if (config.filter_type === 'author') {
    sql += ' AND q.person_id = ?';
    params.push(config.filter_value);
  } else if (config.filter_type === 'topic') {
    sql += ' AND q.id IN (SELECT qt.quote_id FROM quote_topics qt WHERE qt.topic_id = ?)';
    params.push(config.filter_value);
  } else if (config.filter_type === 'keyword') {
    sql += ' AND q.id IN (SELECT qk.quote_id FROM quote_keywords qk WHERE qk.keyword_id = ?)';
    params.push(config.filter_value);
  } else if (config.filter_type === 'category') {
    sql += ' AND q.id IN (SELECT qt.quote_id FROM quote_topics qt JOIN category_topics ct ON ct.topic_id = qt.topic_id WHERE ct.category_id = ?)';
    params.push(config.filter_value);
  }

  sql += ' ORDER BY q.importants_count DESC LIMIT 1';
  return db.prepare(sql).get(...params) || null;
}
```

#### Author Evaluator

```javascript
export function evaluateAuthorOfPeriod(db, period) {
  const since = getTimeWindowStart(period);
  // Person with highest aggregate importants across their quotes in the period
  const person = db.prepare(`
    SELECT p.id, p.canonical_name, p.photo_url, p.category, p.category_context,
           SUM(q.importants_count) as period_importants
    FROM persons p
    JOIN quotes q ON q.person_id = p.id
    WHERE q.is_visible = 1 AND q.created_at >= ?
    GROUP BY p.id
    ORDER BY period_importants DESC
    LIMIT 1
  `).get(since);
  if (!person) return null;

  // Top 3 quotes from this person in the period
  const top_quotes = db.prepare(`
    SELECT id, text, context, importants_count, fact_check_verdict
    FROM quotes
    WHERE person_id = ? AND is_visible = 1 AND created_at >= ?
    ORDER BY importants_count DESC
    LIMIT 3
  `).all(person.id, since);

  return { entity: person, top_quotes };
}
```

#### Source Evaluator

```javascript
export function evaluateSourceOfPeriod(db, period) {
  const since = getTimeWindowStart(period);
  // Source author with highest aggregate importants across quotes from their articles
  const source = db.prepare(`
    SELECT sa.id, sa.name, sa.domain, sa.image_url,
           SUM(q.importants_count) as period_importants
    FROM source_authors sa
    JOIN sources s ON s.source_author_id = sa.id
    JOIN articles a ON a.source_id = s.id
    JOIN quote_articles qa ON qa.article_id = a.id
    JOIN quotes q ON q.id = qa.quote_id
    WHERE q.is_visible = 1 AND q.created_at >= ?
    GROUP BY sa.id
    ORDER BY period_importants DESC
    LIMIT 1
  `).get(since);
  if (!source) return null;

  const top_quotes = db.prepare(`
    SELECT q.id, q.text, q.context, q.importants_count, q.fact_check_verdict,
           p.canonical_name as person_name, p.photo_url
    FROM quotes q
    JOIN persons p ON p.id = q.person_id
    JOIN quote_articles qa ON qa.quote_id = q.id
    JOIN articles a ON a.id = qa.article_id
    JOIN sources s ON s.id = a.source_id
    WHERE s.source_author_id = ? AND q.is_visible = 1 AND q.created_at >= ?
    ORDER BY q.importants_count DESC
    LIMIT 3
  `).all(source.id, since);

  return { entity: source, top_quotes };
}
```

#### Topic & Category Evaluators

Same pattern as Author: find entity with highest aggregate `importants_count` across its quotes in the time window, return entity + top 3 quotes.

- **Topic**: Join through `quote_topics`
- **Category**: Join through `category_topics` → `quote_topics`

#### Dispatch Function

```javascript
export function evaluateCard(db, cardConfig) {
  const config = JSON.parse(cardConfig.config || '{}');
  const [entityType, , period] = cardConfig.card_type.split('_'); // e.g. "author_of_day" → ["author", "of", "day"]

  switch (entityType) {
    case 'quote': return { type: 'quote', data: evaluateQuoteOfPeriod(db, period, config) };
    case 'author': return { type: 'author', data: evaluateAuthorOfPeriod(db, period) };
    case 'source': return { type: 'source', data: evaluateSourceOfPeriod(db, period) };
    case 'topic': return { type: 'topic', data: evaluateTopicOfPeriod(db, period) };
    case 'category': return { type: 'category', data: evaluateCategoryOfPeriod(db, period) };
    case 'search': return { type: 'search', data: { search_type: cardConfig.card_type.replace('search_', '') } };
    case 'info': return { type: 'info', data: { info_type: cardConfig.card_type.replace('info_', '') } };
    default: return null;
  }
}
```

## Phase 8: Frontend Card Renderers

### Time-Based Quote Card

```javascript
function buildTimedQuoteCardHtml(card) {
  const q = card.data;
  if (!q) return '';
  return `
    <div class="noteworthy-card noteworthy-card--timed-quote" data-href="/quote/${q.id}" onclick="slideToDetail('/quote/${q.id}')">
      <div class="noteworthy-card__header">
        <div class="noteworthy-card__badge">${escapeHtml(card.custom_title)}</div>
      </div>
      <div class="noteworthy-card__content">
        <div class="noteworthy-quote__text">"${escapeHtml(q.text?.substring(0, 200))}"</div>
        <div class="noteworthy-quote__byline">
          ${q.photo_url ? `<img class="noteworthy-quote__avatar" src="${q.photo_url}" alt="">` : ''}
          — ${escapeHtml(q.person_name)}
        </div>
      </div>
    </div>
  `;
}
```

### Time-Based Author/Source/Topic/Category Cards

Same pattern as existing noteworthy person/topic/category cards — header with avatar/name, content with top 3 mini-quotes. Use `buildMiniQuotesHtml()` (already exists).

Key difference: the card title comes from `card.custom_title` (e.g., "Author of the Day") instead of the entity name.

### Search Cards (4 types)

```javascript
function buildSearchCardHtml(card) {
  const st = card.data.search_type; // 'topic', 'quote_text', 'source_author', 'source'
  const labels = {
    topic: 'Search by news topic',
    quote_text: 'Search by quote text',
    source_author: 'Search by quote author',
    source: 'Search by news source'
  };
  return `
    <div class="noteworthy-card noteworthy-card--search noteworthy-card--full-width">
      <div class="noteworthy-card__header">
        <div class="noteworthy-card__badge">${escapeHtml(card.custom_title)}</div>
      </div>
      <p class="search-card__subhead">${labels[st]}</p>
      <div class="search-card__input-wrap">
        <input type="search" class="search-card__input" placeholder="Type to search..."
               oninput="searchCardAutocomplete(this, '${st}')"
               onkeydown="searchCardKeydown(event, this, '${st}')">
        <div class="search-card__results"></div>
      </div>
    </div>
  `;
}
```

Autocomplete reuses existing search API patterns (`/api/search/autocomplete` with type filter).

### Info Cards

```javascript
function buildInfoCardHtml(card) {
  const infoType = card.data.info_type;
  const content = {
    importance: {
      title: 'What does IMPORTANT? do?',
      body: 'Tap the IMPORTANT? button on any quote to mark it as noteworthy. This helps surface the most significant quotes and influences trending rankings.',
      icon: '⭐'
    },
    fact_check: {
      title: 'What does RUN FACT CHECK do?',
      body: 'Tap RUN FACT CHECK to have AI verify factual claims in a quote using real-time web search. Results include a verdict (TRUE, FALSE, MISLEADING, etc.) with cited sources.',
      icon: '🔍'
    },
    bug: {
      title: 'Found a bug?',
      body: 'Tap the bug icon on any page to report an issue. Include what you expected vs what happened. Bug reports help us improve QuoteLog.',
      icon: '🐛'
    },
    donate: {
      title: 'Support QuoteLog',
      body: 'QuoteLog is free and open source. If you find it valuable, consider supporting development.',
      icon: '❤️'
    }
  };
  const c = content[infoType] || { title: '', body: '', icon: '' };
  return `
    <div class="noteworthy-card noteworthy-card--info">
      <div class="noteworthy-card__header">
        <span class="info-card__icon">${c.icon}</span>
        <div class="noteworthy-card__badge">${escapeHtml(c.title)}</div>
      </div>
      <div class="noteworthy-card__content">
        <p class="info-card__body">${escapeHtml(c.body)}</p>
      </div>
    </div>
  `;
}
```

## Test Expectations

### Evaluation Tests
- Each evaluator returns correct entity for given time window
- Returns null when no data in window
- Quote evaluator respects filter_type/filter_value
- Top quotes limited to 3, ordered by importants_count DESC
- dispatch function routes card_type correctly

### Renderer Tests
- Each renderer produces valid HTML with correct classes
- Time-based cards show custom_title, entity data, top quotes
- Search cards have input field and autocomplete container
- Info cards display correct content for each type
- All cards have data-href and onclick for slide navigation
