# Card Peppering System

## Overview

Noteworthy cards are inserted inline with quotes in the homepage infinite scroll. The peppering algorithm determines WHERE cards appear; the pick logic determines WHICH card appears.

## Algorithm

### Insertion Points

After loading each page of quotes (20 per page), determine insertion points:

```javascript
function determinePepperPositions(quoteCount, frequency, chance) {
  const positions = [];
  for (let i = frequency; i < quoteCount; i += frequency) {
    if (Math.random() * 100 < chance) {
      positions.push(i);
    }
  }
  return positions; // e.g., [5, 15] means insert a card after quote index 5 and 15
}
```

- `frequency`: every N quotes, there's a CHANCE of insertion (from settings)
- `chance`: percentage probability at each chance point (from settings)
- Positions are relative to the current page, not absolute

### Card Picking

```javascript
let _cardPickIndex = 0; // reset when cards re-evaluated
let _usedCardIds = new Set();

function pickNextCard(evaluatedCards, mode, reuseEnabled) {
  const available = reuseEnabled
    ? evaluatedCards
    : evaluatedCards.filter(c => !_usedCardIds.has(c.id));

  if (available.length === 0) {
    if (reuseEnabled) return null; // shouldn't happen
    // All used, reset if reuse enabled
    _usedCardIds.clear();
    return pickNextCard(evaluatedCards, mode, true);
  }

  let card;
  if (mode === 'random') {
    card = available[Math.floor(Math.random() * available.length)];
  } else {
    // Sequential: use display_order
    card = available[_cardPickIndex % available.length];
    _cardPickIndex++;
  }

  _usedCardIds.add(card.id);
  return card;
}
```

### Collection Grouping

Cards in the same collection render as a horizontal scroll row (reusing existing `.noteworthy-section__scroll` CSS pattern):

```javascript
function buildPepperedCardHtml(card, allCards) {
  if (card.collection_id) {
    // Find all cards in this collection
    const siblings = allCards.filter(c => c.collection_id === card.collection_id);
    if (siblings[0].id !== card.id) return ''; // already rendered by first sibling

    return `
      <div class="noteworthy-section__scroll">
        ${siblings.map(c => renderCardByType(c)).join('')}
      </div>
    `;
  }
  return renderCardByType(card);
}
```

## Integration with Infinite Scroll

### Modified loadQuotesPage

```javascript
async function loadQuotesPage(page) {
  const [quotesData, cardsData] = await Promise.all([
    API.get(`/analytics/trending-quotes?page=${page}&limit=20&sort=date`),
    page === 1 ? API.get('/noteworthy/evaluated') : Promise.resolve(null)
  ]);

  // Cache evaluated cards on first page load
  if (cardsData) {
    _evaluatedCards = cardsData.cards;
    _pepperSettings = cardsData.pepper_settings;
    _cardPickIndex = 0;
    _usedCardIds.clear();
  }

  const quotes = quotesData.recentQuotes || [];
  const positions = determinePepperPositions(
    quotes.length,
    parseInt(_pepperSettings?.noteworthy_pepper_frequency || '5'),
    parseInt(_pepperSettings?.noteworthy_pepper_chance || '50')
  );

  let html = '';
  quotes.forEach((q, i) => {
    html += buildQuoteBlockHtml(q, ...) + '<hr class="quote-divider">';

    if (positions.includes(i)) {
      const card = pickNextCard(_evaluatedCards, _pepperSettings?.noteworthy_pick_mode || 'sequential', _pepperSettings?.noteworthy_reuse_cards === '1');
      if (card) {
        html += buildPepperedCardHtml(card, _evaluatedCards);
      }
    }
  });

  const list = document.getElementById('quotes-list');
  if (page === 1) {
    list.innerHTML = html;
  } else {
    list.insertAdjacentHTML('beforeend', html);
  }

  _quotesHasMore = quotes.length >= 20;
  updateSentinel();
  initViewTracking();
}
```

### Re-Evaluation on Fetch

```javascript
// In app.js Socket.IO handler:
socket.on('fetch_cycle_complete', async () => {
  // Re-evaluate time-based cards with fresh data
  try {
    const cardsData = await API.get('/noteworthy/evaluated');
    _evaluatedCards = cardsData.cards;
    // Don't reset pick index — continue where we left off
  } catch (e) {
    console.warn('Failed to re-evaluate noteworthy cards:', e);
  }
});
```

## State Variables

```javascript
let _evaluatedCards = [];       // Cached evaluated card data
let _pepperSettings = {};       // Pepper settings from API
let _cardPickIndex = 0;         // Sequential pick counter
let _usedCardIds = new Set();   // Tracks shown cards for no-reuse mode
```

## Test Expectations

- `determinePepperPositions(20, 5, 100)` returns [5, 10, 15] (100% chance)
- `determinePepperPositions(20, 5, 0)` returns [] (0% chance)
- Sequential picking cycles through cards in display_order
- Random picking selects from available cards
- No-reuse mode skips already-shown cards, resets when exhausted
- Collection grouping renders siblings in one `.noteworthy-section__scroll`
- Cards inserted at correct positions in quote list HTML
- Re-evaluation updates `_evaluatedCards` without resetting pick index
