// Disambiguation Review Page

async function renderReview() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading review queue...</div>';

  try {
    const [reviewData, stats] = await Promise.all([
      API.get('/review?limit=20'),
      API.get('/review/stats'),
    ]);

    updateReviewBadge(stats.pending);

    let html = `
      <h1 class="page-title">Disambiguation Review</h1>
      <p class="page-subtitle">Review potential name matches to improve quote attribution accuracy</p>
      <div class="review-stats">
        <span class="stat"><strong>${stats.pending}</strong> items pending</span>
        <span class="stat"><strong>${stats.resolved_today}</strong> resolved today</span>
      </div>
    `;

    if (reviewData.items.length === 0) {
      html += `
        <div class="empty-state">
          <h3>No items to review</h3>
          <p>Great job! All disambiguation tasks have been completed.</p>
          <p><a href="/" onclick="navigate(event, '/')">Back to quotes</a></p>
        </div>
      `;
    } else {
      // Group items by candidate person for batch review
      const groupedItems = groupByCandidate(reviewData.items);

      for (const [candidateId, items] of Object.entries(groupedItems)) {
        if (items.length > 1 && candidateId !== 'null') {
          // Batch review card
          html += renderBatchReviewCard(items);
        } else {
          // Individual review cards
          for (const item of items) {
            html += renderReviewCard(item);
          }
        }
      }

      // Pagination
      if (reviewData.totalPages > 1) {
        html += `
          <div class="pagination">
            <span class="pagination-info">Page ${reviewData.page} of ${reviewData.totalPages}</span>
          </div>
        `;
      }
    }

    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function groupByCandidate(items) {
  const groups = {};
  for (const item of items) {
    const key = item.candidate_person_id || 'null';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

function renderReviewCard(item) {
  const signals = item.match_signals || {};
  const similarityPercent = Math.round((item.similarity_score || 0) * 100);
  const similarityClass = similarityPercent >= 85 ? 'high' : similarityPercent >= 70 ? 'medium' : 'low';

  return `
    <div class="review-card" data-id="${item.id}">
      <div class="review-header">
        <h3>Is this the same person?</h3>
      </div>

      <div class="review-columns">
        <div class="review-column new-name">
          <h4>New Name</h4>
          <p class="name-display">"${escapeHtml(item.new_name)}"</p>
          ${item.new_context ? `<div class="context"><strong>Context:</strong> ${escapeHtml(item.new_context)}</div>` : ''}
          ${signals.reasoning ? `<div class="match-signals"><strong>Match reasoning:</strong> ${escapeHtml(signals.reasoning)}</div>` : ''}
        </div>

        <div class="review-column existing-person">
          <h4>Existing Person</h4>
          ${item.candidate_person_id ? `
            <p class="name-display">"${escapeHtml(item.candidate_canonical_name || item.candidate_name)}"</p>
            ${item.candidate_disambiguation ? `<p class="disambiguation">${escapeHtml(item.candidate_disambiguation)}</p>` : ''}
            ${item.candidate_aliases && item.candidate_aliases.length > 0 ? `
              <div class="aliases"><strong>Aliases:</strong> ${item.candidate_aliases.map(a => escapeHtml(a)).join(', ')}</div>
            ` : ''}
            ${item.candidate_recent_quotes && item.candidate_recent_quotes.length > 0 ? `
              <div class="recent-quotes">
                <strong>Recent quotes:</strong>
                <ul>
                  ${item.candidate_recent_quotes.map(q => `<li>"${escapeHtml(q)}"</li>`).join('')}
                </ul>
              </div>
            ` : ''}
            <p class="quote-count"><strong>Quote count:</strong> ${item.candidate_quote_count || 0}</p>
          ` : `
            <p class="no-candidate">No candidate person identified</p>
          `}
        </div>
      </div>

      <div class="similarity-bar">
        <div class="similarity-fill ${similarityClass}" style="width: ${similarityPercent}%"></div>
        <span class="similarity-label">Similarity: ${similarityPercent}%</span>
      </div>

      <div class="review-actions">
        ${item.candidate_person_id ? `
          <button class="btn btn-success" onclick="handleMerge(${item.id})">Same Person</button>
        ` : ''}
        <button class="btn btn-danger" onclick="handleReject(${item.id})">Different Person</button>
        <button class="btn btn-secondary" onclick="handleSkip(${item.id})">Skip</button>
      </div>
    </div>
  `;
}

function renderBatchReviewCard(items) {
  const candidate = items[0];
  const candidateName = candidate.candidate_canonical_name || candidate.candidate_name;

  return `
    <div class="batch-review-card">
      <div class="batch-header">
        <h3>Batch Review: ${items.length} names may match "${escapeHtml(candidateName)}"</h3>
        ${candidate.candidate_disambiguation ? `<p class="disambiguation">${escapeHtml(candidate.candidate_disambiguation)}</p>` : ''}
      </div>

      <div class="batch-items">
        ${items.map(item => {
          const score = Math.round((item.similarity_score || 0) * 100);
          const checked = score >= 80 ? 'checked' : '';
          return `
            <label class="batch-item">
              <input type="checkbox" ${checked} value="${item.id}" class="batch-checkbox" data-candidate="${item.candidate_person_id}">
              <span class="batch-name">"${escapeHtml(item.new_name)}"</span>
              <span class="batch-score">${score}%</span>
            </label>
          `;
        }).join('')}
      </div>

      <div class="batch-actions">
        <button class="btn btn-success" onclick="handleBatchMerge(this)">Merge Selected</button>
        <button class="btn btn-danger" onclick="handleBatchReject(this)">Reject All</button>
        <button class="btn btn-secondary" onclick="expandBatch(this)">Review Individually</button>
      </div>
    </div>
  `;
}

async function handleMerge(reviewId) {
  const card = document.querySelector(`.review-card[data-id="${reviewId}"]`);
  card.classList.add('processing');

  try {
    await API.post(`/review/${reviewId}/merge`);
    card.classList.add('resolved', 'merged');
    setTimeout(() => card.remove(), 500);
    updateReviewCount(-1);
  } catch (err) {
    card.classList.remove('processing');
    alert('Error: ' + err.message);
  }
}

async function handleReject(reviewId) {
  const card = document.querySelector(`.review-card[data-id="${reviewId}"]`);
  card.classList.add('processing');

  try {
    await API.post(`/review/${reviewId}/reject`);
    card.classList.add('resolved', 'rejected');
    setTimeout(() => card.remove(), 500);
    updateReviewCount(-1);
  } catch (err) {
    card.classList.remove('processing');
    alert('Error: ' + err.message);
  }
}

async function handleSkip(reviewId) {
  const card = document.querySelector(`.review-card[data-id="${reviewId}"]`);
  card.classList.add('processing');

  try {
    await API.post(`/review/${reviewId}/skip`);
    card.classList.add('resolved', 'skipped');
    setTimeout(() => card.remove(), 500);
  } catch (err) {
    card.classList.remove('processing');
    alert('Error: ' + err.message);
  }
}

async function handleBatchMerge(button) {
  const card = button.closest('.batch-review-card');
  const checkboxes = card.querySelectorAll('.batch-checkbox:checked');
  const ids = Array.from(checkboxes).map(cb => parseInt(cb.value));

  if (ids.length === 0) {
    alert('Please select at least one item to merge');
    return;
  }

  card.classList.add('processing');

  try {
    await API.post('/review/batch', { action: 'merge', ids });
    card.classList.add('resolved');
    setTimeout(() => card.remove(), 500);
    updateReviewCount(-ids.length);
  } catch (err) {
    card.classList.remove('processing');
    alert('Error: ' + err.message);
  }
}

async function handleBatchReject(button) {
  const card = button.closest('.batch-review-card');
  const checkboxes = card.querySelectorAll('.batch-checkbox');
  const ids = Array.from(checkboxes).map(cb => parseInt(cb.value));

  card.classList.add('processing');

  try {
    await API.post('/review/batch', { action: 'reject', ids });
    card.classList.add('resolved');
    setTimeout(() => card.remove(), 500);
    updateReviewCount(-ids.length);
  } catch (err) {
    card.classList.remove('processing');
    alert('Error: ' + err.message);
  }
}

function expandBatch(button) {
  const card = button.closest('.batch-review-card');
  const checkboxes = card.querySelectorAll('.batch-checkbox');
  const ids = Array.from(checkboxes).map(cb => parseInt(cb.value));

  // Re-render the page to show individual cards
  renderReview();
}

function updateReviewCount(delta) {
  const badge = document.getElementById('review-badge');
  if (badge) {
    let count = parseInt(badge.textContent) || 0;
    count = Math.max(0, count + delta);
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  }
}
