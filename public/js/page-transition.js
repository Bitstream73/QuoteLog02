// Page transition engine — iOS-like slide animations between pages

let _transitionInProgress = false;

/**
 * Animate a forward page transition (current slides out left, new slides in right).
 * @param {HTMLElement} content - The #content element
 * @param {Function} renderFn - Function that renders the new page into content
 */
function transitionForward(content, renderFn) {
  if (!content || _transitionInProgress) {
    if (renderFn) renderFn();
    return;
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (renderFn) renderFn();
    return;
  }

  _transitionInProgress = true;

  // Snapshot current page
  const oldPage = document.createElement('div');
  oldPage.className = 'page-transition-layer page-transition-old';
  oldPage.innerHTML = content.innerHTML;
  oldPage.style.position = 'absolute';
  oldPage.style.top = '0';
  oldPage.style.left = '0';
  oldPage.style.width = '100%';
  oldPage.style.zIndex = '1';

  // Prepare content wrapper
  content.style.position = 'relative';
  content.style.overflow = 'hidden';
  content.appendChild(oldPage);

  // Render new page
  if (renderFn) renderFn();

  // Wrap new content (excluding oldPage) in a layer
  const newPage = document.createElement('div');
  newPage.className = 'page-transition-layer page-transition-new';
  newPage.style.position = 'relative';
  newPage.style.zIndex = '2';

  // Move all children except oldPage into newPage
  const children = Array.from(content.childNodes).filter(n => n !== oldPage);
  children.forEach(child => newPage.appendChild(child));
  content.appendChild(newPage);

  // Animate
  oldPage.style.animation = 'page-slide-out-left 0.3s ease forwards';
  newPage.style.animation = 'page-slide-in-right 0.3s ease forwards';

  newPage.addEventListener('animationend', () => {
    // Clean up: unwrap newPage children back into content
    const newChildren = Array.from(newPage.childNodes);
    oldPage.remove();
    newChildren.forEach(child => content.appendChild(child));
    newPage.remove();
    content.style.position = '';
    content.style.overflow = '';
    _transitionInProgress = false;
  }, { once: true });
}

/**
 * Animate a back page transition (current slides out right, cached slides in left).
 * @param {Object|null} cachedEntry - Cached nav stack entry with { html, scrollY } or null
 * @param {HTMLElement} content - The #content element
 * @param {Function} renderFn - Function that renders/restores the previous page
 */
function transitionBack(cachedEntry, content, renderFn) {
  if (!content || _transitionInProgress) {
    if (renderFn) renderFn();
    return;
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (renderFn) renderFn();
    return;
  }

  _transitionInProgress = true;

  // Snapshot current page
  const oldPage = document.createElement('div');
  oldPage.className = 'page-transition-layer page-transition-old';
  oldPage.innerHTML = content.innerHTML;
  oldPage.style.position = 'absolute';
  oldPage.style.top = '0';
  oldPage.style.left = '0';
  oldPage.style.width = '100%';
  oldPage.style.zIndex = '1';

  content.style.position = 'relative';
  content.style.overflow = 'hidden';
  content.appendChild(oldPage);

  // Render previous page
  if (renderFn) renderFn();

  // Wrap new content
  const newPage = document.createElement('div');
  newPage.className = 'page-transition-layer page-transition-new';
  newPage.style.position = 'relative';
  newPage.style.zIndex = '2';

  const children = Array.from(content.childNodes).filter(n => n !== oldPage);
  children.forEach(child => newPage.appendChild(child));
  content.appendChild(newPage);

  // Animate (reverse direction)
  oldPage.style.animation = 'page-slide-out-right 0.3s ease forwards';
  newPage.style.animation = 'page-slide-in-left 0.3s ease forwards';

  newPage.addEventListener('animationend', () => {
    const newChildren = Array.from(newPage.childNodes);
    oldPage.remove();
    newChildren.forEach(child => content.appendChild(child));
    newPage.remove();
    content.style.position = '';
    content.style.overflow = '';
    _transitionInProgress = false;
  }, { once: true });
}

/**
 * Initialize interactive swipe-to-go-back on detail pages.
 * Only enables right-swipe (back gesture).
 * @param {HTMLElement} element - The element to attach touch listeners to
 */
function initPageSwipe(element) {
  if (!element) return;
  let startX, startY, startTime;
  let tracking = false;

  element.addEventListener('touchstart', (e) => {
    if (_transitionInProgress) return;
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startTime = Date.now();
    tracking = true;
  }, { passive: true });

  element.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    // Track finger position for potential future interactive drag
  }, { passive: true });

  element.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const dt = Date.now() - startTime;
    const velocity = Math.abs(dx) / dt;

    // Only horizontal right-swipes
    if (Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 80 && velocity < 0.5) return;

    // Right swipe detected — go back
    if (dx > 0 && typeof navigateBack === 'function') {
      navigateBack(null);
    }
  }, { passive: true });
}

/**
 * Initialize page transitions (called once on load).
 */
function initPageTransitions() {
  // Module ready — transitions are invoked by navigate/navigateBack
}
