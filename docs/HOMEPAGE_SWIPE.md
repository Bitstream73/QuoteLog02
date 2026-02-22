# Homepage Restructure & Swipe Gesture System

## Phase 5: Homepage Restructure

### What to Remove

In `public/js/home.js`:

1. **Tab bar**: Remove `buildTabBarHtml()`, `switchHomepageTab()`, `renderTabContent()`, `renderTrendingAuthorsTab()`, `renderTrendingSourcesTab()`
2. **Tab state variables**: Remove `_activeTab`, `_authorsPage`, `_authorsSearch`, `_authorsSortBy`, `_authorsHasMore`, `_sourcesPage`, `_sourcesSearch`, `_sourcesSortBy`, `_sourcesHasMore`
3. **Tab-specific loaders**: Remove `loadMoreAuthors()`, `loadMoreSources()` (keep `loadMoreQuotes()`)
4. **Standalone noteworthy section**: Remove the `buildNoteworthySectionHtml()` call in `renderHome()` (keep the function itself — it may be reused for card rendering)

### New Homepage Layout

```javascript
async function renderHome() {
  const content = document.getElementById('content');

  // Simplified: just quotes scroll, no tabs, no standalone noteworthy
  content.innerHTML = `
    <div id="home-quotes-scroll" class="slide-container">
      <div class="slide-panel slide-panel--main" id="slide-main">
        <div id="quotes-list"></div>
        <div id="infinite-scroll-sentinel" class="infinite-scroll-sentinel"></div>
      </div>
      <div class="slide-panel slide-panel--detail" id="slide-detail"></div>
    </div>
  `;

  // Load first page of quotes (with peppered cards — Phase 9)
  await loadQuotesPage(1);
  setupInfiniteScroll();

  // Restore scroll position if returning
  if (_pendingScrollRestore) {
    requestAnimationFrame(() => window.scrollTo(0, _homeScrollY));
    _pendingScrollRestore = false;
  }
}
```

### Simplified State

```javascript
let _quotesPage = 1;
let _quotesHasMore = true;
let _isLoadingMore = false;
let _homeScrollY = 0;
let _pendingScrollRestore = false;
// Remove: _activeTab, _authorsPage, _sourcesPage, etc.
```

### Keep loadMoreItems → loadMoreQuotes Only

`loadMoreItems()` now just calls `loadMoreQuotes()` directly (no tab dispatch).

## Phase 6: Swipe Gesture System

### Module: `public/js/swipe.js`

```javascript
/**
 * Swipe detection for touch-enabled devices.
 * Attaches to a container element and calls callbacks on swipe.
 */
export function initSwipeHandlers(container, { onSwipeLeft, onSwipeRight, threshold = 50, velocityThreshold = 0.3 }) {
  let startX, startY, startTime;
  let tracking = false;

  container.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startTime = Date.now();
    tracking = true;
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    // Optional: add visual feedback during drag
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const dt = Date.now() - startTime;
    const velocity = Math.abs(dx) / dt;

    // Only horizontal swipes (ignore vertical scrolling)
    if (Math.abs(dx) < Math.abs(dy)) return;
    if (Math.abs(dx) < threshold && velocity < velocityThreshold) return;

    if (dx < -threshold || (dx < 0 && velocity > velocityThreshold)) {
      onSwipeLeft(e);
    } else if (dx > threshold || (dx > 0 && velocity > velocityThreshold)) {
      onSwipeRight(e);
    }
  }, { passive: true });
}
```

### Slide Transitions

The homepage uses a two-panel slide container:

```
[Main Panel (quotes scroll)] [Detail Panel (hidden right)]
          ←  swipe left  ←
          →  swipe right  →
```

**Swipe left / tap on quote:**
1. Save current scroll position (`_homeScrollY`)
2. Load detail content into `#slide-detail` (quote page, author page, etc.)
3. Add `.slide-active` class to `.slide-container` (CSS translates both panels left)

**Swipe right (from detail):**
1. Remove `.slide-active` class (panels slide back)
2. Restore scroll position

### CSS Slide Classes

```css
.slide-container {
  position: relative;
  overflow: hidden;
  width: 100%;
}

.slide-panel {
  width: 100%;
  min-height: 100vh;
  transition: transform 0.3s ease;
}

.slide-panel--main {
  transform: translateX(0);
}

.slide-panel--detail {
  position: absolute;
  top: 0;
  left: 100%;
  transform: translateX(0);
}

.slide-container.slide-active .slide-panel--main {
  transform: translateX(-100%);
}

.slide-container.slide-active .slide-panel--detail {
  transform: translateX(-100%);
}
```

### Wiring in home.js

```javascript
import { initSwipeHandlers } from './swipe.js';

// After rendering homepage:
const container = document.getElementById('home-quotes-scroll');
initSwipeHandlers(container, {
  onSwipeLeft: (e) => {
    const quoteBlock = e.target.closest('.quote-block');
    const card = e.target.closest('.noteworthy-card');
    if (quoteBlock) {
      const quoteId = quoteBlock.dataset.quoteId;
      slideToDetail(`/quote/${quoteId}`);
    } else if (card) {
      slideToDetail(card.dataset.href);
    }
  },
  onSwipeRight: () => slideBack()
});
```

### Tap Handling

Also add tap-to-navigate for quote blocks. Replace existing `onclick="navigateTo('/quote/${q.id}')"` with `onclick="slideToDetail('/quote/${q.id}')"` in quote text div.

### slideToDetail / slideBack

```javascript
function slideToDetail(path) {
  _homeScrollY = window.scrollY;
  const detail = document.getElementById('slide-detail');
  // Render the target page content into the detail panel
  // (reuse existing render functions but target detail panel instead of #content)
  renderDetailPanel(detail, path);
  document.getElementById('home-quotes-scroll').classList.add('slide-active');
  window.scrollTo(0, 0);
}

function slideBack() {
  document.getElementById('home-quotes-scroll').classList.remove('slide-active');
  requestAnimationFrame(() => window.scrollTo(0, _homeScrollY));
}
```

### Desktop Behavior

On non-touch devices, tap (click) still triggers `slideToDetail`. No swipe gestures needed — just click handlers. The slide transition still applies.

## Test Expectations

### Homepage Tests
- Renders quotes list without tab bar
- No noteworthy section in DOM
- Infinite scroll sentinel present and functional
- Quote blocks have correct data attributes

### Swipe Tests
- Swipe left detected when dx > threshold
- Swipe right detected when dx > threshold in positive direction
- Vertical scrolling ignored (|dy| > |dx|)
- Velocity-based detection works for fast short swipes
- Slide container adds/removes `.slide-active` class
- Scroll position saved on slide-out, restored on slide-back
