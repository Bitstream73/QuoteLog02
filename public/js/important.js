// Important? Button Component — Reusable across all pages

/**
 * Render an Important? button HTML string
 * @param {string} entityType - 'quote', 'article', 'person', or 'topic'
 * @param {number} entityId
 * @param {number} importantsCount
 * @param {boolean} isImportant - whether the current user has marked it as important
 * @param {boolean} adminView - whether to show admin features (defaults to global isAdmin)
 * @returns {string} HTML string
 */
function renderImportantButton(entityType, entityId, importantsCount, isImportant, adminView) {
  const showAdmin = adminView !== undefined ? adminView : (typeof isAdmin !== 'undefined' && isAdmin);
  const activeClass = isImportant ? 'important-btn--active important-btn--confirmed' : '';
  const label = isImportant ? 'IMPORTANT!' : 'Important?';
  const countDisplay = showAdmin ? ` <span class="important-count">${importantsCount || 0}</span>` : '';
  const superBtn = showAdmin
    ? ` <button class="super-important-btn" onclick="handleSuperImportant(event, '${entityType}', ${entityId})">SuperImportant</button>`
    : '';
  return `
    <button class="important-btn ${activeClass}"
            data-entity-type="${entityType}" data-entity-id="${entityId}"
            onclick="handleImportantToggle(event, '${entityType}', ${entityId})">
      <span class="important-label">${label}</span>${countDisplay}
    </button><span class="important-tooltip" title="Mark this as important to boost its visibility and help surface the most noteworthy quotes">?</span>${superBtn}
  `;
}

/**
 * Handle Important? button toggle
 */
async function handleImportantToggle(event, entityType, entityId) {
  event.stopPropagation();
  event.preventDefault();
  const btn = event.currentTarget;
  // Optimistic toggle
  btn.classList.toggle('important-btn--active');
  btn.classList.toggle('important-btn--confirmed');
  const labelEl = btn.querySelector('.important-label');
  if (labelEl) labelEl.textContent = btn.classList.contains('important-btn--active') ? 'IMPORTANT!' : 'Important?';
  try {
    const res = await API.post('/importants/toggle', { entity_type: entityType, entity_id: entityId });
    const countEl = btn.querySelector('.important-count');
    if (countEl) countEl.textContent = res.importants_count;
    if (res.is_important) {
      btn.classList.add('important-btn--active', 'important-btn--confirmed');
      if (labelEl) labelEl.textContent = 'IMPORTANT!';
    } else {
      btn.classList.remove('important-btn--active', 'important-btn--confirmed');
      if (labelEl) labelEl.textContent = 'Important?';
    }
    // Update data-importance on parent quote-block for client-side sorting
    updateQuoteBlockImportance(btn, res.importants_count);
  } catch (err) {
    btn.classList.toggle('important-btn--active'); // revert
    btn.classList.toggle('important-btn--confirmed');
    if (labelEl) labelEl.textContent = btn.classList.contains('important-btn--active') ? 'IMPORTANT!' : 'Important?';
    showToast('Failed to update', 'error');
  }
}

/**
 * Handle SuperImportant button click (admin-only, +100 boost)
 */
async function handleSuperImportant(event, entityType, entityId) {
  event.stopPropagation();
  const btn = event.target;
  btn.disabled = true;
  try {
    const result = await API.post('/importants/super-toggle', {
      entity_type: entityType,
      entity_id: entityId
    });
    // Update count display
    const block = btn.closest('.quote-block, .admin-quote-block');
    if (block) {
      const countEl = block.querySelector('.important-count');
      if (countEl) countEl.textContent = result.importants_count;
      block.dataset.importance = result.importants_count;
    }
    showToast('Boosted +100!', 'success');
  } catch (err) {
    showToast('Failed to boost: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/**
 * Update data-importance attribute on the closest .quote-block ancestor
 * so client-side sorting reflects the new importants count.
 * Uses absolute calculation (importants + share + view) to avoid race conditions
 * between API response and Socket.IO event both applying deltas.
 */
function updateQuoteBlockImportance(btn, newImportantsCount) {
  const quoteBlock = btn.closest('.quote-block');
  if (!quoteBlock) return;
  const shareView = parseInt(quoteBlock.dataset.shareView) || 0;
  quoteBlock.dataset.importance = String(newImportantsCount + shareView);
}

/**
 * Initialize Socket.IO listener for real-time important count updates
 */
function initImportantSocket() {
  if (typeof socket !== 'undefined' && socket) {
    socket.on('important_update', ({ entity_type, entity_id, importants_count }) => {
      document.querySelectorAll(
        `.important-btn[data-entity-type="${entity_type}"][data-entity-id="${entity_id}"]`
      ).forEach(btn => {
        updateQuoteBlockImportance(btn, importants_count);
        const countEl = btn.querySelector('.important-count');
        if (countEl) countEl.textContent = importants_count;
      });
    });
  }
}
