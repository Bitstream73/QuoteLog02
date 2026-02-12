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
  } catch (err) {
    btn.classList.toggle('important-btn--active'); // revert
    showToast('Failed to update', 'error');
  }
}

/**
 * Initialize Socket.IO listener for real-time important count updates
 */
function initImportantSocket() {
  if (typeof socket !== 'undefined' && socket) {
    socket.on('important_update', ({ entity_type, entity_id, importants_count }) => {
      document.querySelectorAll(
        `.important-btn[data-entity-type="${entity_type}"][data-entity-id="${entity_id}"] .important-count`
      ).forEach(el => { el.textContent = importants_count; });
    });
  }
}
