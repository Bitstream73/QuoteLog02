import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/votes-test.db';

describe('Vote API', () => {
  let app;
  let testQuoteId;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    // Seed a person and quote for testing
    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();
    db.prepare('INSERT INTO persons (canonical_name) VALUES (?)').run('Vote Test Author');
    const result = db.prepare('INSERT INTO quotes (person_id, text, is_visible) VALUES (?, ?, 1)').run(1, 'Test quote for voting');
    testQuoteId = result.lastInsertRowid;
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/votes-test.db${suffix}`); } catch {}
    }
  });

  describe('POST /api/quotes/:id/vote', () => {
    it('returns correct aggregate scores after upvote', async () => {
      const res = await request(app)
        .post(`/api/quotes/${testQuoteId}/vote`)
        .send({ value: 1 })
        .set('User-Agent', 'TestAgent1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.vote_score).toBe(1);
      expect(res.body.upvotes).toBe(1);
      expect(res.body.downvotes).toBe(0);
      expect(res.body.user_vote).toBe(1);
    });

    it('changing vote (up to down) updates correctly', async () => {
      const res = await request(app)
        .post(`/api/quotes/${testQuoteId}/vote`)
        .send({ value: -1 })
        .set('User-Agent', 'TestAgent1');

      expect(res.status).toBe(200);
      expect(res.body.vote_score).toBe(-1);
      expect(res.body.upvotes).toBe(0);
      expect(res.body.downvotes).toBe(1);
      expect(res.body.user_vote).toBe(-1);
    });

    it('removing vote (value=0) deletes the record', async () => {
      const res = await request(app)
        .post(`/api/quotes/${testQuoteId}/vote`)
        .send({ value: 0 })
        .set('User-Agent', 'TestAgent1');

      expect(res.status).toBe(200);
      expect(res.body.vote_score).toBe(0);
      expect(res.body.upvotes).toBe(0);
      expect(res.body.downvotes).toBe(0);
      expect(res.body.user_vote).toBe(0);
    });

    it('duplicate voter_hash on same quote updates instead of duplicates', async () => {
      // First vote: upvote
      await request(app)
        .post(`/api/quotes/${testQuoteId}/vote`)
        .send({ value: 1 })
        .set('User-Agent', 'TestAgent2');

      // Second vote: change to downvote (same UA = same voter_hash)
      const res = await request(app)
        .post(`/api/quotes/${testQuoteId}/vote`)
        .send({ value: -1 })
        .set('User-Agent', 'TestAgent2');

      expect(res.status).toBe(200);
      expect(res.body.vote_score).toBe(-1);
      expect(res.body.downvotes).toBe(1);
      // Should be 1 total vote record, not 2
      expect(res.body.upvotes).toBe(0);
    });

    it('invalid value (2) returns 400', async () => {
      const res = await request(app)
        .post(`/api/quotes/${testQuoteId}/vote`)
        .send({ value: 2 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('invalid value ("abc") returns 400', async () => {
      const res = await request(app)
        .post(`/api/quotes/${testQuoteId}/vote`)
        .send({ value: 'abc' });

      expect(res.status).toBe(400);
    });

    it('nonexistent quote returns 404', async () => {
      const res = await request(app)
        .post('/api/quotes/99999/vote')
        .send({ value: 1 });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/quotes/:id/votes', () => {
    it('returns vote counts and user_vote', async () => {
      // First, cast a vote
      await request(app)
        .post(`/api/quotes/${testQuoteId}/vote`)
        .send({ value: 1 })
        .set('User-Agent', 'VoteCountAgent');

      const res = await request(app)
        .get(`/api/quotes/${testQuoteId}/votes`)
        .set('User-Agent', 'VoteCountAgent');

      expect(res.status).toBe(200);
      expect(res.body.quote_id).toBe(Number(testQuoteId));
      expect(typeof res.body.vote_score).toBe('number');
      expect(typeof res.body.upvotes).toBe('number');
      expect(typeof res.body.downvotes).toBe('number');
      expect(res.body.user_vote).toBe(1);
    });

    it('returns user_vote=0 for non-voter', async () => {
      const res = await request(app)
        .get(`/api/quotes/${testQuoteId}/votes`)
        .set('User-Agent', 'NeverVotedAgent');

      expect(res.status).toBe(200);
      expect(res.body.user_vote).toBe(0);
    });

    it('nonexistent quote returns 404', async () => {
      const res = await request(app).get('/api/quotes/99999/votes');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/quotes includes vote_score', () => {
    it('quotes list includes voteScore field', async () => {
      const res = await request(app).get('/api/quotes');
      expect(res.status).toBe(200);
      if (res.body.quotes.length > 0) {
        expect(res.body.quotes[0]).toHaveProperty('voteScore');
        expect(typeof res.body.quotes[0].voteScore).toBe('number');
        expect(res.body.quotes[0]).toHaveProperty('userVote');
      }
    });
  });

  describe('GET /api/quotes/:id includes vote_score', () => {
    it('single quote includes voteScore and userVote', async () => {
      const res = await request(app).get(`/api/quotes/${testQuoteId}`);
      expect(res.status).toBe(200);
      expect(res.body.quote).toHaveProperty('voteScore');
      expect(typeof res.body.quote.voteScore).toBe('number');
      expect(res.body.quote).toHaveProperty('userVote');
    });
  });
});
