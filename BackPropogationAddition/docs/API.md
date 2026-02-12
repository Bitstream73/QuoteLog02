# API Routes -- Historical Sources

New route file: `src/routes/historicalSources.js`
Mount in `src/index.js`: `app.use('/api/historical-sources', historicalSourcesRouter)`

All endpoints require admin auth (`requireAdmin` middleware from `src/middleware/auth.js`).

## Endpoints

### GET /api/historical-sources

List all historical source providers with current status.

```json
{
  "sources": [
    {
      "id": 1,
      "provider_key": "wikiquote",
      "name": "Wikiquote",
      "description": "Quotes from Wikiquote via MediaWiki API",
      "enabled": true,
      "status": "working",
      "consecutive_failures": 0,
      "total_articles_fetched": 142,
      "last_fetch_at": "2026-02-12T10:30:00.000Z",
      "last_success_at": "2026-02-12T10:30:00.000Z",
      "last_error": null
    }
  ]
}
```

Query: `SELECT * FROM historical_sources ORDER BY name`
Map `enabled` to boolean for JSON response.

### PATCH /api/historical-sources/:key

Toggle a provider on/off. Admin only.

**Body:** `{ "enabled": true }` or `{ "enabled": false }`

**Logic:**
- If disabling: `UPDATE historical_sources SET enabled = 0, status = 'disabled', updated_at = datetime('now') WHERE provider_key = ?`
- If enabling: `UPDATE historical_sources SET enabled = 1, status = 'unknown', updated_at = datetime('now') WHERE provider_key = ?`
- Return 404 if provider_key not found

**Response:** Updated source object.

### POST /api/historical-sources/:key/test

Test a provider's connection. Admin only.

**Logic:**
1. Look up provider by key in the provider registry (`getProviderByKey(key)`)
2. Return 404 if not found
3. Call `provider.testConnection()`
4. Update `historical_sources.status` based on result:
   - Success: `status = 'working'`, `last_success_at = datetime('now')`, `last_error = NULL`
   - Failure: `status = 'failed'`, `last_error = message`

**Response:**
```json
{ "success": true, "message": "Successfully connected to Wikiquote API" }
```

### GET /api/historical-sources/stats

Aggregate statistics. Admin only.

**Response:**
```json
{
  "total_historical_articles": 1523,
  "total_historical_quotes": 4891,
  "providers": [
    {
      "provider_key": "wikiquote",
      "articles_fetched": 142,
      "last_fetch_at": "2026-02-12T10:30:00.000Z",
      "status": "working"
    }
  ]
}
```

**Queries:**
- `SELECT COUNT(*) FROM articles WHERE historical_source_id IS NOT NULL`
- `SELECT COUNT(*) FROM quotes q JOIN quote_articles qa ON q.id = qa.quote_id JOIN articles a ON qa.article_id = a.id WHERE a.historical_source_id IS NOT NULL`
- `SELECT provider_key, total_articles_fetched, last_fetch_at, status FROM historical_sources ORDER BY name`

## Frontend -- Settings Page Section

Add a new settings section in `public/js/settings.js` `renderSettings()`. Insert between the "Appearance" section and the "Data Management" section.

### Section HTML (in renderSettings template):

```html
<div class="settings-section">
  <h2>Historical Sources</h2>
  <p class="section-description">
    Configure historical quote sources for backfilling quotes from the past.
    Each provider fetches articles from a different archive.
  </p>

  <div class="setting-row" style="align-items:center">
    <label>
      <span class="setting-label">Historical Backfill</span>
      <span class="setting-description">Enable/disable historical fetching during each cycle</span>
    </label>
    <label class="toggle">
      <input type="checkbox" ${settings.historical_fetch_enabled === '1' ? 'checked' : ''}
             onchange="updateSetting('historical_fetch_enabled', this.checked ? '1' : '0')">
      <span class="toggle-slider"></span>
    </label>
  </div>

  <div class="setting-row">
    <label>
      <span class="setting-label">Articles per Source per Cycle</span>
      <span class="setting-description">Max historical articles to fetch from each provider per cycle</span>
    </label>
    <input type="number" value="${settings.historical_articles_per_source_per_cycle || 5}"
           min="1" max="100" class="input-number"
           onchange="updateSetting('historical_articles_per_source_per_cycle', this.value)">
  </div>

  <div id="historical-sources-list" class="sources-list">
    <p class="empty-message">Loading historical sources...</p>
  </div>
</div>
```

