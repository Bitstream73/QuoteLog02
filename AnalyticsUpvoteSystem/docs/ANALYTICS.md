# Analytics Modal Specification

## Overview

A modal accessible from the header nav showing quote insights: volume trends, top authors, most-voted quotes, and trending topics. Available to all users (public) and admins.

## API Endpoints

### GET /api/analytics/overview

High-level dashboard stats.

**Response (200):**
```json
{
  "quotes_today": 45,
  "quotes_this_week": 312,
  "quotes_total": 8500,
  "articles_today": 22,
  "top_author_today": {
    "id": 45,
    "name": "Jane Doe",
    "photo_url": "https://...",
    "quote_count": 8
  },
  "most_upvoted_today": {
    "id": 789,
    "text": "The economy is...",
    "person_name": "John Smith",
    "vote_score": 42
  },
  "quotes_per_day": [
    { "date": "2025-02-01", "count": 38 },
    { "date": "2025-02-02", "count": 45 }
  ]
}
```

**Queries:**
```sql
-- Quotes today
SELECT COUNT(*) FROM quotes WHERE date(created_at) = date('now') AND is_visible = 1

-- Top author today
SELECT p.id, p.canonical_name, p.photo_url, COUNT(q.id) as quote_count
FROM quotes q JOIN persons p ON q.person_id = p.id
WHERE date(q.created_at) = date('now') AND q.is_visible = 1
GROUP BY p.id ORDER BY quote_count DESC LIMIT 1

-- Most upvoted today
SELECT q.id, q.text, p.canonical_name,
       COALESCE(SUM(v.vote_value), 0) as vote_score
FROM quotes q
JOIN persons p ON q.person_id = p.id
LEFT JOIN votes v ON v.quote_id = q.id
WHERE date(q.created_at) = date('now') AND q.is_visible = 1
GROUP BY q.id ORDER BY vote_score DESC LIMIT 1

-- Quotes per day (last 30 days)
SELECT date(created_at) as date, COUNT(*) as count
FROM quotes WHERE is_visible = 1
  AND created_at >= datetime('now', '-30 days')
GROUP BY date(created_at) ORDER BY date
```

### GET /api/analytics/quotes?period=week

Most upvoted quotes for a given period.

**Query params:** `period` = day | week | month | year (default: week)

**Response (200):**
```json
{
  "period": "week",
  "quotes": [
    {
      "id": 789,
      "text": "The economy is...",
      "person_id": 45,
      "person_name": "Jane Doe",
      "photo_url": "https://...",
      "vote_score": 42,
      "upvotes": 50,
      "downvotes": 8,
      "created_at": "2025-02-05T10:30:00Z"
    }
  ]
}
```

**Period Mapping:**
```javascript
const periodMap = {
  day:   "datetime('now', '-1 day')",
  week:  "datetime('now', '-7 days')",
  month: "datetime('now', '-30 days')",
  year:  "datetime('now', '-365 days')"
};
```

**Query:**
```sql
SELECT q.id, q.text, q.person_id, p.canonical_name, p.photo_url, q.created_at,
       COALESCE(SUM(v.vote_value), 0) as vote_score,
       COUNT(CASE WHEN v.vote_value = 1 THEN 1 END) as upvotes,
       COUNT(CASE WHEN v.vote_value = -1 THEN 1 END) as downvotes
FROM quotes q
JOIN persons p ON q.person_id = p.id
LEFT JOIN votes v ON v.quote_id = q.id
WHERE q.created_at >= ${periodMap[period]} AND q.is_visible = 1
GROUP BY q.id
ORDER BY vote_score DESC
LIMIT 20
```

### GET /api/analytics/authors?period=week

Top authors by quote volume and vote score.

**Query params:** `period` = day | week | month | year (default: week)

**Response (200):**
```json
{
  "period": "week",
  "authors": [
    {
      "id": 45,
      "name": "Jane Doe",
      "photo_url": "https://...",
      "category": "Politician",
      "quote_count": 15,
      "total_vote_score": 123
    }
  ]
}
```

**Query:**
```sql
SELECT p.id, p.canonical_name, p.photo_url, p.category,
       COUNT(q.id) as quote_count,
       COALESCE(SUM(vs.vote_score), 0) as total_vote_score
FROM persons p
JOIN quotes q ON q.person_id = p.id
LEFT JOIN (
  SELECT quote_id, SUM(vote_value) as vote_score FROM votes GROUP BY quote_id
) vs ON vs.quote_id = q.id
WHERE q.created_at >= ${periodMap[period]} AND q.is_visible = 1
GROUP BY p.id
ORDER BY quote_count DESC, total_vote_score DESC
LIMIT 20
```

### GET /api/analytics/topics?period=week

Trending keywords/topics.

**Query params:** `period` = day | week | month | year (default: week)

**Response (200):**
```json
{
  "period": "week",
  "topics": [
    { "keyword": "economy", "count": 45, "trend": "up" },
    { "keyword": "immigration", "count": 38, "trend": "stable" },
    { "keyword": "climate", "count": 22, "trend": "down" }
  ]
}
```

**Query:**
```sql
-- Current period keyword counts
SELECT qk.keyword, COUNT(*) as count
FROM quote_keywords qk
JOIN quotes q ON q.id = qk.quote_id
WHERE q.created_at >= ${periodMap[period]} AND q.is_visible = 1
GROUP BY qk.keyword
ORDER BY count DESC
LIMIT 30
```

