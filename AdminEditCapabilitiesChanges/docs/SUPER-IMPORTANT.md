# SuperImportant Feature Spec

## Overview
Admin-only feature that boosts an entity's `importants_count` by +100 per click. This is an admin override, not a normal user vote.

## Backend Endpoint

### `POST /api/importants/super-toggle`

**Auth:** `requireAdmin` middleware (from `src/middleware/auth.js`)

**Request Body:**
```json
{
  "entity_type": "quote" | "article" | "person" | "topic",
  "entity_id": 123
}
```

**Behavior:**
1. Validate `entity_type` against existing `VALID_TYPES` array in `src/routes/importants.js`
2. Validate entity exists using existing `TABLE_MAP` lookup
3. Increment `importants_count` by 100 in the entity's table: `UPDATE ${table} SET importants_count = importants_count + 100 WHERE id = ?`
4. Do NOT create an `importants` table row (this is not a vote — no `voter_hash`)
5. Recalculate trending score: call existing `recalculateEntityScore(entity_type, entity_id)` from `src/services/trending.js`
6. Emit Socket.IO event: `io.emit('important_update', { entity_type, entity_id, importants_count: newCount })`
7. Return response

**Response:**
```json
{
  "success": true,
  "importants_count": 200
}
```

**Error Cases:**
- 401: No auth cookie or invalid JWT
- 400: Missing or invalid `entity_type`/`entity_id`
- 404: Entity not found in database

## Frontend Button

### Placement
After the existing Important? button and its count, on the same line.

### HTML Structure
```html
<button class="super-important-btn"
  onclick="handleSuperImportant(event, '${entityType}', ${entityId})">
  SuperImportant
</button>
```

### CSS
```css
.super-important-btn {
  background: var(--color-warning, #f0a500);
  color: white;
  border: none;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  margin-left: 6px;
}
.super-important-btn:hover {
  filter: brightness(1.1);
}
```

### Handler Function
Add to `public/js/important.js`:
```javascript
async function handleSuperImportant(event, entityType, entityId) {
  event.stopPropagation();
  const btn = event.target;
  btn.disabled = true;
  try {
    const result = await API.post('/importants/super-toggle', {
      entity_type: entityType,
      entity_id: entityId
    });
    // Update count display
    const block = btn.closest('.quote-block, .admin-quote-block');
    if (block) {
      const countEl = block.querySelector('.important-count');
      if (countEl) countEl.textContent = result.importants_count;
      block.dataset.importance = result.importants_count;
    }
    showToast('Boosted +100!', 'success');
  } catch (err) {
    showToast('Failed to boost: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
```

## Security Rules
- ONLY admin can call this endpoint — `requireAdmin` is non-negotiable
- No rate limiting needed (admin trust model)
- No voter_hash row — this does not count as a "vote" and cannot be "toggled off"
- Each click is additive (+100 every time)

## Test Requirements
- 401 when called without auth cookie
- 400 for invalid entity_type
- 404 for nonexistent entity_id
- Successful +100 increment (verify DB value before and after)
- Correct response shape `{ success, importants_count }`
- Socket.IO emission (mock or spy on `io.emit`)
