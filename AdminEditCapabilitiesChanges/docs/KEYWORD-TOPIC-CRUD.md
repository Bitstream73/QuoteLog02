# Keyword & Topic CRUD Endpoints Spec

## Database Tables (existing)

```sql
keywords (id, name, name_normalized, keyword_type, created_at)
quote_keywords (quote_id, keyword_id, relevance DEFAULT 1.0)
quote_topics (quote_id, topic_id)
topic_keywords (topic_id, keyword_id)
topics (id, name, slug, description, context, importants_count, share_count, view_count, trending_score, created_at)
```

## New Endpoints

### 1. `GET /api/quotes/:id/keywords-topics`

**Auth:** None (read-only)
**File:** `src/routes/quotes.js`

**Response:**
```json
{
  "keywords": [
    { "id": 1, "name": "Climate Change", "keyword_type": "concept" }
  ],
  "topics": [
    { "id": 5, "name": "Environment", "slug": "environment" }
  ]
}
```

**SQL:**
```sql
-- Keywords
SELECT k.id, k.name, k.keyword_type
FROM keywords k JOIN quote_keywords qk ON k.id = qk.keyword_id
WHERE qk.quote_id = ?;

-- Topics
SELECT t.id, t.name, t.slug
FROM topics t JOIN quote_topics qt ON t.id = qt.topic_id
WHERE qt.quote_id = ?;
```

---

### 2. `POST /api/admin/quotes/:id/keywords`

**Auth:** `requireAdmin`
**File:** `src/routes/admin.js`

**Request Body:**
```json
{ "name": "Climate Change", "keyword_type": "concept" }
```

`keyword_type` is optional, defaults to `"concept"`. Valid types: `person`, `organization`, `event`, `legislation`, `location`, `concept`.

**Behavior:**
1. Normalize name: `name.trim()`, `name_normalized = name.toLowerCase().trim()`
2. Upsert into `keywords`: INSERT OR IGNORE (match on `name_normalized`)
3. Get keyword ID (SELECT after upsert)
4. INSERT OR IGNORE into `quote_keywords (quote_id, keyword_id)`
5. Return the keyword object

**Response:**
```json
{ "success": true, "keyword": { "id": 42, "name": "Climate Change", "keyword_type": "concept" } }
```

---

### 3. `DELETE /api/admin/quotes/:id/keywords/:keywordId`

**Auth:** `requireAdmin`
**File:** `src/routes/admin.js`

**Behavior:**
1. DELETE FROM `quote_keywords` WHERE `quote_id = :id AND keyword_id = :keywordId`
2. Does NOT delete the keyword itself (may be linked to other quotes/topics)

**Response:**
```json
{ "success": true }
```

---

### 4. `POST /api/admin/quotes/:id/topics`

**Auth:** `requireAdmin`
**File:** `src/routes/admin.js`

**Request Body (link existing):**
```json
{ "topic_id": 5 }
```

**Request Body (create and link):**
```json
{ "name": "New Topic Name" }
```

**Behavior (create-and-link):**
1. Generate slug: `name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')`
2. INSERT into `topics (name, slug, created_at)` — ignore if slug exists
3. Get topic ID
4. INSERT OR IGNORE into `quote_topics (quote_id, topic_id)`

**Response:**
```json
{ "success": true, "topic": { "id": 5, "name": "Environment", "slug": "environment" } }
```

---

### 5. `DELETE /api/admin/quotes/:id/topics/:topicId`

**Auth:** `requireAdmin`
**File:** `src/routes/admin.js`

**Behavior:**
1. DELETE FROM `quote_topics` WHERE `quote_id = :id AND topic_id = :topicId`

**Response:**
```json
{ "success": true }
```

---

### 6. `GET /api/admin/keywords`

**Auth:** `requireAdmin`
**File:** `src/routes/admin.js`

**Response:**
```json
{
  "keywords": [
    { "id": 1, "name": "Climate Change", "keyword_type": "concept", "quote_count": 15 }
  ]
}
```

**SQL:**
```sql
SELECT k.*, COUNT(qk.quote_id) as quote_count
FROM keywords k
LEFT JOIN quote_keywords qk ON k.id = qk.keyword_id
GROUP BY k.id
ORDER BY quote_count DESC;
```

---

### 7. `POST /api/admin/keywords`

**Auth:** `requireAdmin`
**File:** `src/routes/admin.js`

**Request Body:**
```json
{ "name": "New Keyword", "keyword_type": "concept" }
```

**Behavior:**
1. Validate name is non-empty
2. Normalize: `name_normalized = name.toLowerCase().trim()`
3. INSERT INTO `keywords (name, name_normalized, keyword_type, created_at)`
4. Return created keyword

**Response:**
```json
{ "success": true, "keyword": { "id": 99, "name": "New Keyword", "keyword_type": "concept" } }
```

---

### 8. `PATCH /api/admin/keywords/:id`

**Auth:** `requireAdmin`
**File:** `src/routes/admin.js`

**Request Body:**
```json
{ "name": "Updated Name", "keyword_type": "organization" }
```

**Behavior:**
1. Both fields optional, at least one required
2. If name changed, update `name_normalized`
3. UPDATE keyword row

**Response:**
```json
{ "success": true, "keyword": { "id": 99, "name": "Updated Name", "keyword_type": "organization" } }
```

---

### 9. `DELETE /api/admin/keywords/:id`

**Auth:** `requireAdmin`
**File:** `src/routes/admin.js`

**Behavior (cascade):**
1. DELETE FROM `quote_keywords` WHERE `keyword_id = :id`
2. DELETE FROM `topic_keywords` WHERE `keyword_id = :id`
3. DELETE FROM `keywords` WHERE `id = :id`

**Response:**
```json
{ "success": true }
```

## Validation Rules
- Keyword names must be non-empty strings after trim
- Keyword types must be one of: `person`, `organization`, `event`, `legislation`, `location`, `concept`
- Quote must exist for quote-level operations (404 if not)
- Duplicate keyword links are silently ignored (INSERT OR IGNORE)

## Test Requirements
- All POST/PATCH/DELETE return 401 without admin auth
- GET returns correct data shape
- Create-and-link creates new keyword AND links it
- Delete only unlinks (does not delete the keyword entity)
- Cascade delete on keyword removes from both join tables
- Duplicate link attempts succeed silently (idempotent)
