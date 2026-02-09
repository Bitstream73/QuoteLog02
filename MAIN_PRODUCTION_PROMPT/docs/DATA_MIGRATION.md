# Data Migration: Development to LIVE

## One-Time Initial Data Copy

After the LIVE service is running with an empty (auto-seeded) database, copy Development's full data.

### Step 1: Log in to Development Admin

Log in at `https://quotelog02-production.up.railway.app/` with admin credentials to get a JWT token.

### Step 2: Export from Development

**Option A — Browser UI:**
1. Go to Settings > Database > Export JSON
2. Save the downloaded file as `dev-backup.json`

**Option B — API:**
```bash
curl -b "auth_token=<dev-jwt>" \
  https://quotelog02-production.up.railway.app/api/admin/backup \
  -o dev-backup.json
```

### Step 3: Log in to LIVE Admin

Log in at `https://<live-url>/` with admin credentials. (Same email/password — the admin user is auto-seeded.)

### Step 4: Import to LIVE

**Option A — Browser UI:**
1. Go to Settings > Database > Import JSON
2. Upload `dev-backup.json`

**Option B — API:**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -b "auth_token=<live-jwt>" \
  -d @dev-backup.json \
  https://<live-url>/api/admin/restore
```

### Step 5: Verify Data Integrity

Compare row counts between environments:
- Check LIVE Settings > Database for source/quote/person counts
- They should match Development's counts

## Pinecone Namespace Note

The JSON import restores **SQLite data only** — it does NOT populate the Pinecone `quotes-live` namespace.

This means:
- Imported quotes won't have vector embeddings in `quotes-live`
- Quote deduplication against imported quotes won't work via vector similarity
- As new articles are processed, new quotes WILL be embedded into `quotes-live`
- Over time, the LIVE namespace builds up naturally

If full vector parity is needed immediately, a separate re-embed script would be required (not included in this setup — low priority since dedup also uses text-based methods).

## Ongoing Data Independence

After initial seeding, each environment's database evolves independently:
- Development processes RSS feeds and accumulates its own quotes
- LIVE processes RSS feeds and accumulates its own quotes
- There is **no automatic sync** between environments
- Each has its own scheduler running independently