### Provider Row Rendering:

```javascript
function renderHistoricalSourceRow(source) {
  const statusClass = source.status === 'working' ? 'status-dot-working'
    : source.status === 'failed' ? 'status-dot-failed'
    : 'status-dot-disabled';
  const statusLabel = source.status === 'working' ? 'Working'
    : source.status === 'failed' ? 'Failed'
    : source.status === 'disabled' ? 'Disabled'
    : 'Unknown';

  return `
    <div class="source-row historical-source-row" data-key="${escapeHtml(source.provider_key)}">
      <div class="source-info">
        <span class="status-dot ${statusClass}" title="${statusLabel}"></span>
        <div>
          <span class="source-domain">${escapeHtml(source.name)}</span>
          <span class="source-name">${escapeHtml(source.description || '')}</span>
          ${source.last_error ? `<span class="source-warning" title="${escapeHtml(source.last_error)}">!</span>` : ''}
        </div>
      </div>
      <div class="source-actions">
        <span class="historical-stat">${source.total_articles_fetched} articles</span>
        <button class="btn btn-secondary btn-sm"
                onclick="testHistoricalSource('${escapeHtml(source.provider_key)}')"
                id="test-btn-${escapeHtml(source.provider_key)}">Test</button>
        <label class="toggle">
          <input type="checkbox" ${source.enabled ? 'checked' : ''}
                 onchange="toggleHistoricalSource('${escapeHtml(source.provider_key)}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
  `;
}
```

### Frontend Functions:

```javascript
async function loadHistoricalSources() {
  try {
    const data = await API.get('/historical-sources');
    const list = document.getElementById('historical-sources-list');
    if (list) {
      list.innerHTML = data.sources.length === 0
        ? '<p class="empty-message">No historical sources configured.</p>'
        : data.sources.map(s => renderHistoricalSourceRow(s)).join('');
    }
  } catch (err) {
    console.error('Failed to load historical sources:', err);
  }
}

async function toggleHistoricalSource(key, enabled) {
  try {
    await API.patch(`/historical-sources/${key}`, { enabled });
    showToast(enabled ? 'Historical source enabled' : 'Historical source disabled', 'success');
    await loadHistoricalSources();
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
    await loadHistoricalSources();
  }
}

async function testHistoricalSource(key) {
  const btn = document.getElementById(`test-btn-${key}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Testing...'; }
  try {
    const result = await API.post(`/historical-sources/${key}/test`);
    showToast(result.message, result.success ? 'success' : 'error', 5000);
    await loadHistoricalSources();
  } catch (err) {
    showToast('Test failed: ' + err.message, 'error', 5000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Test'; }
  }
}
```

Call `loadHistoricalSources()` at the end of `renderSettings()`, after `startSchedulerCountdown()`.

### CSS (append to end of `public/css/styles.css`):

```css
/* Historical Sources */
.historical-source-row .source-info {
  gap: 0.75rem;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}

.status-dot-working {
  background: var(--success, #22c55e);
}

.status-dot-failed {
  background: var(--error, #ef4444);
}

.status-dot-disabled {
  background: var(--text-muted, #9ca3af);
}

.historical-stat {
  font-size: 0.8rem;
  color: var(--text-muted);
  white-space: nowrap;
}
```

## Test Expectations

### Integration Tests (`tests/integration/historical-sources.test.js`):
- GET `/api/historical-sources` returns all 5 providers
- GET without admin auth returns 401
- PATCH `/api/historical-sources/wikiquote` with `{enabled: false}` sets enabled=0, status='disabled'
- PATCH back with `{enabled: true}` sets enabled=1, status='unknown'
- PATCH with invalid key returns 404
- POST `/api/historical-sources/wikiquote/test` returns `{success, message}` (mock provider)
- GET `/api/historical-sources/stats` returns article/quote counts

### Frontend Tests (`tests/unit/historical-frontend.test.js`):
- `renderHistoricalSourceRow()` produces correct HTML with status dot, toggle, test button
- Status dot classes map correctly to status values
- Toggle and test button have correct onclick handlers
