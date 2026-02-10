import { Router } from 'express';
import { getDb } from '../config/database.js';
import { createHash } from 'crypto';
import { createRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

function getVoterHash(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const ua = req.get('User-Agent') || '';
  return createHash('sha256').update(`${ip}:${ua}`).digest('hex');
}

function getVoteAggregates(db, quoteId) {
  return db.prepare(`
    SELECT COALESCE(SUM(vote_value), 0) as vote_score,
           COUNT(CASE WHEN vote_value = 1 THEN 1 END) as upvotes,
           COUNT(CASE WHEN vote_value = -1 THEN 1 END) as downvotes
    FROM votes WHERE quote_id = ?
  `).get(quoteId);
}

// Vote rate limiter: 30 votes per minute per voter
const voteRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
});

// POST /api/quotes/:id/vote
router.post('/quotes/:id/vote', voteRateLimiter, (req, res) => {
  try {
    const db = getDb();
    const quoteId = parseInt(req.params.id);
    const { value } = req.body;

    // Validate value
    if (value !== -1 && value !== 0 && value !== 1) {
      return res.status(400).json({ error: 'Invalid vote value. Must be -1, 0, or 1.' });
    }

    // Validate quote exists
    const quote = db.prepare('SELECT id FROM quotes WHERE id = ?').get(quoteId);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const voterHash = getVoterHash(req);

    if (value === 0) {
      // Remove vote
      db.prepare('DELETE FROM votes WHERE quote_id = ? AND voter_hash = ?').run(quoteId, voterHash);
    } else {
      // Insert or replace vote
      db.prepare(`
        INSERT INTO votes (quote_id, voter_hash, vote_value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(quote_id, voter_hash) DO UPDATE SET
          vote_value = excluded.vote_value,
          updated_at = excluded.updated_at
      `).run(quoteId, voterHash, value);
    }

    const aggregates = getVoteAggregates(db, quoteId);

    // Emit Socket.IO event if available
    const io = req.app.get('io');
    if (io) {
      io.emit('vote_update', {
        quoteId,
        vote_score: aggregates.vote_score,
        upvotes: aggregates.upvotes,
        downvotes: aggregates.downvotes,
      });
    }

    res.json({
      success: true,
      vote_score: aggregates.vote_score,
      upvotes: aggregates.upvotes,
      downvotes: aggregates.downvotes,
      user_vote: value,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/quotes/:id/votes
router.get('/quotes/:id/votes', (req, res) => {
  try {
    const db = getDb();
    const quoteId = parseInt(req.params.id);

    // Validate quote exists
    const quote = db.prepare('SELECT id FROM quotes WHERE id = ?').get(quoteId);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const voterHash = getVoterHash(req);
    const aggregates = getVoteAggregates(db, quoteId);

    // Get current voter's vote
    const userVote = db.prepare('SELECT vote_value FROM votes WHERE quote_id = ? AND voter_hash = ?').get(quoteId, voterHash);

    res.json({
      quote_id: quoteId,
      vote_score: aggregates.vote_score,
      upvotes: aggregates.upvotes,
      downvotes: aggregates.downvotes,
      user_vote: userVote ? userVote.vote_value : 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
