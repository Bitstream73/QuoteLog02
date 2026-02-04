function navigate(event, path) {
  if (event) event.preventDefault();
  window.history.pushState({}, '', path);
  route();
}

function route() {
  const path = window.location.pathname;
  if (path === '/' || path === '') { renderHome(); }
  else if (path.startsWith('/quote/')) { renderQuote(path.split('/')[2]); }
  else if (path.startsWith('/author/')) { renderAuthor(decodeURIComponent(path.split('/')[2])); }
  else if (path === '/settings') { renderSettings(); }
  else { renderHome(); }
}

window.addEventListener('popstate', route);
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }
route();
