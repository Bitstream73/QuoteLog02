let logsState = {
  page: 1,
  level: '',
  category: '',
  search: '',
  startDate: '',
  endDate: '',
};

let debounceTimer = null;

async function loadLogsStats() {
  const container = document.getElementById('logs-stats');
  if (!container) return;

  try {
    const stats = await API.get('/logs/stats');

    const maxRph = Math.max(...(stats.requestsPerHour.map(r => r.count) || [1]), 1);

    let barsHtml = '';
    for (const rph of stats.requestsPerHour.slice(0, 12)) {
      const height = Math.max((rph.count / maxRph) * 60, 2);
      barsHtml += `<div class="bar" style="height:${height}px" title="${rph.hour}: ${rph.count}"></div>`;
    }

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value" style="color:var(--error)">${stats.errorCount24h}</div>
          <div class="stat-label">Errors (24h)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--warning)">${stats.warningCount24h}</div>
          <div class="stat-label">Warnings (24h)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.topCategories.length}</div>
          <div class="stat-label">Active Categories</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Requests/Hour</div>
          <div class="bar-chart">${barsHtml || '<span style="color:var(--text-muted)">No data</span>'}</div>
        </div>
      </div>
    `;
  } catch {
    container.innerHTML = '';
  }
}

function renderLogsFilters() {
  const container = document.getElementById('logs-filters');
  if (!container) return;

  container.innerHTML = `
    <div class="toolbar">
      <div class="filter-group">
        <button class="filter-btn error ${logsState.level === 'error' ? 'active' : ''}" onclick="toggleLevel('error')">Error</button>
        <button class="filter-btn warn ${logsState.level === 'warn' ? 'active' : ''}" onclick="toggleLevel('warn')">Warn</button>
        <button class="filter-btn info ${logsState.level === 'info' ? 'active' : ''}" onclick="toggleLevel('info')">Info</button>
        <button class="filter-btn debug ${logsState.level === 'debug' ? 'active' : ''}" onclick="toggleLevel('debug')">Debug</button>
      </div>
      <select onchange="setCategory(this.value)">
        <option value="">All Categories</option>
        <option value="api" ${logsState.category === 'api' ? 'selected' : ''}>API</option>
        <option value="ai" ${logsState.category === 'ai' ? 'selected' : ''}>AI</option>
        <option value="db" ${logsState.category === 'db' ? 'selected' : ''}>Database</option>
        <option value="system" ${logsState.category === 'system' ? 'selected' : ''}>System</option>
        <option value="vectordb" ${logsState.category === 'vectordb' ? 'selected' : ''}>Vector DB</option>
        <option value="test" ${logsState.category === 'test' ? 'selected' : ''}>Test</option>
      </select>
      <input type="search" placeholder="Search logs..." value="${escapeHtml(logsState.search)}" oninput="debounceSearch(this.value)">
      <input type="date" value="${logsState.startDate}" onchange="setDateRange(this.value, 'start')">
      <input type="date" value="${logsState.endDate}" onchange="setDateRange(this.value, 'end')">
    </div>
  `;
}

function toggleLevel(level) {
  logsState.level = logsState.level === level ? '' : level;
  logsState.page = 1;
  renderLogsFilters();
  loadLogs();
}

function setCategory(cat) {
  logsState.category = cat;
  logsState.page = 1;
  loadLogs();
}

function debounceSearch(val) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    logsState.search = val;
    logsState.page = 1;
    loadLogs();
  }, 300);
}

function setDateRange(val, type) {
  if (type === 'start') logsState.startDate = val;
  else logsState.endDate = val;
  logsState.page = 1;
  loadLogs();
}

async function loadLogs() {
  const container = document.getElementById('logs-table');
  if (!container) return;

  const params = new URLSearchParams({ page: logsState.page, limit: 50 });
  if (logsState.level) params.set('level', logsState.level);
  if (logsState.category) params.set('category', logsState.category);
  if (logsState.search) params.set('search', logsState.search);
  if (logsState.startDate) params.set('startDate', logsState.startDate);
  if (logsState.endDate) params.set('endDate', logsState.endDate);

  try {
    const data = await API.get(`/logs?${params}`);

    if (data.logs.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);padding:1rem">No logs found matching filters.</p>';
      document.getElementById('logs-pagination').innerHTML = '';
      return;
    }

    let rows = '';
    for (const log of data.logs) {
      const time = new Date(log.timestamp).toLocaleString();
      const details = log.details ? JSON.parse(log.details) : {};
      const detailStr = Object.entries(details).slice(0, 3).map(([k,v]) => `${k}=${v}`).join(', ');

      rows += `
        <tr onclick="showLogDetail(${log.id}, this)" data-log='${escapeHtml(JSON.stringify(log))}'>
          <td>${time}</td>
          <td><span class="badge badge-${log.level}">${log.level}</span></td>
          <td>${escapeHtml(log.category)}</td>
          <td>${escapeHtml(log.action)}</td>
          <td>${log.duration ? log.duration + 'ms' : '-'}</td>
          <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(detailStr)}</td>
        </tr>
      `;
    }

    container.innerHTML = `
      <table class="log-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Level</th>
            <th>Category</th>
            <th>Action</th>
            <th>Duration</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    // Pagination
    const pagContainer = document.getElementById('logs-pagination');
    if (data.totalPages > 1) {
      let pagHtml = '<div class="pagination">';
      pagHtml += `<button class="page-btn" ${data.page <= 1 ? 'disabled' : ''} onclick="goToLogsPage(${data.page - 1})">Prev</button>`;
      for (let i = Math.max(1, data.page - 2); i <= Math.min(data.totalPages, data.page + 2); i++) {
        pagHtml += `<button class="page-btn ${i === data.page ? 'active' : ''}" onclick="goToLogsPage(${i})">${i}</button>`;
      }
      pagHtml += `<button class="page-btn" ${data.page >= data.totalPages ? 'disabled' : ''} onclick="goToLogsPage(${data.page + 1})">Next</button>`;
      pagHtml += '</div>';
      pagContainer.innerHTML = pagHtml;
    } else {
      pagContainer.innerHTML = '';
    }
  } catch (err) {
    container.innerHTML = `<p style="color:var(--error);padding:1rem">Error loading logs: ${escapeHtml(err.message)}</p>`;
  }
}

