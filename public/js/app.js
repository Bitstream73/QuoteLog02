// Simple SPA router

// Auth state
let isAdmin = false;

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
  if (loginLink) loginLink.style.display = isAdmin ? 'none' : '';
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
  window.history.pushState({}, '', path);
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
  } else if (path.startsWith('/author/')) {
    const id = path.split('/')[2];
    renderAuthor(id);
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
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  updateNav();
  initSocket();
  route();
});

// Also run immediately in case DOMContentLoaded already fired
if (document.readyState !== 'loading') {
  (async () => {
    await checkAuth();
    updateNav();
    initSocket();
    route();
  })();
}
