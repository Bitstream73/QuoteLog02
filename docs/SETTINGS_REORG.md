# Settings Reorganization Spec

## Overview
Two structural changes to the settings and review pages:
1. Move "Quote Management" from Settings to the Review page
2. Move "News Sources" under the "Database" section in Settings (renamed to "Data Management")

## Change 1: Move Quote Management to Review Page

### Current State
- Settings page (`public/js/settings.js`) has a "Quote Management" section (lines ~160-176, ~458-710)
- Review page (`public/js/review.js`) has only disambiguation review

### Target State
- Review page gets TWO tabs: "Disambiguation" (existing) and "Quote Management" (moved from settings)
- Settings page NO LONGER has Quote Management

### Implementation — Review Page (`public/js/review.js`)

Add a tab bar at the top of the review page:
```html
<div class="review-tabs">
  <button class="review-tab active" data-tab="disambiguation">Disambiguation</button>
  <button class="review-tab" data-tab="quote-management">Quote Management</button>
</div>
<div id="review-disambiguation" class="review-tab-content">
  <!-- existing disambiguation UI -->
</div>
<div id="review-quote-management" class="review-tab-content" style="display:none">
  <!-- moved from settings: search, pagination, quote cards with admin actions -->
</div>
```

Tab switching:
```javascript
function switchReviewTab(tab) {
  document.querySelectorAll('.review-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.review-tab-content').forEach(c => c.style.display = 'none');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`review-${tab}`).style.display = '';
  if (tab === 'quote-management') loadAdminQuotes();
}
```

### What Moves from Settings to Review
Functions to move (they will now use shared `admin-actions.js`):
- `loadAdminQuotes()` — search + paginated quote list rendering
- Quote card rendering with admin action buttons
- Quote management search/pagination state variables

### What to Remove from Settings
- The entire "Quote Management" section HTML generation
- `loadAdminQuotes()` and related rendering functions (now in review.js or admin-actions.js)
- Keep the settings sections that remain: Fetch Settings, Disambiguation, Appearance, Data Management, Logs

### CSS for Review Tabs
```css
.review-tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--border-color);
  margin-bottom: 20px;
}
.review-tab {
  padding: 10px 20px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  cursor: pointer;
  font-size: 0.95rem;
  color: var(--text-secondary);
}
.review-tab.active {
  color: var(--accent-color);
  border-bottom-color: var(--accent-color);
  font-weight: 600;
}
```

---

## Change 2: Move News Sources Under Database Section

### Current Settings Page Section Order
1. News Sources
2. Fetch Settings
3. Disambiguation Settings
4. Appearance
5. Database Backup (Export, Import, Backfill Headshots)
6. Quote Management ← being removed
7. Application Logs

### Target Settings Page Section Order
1. Fetch Settings
2. Disambiguation Settings
3. Appearance
4. **Data Management** (renamed from "Database Backup")
   - **4a. News Sources** (moved here as subsection)
   - **4b. Backup & Restore** (Export, Import)
   - **4c. Maintenance** (Backfill Headshots)
5. Application Logs

### Implementation — Settings Page (`public/js/settings.js`)

Restructure the `renderSettings()` function to output sections in new order:
1. Move news sources HTML generation inside the Data Management section
2. Rename "Database Backup" header to "Data Management"
3. Add subsection headers: "News Sources", "Backup & Restore", "Maintenance"

### Subsection Layout
```html
<section id="settings-section-data">
  <h2>Data Management</h2>

  <div class="settings-subsection">
    <h3>News Sources</h3>
    <!-- existing news sources add form + list -->
  </div>

  <div class="settings-subsection">
    <h3>Backup & Restore</h3>
    <!-- existing export/import buttons -->
  </div>

  <div class="settings-subsection">
    <h3>Maintenance</h3>
    <!-- existing backfill headshots button -->
  </div>
</section>
```

### CSS for Subsections
```css
.settings-subsection {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
}
.settings-subsection:last-child {
  border-bottom: none;
  margin-bottom: 0;
}
.settings-subsection h3 {
  font-size: 1rem;
  margin-bottom: 12px;
  color: var(--text-secondary);
}
```

## Test Expectations
- Settings page test: "Quote Management" section does NOT render
- Settings page test: "News Sources" renders inside "Data Management" section
- Settings page test: section order is Fetch, Disambiguation, Appearance, Data Management, Logs
- Review page test: two tabs render (Disambiguation + Quote Management)
- Review page test: Quote Management tab loads quote search/list
- Review page test: Quote Management tab has admin action buttons
