// Simple SPA router

// Auth state
let isAdmin = false;

// Homepage scroll position (saved when navigating to article/quote)
let _homeScrollY = 0;
let _pendingScrollRestore = false;

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

    // Initialize vote real-time updates
    if (typeof initVoteSocket === 'function') {
      initVoteSocket();
    }
  }
}

async function checkAuth() {
  try {
    const result = await API.get('/auth/me');
    isAdmin = result.authenticated;
  } catch {
    isAdmin = false;
  }
}

function updateNav() {
  const reviewLink = document.getElementById('nav-review');
  const settingsLink = document.getElementById('nav-settings');
  const loginLink = document.getElementById('nav-login');
  const logoutLink = document.getElementById('nav-logout');

  if (reviewLink) reviewLink.style.display = isAdmin ? '' : 'none';
  if (settingsLink) settingsLink.style.display = isAdmin ? '' : 'none';
  if (loginLink) loginLink.style.display = 'none'; // Login hidden from header per spec
  if (logoutLink) logoutLink.style.display = isAdmin ? '' : 'none';
}

async function logout(event) {
  if (event) event.preventDefault();
  try {
    await API.post('/auth/logout', {});
  } catch {
    // Ignore errors
  }
  isAdmin = false;
  updateNav();
  navigate(null, '/');
}

function navigate(event, path) {
  if (event) event.preventDefault();
  // Save scroll position when leaving homepage
  if (window.location.pathname === '/' || window.location.pathname === '') {
    _homeScrollY = window.scrollY;
  }
  window.history.pushState({}, '', path);
  route();
}

function navigateBackToQuotes(event) {
  if (event) event.preventDefault();
  _pendingScrollRestore = true;
  window.history.pushState({}, '', '/');
  route();
}

function route() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  if (path === '/' || path === '') {
    renderHome();
  } else if (path.startsWith('/quote/')) {
    const id = path.split('/')[2];
    renderQuote(id);
  } else if (path.startsWith('/article/')) {
    const id = path.split('/')[2];
    renderArticle(id);
  } else if (path.startsWith('/author/')) {
    const id = path.split('/')[2];
    renderAuthor(id);
  } else if (path === '/admin') {
    if (isAdmin) { navigate(null, '/settings'); return; }
    renderLogin();
  } else if (path === '/login') {
    if (isAdmin) { navigate(null, '/'); return; }
    renderLogin();
  } else if (path === '/forgot-password') {
    renderForgotPassword();
  } else if (path === '/reset-password') {
    renderResetPassword(params.get('token'));
  } else if (path === '/settings') {
    if (!isAdmin) { navigate(null, '/login'); return; }
    renderSettings();
  } else if (path === '/review') {
    if (!isAdmin) { navigate(null, '/login'); return; }
    renderReview();
  } else {
    renderHome();
  }

  // Only update review badge if admin
  if (isAdmin) {
    updateReviewBadgeAsync();
  }

  // Show/hide ad on public pages only (not in standalone PWA mode)
  updateAdVisibility(path);
}

async function updateReviewBadgeAsync() {
  if (!isAdmin) return;
  try {
    const stats = await API.get('/review/stats');
    if (typeof updateReviewBadge === 'function') {
      updateReviewBadge(stats.pending);
    }
  } catch {
    // Ignore errors
  }
}

// AdSense: show ad only on public pages, not in standalone PWA mode
const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
let adInitialized = false;

function updateAdVisibility(path) {
  const adContainer = document.getElementById('ad-container');
  if (!adContainer) return;

  const isPublicPage = path === '/' || path === '' ||
    path.startsWith('/quote/') || path.startsWith('/author/') || path.startsWith('/article/');

  if (isPublicPage && !isStandalone) {
    adContainer.style.display = '';
    if (!adInitialized) {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        adInitialized = true;
      } catch (e) {
        // AdSense not ready yet
      }
    }
  } else {
    adContainer.style.display = 'none';
  }
}

// Handle browser back/forward
window.addEventListener('popstate', route);

// Register service worker with update detection
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    // Check for updates periodically (every 30 min)
    setInterval(() => reg.update(), 30 * 60 * 1000);

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
          // New version available — reload to get fresh assets
          window.location.reload();
        }
      });
    });
  }).catch(() => {});

  // When a new SW takes control, reload the page
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}

// Modal functions
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    if (typeof closeAnalytics === 'function') closeAnalytics();
  }
});

// Update CSS variable for header height (used by article sticky header)
function updateHeaderHeight() {
  const header = document.querySelector('header');
  if (header) {
    document.documentElement.style.setProperty('--header-height', header.offsetHeight + 'px');
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  updateNav();
  initSocket();
  updateHeaderHeight();
  route();
});

// Update header height on window resize
window.addEventListener('resize', updateHeaderHeight);

// Also run immediately in case DOMContentLoaded already fired
if (document.readyState !== 'loading') {
  (async () => {
    await checkAuth();
    updateNav();
    initSocket();
    updateHeaderHeight();
    route();
  })();
}
