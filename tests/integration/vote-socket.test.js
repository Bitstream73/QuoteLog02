import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/vote-socket-test.db';

describe('Vote Socket.IO Broadcast', () => {
  let app, httpServer, io, clientSocket;
  let testQuoteId;
  const PORT = 0; // random available port

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    httpServer = createServer(app);
    io = new SocketServer(httpServer, { cors: { origin: '*' } });
    app.set('io', io);

    // Seed test data
    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();
    db.prepare('INSERT INTO persons (canonical_name) VALUES (?)').run('Socket Test Author');
    const result = db.prepare('INSERT INTO quotes (person_id, text, is_visible) VALUES (?, ?, 1)').run(1, 'Socket test quote');
    testQuoteId = result.lastInsertRowid;

    // Start server and connect client
    await new Promise(resolve => httpServer.listen(0, resolve));
    const port = httpServer.address().port;
    clientSocket = ioClient(`http://localhost:${port}`);
    await new Promise(resolve => clientSocket.on('connect', resolve));
  }, 30000);

  afterAll(async () => {
    if (clientSocket) clientSocket.disconnect();
    if (io) io.close();
    if (httpServer) httpServer.close();
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/vote-socket-test.db${suffix}`); } catch {}
    }
  });

  it('emits vote_update event when a vote is cast', async () => {
    // Listen for the event
    const eventPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('vote_update event not received')), 5000);
      clientSocket.on('vote_update', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
    });

    // Cast a vote via HTTP
    const res = await request(app)
      .post(`/api/quotes/${testQuoteId}/vote`)
      .send({ value: 1 })
      .set('User-Agent', 'SocketTestAgent');

    expect(res.status).toBe(200);

    // Wait for the socket event
    const socketData = await eventPromise;
    expect(socketData.quoteId).toBe(Number(testQuoteId));
    expect(typeof socketData.vote_score).toBe('number');
    expect(typeof socketData.upvotes).toBe('number');
    expect(typeof socketData.downvotes).toBe('number');
  });
});
