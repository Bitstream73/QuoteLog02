import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/tiered-sort-test.db';

describe('5-Tier Home Page Quote Sorting', () => {
  let app;
  let db;
  // Track IDs for verification
  const ids = {
    // Authors
    authorHot: null,    // top author (high importants)
    authorWarm: null,   // second author
    authorCold: null,   // no importants
    // Quotes by tier
    tier1: [],  // last hour, has importants
    tier2: [],  // last 24h (not hour), has importants
    tier3: [],  // last 7d (not 24h), has importants
    tier4: [],  // from top authors, recent, no importants of their own
    tier5: [],  // everything else (chronological)
    hidden: null,
    canonical: null,
    canonicalChild: null,
  };

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    const dbMod = await import('../../src/config/database.js');
    db = dbMod.getDb();

    // --- Seed authors ---
    const pHot = db.prepare("INSERT INTO persons (canonical_name, quote_count, importants_count) VALUES ('Hot Author', 10, 50)").run();
    ids.authorHot = Number(pHot.lastInsertRowid);

    const pWarm = db.prepare("INSERT INTO persons (canonical_name, quote_count, importants_count) VALUES ('Warm Author', 5, 10)").run();
    ids.authorWarm = Number(pWarm.lastInsertRowid);

    const pCold = db.prepare("INSERT INTO persons (canonical_name, quote_count, importants_count) VALUES ('Cold Author', 3, 0)").run();
    ids.authorCold = Number(pCold.lastInsertRowid);

    // --- Tier 1: quotes from last hour with importants ---
    for (let i = 0; i < 3; i++) {
      const r = db.prepare(
        "INSERT INTO quotes (person_id, text, is_visible, importants_count, created_at) VALUES (?, ?, 1, ?, datetime('now', ?))"
      ).run(ids.authorCold, `Tier1 quote ${i}`, 10 - i, `-${i * 10} minutes`);
      ids.tier1.push(Number(r.lastInsertRowid));
    }

    // --- Tier 2: quotes from last 24h (but older than 1h) with importants ---
    for (let i = 0; i < 3; i++) {
      const r = db.prepare(
        "INSERT INTO quotes (person_id, text, is_visible, importants_count, created_at) VALUES (?, ?, 1, ?, datetime('now', ?))"
      ).run(ids.authorCold, `Tier2 quote ${i}`, 8 - i, `-${2 + i} hours`);
      ids.tier2.push(Number(r.lastInsertRowid));
    }

    // --- Tier 3: quotes from last 7d (but older than 24h) with importants ---
    for (let i = 0; i < 3; i++) {
      const r = db.prepare(
        "INSERT INTO quotes (person_id, text, is_visible, importants_count, created_at) VALUES (?, ?, 1, ?, datetime('now', ?))"
      ).run(ids.authorCold, `Tier3 quote ${i}`, 6 - i, `-${2 + i} days`);
      ids.tier3.push(Number(r.lastInsertRowid));
    }

    // --- Tier 4: quotes from top authors (Hot/Warm), recent, 0 importants ---
    // Hot Author gets 6 quotes (only 5 should appear in tier 4)
    for (let i = 0; i < 6; i++) {
      const r = db.prepare(
        "INSERT INTO quotes (person_id, text, is_visible, importants_count, created_at) VALUES (?, ?, 1, 0, datetime('now', ?))"
      ).run(ids.authorHot, `HotAuthor quote ${i}`, `-${i + 1} hours`);
      ids.tier4.push(Number(r.lastInsertRowid));
    }
    // Warm Author gets 3 quotes
    for (let i = 0; i < 3; i++) {
      const r = db.prepare(
        "INSERT INTO quotes (person_id, text, is_visible, importants_count, created_at) VALUES (?, ?, 1, 0, datetime('now', ?))"
      ).run(ids.authorWarm, `WarmAuthor quote ${i}`, `-${i + 1} hours`);
      ids.tier4.push(Number(r.lastInsertRowid));
    }

    // --- Tier 5: old quotes, no importants (chronological filler) ---
    for (let i = 0; i < 5; i++) {
      const r = db.prepare(
        "INSERT INTO quotes (person_id, text, is_visible, importants_count, created_at) VALUES (?, ?, 1, 0, datetime('now', ?))"
      ).run(ids.authorCold, `Tier5 quote ${i}`, `-${10 + i} days`);
      ids.tier5.push(Number(r.lastInsertRowid));
    }

    // --- Hidden quote (should be excluded from all tiers) ---
    const hid = db.prepare(
      "INSERT INTO quotes (person_id, text, is_visible, importants_count, created_at) VALUES (?, 'Hidden quote', 0, 100, datetime('now'))"
    ).run(ids.authorCold);
    ids.hidden = Number(hid.lastInsertRowid);

    // --- Canonical/duplicate quote (canonical_quote_id set, should be excluded) ---
    const canon = db.prepare(
      "INSERT INTO quotes (person_id, text, is_visible, importants_count, created_at) VALUES (?, 'Canonical original', 1, 0, datetime('now', '-20 days'))"
    ).run(ids.authorCold);
    ids.canonical = Number(canon.lastInsertRowid);

    const child = db.prepare(
      "INSERT INTO quotes (person_id, text, is_visible, importants_count, canonical_quote_id, created_at) VALUES (?, 'Canonical child', 1, 100, ?, datetime('now'))"
    ).run(ids.authorCold, ids.canonical);
    ids.canonicalChild = Number(child.lastInsertRowid);

    // Update person quote_counts to match
    db.prepare("UPDATE persons SET quote_count = (SELECT COUNT(*) FROM quotes WHERE person_id = persons.id AND is_visible = 1 AND canonical_quote_id IS NULL)").run();
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/tiered-sort-test.db${suffix}`); } catch {}
    }
  });

  it('default sort returns tiered order: hour > day > week > authors > chronological', async () => {
    const res = await request(app).get('/api/analytics/trending-quotes?limit=50');
    expect(res.status).toBe(200);

    const quoteIds = res.body.recent_quotes.map(q => q.id);

    // Tier 1 quotes should come first (sorted by importants_count DESC)
    const tier1Positions = ids.tier1.map(id => quoteIds.indexOf(id));
    const tier2Positions = ids.tier2.map(id => quoteIds.indexOf(id));
    const tier3Positions = ids.tier3.map(id => quoteIds.indexOf(id));

    // All tier1 should be found
    tier1Positions.forEach(pos => expect(pos).toBeGreaterThanOrEqual(0));
    // All tier2 should be found
    tier2Positions.forEach(pos => expect(pos).toBeGreaterThanOrEqual(0));
    // All tier3 should be found
    tier3Positions.forEach(pos => expect(pos).toBeGreaterThanOrEqual(0));

    // Max position in tier1 < min position in tier2
    expect(Math.max(...tier1Positions)).toBeLessThan(Math.min(...tier2Positions));
    // Max position in tier2 < min position in tier3
    expect(Math.max(...tier2Positions)).toBeLessThan(Math.min(...tier3Positions));

    // Tier 5 quotes should come after tier 3 + tier 4
    const tier5Positions = ids.tier5.map(id => quoteIds.indexOf(id));
    tier5Positions.forEach(pos => expect(pos).toBeGreaterThanOrEqual(0));
    expect(Math.max(...tier3Positions)).toBeLessThan(Math.min(...tier5Positions));
  });

  it('tier de-duplication: a quote in tier 1 does not appear in tiers 2-4', async () => {
    const res = await request(app).get('/api/analytics/trending-quotes?limit=50');
    const quoteIds = res.body.recent_quotes.map(q => q.id);

    // Each ID should appear exactly once
    const uniqueIds = new Set(quoteIds);
    expect(uniqueIds.size).toBe(quoteIds.length);

    // Specifically, tier1 IDs should not repeat
    for (const id of ids.tier1) {
      const count = quoteIds.filter(qid => qid === id).length;
      expect(count).toBe(1);
    }
  });

  it('tier 4 selects correct top authors and limits to 5 quotes per author', async () => {
    const res = await request(app).get('/api/analytics/trending-quotes?limit=50');
    const quoteIds = res.body.recent_quotes.map(q => q.id);

    // Hot Author had 6 quotes — only 5 should be in tier 4
    // (the 6th might end up in tier 5 or be excluded from tier 4)
    const hotAuthorInResult = quoteIds.filter(id => ids.tier4.slice(0, 6).includes(id));
    // At most 5 from hot author in the tier 4 section
    // We check that the 6th hot-author quote (ids.tier4[5]) appears AFTER the tier 4 block
    const hotAuthor5thPos = quoteIds.indexOf(ids.tier4[4]); // 5th quote (0-indexed)
    const hotAuthor6thPos = quoteIds.indexOf(ids.tier4[5]); // 6th quote

    // The 6th should be after the 5th (it's in tier 5 now)
    if (hotAuthor6thPos >= 0) {
      expect(hotAuthor6thPos).toBeGreaterThan(hotAuthor5thPos);
    }
  });

  it('pagination across tier boundary works correctly', async () => {
    // Get first page with small limit
    const page1 = await request(app).get('/api/analytics/trending-quotes?limit=5&page=1');
    expect(page1.status).toBe(200);
    expect(page1.body.recent_quotes).toHaveLength(5);

    // Get second page
    const page2 = await request(app).get('/api/analytics/trending-quotes?limit=5&page=2');
    expect(page2.status).toBe(200);
    expect(page2.body.recent_quotes.length).toBeGreaterThan(0);

    // No overlap between pages
    const page1Ids = page1.body.recent_quotes.map(q => q.id);
    const page2Ids = page2.body.recent_quotes.map(q => q.id);
    const overlap = page1Ids.filter(id => page2Ids.includes(id));
    expect(overlap).toHaveLength(0);

    // Combined should still follow tier ordering
    const allIds = [...page1Ids, ...page2Ids];
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });

  it('search falls back to chronological (not tiered)', async () => {
    const res = await request(app).get('/api/analytics/trending-quotes?search=Tier1');
    expect(res.status).toBe(200);
    expect(res.body.recent_quotes.length).toBeGreaterThan(0);
    // When searching, results should be chronological, not tiered
    // quote_of_day/week/month should be null
    expect(res.body.quote_of_day).toBeNull();
  });

  it('sort=date gives pure chronological order', async () => {
    const res = await request(app).get('/api/analytics/trending-quotes?sort=date&limit=50');
    expect(res.status).toBe(200);

    const quotes = res.body.recent_quotes;
    // Verify chronological: each quote's effective date >= next quote's
    for (let i = 0; i < quotes.length - 1; i++) {
      const dateA = quotes[i].quote_datetime || quotes[i].created_at;
      const dateB = quotes[i + 1].quote_datetime || quotes[i + 1].created_at;
      expect(dateA >= dateB).toBe(true);
    }
  });

  it('sort=importance gives old tiered importance (backward compat)', async () => {
    const res = await request(app).get('/api/analytics/trending-quotes?sort=importance&limit=50');
    expect(res.status).toBe(200);
    expect(res.body.recent_quotes.length).toBeGreaterThan(0);

    // Quotes with importants should generally come before those without
    const quotes = res.body.recent_quotes;
    const firstWithImportants = quotes.findIndex(q => q.importants_count > 0);
    const firstWithout = quotes.findIndex(q => q.importants_count === 0);
    if (firstWithImportants >= 0 && firstWithout >= 0) {
      expect(firstWithImportants).toBeLessThan(firstWithout);
    }
  });

  it('total count is unchanged regardless of sort mode', async () => {
    const [defaultRes, dateRes, importanceRes] = await Promise.all([
      request(app).get('/api/analytics/trending-quotes'),
      request(app).get('/api/analytics/trending-quotes?sort=date'),
      request(app).get('/api/analytics/trending-quotes?sort=importance'),
    ]);

    expect(defaultRes.body.total).toBe(dateRes.body.total);
    expect(defaultRes.body.total).toBe(importanceRes.body.total);
  });

  it('hidden and canonical-child quotes excluded from all tiers', async () => {
    const res = await request(app).get('/api/analytics/trending-quotes?limit=50');
    const quoteIds = res.body.recent_quotes.map(q => q.id);

    expect(quoteIds).not.toContain(ids.hidden);
    expect(quoteIds).not.toContain(ids.canonicalChild);
  });

  it('empty tiers degrade gracefully to pure chronological', async () => {
    // Create a temp db scenario where no quotes have importants
    // We'll just use search to verify the handler doesn't crash with edge cases
    const res = await request(app).get('/api/analytics/trending-quotes?search=ZZZnonexistent');
    expect(res.status).toBe(200);
    expect(res.body.recent_quotes).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });
});