function goToLogsPage(page) {
  logsState.page = page;
  loadLogs();
}

function showLogDetail(id, row) {
  try {
    const log = JSON.parse(row.dataset.log);
    const details = log.details ? JSON.parse(log.details) : {};
    const time = new Date(log.timestamp).toLocaleString();

    document.getElementById('modal-content').innerHTML = `
      <h3 style="margin-bottom:1rem">Log Detail</h3>
      <p><strong>ID:</strong> ${log.id}</p>
      <p><strong>Time:</strong> ${time}</p>
      <p><strong>Level:</strong> <span class="badge badge-${log.level}">${log.level}</span></p>
      <p><strong>Category:</strong> ${escapeHtml(log.category)}</p>
      <p><strong>Action:</strong> ${escapeHtml(log.action)}</p>
      <p><strong>Request ID:</strong> ${escapeHtml(log.request_id || 'N/A')}</p>
      <p><strong>IP:</strong> ${escapeHtml(log.ip_address || 'N/A')}</p>
      <p><strong>Duration:</strong> ${log.duration ? log.duration + 'ms' : 'N/A'}</p>
      ${log.error ? `<p><strong>Error:</strong> <span style="color:var(--error)">${escapeHtml(log.error)}</span></p>` : ''}
      <h4 style="margin:1rem 0 0.5rem">Details</h4>
      <div class="json-view">${escapeHtml(JSON.stringify(details, null, 2))}</div>
    `;
    document.getElementById('modal-overlay').classList.remove('hidden');
  } catch (err) {
    console.error('Error showing log detail:', err);
  }
}

function exportLogs() {
  const params = {};
  if (logsState.level) params.level = logsState.level;
  if (logsState.category) params.category = logsState.category;
  if (logsState.startDate) params.startDate = logsState.startDate;
  if (logsState.endDate) params.endDate = logsState.endDate;

  window.location.href = API.getExportUrl(params);
}
