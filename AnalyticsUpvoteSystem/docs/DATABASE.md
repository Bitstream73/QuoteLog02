# Database Schema Changes

All changes are ADDITIVE — no existing tables or columns are modified.

## New Tables

### votes

Tracks anonymous upvotes/downvotes on quotes. One vote per quote per voter.

```sql
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  voter_hash TEXT NOT NULL,
  vote_value INTEGER NOT NULL CHECK(vote_value IN (-1, 1)),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(quote_id, voter_hash)
);
```

**Fields:**
- `quote_id` — FK to quotes.id
- `voter_hash` — SHA-256 of `IP + User-Agent` string, generated server-side
- `vote_value` — +1 (upvote) or -1 (downvote)
- `created_at` / `updated_at` — timestamps

**Voter Hash Generation (server-side):**
```javascript
import { createHash } from 'crypto';

function getVoterHash(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const ua = req.get('User-Agent') || '';
  return createHash('sha256').update(`${ip}:${ua}`).digest('hex');
}
```

### quote_keywords

Extracted keywords from quote text and context for analytics aggregation.

```sql
CREATE TABLE IF NOT EXISTS quote_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Fields:**
- `quote_id` — FK to quotes.id
- `keyword` — lowercase, singular-form keyword (e.g., "economy", "immigration")

**Keyword Extraction Strategy:**
- Extract from `quotes.context` field (most descriptive)
- Simple approach: split on whitespace/punctuation, filter stopwords, lowercase
- Keep nouns/adjectives (3+ chars, not in stopword list)
- Store top 5 keywords per quote
- Stopword list: common English words (the, a, an, is, are, was, were, said, told, etc.)

## New Indexes

```sql
-- Vote aggregation: fast SUM of vote_value per quote
CREATE INDEX IF NOT EXISTS idx_votes_quote_id ON votes(quote_id);

-- Voter lookup: check if voter already voted on a quote
CREATE INDEX IF NOT EXISTS idx_votes_voter_hash ON votes(voter_hash);

-- Compound index for the UNIQUE constraint (auto-created by SQLite)
-- UNIQUE(quote_id, voter_hash) creates this implicitly

-- Keyword aggregation: count keywords across quotes
CREATE INDEX IF NOT EXISTS idx_quote_keywords_keyword ON quote_keywords(keyword);

-- Keyword lookup: find keywords for a specific quote
CREATE INDEX IF NOT EXISTS idx_quote_keywords_quote_id ON quote_keywords(quote_id);
```

## Integration Points

### Where to add schema creation

In `src/config/database.js`, inside the `initializeDatabase()` function, after existing CREATE TABLE statements:

```javascript
// --- Upvote System ---
db.exec(`
  CREATE TABLE IF NOT EXISTS votes (...)
  CREATE TABLE IF NOT EXISTS quote_keywords (...)
  CREATE INDEX IF NOT EXISTS idx_votes_quote_id ON votes(quote_id);
  CREATE INDEX IF NOT EXISTS idx_votes_voter_hash ON votes(voter_hash);
  CREATE INDEX IF NOT EXISTS idx_quote_keywords_keyword ON quote_keywords(keyword);
  CREATE INDEX IF NOT EXISTS idx_quote_keywords_quote_id ON quote_keywords(quote_id);
`);
```

### Aggregate Vote Score Query

Used everywhere votes are displayed:

```sql
-- Get vote score for a single quote
SELECT COALESCE(SUM(vote_value), 0) as vote_score,
       COUNT(CASE WHEN vote_value = 1 THEN 1 END) as upvotes,
       COUNT(CASE WHEN vote_value = -1 THEN 1 END) as downvotes
FROM votes WHERE quote_id = ?

-- Get vote scores for multiple quotes (batch, for list views)
SELECT quote_id,
       COALESCE(SUM(vote_value), 0) as vote_score,
       COUNT(CASE WHEN vote_value = 1 THEN 1 END) as upvotes,
       COUNT(CASE WHEN vote_value = -1 THEN 1 END) as downvotes
FROM votes
WHERE quote_id IN (?, ?, ...)
GROUP BY quote_id
```

### Check Existing Vote Query

Used to show current vote state in UI:

```sql
SELECT vote_value FROM votes
WHERE quote_id = ? AND voter_hash = ?
```

## Test Expectations

1. `votes` table exists after `initializeDatabase()`
2. `quote_keywords` table exists after `initializeDatabase()`
3. Can insert a vote and retrieve it
4. UNIQUE(quote_id, voter_hash) rejects duplicate votes
5. vote_value CHECK constraint rejects values other than -1 and 1
6. Deleting a quote cascades to delete its votes
7. Deleting a quote cascades to delete its keywords
8. All indexes exist (query sqlite_master)
9. Existing 122 tests still pass with new schema