**Trend Calculation:**
Compare current period count vs previous period count:
- "up" if current > previous * 1.1
- "down" if current < previous * 0.9
- "stable" otherwise

## Route File Structure

Create `src/routes/analytics.js`:

```javascript
import { Router } from 'express';
import { getDb } from '../config/database.js';

const router = Router();

const VALID_PERIODS = ['day', 'week', 'month', 'year'];

function getPeriodClause(period) {
  const map = { day: '-1 day', week: '-7 days', month: '-30 days', year: '-365 days' };
  return `datetime('now', '${map[period] || map.week}')`;
}

// GET /api/analytics/overview
// GET /api/analytics/quotes
// GET /api/analytics/authors
// GET /api/analytics/topics

export default router;
```

Mount in `src/index.js`:
```javascript
import analyticsRoutes from './routes/analytics.js';
app.use('/api', analyticsRoutes);
```

## Frontend Modal

### Header Integration

Add to `public/index.html` nav-links div:
```html
<a href="#" id="nav-analytics" onclick="openAnalytics(event)">Analytics</a>
```

Visible to ALL users (not admin-only). Place before the Review link.

Add modal container to body:
```html
<div id="analytics-modal" class="modal-overlay" style="display:none">
  <div class="analytics-modal-content">
    <div class="analytics-modal-header">
      <h2>Analytics</h2>
      <button class="modal-close" onclick="closeAnalytics()">&times;</button>
    </div>
    <div class="analytics-tabs">
      <button class="analytics-tab active" data-tab="overview">Overview</button>
      <button class="analytics-tab" data-tab="quotes">Top Quotes</button>
      <button class="analytics-tab" data-tab="authors">Top Authors</button>
      <button class="analytics-tab" data-tab="topics">Trending Topics</button>
    </div>
    <div class="analytics-body" id="analytics-body"></div>
  </div>
</div>
```

### Tab Content

**Overview Tab:**
- Stat cards row: Quotes Today, Quotes This Week, Total Quotes, Articles Today
- Top Author Today: headshot + name + count
- Most Upvoted Quote Today: quote text + author + score
- Quotes Per Day: simple bar chart (CSS-only, last 14 days)

**Top Quotes Tab:**
- Period selector: Day | Week | Month | Year (pill buttons)
- List of top 20 quotes by vote score
- Each: quote text (truncated), author, vote score, date

**Top Authors Tab:**
- Period selector: Day | Week | Month | Year
- Leaderboard table: rank, headshot, name, category, quote count, total vote score

**Trending Topics Tab:**
- Period selector: Day | Week | Month | Year
- Keyword cloud or ranked list with counts
- Trend indicator arrows (up/down/stable)

### CSS-Only Bar Chart

For the quotes-per-day sparkline, use CSS flexbox bars:

```html
<div class="sparkline">
  <div class="sparkline-bar" style="height: 80%" title="Feb 1: 38 quotes"></div>
  <div class="sparkline-bar" style="height: 100%" title="Feb 2: 45 quotes"></div>
  ...
</div>
```

No charting library needed. Max value = 100% height, others proportional.

### File Structure

Create `public/js/analytics.js`:

```javascript
function openAnalytics(e) { ... }
function closeAnalytics() { ... }
function switchAnalyticsTab(tab) { ... }
async function loadOverview() { ... }
async function loadTopQuotes(period) { ... }
async function loadTopAuthors(period) { ... }
async function loadTrendingTopics(period) { ... }
```

Load in `public/index.html`:
```html
<script src="/js/analytics.js"></script>
```

## CSS Styling

Append to `public/css/styles.css`. Key classes:

```css
.analytics-modal-content {
  max-width: 800px;
  max-height: 85vh;
  overflow-y: auto;
  /* Use existing modal pattern from styles.css */
}

.analytics-tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--border);
}

.analytics-tab {
  /* Match existing category tab style */
  font-family: 'Inter', sans-serif;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
}

.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.stat-card {
  text-align: center;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.stat-card .stat-value {
  font-family: 'Playfair Display', serif;
  font-size: 1.8rem;
  font-weight: 900;
}

.stat-card .stat-label {
  font-family: 'Inter', sans-serif;
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--text-muted);
}

.sparkline {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 60px;
}

.sparkline-bar {
  flex: 1;
  background: var(--accent);
  border-radius: 2px 2px 0 0;
  min-width: 4px;
}
```

## Test Expectations

### Backend Tests
1. GET /api/analytics/overview returns all expected fields
2. GET /api/analytics/quotes returns quotes sorted by vote_score desc
3. GET /api/analytics/authors returns authors sorted by quote_count desc
4. GET /api/analytics/topics returns keywords sorted by count desc
5. Period parameter filters correctly (day/week/month/year)
6. Invalid period defaults to week
7. Empty database returns zero counts (not errors)
8. Only visible quotes (is_visible=1) included in analytics

### Frontend Tests
1. Analytics modal opens and closes correctly
2. Tab switching renders correct content
3. Period selector updates data
4. Stat cards render with correct values
5. Sparkline bars have proportional heights
6. Author leaderboard rows render correctly
