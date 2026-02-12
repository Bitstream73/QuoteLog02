// Important? Button Component — Reusable across all pages

/**
 * Render an Important? button HTML string
 * @param {string} entityType - 'quote', 'article', 'person', or 'topic'
 * @param {number} entityId
 * @param {number} importantsCount
 * @param {boolean} isImportant - whether the current user has marked it as important
 * @returns {string} HTML string
 */
function renderImportantButton(entityType, entityId, importantsCount, isImportant) {
  const activeClass = isImportant ? 'important-btn--active' : '';
  return `
    <button class="important-btn ${activeClass}"
            data-entity-type="${entityType}" data-entity-id="${entityId}"
            onclick="handleImportantToggle(event, '${entityType}', ${entityId})">
      Important? <span class="important-count">${importantsCount || 0}</span>
    </button>
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
  try {
    const res = await API.post('/importants/toggle', { entity_type: entityType, entity_id: entityId });
    btn.querySelector('.important-count').textContent = res.importants_count;
    if (res.is_important) {
      btn.classList.add('important-btn--active');
    } else {
      btn.classList.remove('important-btn--active');
    }
    // Update data-importance on parent quote-block for client-side sorting
    updateQuoteBlockImportance(btn, res.importants_count);
  } catch (err) {
    btn.classList.toggle('important-btn--active'); // revert
    showToast('Failed to update', 'error');
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
