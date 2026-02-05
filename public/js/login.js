function renderLogin() {
  document.getElementById('content').innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <h1>Admin Login</h1>
        <form id="login-form" class="auth-form">
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required autocomplete="email">
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required autocomplete="current-password">
          </div>
          <div id="login-error" class="auth-error hidden"></div>
          <button type="submit" class="btn btn-primary">Login</button>
        </form>
        <p class="auth-link">
          <a href="/forgot-password" onclick="navigate(event, '/forgot-password')">Forgot password?</a>
        </p>
      </div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('login-error');

    errorDiv.classList.add('hidden');

    try {
      const result = await API.post('/auth/login', { email, password });
      if (result.success) {
        isAdmin = true;
        updateNav();
        navigate(null, '/');
      }
    } catch (err) {
      errorDiv.textContent = err.message || 'Login failed';
      errorDiv.classList.remove('hidden');
    }
  });
}
