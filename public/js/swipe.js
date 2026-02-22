// Swipe gesture detection for touch-enabled devices

/**
 * Initialize swipe handlers on a container element.
 * @param {HTMLElement} container - The element to attach touch listeners to
 * @param {Object} options - Configuration
 * @param {Function} options.onSwipeLeft - Called on left swipe
 * @param {Function} options.onSwipeRight - Called on right swipe
 * @param {number} [options.threshold=50] - Minimum distance in pixels
 * @param {number} [options.velocityThreshold=0.3] - Minimum velocity (px/ms)
 */
function initSwipeHandlers(container, { onSwipeLeft, onSwipeRight, threshold = 50, velocityThreshold = 0.3 }) {
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
