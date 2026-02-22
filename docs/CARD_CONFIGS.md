# Noteworthy Card Config Backend & Settings UI

## Phase 3: Backend Routes

### Admin CRUD — Card Configs

Add to `src/routes/admin.js` after existing noteworthy CRUD (~line 467):

**GET `/api/admin/noteworthy-configs`** — List all card configs
```javascript
// Returns: { configs: [...], collections: [...] }
// Include collection name via LEFT JOIN
SELECT ncc.*, nc.name as collection_name
FROM noteworthy_card_configs ncc
LEFT JOIN noteworthy_collections nc ON nc.id = ncc.collection_id
ORDER BY ncc.display_order ASC
```

**POST `/api/admin/noteworthy-configs`** — Create card config
- Body: `{ card_type, enabled?, display_order?, custom_title?, config?, collection_id? }`
- Validate card_type is one of the 28 valid types
- Returns: `{ success: true, id: number }`

**PATCH `/api/admin/noteworthy-configs/:id`** — Update config
- Body: any of `{ enabled, display_order, custom_title, config, collection_id }`
- Returns: `{ success: true }`

**DELETE `/api/admin/noteworthy-configs/:id`** — Delete config
- Returns: `{ success: true }`

### Admin CRUD — Collections

**GET `/api/admin/noteworthy-collections`** — List collections
**POST `/api/admin/noteworthy-collections`** — Create: `{ name, display_order? }`
**PATCH `/api/admin/noteworthy-collections/:id`** — Update: `{ name?, display_order?, enabled? }`
**DELETE `/api/admin/noteworthy-collections/:id`** — Delete (cards get `collection_id = NULL`)

### Public Endpoint — Evaluated Cards

Add to `src/routes/search.js` after existing `/noteworthy` route:

**GET `/api/noteworthy/evaluated`** — Returns computed card data for frontend
```javascript
// 1. Fetch all enabled card configs ordered by display_order
// 2. For each config, evaluate:
//    - Time-based: call evaluator from src/services/noteworthyEvaluator.js
//    - Search: return metadata only (frontend handles interaction)
//    - Info: return static content
// 3. Group by collection_id (null = standalone)
// Returns: { cards: [...], collections: [...], pepper_settings: {...} }
```

Each evaluated card object:
```json
{
  "id": 1,
  "card_type": "author_of_day",
  "custom_title": "Author of the Day",
  "collection_id": null,
  "data": {
    "entity": { "id": 42, "name": "...", "photo_url": "...", "category": "..." },
    "top_quotes": [{ "id": 1, "text": "...", "importants_count": 5 }, ...],
    "time_period": "day"
  }
}
```

### Pepper Settings in GET /api/settings

Ensure the existing `GET /api/settings` response includes the 4 new pepper setting keys. No code change needed if `initializeTables` seeds them — the existing settings endpoint returns all rows from the settings table.

## Phase 4: Settings UI

### Card Config List (in Noteworthy Cards tab)

Render in the Noteworthy Cards settings tab, BELOW the existing noteworthy items section:

```html
<div class="settings-subsection">
  <h3 class="subsection-title">Peppered Card Configs</h3>
  <p class="section-description">Configure cards that appear inline with quotes in the homepage scroll.</p>

  <!-- Pepper settings -->
  <div class="setting-row">
    <label><span class="setting-label">Quote Frequency</span>
      <span class="setting-description">Quotes between card insertion chances</span></label>
    <input type="number" value="${settings.noteworthy_pepper_frequency || 5}"
           min="1" max="50" class="input-number"
           onchange="updateSetting('noteworthy_pepper_frequency', this.value)">
  </div>
  <div class="setting-row">
    <label><span class="setting-label">Insertion Chance (%)</span>
      <span class="setting-description">Probability of inserting a card at each chance</span></label>
    <input type="range" min="0" max="100" value="${settings.noteworthy_pepper_chance || 50}"
           oninput="this.nextElementSibling.textContent=this.value+'%'; updateSetting('noteworthy_pepper_chance', this.value)">
    <span>${settings.noteworthy_pepper_chance || 50}%</span>
  </div>
  <div class="setting-row">
    <label><span class="setting-label">Pick Mode</span></label>
    <select onchange="updateSetting('noteworthy_pick_mode', this.value)" class="input-select">
      <option value="sequential" ${settings.noteworthy_pick_mode === 'sequential' ? 'selected' : ''}>Sequential</option>
      <option value="random" ${settings.noteworthy_pick_mode === 'random' ? 'selected' : ''}>Random</option>
    </select>
  </div>
  <div class="setting-row">
    <label><span class="setting-label">Re-use Cards</span>
      <span class="setting-description">Cycle through cards again after all have been shown</span></label>
    <label class="toggle">
      <input type="checkbox" ${settings.noteworthy_reuse_cards === '1' ? 'checked' : ''}
             onchange="updateSetting('noteworthy_reuse_cards', this.checked ? '1' : '0')">
      <span class="toggle-slider"></span>
    </label>
  </div>

  <!-- Card config list -->
  <div id="card-configs-list">
    <!-- Render each card config with toggle, title edit, collection dropdown -->
  </div>
</div>
```

### Card Config Row

```javascript
function renderCardConfigRow(config, collections) {
  return `
    <div class="noteworthy-config-row" data-config-id="${config.id}">
      <label class="toggle">
        <input type="checkbox" ${config.enabled ? 'checked' : ''}
               onchange="toggleCardConfig(${config.id}, this.checked)">
        <span class="toggle-slider"></span>
      </label>
      <span class="config-type-badge">${formatCardType(config.card_type)}</span>
      <input type="text" value="${escapeHtml(config.custom_title || '')}"
             placeholder="Custom title..."
             class="input-text input-sm"
             onchange="updateCardConfigTitle(${config.id}, this.value)">
      <select onchange="updateCardConfigCollection(${config.id}, this.value)" class="input-select input-sm">
        <option value="">Standalone</option>
        ${collections.map(c => `<option value="${c.id}" ${config.collection_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
      </select>
    </div>
  `;
}
```

### Helper Functions

```javascript
async function toggleCardConfig(id, enabled) {
  await API.patch(`/admin/noteworthy-configs/${id}`, { enabled });
}
async function updateCardConfigTitle(id, title) {
  await API.patch(`/admin/noteworthy-configs/${id}`, { custom_title: title });
}
async function updateCardConfigCollection(id, collectionId) {
  await API.patch(`/admin/noteworthy-configs/${id}`, { collection_id: collectionId || null });
}
```

## Test Expectations

- CRUD routes return correct HTTP status codes (200, 201, 404, 409)
- Card config toggle persists enabled state
- Collection deletion nullifies `collection_id` on child configs
- Evaluated endpoint returns data for enabled configs only
- Time-based evaluated cards include entity + top_quotes
- Settings UI renders all configs with correct toggles
- Pepper settings save and reload correctly
