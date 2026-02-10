// Vote Component — Reusable upvote/downvote controls for quotes

// localStorage key for persisting user votes for instant feedback
const VOTE_STORAGE_KEY = 'quote_votes';

function getStoredVotes() {
  try {
    return JSON.parse(localStorage.getItem(VOTE_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function storeVote(quoteId, value) {
  const votes = getStoredVotes();
  if (value === 0) {
    delete votes[quoteId];
  } else {
    votes[quoteId] = value;
  }
  localStorage.setItem(VOTE_STORAGE_KEY, JSON.stringify(votes));
}

/**
 * Render vote controls HTML for a quote.
 * @param {number} quoteId
 * @param {number} voteScore - net vote score
 * @param {number} userVote - current user's vote (-1, 0, or 1)
 * @returns {string} HTML string
 */
function renderVoteControls(quoteId, voteScore, userVote) {
  // Check localStorage for instant feedback (overrides server state on first render)
  const stored = getStoredVotes();
  const effectiveVote = stored[quoteId] !== undefined ? stored[quoteId] : (userVote || 0);

  const upActive = effectiveVote === 1 ? ' active' : '';
  const downActive = effectiveVote === -1 ? ' active' : '';
  const scoreClass = voteScore !== 0 ? ' has-votes' : '';

  return `
    <div class="vote-controls" data-quote-id="${quoteId}">
      <button class="vote-btn vote-up${upActive}" aria-label="Upvote" onclick="handleVote(event, ${quoteId}, ${effectiveVote === 1 ? 0 : 1})">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 3L3 10h10L8 3z"/>
        </svg>
      </button>
      <span class="vote-score${scoreClass}">${voteScore}</span>
      <button class="vote-btn vote-down${downActive}" aria-label="Downvote" onclick="handleVote(event, ${quoteId}, ${effectiveVote === -1 ? 0 : -1})">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 13L3 6h10L8 13z"/>
        </svg>
      </button>
    </div>
  `;
}

/**
 * Handle a vote click. Posts to API, updates localStorage, updates DOM.
 */
async function handleVote(event, quoteId, value) {
  if (event) event.preventDefault();
  if (event) event.stopPropagation();

  const container = document.querySelector(`.vote-controls[data-quote-id="${quoteId}"]`);
  if (!container) return;

  // Optimistic UI update
  const upBtn = container.querySelector('.vote-up');
  const downBtn = container.querySelector('.vote-down');
  const scoreEl = container.querySelector('.vote-score');

  // Remove active states
  upBtn.classList.remove('active');
  downBtn.classList.remove('active');

  // Set new active state
  if (value === 1) upBtn.classList.add('active');
  if (value === -1) downBtn.classList.add('active');

  // Store optimistically
  storeVote(quoteId, value);

  // Update onclick handlers for toggle behavior
  upBtn.setAttribute('onclick', `handleVote(event, ${quoteId}, ${value === 1 ? 0 : 1})`);
  downBtn.setAttribute('onclick', `handleVote(event, ${quoteId}, ${value === -1 ? 0 : -1})`);

  try {
    const result = await API.post(`/quotes/${quoteId}/vote`, { value });
    // Update score from server (source of truth)
    if (scoreEl) {
      scoreEl.textContent = result.vote_score;
      scoreEl.classList.toggle('has-votes', result.vote_score !== 0);
    }
  } catch (err) {
    console.error('Vote failed:', err);
    // Revert optimistic update on error — remove active states
    upBtn.classList.remove('active');
    downBtn.classList.remove('active');
  }
}

// Socket.IO: listen for real-time vote updates from other users
function initVoteSocket() {
  if (typeof socket !== 'undefined' && socket) {
    socket.on('vote_update', ({ quoteId, vote_score }) => {
      const el = document.querySelector(`.vote-controls[data-quote-id="${quoteId}"] .vote-score`);
      if (el) {
        el.textContent = vote_score;
        el.classList.toggle('has-votes', vote_score !== 0);
      }
    });
  }
}
