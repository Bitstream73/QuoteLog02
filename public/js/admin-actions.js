// Shared Admin Actions — reusable across all pages
// These functions require: API, escapeHtml, showToast, isAdmin (globals from app.js/home.js)

const ADMIN_CATEGORIES = [
  'Politician', 'Government Official', 'Business Leader',
  'Entertainer', 'Athlete', 'Pundit', 'Journalist',
  'Scientist/Academic', 'Legal/Judicial', 'Military/Defense',
  'Activist/Advocate', 'Religious Leader', 'Other'
];

async function adminEditQuoteText(quoteId, currentText, onUpdate) {
  const newText = prompt('Edit quote text:', currentText || '');
  if (newText === null || newText.trim() === '' || newText.trim() === currentText) return;

  try {
    await API.patch(`/quotes/${quoteId}`, { text: newText.trim() });
    showToast('Quote text updated', 'success');
    if (onUpdate) onUpdate();
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function adminEditContext(quoteId, currentContext, onUpdate) {
  const newContext = prompt('Edit context:', currentContext || '');
  if (newContext === null) return;

  try {
    await API.patch(`/quotes/${quoteId}`, { context: newContext.trim() || null });
    showToast('Context updated', 'success');
    if (onUpdate) onUpdate();
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function adminToggleVis(quoteId, currentVisible, onUpdate) {
  const newVisible = !currentVisible;
  try {
    await API.patch(`/quotes/${quoteId}/visibility`, { isVisible: newVisible });
    showToast(newVisible ? 'Quote shown' : 'Quote hidden', 'success');
    if (onUpdate) onUpdate();
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function adminEditCategory(personId, personName, onUpdate) {
  const category = prompt(
    `Select category for ${personName}:\n${ADMIN_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nEnter number or category name:`
  );
  if (category === null) return;

  let selected = category.trim();
  const num = parseInt(selected);
  if (num >= 1 && num <= ADMIN_CATEGORIES.length) {
    selected = ADMIN_CATEGORIES[num - 1];
  }

  if (!ADMIN_CATEGORIES.includes(selected)) {
    showToast('Invalid category. Please choose from the list.', 'error');
    return;
  }

  const context = prompt(`Enter category context for ${personName} (e.g., party/office, team/sport):`, '');

  try {
    await API.patch(`/authors/${personId}`, {
      category: selected,
      categoryContext: context ? context.trim() : null,
    });
    showToast('Category updated', 'success');
    if (onUpdate) onUpdate();
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function adminEditAuthorName(personId, currentName, currentDisambiguation, onUpdate) {
  const newName = prompt(`Edit author name for "${currentName}":`, currentName);
  if (newName === null) return;

  const newDisambiguation = prompt(`Edit description/disambiguation for "${newName || currentName}" (leave blank to clear):`, currentDisambiguation || '');

  const updates = {};
  if (newName !== null && newName.trim() !== '' && newName.trim() !== currentName) {
    updates.canonicalName = newName.trim();
  }
  if (newDisambiguation !== null) {
    updates.disambiguation = newDisambiguation.trim() || null;
  }

  if (Object.keys(updates).length === 0) return;

  try {
    await API.patch(`/authors/${personId}`, updates);
    showToast('Author updated', 'success');
    if (onUpdate) onUpdate();
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function adminDeleteQuote(quoteId, onUpdate, btn) {
  if (!btn) return;
  if (btn._confirmPending) {
    clearTimeout(btn._confirmTimer);
    btn._confirmPending = false;
    btn.textContent = 'Delete';
    try {
      await API.delete(`/quotes/${quoteId}`);
      showToast('Quote deleted', 'success');
      if (onUpdate) onUpdate();
    } catch (err) {
      showToast('Error: ' + err.message, 'error', 5000);
    }
    return;
  }
  btn._confirmPending = true;
  btn.textContent = 'Are you sure?';
  btn._confirmTimer = setTimeout(() => {
    btn._confirmPending = false;
    btn.textContent = 'Delete';
  }, 3000);
}

let _selectedHeadshotUrl = '';
let _headshotOnUpdate = null;
let _headshotPersonId = null;

async function adminChangeHeadshot(personId, personName, onUpdate) {
  _headshotPersonId = personId;
  _headshotOnUpdate = onUpdate;
  _selectedHeadshotUrl = '';

  // Fetch current author data + cached suggestions
  let currentUrl = '';
  let cachedSuggestions = [];
  try {
    const data = await API.get(`/authors/${personId}`);
    currentUrl = data.author?.photoUrl || '';
  } catch (e) { /* continue with empty */ }

  try {
    const cached = await API.get(`/authors/${personId}/image-suggestions`);
    cachedSuggestions = cached.suggestions || [];
  } catch (e) { /* no cached suggestions */ }

  _selectedHeadshotUrl = currentUrl;

  const safeName = escapeHtml(personName);
  const initial = (personName || '?').charAt(0).toUpperCase();
  const currentImg = currentUrl
    ? `<img src="${escapeHtml(currentUrl)}" alt="${safeName}" onerror="this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'">`
    : `<div class="quote-headshot-placeholder">${initial}</div>`;

  const modalContent = document.getElementById('modal-content');
  modalContent.innerHTML = `
    <h3>Change Photo &mdash; ${safeName}</h3>
    <div class="headshot-modal">
      <div class="headshot-modal__current">
        ${currentImg}
      </div>

      <div class="headshot-modal__suggestions">
        <div class="headshot-modal__suggestions-header">
          <span>AI Suggestions</span>
          <button class="btn btn-sm" onclick="searchAuthorImages(${personId}, '${escapeHtml(personName.replace(/'/g, "\\'"))}')">Search with AI</button>
        </div>
        <div id="headshot-suggestions-grid">
          ${cachedSuggestions.length > 0 ? renderSuggestionCards(cachedSuggestions) : '<div class="headshot-spinner">No suggestions yet</div>'}
        </div>
      </div>

      <div class="headshot-modal__manual">
        <label>Or enter URL manually:</label>
        <input type="text" id="headshot-manual-url" placeholder="https://..." value="${escapeHtml(currentUrl)}">
        <button class="btn btn-sm" onclick="previewManualUrl()">Preview</button>
        <div id="headshot-manual-preview"></div>
      </div>

      <div class="headshot-modal__actions">
        <button class="btn btn-primary" onclick="applyHeadshot(${personId})">Apply</button>
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      </div>
    </div>
  `;

  document.getElementById('modal-overlay').classList.remove('hidden');

  // Auto-trigger AI search if no cached suggestions and no current photo
  if (cachedSuggestions.length === 0 && !currentUrl) {
    searchAuthorImages(personId, personName);
  }
}

function renderSuggestionCards(suggestions) {
  if (!suggestions || suggestions.length === 0) {
    return '<div class="headshot-spinner">No image suggestions found</div>';
  }
  return suggestions.map(s => `
    <div class="headshot-suggestion" onclick="selectSuggestion('${escapeHtml(s.url.replace(/'/g, "\\'"))}', this)">
      <img src="${escapeHtml(s.url)}" alt="${escapeHtml(s.description || '')}" onerror="this.parentElement.remove()">
      <small>${escapeHtml(s.source || '')}</small>
    </div>
  `).join('');
}

function selectSuggestion(url, el) {
  _selectedHeadshotUrl = url;
  // Update selection visuals
  document.querySelectorAll('.headshot-suggestion').forEach(s => s.classList.remove('selected'));
  if (el) el.classList.add('selected');
  // Update manual input to match
  const manualInput = document.getElementById('headshot-manual-url');
  if (manualInput) manualInput.value = url;
}

async function searchAuthorImages(personId, personName) {
  const grid = document.getElementById('headshot-suggestions-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="headshot-spinner">Searching for images...</div>';

  try {
    const data = await API.post(`/authors/${personId}/image-search`);
    grid.innerHTML = renderSuggestionCards(data.suggestions);
  } catch (err) {
    grid.innerHTML = '<div class="headshot-spinner">Search failed: ' + escapeHtml(err.message) + '</div>';
  }
}

function previewManualUrl() {
  const input = document.getElementById('headshot-manual-url');
  const preview = document.getElementById('headshot-manual-preview');
  if (!input || !preview) return;

  const url = input.value.trim();
  if (!url) {
    preview.innerHTML = '';
    _selectedHeadshotUrl = '';
    return;
  }

  _selectedHeadshotUrl = url;
  // Deselect any AI suggestion cards
  document.querySelectorAll('.headshot-suggestion').forEach(s => s.classList.remove('selected'));

  preview.innerHTML = `<img src="${escapeHtml(url)}" alt="Preview" style="max-width:80px;max-height:80px;border-radius:50%;object-fit:cover;margin-top:0.5rem" onerror="this.outerHTML='<span style=\\'color:var(--error)\\'>Failed to load image</span>'">`;
}

async function applyHeadshot(personId) {
  const url = _selectedHeadshotUrl.trim();
  try {
    await API.patch(`/authors/${personId}`, { photoUrl: url || null });
    showToast('Headshot updated', 'success');
    closeModal();
    if (_headshotOnUpdate) _headshotOnUpdate();
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

// --- Source Author Image Modal ---

let _selectedSourceAuthorUrl = '';
let _sourceAuthorOnUpdate = null;
let _sourceAuthorId = null;

async function adminChangeSourceAuthorImage(sourceAuthorId, saName, onUpdate) {
  _sourceAuthorId = sourceAuthorId;
  _sourceAuthorOnUpdate = onUpdate || null;
  _selectedSourceAuthorUrl = '';

  let currentUrl = '';
  let cachedSuggestions = [];
  try {
    const data = await API.get(`/source-authors/${sourceAuthorId}`);
    currentUrl = data.sourceAuthor?.image_url || '';
  } catch (e) { /* continue */ }

  try {
    const cached = await API.get(`/source-authors/${sourceAuthorId}/image-suggestions`);
    cachedSuggestions = cached.suggestions || [];
  } catch (e) { /* no cached suggestions */ }

  _selectedSourceAuthorUrl = currentUrl;

  const safeName = escapeHtml(saName);
  const initial = (saName || '?').charAt(0).toUpperCase();
  const currentImg = currentUrl
    ? `<img src="${escapeHtml(currentUrl)}" alt="${safeName}" style="width:48px;height:48px;border-radius:4px;object-fit:cover" onerror="this.outerHTML='<div class=\\'source-author-avatar__placeholder\\'>${initial}</div>'">`
    : `<div class="source-author-avatar__placeholder">${initial}</div>`;

  const modalContent = document.getElementById('modal-content');
  modalContent.innerHTML = `
    <h3>Change Image &mdash; ${safeName}</h3>
    <div class="headshot-modal">
      <div class="headshot-modal__current">
        ${currentImg}
      </div>

      <div class="headshot-modal__suggestions">
        <div class="headshot-modal__suggestions-header">
          <span>AI Suggestions</span>
          <button class="btn btn-sm" onclick="searchSourceAuthorImages(${sourceAuthorId}, '${escapeHtml(saName.replace(/'/g, "\\'"))}')">Search with AI</button>
        </div>
        <div id="headshot-suggestions-grid">
          ${cachedSuggestions.length > 0 ? renderSuggestionCards(cachedSuggestions) : '<div class="headshot-spinner">No suggestions yet</div>'}
        </div>
      </div>

      <div class="headshot-modal__manual">
        <label>Or enter URL manually:</label>
        <input type="text" id="headshot-manual-url" placeholder="https://..." value="${escapeHtml(currentUrl)}">
        <button class="btn btn-sm" onclick="previewSourceAuthorManualUrl()">Preview</button>
        <div id="headshot-manual-preview"></div>
      </div>

      <div class="headshot-modal__actions">
        <button class="btn btn-primary" onclick="applySourceAuthorImage(${sourceAuthorId})">Apply</button>
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      </div>
    </div>
  `;

  document.getElementById('modal-overlay').classList.remove('hidden');

  if (cachedSuggestions.length === 0 && !currentUrl) {
    searchSourceAuthorImages(sourceAuthorId, saName);
  }
}

async function searchSourceAuthorImages(sourceAuthorId, saName) {
  const grid = document.getElementById('headshot-suggestions-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="headshot-spinner">Searching for images...</div>';

  try {
    const data = await API.post(`/source-authors/${sourceAuthorId}/image-search`);
    grid.innerHTML = renderSuggestionCards(data.suggestions);
  } catch (err) {
    grid.innerHTML = '<div class="headshot-spinner">Search failed: ' + escapeHtml(err.message) + '</div>';
  }
}

function previewSourceAuthorManualUrl() {
  const input = document.getElementById('headshot-manual-url');
  const preview = document.getElementById('headshot-manual-preview');
  if (!input || !preview) return;

  const url = input.value.trim();
  if (!url) {
    preview.innerHTML = '';
    _selectedSourceAuthorUrl = '';
    return;
  }

  _selectedSourceAuthorUrl = url;
  document.querySelectorAll('.headshot-suggestion').forEach(s => s.classList.remove('selected'));

  preview.innerHTML = `<img src="${escapeHtml(url)}" alt="Preview" style="max-width:48px;max-height:48px;border-radius:4px;object-fit:cover;margin-top:0.5rem" onerror="this.outerHTML='<span style=\\'color:var(--error)\\'>Failed to load image</span>'">`;
}

async function applySourceAuthorImage(sourceAuthorId) {
  const manualInput = document.getElementById('headshot-manual-url');
  const url = (manualInput ? manualInput.value.trim() : _selectedSourceAuthorUrl) || _selectedSourceAuthorUrl;
  try {
    await API.patch(`/source-authors/${sourceAuthorId}`, { imageUrl: url || null });
    showToast('Source author image updated', 'success');
    closeModal();
    if (_sourceAuthorOnUpdate) _sourceAuthorOnUpdate();
    // Reload page to show updated image
    if (typeof renderQuote === 'function' && window._currentQuoteId) {
      renderQuote(window._currentQuoteId);
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

/**
 * Build admin action toolbar HTML for a quote entry.
 * Pass quote data object with: id, personId, personName, text, context, isVisible, personCategory, personCategoryContext, disambiguation
 */
function buildAdminActionsHtml(q) {
  if (typeof isAdmin === 'undefined' || !isAdmin) return '';

  const safeName = escapeHtml(q.personName || '');
  const safeText = escapeHtml((q.text || '').replace(/'/g, "\\'").replace(/\n/g, ' '));
  const safeCtx = escapeHtml((q.context || '').replace(/'/g, "\\'").replace(/\n/g, ' '));
  const safeDisambig = escapeHtml((q.disambiguation || q.personCategoryContext || '').replace(/'/g, "\\'").replace(/\n/g, ' '));

  return `
    <div class="admin-inline-actions">
      <button onclick="adminEditQuoteText(${q.id}, this.closest('.quote-entry, .admin-quote-card')?.querySelector('.quote-text')?.textContent || '')" title="Edit text">Edit</button>
      <button onclick="adminEditContext(${q.id}, '${safeCtx}')" title="Edit context">Context</button>
      <button onclick="adminToggleVis(${q.id}, ${q.isVisible ? 'true' : 'false'}, function(){ loadAdminQuotes ? loadAdminQuotes() : location.reload(); })" title="${q.isVisible ? 'Hide' : 'Show'}">${q.isVisible ? 'Hide' : 'Show'}</button>
      <button onclick="adminEditCategory(${q.personId}, '${safeName}')" title="Edit category">Category</button>
      <button onclick="adminEditAuthorName(${q.personId}, '${safeName}', '${safeDisambig}')" title="Edit author">Author</button>
      <button onclick="adminChangeHeadshot(${q.personId}, '${safeName}')" title="Change photo">Photo</button>
    </div>
  `;
}
