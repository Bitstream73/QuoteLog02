function renderForgotPassword() {
  document.getElementById('content').innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <h1>Forgot Password</h1>
        <p>Enter your email address and we'll send you a link to reset your password.</p>
        <form id="forgot-form" class="auth-form">
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required autocomplete="email">
          </div>
          <div id="forgot-message" class="auth-success hidden"></div>
          <div id="forgot-error" class="auth-error hidden"></div>
          <button type="submit" class="btn btn-primary">Send Reset Link</button>
        </form>
        <p class="auth-link">
          <a href="/login" onclick="navigate(event, '/login')">Back to login</a>
        </p>
      </div>
    </div>
  `;

  document.getElementById('forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const messageDiv = document.getElementById('forgot-message');
    const errorDiv = document.getElementById('forgot-error');

    messageDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');

    try {
      await API.post('/auth/forgot-password', { email });
      messageDiv.textContent = 'If an account with that email exists, a password reset link has been sent. Check your email.';
      messageDiv.classList.remove('hidden');
      document.getElementById('forgot-form').reset();
    } catch (err) {
      errorDiv.textContent = err.message || 'Failed to send reset email';
      errorDiv.classList.remove('hidden');
    }
  });
}

function renderResetPassword(token) {
  if (!token) {
    document.getElementById('content').innerHTML = `
      <div class="auth-container">
        <div class="auth-card">
          <h1>Invalid Reset Link</h1>
          <p>The password reset link is invalid or has expired.</p>
          <p class="auth-link">
            <a href="/forgot-password" onclick="navigate(event, '/forgot-password')">Request a new reset link</a>
          </p>
        </div>
      </div>
    `;
    return;
  }

  document.getElementById('content').innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <h1>Reset Password</h1>
        <form id="reset-form" class="auth-form">
          <div class="form-group">
            <label for="password">New Password</label>
            <input type="password" id="password" name="password" required minlength="8" autocomplete="new-password">
          </div>
          <div class="form-group">
            <label for="confirm-password">Confirm Password</label>
            <input type="password" id="confirm-password" name="confirm-password" required minlength="8" autocomplete="new-password">
          </div>
          <div id="reset-message" class="auth-success hidden"></div>
          <div id="reset-error" class="auth-error hidden"></div>
          <button type="submit" class="btn btn-primary">Reset Password</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const messageDiv = document.getElementById('reset-message');
    const errorDiv = document.getElementById('reset-error');

    messageDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');

    if (password !== confirmPassword) {
      errorDiv.textContent = 'Passwords do not match';
      errorDiv.classList.remove('hidden');
      return;
    }

    try {
      await API.post('/auth/reset-password', { token, password });
      messageDiv.innerHTML = 'Password reset successfully! <a href="/login" onclick="navigate(event, \'/login\')">Click here to login</a>';
      messageDiv.classList.remove('hidden');
      document.getElementById('reset-form').reset();
    } catch (err) {
      errorDiv.textContent = err.message || 'Failed to reset password';
      errorDiv.classList.remove('hidden');
    }
  });
}
