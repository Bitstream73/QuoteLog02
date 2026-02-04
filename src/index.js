import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import config from './config/index.js';
import { getDb, closeDb } from './config/database.js';
import logger from './services/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createRateLimiter } from './middleware/rateLimiter.js';
import { requestLogger } from './middleware/requestLogger.js';
import { logContext } from './middleware/logContext.js';

import quotesRouter from './routes/quotes.js';
import authorsRouter from './routes/authors.js';
import settingsRouter from './routes/settings.js';
import logsRouter from './routes/logs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  getDb();
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);
  app.use(logContext);
  app.use('/api/', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 200 }));
  app.use(express.static(path.join(__dirname, '../public')));

  app.get('/api/health', (req, res) => {
    let dbStatus = 'disconnected';
    try { const db = getDb(); db.prepare('SELECT 1').get(); dbStatus = 'connected'; } catch { dbStatus = 'error'; }
    res.json({ status: 'healthy', timestamp: new Date().toISOString(), version: '1.0.0', services: { database: dbStatus } });
  });

  app.use('/api/quotes', quotesRouter);
  app.use('/api/authors', authorsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/logs', logsRouter);

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  app.use(errorHandler);
  return app;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url).includes(process.argv[1].replace(/\\/g, '/').split('/').pop());

if (isMainModule || (!process.argv[1] && process.env.NODE_ENV !== 'test')) {
  const app = createApp();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, { cors: { origin: '*' } });
  io.on('connection', (socket) => {
    logger.debug('system', 'socket_connected', { socketId: socket.id });
    socket.on('disconnect', () => { logger.debug('system', 'socket_disconnected', { socketId: socket.id }); });
  });
  app.set('io', io);
  httpServer.listen(config.port, () => {
    logger.info('system', 'startup', { version: '1.0.0', nodeVersion: process.version, env: config.env, port: config.port });
    console.log(`Server running on port ${config.port}`);
  });
  const shutdown = (signal) => {
    logger.info('system', 'shutdown_initiated', { signal });
    httpServer.close(() => { closeDb(); logger.info('system', 'shutdown_complete', { signal }); process.exit(0); });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
