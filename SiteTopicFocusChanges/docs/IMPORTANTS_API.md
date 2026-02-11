# Important? System API

Replaces the upvote/downvote system with a single "Important?" toggle button. Polymorphic — works on quotes, articles (displayed as "Sources"), persons (authors), and topics.

## Core Concept

- User clicks "Important?" on any entity -> toggle ON (creates record, increments count)
- User clicks again -> toggle OFF (deletes record, decrements count)
- Anonymous identification via `voter_hash` (same IP+UA hash as old votes system)
- `importants_count` cached on entity tables for fast reads

## API Endpoints

### POST /api/importants/toggle

Toggle an "Important?" mark for the current voter.

**Request Body:**
```json
{
  "entity_type": "quote",
  "entity_id": 123
}
```

**Valid `entity_type` values:** `"quote"`, `"article"`, `"person"`, `"topic"`

**Response (200):**
```json
{
  "success": true,
  "is_important": true,
  "importants_count": 42
}
```

**Logic:**
1. Validate `entity_type` is one of the 4 valid values
2. Validate entity exists (SELECT from the corresponding table)
3. Compute `voter_hash` from request (IP + User-Agent SHA-256)
4. Check if record exists in `importants` for this (entity_type, entity_id, voter_hash)
5. If exists: DELETE it, decrement `importants_count` on entity table, return `is_important: false`
6. If not exists: INSERT it, increment `importants_count` on entity table, return `is_important: true`
7. Emit Socket.IO `important_update` event: `{ entity_type, entity_id, importants_count }`

**Entity table mapping for count update:**
```javascript
const TABLE_MAP = {
  quote: 'quotes',
  article: 'articles',
  person: 'persons',
  topic: 'topics'
};
```

**Error Cases:**
- 400: Invalid entity_type
- 400: Missing entity_id
- 404: Entity not found

### GET /api/importants/status

Batch-check whether the current voter has marked entities as important. Used on page load to set button states.

**Query params:** `entities` = comma-separated `type:id` pairs

Example: `GET /api/importants/status?entities=quote:1,quote:2,article:5,topic:3`

**Response (200):**
```json
{
  "statuses": {
    "quote:1": true,
    "quote:2": false,
    "article:5": true,
    "topic:3": false
  }
}
```

**Logic:**
1. Parse `entities` query param into (type, id) pairs
2. Compute `voter_hash`
3. Query `importants` table for all matching (entity_type, entity_id, voter_hash)
4. Return map of `"type:id" -> boolean`

## Route File Structure

Create `src/routes/importants.js`:

```javascript
import { Router } from 'express';
import { getDb } from '../config/database.js';
import { createHash } from 'crypto';

const router = Router();

const VALID_TYPES = ['quote', 'article', 'person', 'topic'];
const TABLE_MAP = { quote: 'quotes', article: 'articles', person: 'persons', topic: 'topics' };

function getVoterHash(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const ua = req.get('User-Agent') || '';
  return createHash('sha256').update(`${ip}:${ua}`).digest('hex');
}

// POST /api/importants/toggle
// GET /api/importants/status

export default router;
```

Mount in `src/index.js`:
```javascript
import importantsRouter from './routes/importants.js';
app.use('/api/importants', importantsRouter);
```

## Removing Votes

- Remove `import votesRouter` and `app.use('/api', votesRouter)` from `src/index.js`
- Keep `src/routes/votes.js` file as-is (don't delete, just unmount)
- In `src/routes/quotes.js`: replace `vote_score` subquery with `q.importants_count`
- In `src/routes/articles.js`: remove vote-related subqueries if any
- In `src/routes/authors.js`: remove vote-related subqueries if any

## Socket.IO Event

```javascript
// After toggle, emit:
const io = req.app.get('io');
if (io) {
  io.emit('important_update', { entity_type, entity_id, importants_count });
}
```

## Test Expectations

### Integration Tests
1. POST toggle creates record and increments count
2. POST toggle again removes record and decrements count
3. Count never goes below 0
4. Invalid entity_type returns 400
5. Nonexistent entity returns 404
6. GET status returns correct boolean map for current voter
7. Different voter_hash gets independent toggle state
8. Socket.IO `important_update` event emitted with correct payload
9. GET /api/quotes includes `importants_count` field (not `vote_score`)
