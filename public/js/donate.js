// Donate Nag Modal
// Shows a timed donation prompt with escalating delays per day session.
// Admin users never see it. Tracked via localStorage.

const DONATE_DELAYS = [10000, 300000, 900000, 2700000]; // 10s, 5m, 15m, 45m
const DONATE_URL = 'https://buymeacoffee.com/whattheysaidnews';
let _donateTimerId = null;

function initDonateNag() {
  if (typeof isAdmin !== 'undefined' && isAdmin) return;

  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const storedDate = localStorage.getItem('ql-donate-date');
  let count = parseInt(localStorage.getItem('ql-donate-count'), 10) || 0;

  if (storedDate !== today) {
    count = 0;
    localStorage.setItem('ql-donate-date', today);
    localStorage.setItem('ql-donate-count', '0');
  }

  _scheduleDonateNag(count);
}

function _scheduleDonateNag(count) {
  if (count >= DONATE_DELAYS.length) return;
  clearTimeout(_donateTimerId);
  _donateTimerId = setTimeout(showDonateModal, DONATE_DELAYS[count]);
}

function showDonateModal() {
  if (document.getElementById('donate-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'donate-modal-overlay';
  overlay.id = 'donate-modal-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) closeDonateModal(); };

  overlay.innerHTML = `
    <div class="donate-modal">
      <button class="donate-modal-close" onclick="closeDonateModal()">&times;</button>
      <h3 class="donate-modal-title">This'll just take a sec!</h3>
      <p class="donate-modal-body">
        TrueOrFalse.News is built and maintained by one person. No ads, no paywalls, no corporate sponsors.
        If you find value in what we do, a small donation helps keep the lights on and the quotes flowing.
      </p>
      <a href="${DONATE_URL}" target="_blank" rel="noopener" class="btn btn-primary donate-modal-btn" onclick="closeDonateModal()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        Buy Me a Coffee
      </a>
      <p class="donate-modal-disclaimer">100% of donations go toward hosting, AI, and development costs.</p>
    </div>
  `;

  document.body.appendChild(overlay);
  document.addEventListener('keydown', _donateEscHandler);
}

function _donateEscHandler(e) {
  if (e.key === 'Escape') closeDonateModal();
}

function closeDonateModal() {
  const overlay = document.getElementById('donate-modal-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', _donateEscHandler);

  let count = parseInt(localStorage.getItem('ql-donate-count'), 10) || 0;
  count++;
  localStorage.setItem('ql-donate-count', String(count));
  _scheduleDonateNag(count);
}
