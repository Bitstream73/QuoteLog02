# Upvote System Specification

## Overview

Reddit-style voting on quotes. Anonymous users can upvote or downvote. Vote controls appear alongside every quote across all pages.

## API Endpoints

### POST /api/quotes/:id/vote

Cast, change, or remove a vote on a quote.

**Request Body:**
```json
{ "value": 1 }     // upvote
{ "value": -1 }    // downvote
{ "value": 0 }     // remove vote
```

**Response (200):**
```json
{
  "success": true,
  "vote_score": 42,
  "upvotes": 50,
  "downvotes": 8,
  "user_vote": 1
}
```

**Logic:**
1. Extract `voter_hash` from request (IP + User-Agent, see docs/DATABASE.md)
2. Validate `value` is -1, 0, or 1
3. Validate quote exists (`SELECT id FROM quotes WHERE id = ?`)
4. If `value === 0`: DELETE from votes WHERE quote_id AND voter_hash
5. Else: INSERT OR REPLACE into votes (quote_id, voter_hash, vote_value, updated_at)
6. Query fresh aggregate (vote_score, upvotes, downvotes)
7. Emit Socket.IO `vote_update` event with { quoteId, vote_score, upvotes, downvotes }
8. Return response

**Error Cases:**
- 400: Invalid value (not -1, 0, or 1)
- 404: Quote not found
- 429: Rate limited (max 30 votes per minute per voter_hash)

**Rate Limiting:**
- 30 votes per minute per voter_hash
- Use existing rate limiter pattern from `src/middleware/`
- Separate from general API rate limit

### GET /api/quotes/:id/votes

Get vote counts for a specific quote plus the current voter's state.

**Response (200):**
```json
{
  "quote_id": 123,
  "vote_score": 42,
  "upvotes": 50,
  "downvotes": 8,
  "user_vote": 0
}
```

`user_vote` is the current voter's vote (-1, 0, or 1). Determined by voter_hash.

### Modified: GET /api/quotes (and /api/quotes/:id)

Add `vote_score` field to every quote object in the response. Use a LEFT JOIN or subquery:

```sql
-- In the main quotes query, add:
COALESCE((SELECT SUM(vote_value) FROM votes WHERE votes.quote_id = q.id), 0) as vote_score
```

Also add `user_vote` field (the current voter's vote, 0 if none).

## Route File Structure

Create `src/routes/votes.js`:

```javascript
import { Router } from 'express';
import { getDb } from '../config/database.js';
import { createHash } from 'crypto';

const router = Router();

function getVoterHash(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const ua = req.get('User-Agent') || '';
  return createHash('sha256').update(`${ip}:${ua}`).digest('hex');
}

// POST /api/quotes/:id/vote
// GET /api/quotes/:id/votes

export default router;
```

Mount in `src/index.js`:
```javascript
import voteRoutes from './routes/votes.js';
app.use('/api', voteRoutes);
```

## Frontend Component

### Vote Controls UI

Create `public/js/vote.js` with a reusable function:

```javascript
function renderVoteControls(quoteId, voteScore, userVote) {
  // Returns HTML string for vote controls
}

async function handleVote(quoteId, value) {
  // POST to API, update localStorage, update DOM
}
```

**HTML Structure:**
```html
<div class="vote-controls" data-quote-id="123">
  <button class="vote-btn vote-up active" aria-label="Upvote">
    <svg><!-- up arrow --></svg>
  </button>
  <span class="vote-score">42</span>
  <button class="vote-btn vote-down" aria-label="Downvote">
    <svg><!-- down arrow --></svg>
  </button>
</div>
```

**Behavior:**
- Click upvote when no vote → upvote (+1)
- Click upvote when already upvoted → remove vote (0)
- Click downvote when no vote → downvote (-1)
- Click downvote when already downvoted → remove vote (0)
- Click upvote when downvoted → switch to upvote (+1)
- Click downvote when upvoted → switch to downvote (-1)

**Visual States:**
- No vote: both arrows neutral (--text-muted color)
- Upvoted: up arrow active (--accent color, #c41e3a), score normal
- Downvoted: down arrow active (--accent color), score normal
- Score display: net value (can be negative), bold when non-zero

**localStorage Tracking:**
```javascript
// Store user votes for instant UI feedback
// Key: 'quote_votes'
// Value: { "123": 1, "456": -1 }
const votes = JSON.parse(localStorage.getItem('quote_votes') || '{}');
```

This provides instant feedback without waiting for API response. Server is source of truth.

### Integration Points

**home.js** — Add vote controls to each quote card:
- Inside the quote content area, left side or below the quote text
- Between the quote text and the author/source row
- Call `renderVoteControls(quote.id, quote.vote_score, userVote)`

**quote.js** — Single quote detail page:
- Prominent position next to the quote text
- Same component, larger styling variant

**author.js** — Author's quote list:
- Same as home page placement per quote

**article.js** — Article's quote list:
- Same as home page placement per quote

### Socket.IO Integration

Listen for `vote_update` events to update scores in real-time:

```javascript
socket.on('vote_update', ({ quoteId, vote_score }) => {
  const el = document.querySelector(`.vote-controls[data-quote-id="${quoteId}"] .vote-score`);
  if (el) el.textContent = vote_score;
});
```

## CSS Styling

Append to `public/css/styles.css`:

```css
.vote-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin-right: 12px;
  flex-shrink: 0;
}

.vote-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--text-muted);
  transition: color 0.15s;
  line-height: 1;
}

.vote-btn:hover {
  color: var(--accent);
}

.vote-btn.active {
  color: var(--accent);
}

.vote-score {
  font-family: 'Inter', sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 24px;
  text-align: center;
}
```

## Test Expectations

### Backend Tests (integration)
1. POST vote returns correct aggregate scores
2. Changing vote (up→down) updates correctly
3. Removing vote (value=0) deletes the record
4. Duplicate voter_hash on same quote → updates instead of duplicates
5. Invalid value (2, "abc") returns 400
6. Nonexistent quote returns 404
7. Rate limit triggers at 31st vote in 1 minute
8. GET /api/quotes includes vote_score field
9. GET /api/quotes/:id includes vote_score and user_vote

### Frontend Tests (unit)
1. renderVoteControls returns correct HTML structure
2. Active state applied correctly for upvote/downvote/none
3. Click handlers toggle state correctly
4. localStorage reads/writes vote state
5. Score displays correctly for positive, negative, zero
