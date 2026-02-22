import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// Set test environment BEFORE any imports that trigger config loading
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/purge-quality-test.db';

// Mock Gemini
vi.mock('../../src/services/ai/gemini.js', () => ({
  default: {
    generateText: vi.fn(),
    generateJSON: vi.fn(),
    generateEmbedding: vi.fn(),
    extractQuotes: vi.fn(),
  },
}));

// Mock vectorDb entirely (avoid importActual which triggers config loading)
vi.mock('../../src/services/vectorDb.js', () => ({
  default: {
    deleteManyByIds: vi.fn().mockResolvedValue(undefined),
    embedQuote: vi.fn().mockResolvedValue(undefined),
    deleteByIds: vi.fn().mockResolvedValue(undefined),
    getIndexStats: vi.fn().mockResolvedValue({}),
  },
  embedQuote: vi.fn().mockResolvedValue(undefined),
  queryQuotes: vi.fn().mockResolvedValue({ result: { hits: [] } }),
  searchQuotes: vi.fn().mockResolvedValue({ result: { hits: [] } }),
}));

describe('Quote Quality Purge', () => {
  let app;
  let db;
  let authCookie;
  let gemini;

  beforeAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    const dbModule = await import('../../src/config/database.js');
    db = dbModule.getDb();
    const authHelper = await import('../helpers/auth.js');
    authCookie = authHelper.getAuthCookie();
    gemini = (await import('../../src/services/ai/gemini.js')).default;
  });

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    try {
      fs.unlinkSync('./tests/purge-quality-test.db');
      fs.unlinkSync('./tests/purge-quality-test.db-wal');
      fs.unlinkSync('./tests/purge-quality-test.db-shm');
    } catch {}
  });

  function insertPerson(name) {
    return db.prepare(`INSERT INTO persons (canonical_name, quote_count) VALUES (?, 0)`).run(name);
  }

  function insertQuote(personId, text, opts = {}) {
    const { isVisible = 1, factCheckCategory = null, canonicalQuoteId = null } = opts;
    return db.prepare(`
      INSERT INTO quotes (person_id, text, is_visible, fact_check_category, canonical_quote_id, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(personId, text, isVisible, factCheckCategory, canonicalQuoteId);
  }

  function updatePersonQuoteCount(personId) {
    db.prepare(`UPDATE persons SET quote_count = (SELECT COUNT(*) FROM quotes WHERE person_id = ? AND is_visible = 1 AND canonical_quote_id IS NULL) WHERE id = ?`).run(personId, personId);
  }

  it('returns 401 without auth cookie', async () => {
    const res = await request(app)
      .post('/api/admin/purge-quality')
      .send({ dry_run: true });
    expect(res.status).toBe(401);
  });

  it('has fact_check_category and fact_check_confidence columns', () => {
    const cols = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name);
    expect(cols).toContain('fact_check_category');
    expect(cols).toContain('fact_check_confidence');
  });

  it('Phase 1: deletes invisible quotes', async () => {
    const person = insertPerson('Phase1 Speaker');
    const personId = person.lastInsertRowid;
    insertQuote(personId, 'visible quote');
    insertQuote(personId, 'hidden quote 1', { isVisible: 0 });
    insertQuote(personId, 'hidden quote 2', { isVisible: 0 });
    updatePersonQuoteCount(personId);

    gemini.generateJSON.mockResolvedValue({ classifications: [] });

    const res = await request(app)
      .post('/api/admin/purge-quality')
      .set('Cookie', authCookie)
      .send({ dry_run: false });

    expect(res.status).toBe(200);
    expect(res.body.phase1.invisible_found).toBeGreaterThanOrEqual(2);
    expect(res.body.phase1.deleted).toBeGreaterThanOrEqual(2);

    // Visible quote should still exist
    const remaining = db.prepare(`SELECT COUNT(*) as count FROM quotes WHERE person_id = ? AND is_visible = 1`).get(personId);
    expect(remaining.count).toBe(1);
  });

  it('dry run classifies but does not delete', async () => {
    // Pre-classify all existing unclassified quotes so only our test quotes need classification
    db.prepare(`UPDATE quotes SET fact_check_category = 'A' WHERE fact_check_category IS NULL`).run();

    const person = insertPerson('DryRun Speaker');
    const personId = person.lastInsertRowid;
    const q1 = insertQuote(personId, 'The deficit is $1.2 trillion');
    const q2 = insertQuote(personId, 'I think the economy is doing well');
    updatePersonQuoteCount(personId);

    gemini.generateJSON.mockResolvedValue({
      classifications: [
        { index: 1, category: 'A', confidence: 0.95 },
        { index: 2, category: 'B', confidence: 0.88 },
      ],
    });

    const res = await request(app)
      .post('/api/admin/purge-quality')
      .set('Cookie', authCookie)
      .send({ dry_run: true, batch_size: 10 });

    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.phase2.classified).toBeGreaterThanOrEqual(2);
    expect(res.body.phase2.deleted).toBe(0);

    // B quote should still exist (dry run)
    const bQuote = db.prepare(`SELECT fact_check_category FROM quotes WHERE id = ?`).get(q2.lastInsertRowid);
    expect(bQuote.fact_check_category).toBe('B');
  });

  it('deletes B and C quotes on non-dry run', async () => {
    const person = insertPerson('BC Speaker');
    const personId = person.lastInsertRowid;
    insertQuote(personId, 'Fact: 500 jobs created', { factCheckCategory: 'A' });
    insertQuote(personId, 'I believe in freedom', { factCheckCategory: 'B' });
    insertQuote(personId, 'It is what it is', { factCheckCategory: 'C' });
    updatePersonQuoteCount(personId);

    gemini.generateJSON.mockResolvedValue({ classifications: [] });

    const res = await request(app)
      .post('/api/admin/purge-quality')
      .set('Cookie', authCookie)
      .send({ dry_run: false });

    expect(res.status).toBe(200);
    expect(res.body.phase2.deleted).toBeGreaterThanOrEqual(2);

    // Only A quote should remain for this person
    const remaining = db.prepare(`SELECT COUNT(*) as count FROM quotes WHERE person_id = ?`).get(personId);
    expect(remaining.count).toBe(1);
  });

  it('cleans up importants and noteworthy_items for deleted quotes', async () => {
    const person = insertPerson('FK Speaker');
    const personId = person.lastInsertRowid;
    const q = insertQuote(personId, 'This is a platitude', { factCheckCategory: 'C' });
    const quoteId = q.lastInsertRowid;
    updatePersonQuoteCount(personId);

    // Insert related records
    db.prepare(`INSERT INTO importants (entity_type, entity_id, voter_hash) VALUES ('quote', ?, 'test-voter')`).run(quoteId);
    db.prepare(`INSERT INTO noteworthy_items (entity_type, entity_id, display_order) VALUES ('quote', ?, 1)`).run(quoteId);

    gemini.generateJSON.mockResolvedValue({ classifications: [] });

    const res = await request(app)
      .post('/api/admin/purge-quality')
      .set('Cookie', authCookie)
      .send({ dry_run: false });

    expect(res.status).toBe(200);

    // FK records should be cleaned up
    const imp = db.prepare(`SELECT COUNT(*) as count FROM importants WHERE entity_type = 'quote' AND entity_id = ?`).get(quoteId);
    expect(imp.count).toBe(0);
    const nw = db.prepare(`SELECT COUNT(*) as count FROM noteworthy_items WHERE entity_type = 'quote' AND entity_id = ?`).get(quoteId);
    expect(nw.count).toBe(0);
  });

  it('updates person quote_count after deletion', async () => {
    const person = insertPerson('Count Speaker');
    const personId = person.lastInsertRowid;
    insertQuote(personId, 'Fact: 100 units sold', { factCheckCategory: 'A' });
    insertQuote(personId, 'Just saying hello', { factCheckCategory: 'C' });
    insertQuote(personId, 'We need change', { factCheckCategory: 'B' });
    updatePersonQuoteCount(personId);

    const beforeCount = db.prepare(`SELECT quote_count FROM persons WHERE id = ?`).get(personId);
    expect(beforeCount.quote_count).toBe(3);

    gemini.generateJSON.mockResolvedValue({ classifications: [] });

    await request(app)
      .post('/api/admin/purge-quality')
      .set('Cookie', authCookie)
      .send({ dry_run: false });

    const afterCount = db.prepare(`SELECT quote_count FROM persons WHERE id = ?`).get(personId);
    expect(afterCount.quote_count).toBe(1);
  });

  it('skips classification for already-classified quotes', async () => {
    const person = insertPerson('Already Speaker');
    const personId = person.lastInsertRowid;
    insertQuote(personId, 'Already classified A', { factCheckCategory: 'A' });
    insertQuote(personId, 'Already classified B', { factCheckCategory: 'B' });
    updatePersonQuoteCount(personId);

    gemini.generateJSON.mockClear();
    gemini.generateJSON.mockResolvedValue({ classifications: [] });

    const res = await request(app)
      .post('/api/admin/purge-quality')
      .set('Cookie', authCookie)
      .send({ dry_run: false });

    expect(res.status).toBe(200);
    // B should be deleted, A should remain
    expect(res.body.phase2.deleted).toBeGreaterThanOrEqual(1);
    const remaining = db.prepare(`SELECT COUNT(*) as count FROM quotes WHERE person_id = ?`).get(personId);
    expect(remaining.count).toBe(1);
  });

  it('emits Socket.IO purge_progress and purge_complete events', async () => {
    const mockIo = { emit: vi.fn() };
    app.set('io', mockIo);

    // Pre-classify all existing to avoid uncontrolled classification
    db.prepare(`UPDATE quotes SET fact_check_category = 'A' WHERE fact_check_category IS NULL`).run();

    const person = insertPerson('SocketIO Speaker');
    const personId = person.lastInsertRowid;
    insertQuote(personId, 'hidden socket quote', { isVisible: 0 });
    updatePersonQuoteCount(personId);

    gemini.generateJSON.mockResolvedValue({ classifications: [] });

    const res = await request(app)
      .post('/api/admin/purge-quality')
      .set('Cookie', authCookie)
      .send({ dry_run: false });

    expect(res.status).toBe(200);

    // Should have emitted purge_progress for phase1
    const progressCalls = mockIo.emit.mock.calls.filter(c => c[0] === 'purge_progress');
    expect(progressCalls.length).toBeGreaterThanOrEqual(1);
    const phase1Events = progressCalls.filter(c => c[1].phase === 'phase1');
    expect(phase1Events.length).toBeGreaterThanOrEqual(1);

    // Should have emitted purge_complete
    const completeCalls = mockIo.emit.mock.calls.filter(c => c[0] === 'purge_complete');
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0][1]).toHaveProperty('totalDeleted');
    expect(completeCalls[0][1]).toHaveProperty('totalKept');

    app.set('io', undefined);
  });

  it('emits per-quote progress with kept/deleted types during classification', async () => {
    const mockIo = { emit: vi.fn() };
    app.set('io', mockIo);

    // Pre-classify all existing to avoid uncontrolled classification
    db.prepare(`UPDATE quotes SET fact_check_category = 'A' WHERE fact_check_category IS NULL`).run();

    const person = insertPerson('PerQuote Speaker');
    const personId = person.lastInsertRowid;
    const q1 = insertQuote(personId, 'The budget is $4.7 trillion');
    const q2 = insertQuote(personId, 'I feel strongly about this');
    updatePersonQuoteCount(personId);

    gemini.generateJSON.mockResolvedValue({
      classifications: [
        { index: 1, category: 'A', confidence: 0.95 },
        { index: 2, category: 'B', confidence: 0.85 },
      ],
    });

    const res = await request(app)
      .post('/api/admin/purge-quality')
      .set('Cookie', authCookie)
      .send({ dry_run: true, batch_size: 10 });

    expect(res.status).toBe(200);

    const progressCalls = mockIo.emit.mock.calls.filter(c => c[0] === 'purge_progress');
    const keptEvents = progressCalls.filter(c => c[1].type === 'kept');
    const deletedEvents = progressCalls.filter(c => c[1].type === 'deleted');

    expect(keptEvents.length).toBeGreaterThanOrEqual(1);
    expect(deletedEvents.length).toBeGreaterThanOrEqual(1);

    // Verify kept event has expected fields
    const keptEvent = keptEvents[0][1];
    expect(keptEvent.category).toBe('A');
    expect(keptEvent).toHaveProperty('quoteText');
    expect(keptEvent).toHaveProperty('author');
    expect(keptEvent).toHaveProperty('totalKept');
    expect(keptEvent).toHaveProperty('totalDeleted');
    expect(keptEvent).toHaveProperty('remaining');
    expect(keptEvent).toHaveProperty('estimatedSecondsLeft');

    // Verify deleted event
    const deletedEvent = deletedEvents[0][1];
    expect(deletedEvent.category).toBe('B');

    app.set('io', undefined);
  });
});
