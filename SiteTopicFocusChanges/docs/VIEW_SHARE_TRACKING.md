# View & Share Tracking

Lightweight endpoints to increment `view_count` and `share_count` on entity tables.

## API Endpoints

### POST /api/tracking/view

Increment view_count for an entity. Called by frontend IntersectionObserver when content enters viewport.

**Request Body:**
```json
{
  "entity_type": "quote",
  "entity_id": 123
}
```

**Valid entity_type values:** `"article"`, `"person"`, `"topic"` (quotes do NOT have view_count — they're always visible within parent entities)

**Response (200):**
```json
{ "success": true }
```

**Logic:**
1. Validate entity_type is one of: article, person, topic
2. Validate entity exists
3. Increment view_count: `UPDATE ${table} SET view_count = view_count + 1 WHERE id = ?`
4. No Socket.IO broadcast (too noisy for views)

**Rate limiting:** Basic dedup — accept max 1 view per entity per voter_hash per 5 minutes. Use in-memory Map with TTL (don't persist to DB).

```javascript
const viewDedup = new Map(); // key: `${voterHash}:${entityType}:${entityId}`, value: timestamp

function isDuplicateView(voterHash, entityType, entityId) {
  const key = `${voterHash}:${entityType}:${entityId}`;
  const last = viewDedup.get(key);
  if (last && Date.now() - last < 5 * 60 * 1000) return true;
  viewDedup.set(key, Date.now());
  // Periodic cleanup: remove entries older than 10 minutes
  if (viewDedup.size > 10000) {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [k, v] of viewDedup) {
      if (v < cutoff) viewDedup.delete(k);
    }
  }
  return false;
}
```

### POST /api/tracking/share

Increment share_count for an entity. Called when user clicks a share button.

**Request Body:**
```json
{
  "entity_type": "quote",
  "entity_id": 123
}
```

**Valid entity_type values:** `"quote"`, `"article"`, `"person"`, `"topic"`

**Response (200):**
```json
{
  "success": true,
  "share_count": 5
}
```

**Logic:**
1. Validate entity_type
2. Validate entity exists
3. Increment share_count: `UPDATE ${table} SET share_count = share_count + 1 WHERE id = ?`
4. Read updated share_count and return it
5. Trigger targeted trending recalculation for this entity

## Route File Structure

Create `src/routes/tracking.js`:

```javascript
import { Router } from 'express';
import { getDb } from '../config/database.js';
import { createHash } from 'crypto';
import { recalculateEntityScore } from '../services/trendingCalculator.js';

const router = Router();

const VIEW_TABLES = { article: 'articles', person: 'persons', topic: 'topics' };
const SHARE_TABLES = { quote: 'quotes', article: 'articles', person: 'persons', topic: 'topics' };

function getVoterHash(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const ua = req.get('User-Agent') || '';
  return createHash('sha256').update(`${ip}:${ua}`).digest('hex');
}

// POST /tracking/view
// POST /tracking/share

export default router;
```

Mount in `src/index.js`:
```javascript
import trackingRouter from './routes/tracking.js';
app.use('/api/tracking', trackingRouter);
```

## Test Expectations

1. POST /tracking/view increments view_count for valid entity
2. POST /tracking/view returns 400 for "quote" entity_type (quotes don't have view_count)
3. POST /tracking/view returns 404 for nonexistent entity
4. Duplicate view within 5 minutes is silently ignored (count stays same)
5. POST /tracking/share increments share_count and returns new count
6. POST /tracking/share works for all 4 entity types
7. POST /tracking/share returns 404 for nonexistent entity
8. Share event triggers trending score recalculation
