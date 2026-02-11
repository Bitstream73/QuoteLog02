# UI/UX Overhaul Orchestrator

Execute each step file in order. After each step: verify visually, run tests, commit. After all steps: deploy.

## Pre-Flight Checks

1. Ensure git working tree is clean (commit or stash pending changes)
2. Run `npm test` — all tests must pass before starting
3. Open the app locally at `http://localhost:3000` for visual verification

## Execution Order

### Step 1: Dark Mode + CSS Foundation
- **File**: `step1-dark-mode.md`
- **What**: Dark mode CSS variables, theme toggle button, JS logic, settings wiring
- **Verify**: Toggle dark mode on/off, check cards/header/footer/modals all adapt, no white flash on reload
- **Commit**: `feat: add dark mode with theme toggle and CSS variable foundation`

### Step 2: Typography + Spacing + Visual Hierarchy
- **File**: `step2-typography.md`
- **What**: Wider max-width, fluid titles, section dividers, article group borders, elevated quote decorators
- **Verify**: Layout feels wider and more breathable, quotes have larger decorative marks, groups clearly separated
- **Commit**: `style: refine typography, spacing, and visual hierarchy for editorial feel`

### Step 3: Skeleton Loading + Relative Timestamps
- **File**: `step3-skeleton-timestamps.md`
- **What**: Skeleton pulse CSS, skeleton card generator, relative time formatting, live timestamp updates
- **Verify**: Throttle network in DevTools — skeleton cards appear. Timestamps show "5m ago" style. Wait 60s — they update.
- **Commit**: `feat: add skeleton loading states and relative timestamps`

### Step 4: Header + Footer + SVG Icon System
- **File**: `step4-header-footer-icons.md`
- **What**: Date ribbon in header, SVG search icon, SVG admin icons, enhanced publication-style footer
- **Verify**: Date shows in header. All icons are crisp SVGs. Footer has brand/tagline/links. Dark mode — icons adapt.
- **Commit**: `feat: redesign header with date ribbon, SVG icons, and publication-style footer`

### Step 5: Card Interactions + Micro-animations
- **File**: `step5-card-interactions.md`
- **What**: Hover accent border, share buttons on hover, new quotes banner, page transitions
- **Verify**: Hover cards — red left accent. Share buttons fade in on hover. Navigate pages — smooth fade.
- **Commit**: `style: add card hover interactions, share button reveal, and page transitions`

### Step 6: Toast Notifications
- **File**: `step6-toast-notifications.md`
- **What**: Toast container + JS, replace all alert() calls in settings.js
- **Verify**: Settings > add source — green toast. Trigger error — red toast. No more native alert() popups.
- **Commit**: `feat: replace alert() with toast notification system`

### Step 7: Mobile Polish + Accessibility + Scroll-to-top
- **File**: `step7-mobile-polish.md`
- **What**: Scroll-to-top button, focus-visible outlines, improved empty state, mobile header cleanup, cache bump
- **Verify**: Scroll down — up-arrow appears. Tab through page — focus outlines. Resize to 400px — header intact.
- **Commit**: `feat: mobile polish, accessibility improvements, and scroll-to-top button`

## Post-Completion

1. Run `npm test` — all tests still pass
2. Visual check: light mode + dark mode, desktop + mobile (400px)
3. Deploy: `railway up --detach`
4. Check build logs: `railway logs --build --lines 50 <deployment-id>`
5. Check runtime logs: `railway logs --lines 20 <deployment-id>`
6. Hit health endpoint: `https://quotelog02-production.up.railway.app/api/health`
7. Visual check live site in browser

## Files Modified Across All Steps

| File | Steps |
|------|-------|
| `public/css/styles.css` | 1, 2, 3, 4, 5, 6, 7 |
| `public/index.html` | 1, 4, 6, 7 |
| `public/js/app.js` | 1, 3, 4, 5, 6, 7 |
| `public/js/home.js` | 3, 4, 5, 7 |
| `public/js/quote.js` | 3 |
| `public/js/author.js` | 3 |
| `public/js/article.js` | 3 |
| `public/js/settings.js` | 1, 6 |
| `public/sw.js` | 7 |
