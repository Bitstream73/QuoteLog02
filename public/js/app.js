// Simple SPA router

// Theme management
function applyTheme(theme) {
  if (!theme) {
    theme = localStorage.getItem('ql-theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('ql-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#0D0D14' : '#FAFAF8';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('ql-theme')) {
    applyTheme(e.matches ? 'dark' : 'light');
  }
});

// Update page metadata for SPA navigation
function updatePageMeta(title, description, canonicalPath) {
  document.title = title ? title + ' | TrueOrFalse.News' : 'TrueOrFalse.News';
  const descMeta = document.querySelector('meta[name="description"]');
  if (descMeta && description) descMeta.setAttribute('content', description);
  let canonical = document.querySelector('link[rel="canonical"]');
  if (canonicalPath) {
    const href = window.location.origin + canonicalPath;
    if (canonical) {
      canonical.setAttribute('href', href);
    } else {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      canonical.setAttribute('href', href);
      document.head.appendChild(canonical);
    }
  } else if (canonical) {
    canonical.setAttribute('href', window.location.origin + window.location.pathname);
  }
}

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

    socket.on('taxonomy_suggestions_update', (data) => {
      if (typeof updateTaxonomyTabBadge === 'function') {
        updateTaxonomyTabBadge(data.pending);
      }
    });

    socket.on('fetch_cycle_complete', (data) => {
      console.log(`Fetch cycle complete: ${data.newArticles} articles, ${data.newQuotes} quotes`);
    });

    socket.on('source_disabled', (data) => {
      console.warn(`Source disabled: ${data.domain} - ${data.reason}`);
    });

    socket.on('fact_check_complete', (data) => {
      if (typeof handleFactCheckComplete === 'function') handleFactCheckComplete(data);
      if (typeof handleQuotePageFactCheckComplete === 'function') handleQuotePageFactCheckComplete(data);
    });

    socket.on('fact_check_error', (data) => {
      if (typeof handleFactCheckError === 'function') handleFactCheckError(data);
      if (typeof handleQuotePageFactCheckError === 'function') handleQuotePageFactCheckError(data);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    // Initialize important? real-time updates
    if (typeof initImportantSocket === 'function') {
      initImportantSocket();
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
  if (typeof destroyAllCharts === 'function') destroyAllCharts();

  // Re-trigger page fade-in animation
  const content = document.getElementById('content');
  if (content) {
    content.style.animation = 'none';
    content.offsetHeight; // force reflow
    content.style.animation = '';
  }

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
  } else if (path.startsWith('/category/')) {
    const id = path.split('/')[2];
    renderCategory(id);
  } else if (path.startsWith('/topic/')) {
    const id = path.split('/')[2];
    renderTopic(id);
  } else if (path === '/analytics') {
    renderAnalytics();
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
      updateReviewBadge(stats.pending || 0);
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
    path.startsWith('/quote/') || path.startsWith('/author/') || path.startsWith('/article/') || path.startsWith('/category/') || path.startsWith('/analytics');

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

// Toast notification system
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toast-out 0.3s ease-in forwards';
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}

// Confirmation toast for destructive actions
function showConfirmToast(message, onConfirm) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast toast-warning toast-confirm';
  toast.innerHTML = `<span>${escapeHtml(message)}</span>
    <div class="toast-confirm-actions">
      <button class="btn btn-danger btn-sm toast-confirm-yes">Confirm</button>
      <button class="btn btn-secondary btn-sm toast-confirm-no">Cancel</button>
    </div>`;
  container.appendChild(toast);

  toast.querySelector('.toast-confirm-yes').onclick = () => {
    toast.remove();
    onConfirm();
  };
  toast.querySelector('.toast-confirm-no').onclick = () => {
    toast.style.animation = 'toast-out 0.3s ease-in forwards';
    toast.addEventListener('animationend', () => toast.remove());
  };
}

// Modal functions
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
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
  applyTheme();
  await checkAuth();
  updateNav();
  initSocket();
  updateHeaderHeight();
  route();
  initDonateNag();
});

// Update header height on window resize
window.addEventListener('resize', updateHeaderHeight);

// Show/hide scroll-to-top button + auto-hide header on scroll (small screens)
let _lastScrollY = 0;
window.addEventListener('scroll', () => {
  const btn = document.getElementById('scroll-top-btn');
  if (btn) btn.style.display = window.scrollY > 400 ? 'flex' : 'none';

  // Auto-hide header on scroll down (small screens only)
  const header = document.querySelector('header');
  if (header && window.innerWidth <= 768) {
    if (window.scrollY > 60 && window.scrollY > _lastScrollY) {
      header.classList.add('header--hidden');
    } else {
      header.classList.remove('header--hidden');
    }
  } else if (header) {
    header.classList.remove('header--hidden');
  }
  _lastScrollY = window.scrollY;
}, { passive: true });

// Live-update relative timestamps every 60 seconds
setInterval(() => {
  document.querySelectorAll('time[datetime]').forEach(el => {
    const iso = el.getAttribute('datetime');
    if (iso && typeof formatRelativeTime === 'function') {
      const newText = formatRelativeTime(iso);
      if (newText && el.textContent !== newText) {
        el.textContent = newText;
      }
    }
  });
}, 60000);

// Also run immediately in case DOMContentLoaded already fired
if (document.readyState !== 'loading') {
  (async () => {
    applyTheme();
    await checkAuth();
    updateNav();
    initSocket();
    updateHeaderHeight();
    route();
    initDonateNag();
  })();
}
