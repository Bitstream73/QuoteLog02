// Simple SPA router

// Socket.IO connection
let socket = null;

function initSocket() {
  if (typeof io !== 'undefined') {
    socket = io();

    socket.on('connect', () => {
      console.log('Socket connected');
    });

    socket.on('new_quotes', (data) => {
      if (typeof handleNewQuotes === 'function') {
        handleNewQuotes(data.quotes);
      }
    });

    socket.on('review_queue_update', (data) => {
      if (typeof updateReviewBadge === 'function') {
        updateReviewBadge(data.pending);
      }
    });

    socket.on('fetch_cycle_complete', (data) => {
      console.log(`Fetch cycle complete: ${data.newArticles} articles, ${data.newQuotes} quotes`);
    });

    socket.on('source_disabled', (data) => {
      console.warn(`Source disabled: ${data.domain} - ${data.reason}`);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });
  }
}

function navigate(event, path) {
  if (event) event.preventDefault();
  window.history.pushState({}, '', path);
  route();
}

function route() {
  const path = window.location.pathname;

  if (path === '/' || path === '') {
    renderHome();
  } else if (path.startsWith('/quote/')) {
    const id = path.split('/')[2];
    renderQuote(id);
  } else if (path.startsWith('/author/')) {
    const id = path.split('/')[2];
    renderAuthor(id);
  } else if (path === '/settings') {
    renderSettings();
  } else if (path === '/review') {
    renderReview();
  } else {
    renderHome();
  }

  // Update review badge on every route change
  updateReviewBadgeAsync();
}

async function updateReviewBadgeAsync() {
  try {
    const stats = await API.get('/review/stats');
    if (typeof updateReviewBadge === 'function') {
      updateReviewBadge(stats.pending);
    }
  } catch {
    // Ignore errors
  }
}

// Handle browser back/forward
window.addEventListener('popstate', route);

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Modal functions
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initSocket();
  route();
});

// Also run immediately in case DOMContentLoaded already fired
if (document.readyState !== 'loading') {
  initSocket();
  route();
}
