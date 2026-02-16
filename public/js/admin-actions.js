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

async function adminDeleteQuote(quoteId, onUpdate) {
  showConfirmToast('Permanently delete this quote?', async () => {
    try {
      await API.delete(`/quotes/${quoteId}`);
      showToast('Quote deleted', 'success');
      if (onUpdate) onUpdate();
    } catch (err) {
      showToast('Error: ' + err.message, 'error', 5000);
    }
  });
}

async function adminChangeHeadshot(personId, personName, onUpdate) {
  const newUrl = prompt(`Enter new headshot URL for ${personName}:`, '');
  if (newUrl === null) return;

  try {
    await API.patch(`/authors/${personId}`, { photoUrl: newUrl.trim() || null });
    showToast('Headshot updated', 'success');
    if (onUpdate) onUpdate();
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
      <button onclick="adminDeleteQuote(${q.id}, function(){ loadAdminQuotes ? loadAdminQuotes() : location.reload(); })" title="Delete quote" style="color:var(--danger,#dc2626)">Delete</button>
    </div>
  `;
}
