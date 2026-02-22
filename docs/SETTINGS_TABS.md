# Settings Page Tab Restructure

## Current Structure

Settings page (`public/js/settings.js` `renderSettings()`) is a single scrolling page with sequential `<div class="settings-section">` blocks.

## New Structure

Tab bar at top. Only one tab's content visible at a time.

## Tab Definitions & Section Mapping

| Tab ID | Label | Sections to Include |
|--------|-------|---------------------|
| `general` | General | Appearance |
| `data-sources` | Data Sources | Data Management (News Sources list, Source Authors, Export/Import/Backup/Purge) |
| `ingest` | Ingest | Fetch Settings, Disambiguation Settings, Ingest Filters, AI Prompts |
| `backfilling` | Backfilling | Historical Sources |
| `noteworthy` | Noteworthy Cards | Existing Noteworthy section + new Card Configs UI (Phase 4) |
| `metadata` | Metadata | Categories, Topics, Keywords |
| `logs` | Logs | Application Logs |

## HTML Structure

```html
<div class="settings-tab-bar">
  <button class="settings-tab active" onclick="switchSettingsTab('general')" data-tab="general">General</button>
  <button class="settings-tab" onclick="switchSettingsTab('data-sources')" data-tab="data-sources">Data Sources</button>
  <button class="settings-tab" onclick="switchSettingsTab('ingest')" data-tab="ingest">Ingest</button>
  <button class="settings-tab" onclick="switchSettingsTab('backfilling')" data-tab="backfilling">Backfilling</button>
  <button class="settings-tab" onclick="switchSettingsTab('noteworthy')" data-tab="noteworthy">Noteworthy Cards</button>
  <button class="settings-tab" onclick="switchSettingsTab('metadata')" data-tab="metadata">Metadata</button>
  <button class="settings-tab" onclick="switchSettingsTab('logs')" data-tab="logs">Logs</button>
</div>

<div class="settings-tab-content active" id="settings-tab-general">
  <!-- Appearance section here -->
</div>
<div class="settings-tab-content" id="settings-tab-data-sources">
  <!-- Data Management section here -->
</div>
<!-- ... one per tab -->
```

## Tab Switching Logic

```javascript
function switchSettingsTab(tabId) {
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.settings-tab[data-tab="${tabId}"]`)?.classList.add('active');
  document.getElementById(`settings-tab-${tabId}`)?.classList.add('active');
}
```

## CSS (add to `public/css/styles.css`)

Follow existing `.review-tab-bar` pattern:

```css
.settings-tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--border);
  margin-bottom: var(--space-4);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.settings-tab {
  padding: var(--space-2) var(--space-3);
  border: none;
  background: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  color: var(--text-secondary);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s, border-color 0.15s;
}

.settings-tab:hover {
  color: var(--text-primary);
}

.settings-tab.active {
  border-bottom-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.settings-tab-content {
  display: none;
}

.settings-tab-content.active {
  display: block;
}
```

## Implementation Notes

- The `renderSettings()` function already fetches all data upfront (settings, sources, prompts, noteworthy, keywords, topics, categories, sourceAuthors). Keep this — just restructure the HTML output.
- Default active tab: `general`.
- Logs section lazy-loads when tab is selected (check if `loadLogs()` needs to be called on tab switch).
- Historical sources list loads async after render — ensure it still works when the backfilling tab isn't initially visible.
- Preserve all existing `id` attributes on sections (e.g., `settings-section-prompts`, `settings-section-historical`) as code references them.

## Test Expectations

- Settings page renders with tab bar containing 7 tabs
- Default tab (General) is visible, others hidden
- Clicking each tab shows correct sections and hides others
- All existing functionality still works within tabs (add source, edit prompt, toggle ingest filter, etc.)
