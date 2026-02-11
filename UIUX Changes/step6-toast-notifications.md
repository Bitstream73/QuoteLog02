# Step 6: Toast Notifications (Replace `alert()`)

## Goal
Replace all native `alert()` calls with a non-blocking toast notification system. Native alerts block the main thread, look alien on every platform, and break the editorial immersion.

## Files to Modify
- `public/css/styles.css`
- `public/js/app.js`
- `public/index.html`
- `public/js/settings.js`

---

## 6.1 Toast Container in HTML

**File**: `public/index.html`
**Location**: Add before the closing `</body>` tag (before line 91)

```html
<div id="toast-container" class="toast-container"></div>
```

---

## 6.2 Toast CSS

**File**: `public/css/styles.css`
**Location**: Add a new section for toast styles

```css
/* ===================================
   Toast Notifications
   =================================== */
.toast-container {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  z-index: 300;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  pointer-events: none;
}

.toast {
  font-family: var(--font-ui);
  font-size: 0.85rem;
  padding: 0.75rem 1.25rem;
  border-radius: var(--radius);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  animation: toast-in 0.3s ease-out;
  max-width: 400px;
  pointer-events: auto;
  line-height: 1.4;
}

.toast-success {
  background: var(--success);
  color: #fff;
}

.toast-error {
  background: var(--error);
  color: #fff;
}

.toast-info {
  background: var(--text-primary);
  color: var(--bg-primary);
}

@keyframes toast-in {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes toast-out {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(100%); opacity: 0; }
}

@media (max-width: 480px) {
  .toast-container {
    bottom: 1rem;
    right: 1rem;
    left: 1rem;
  }
  .toast {
    max-width: 100%;
  }
}
```

---

## 6.3 Toast JavaScript

**File**: `public/js/app.js`
**Location**: Add before the `DOMContentLoaded` handler

```javascript
/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {'success'|'error'|'info'} type - Toast type (default: 'info')
 * @param {number} duration - Auto-dismiss time in ms (default: 3000)
 */
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toast-out 0.3s ease-in forwards';
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}
```

---

## 6.4 Replace `alert()` Calls in Settings

**File**: `public/js/settings.js`

Replace each `alert()` call with `showToast()`. Here is every instance:

**Line 238** (empty domain validation):
```javascript
// Change from:
alert('Please enter a domain');
// Change to:
showToast('Please enter a domain', 'error');
```

**Line 261** (error adding source):
```javascript
// Change from:
alert('Error adding source: ' + err.message);
// Change to:
showToast('Error adding source: ' + err.message, 'error', 5000);
```

**Line 269** (error updating source):
```javascript
// Change from:
alert('Error updating source: ' + err.message);
// Change to:
showToast('Error updating source: ' + err.message, 'error', 5000);
```

**Line 293** (error removing source):
```javascript
// Change from:
alert('Error removing source: ' + err.message);
// Change to:
showToast('Error removing source: ' + err.message, 'error', 5000);
```

**Line 301** (error updating setting):
```javascript
// Change from:
alert('Error updating setting: ' + err.message);
// Change to:
showToast('Error updating setting: ' + err.message, 'error', 5000);
```

**Line 391** (general error):
```javascript
// Change from:
alert('Error: ' + err.message);
// Change to:
showToast('Error: ' + err.message, 'error', 5000);
```

**Line 412** (export failed):
```javascript
// Change from:
alert('Export failed: ' + err.message);
// Change to:
showToast('Export failed: ' + err.message, 'error', 5000);
```

**Line 426** (backfill complete — this is a success):
```javascript
// Change from:
alert(`Backfill complete: ${result.found} headshots found out of ${result.processed} persons processed.`);
// Change to:
showToast(`Backfill complete: ${result.found} headshots found out of ${result.processed} processed`, 'success', 5000);
```

**Line 428** (backfill failed):
```javascript
// Change from:
alert('Backfill failed: ' + err.message);
// Change to:
showToast('Backfill failed: ' + err.message, 'error', 5000);
```

**Line 448** (restore complete — success):
```javascript
// Change from:
alert('Restore complete! Imported: ' + Object.entries(result.imported || {}).map(([k, v]) => `${k}: ${v}`).join(', '));
// Change to:
showToast('Restore complete! Imported: ' + Object.entries(result.imported || {}).map(([k, v]) => `${k}: ${v}`).join(', '), 'success', 5000);
```

**Line 452** (import failed):
```javascript
// Change from:
alert('Import failed: ' + err.message);
// Change to:
showToast('Import failed: ' + err.message, 'error', 5000);
```

**Lines 579, 591, 600, 612, 636, 708** (various errors in quote management):
```javascript
// Change each from:
alert('Error: ' + err.message);
// Change to:
showToast('Error: ' + err.message, 'error', 5000);
```

**Line 695** (invalid category):
```javascript
// Change from:
alert('Invalid category. Please choose from the list.');
// Change to:
showToast('Invalid category. Please choose from the list.', 'error');
```

---

## Verification

1. Go to Settings > News Sources > add a source with empty domain — red toast appears (not a native alert)
2. Add a valid source — verify it works (green toast for success if you added one, or functional confirmation)
3. Go to Settings > Database > Export — if it fails, red toast appears
4. Go to Settings > Database > Backfill Headshots — on completion, green toast appears
5. Trigger any settings error — red toast with 5 second duration
6. Toast slides in from the right, auto-dismisses after 3-5 seconds
7. Multiple toasts stack vertically
8. Check on mobile — toasts span full width below 480px
9. Check dark mode — toast colors (success green, error red) are visible

## Commit Message
```
feat: replace alert() with toast notification system
```
