// Bug Report Modal

function showBugReportModal(quoteId) {
  // Remove existing modal if any
  closeBugReportModal();

  const overlay = document.createElement('div');
  overlay.className = 'bug-modal-overlay';
  overlay.id = 'bug-modal-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) closeBugReportModal(); };

  overlay.innerHTML = `
    <div class="bug-modal">
      <button class="bug-modal-close" onclick="closeBugReportModal()">&times;</button>
      <h3 class="bug-modal-title">Report a Bug</h3>
      <form onsubmit="submitBugReport(event, ${quoteId || 'null'})">
        <textarea class="bug-modal-textarea" id="bug-report-message" maxlength="280" placeholder="Describe the issue..." rows="4"></textarea>
        <div class="bug-modal-char-count"><span id="bug-char-count">0</span>/280</div>
        <button type="submit" class="btn btn-primary" style="width:100%">Submit Report</button>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  const textarea = document.getElementById('bug-report-message');
  textarea.addEventListener('input', function() {
    document.getElementById('bug-char-count').textContent = this.value.length;
  });
  textarea.focus();

  document.addEventListener('keydown', _bugModalEscHandler);
}

function _bugModalEscHandler(e) {
  if (e.key === 'Escape') closeBugReportModal();
}

function closeBugReportModal() {
  const overlay = document.getElementById('bug-modal-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', _bugModalEscHandler);
}

async function submitBugReport(event, quoteId) {
  event.preventDefault();
  const message = document.getElementById('bug-report-message').value.trim();
  if (!message) {
    showToast('Please describe the issue', 'error');
    return;
  }
  if (message.length > 280) {
    showToast('Message must be 280 characters or less', 'error');
    return;
  }

  try {
    await API.post('/bug-reports', {
      message,
      page_url: window.location.href,
      quote_id: quoteId || null,
    });
    closeBugReportModal();
    showToast('Bug report submitted. Thank you!', 'success');
  } catch (err) {
    showToast('Error submitting report: ' + err.message, 'error');
  }
}
