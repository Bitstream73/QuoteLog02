import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import config from './config/index.js';
import { getDb, closeDb, verifyDatabaseState } from './config/database.js';
import logger from './services/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createRateLimiter } from './middleware/rateLimiter.js';
import { requestLogger } from './middleware/requestLogger.js';
import { logContext } from './middleware/logContext.js';

import authRouter from './routes/auth.js';
import quotesRouter from './routes/quotes.js';
import authorsRouter from './routes/authors.js';
import settingsRouter from './routes/settings.js';
import sourcesRouter from './routes/sources.js';
import reviewRouter from './routes/review.js';
import logsRouter from './routes/logs.js';
import adminRouter from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // Initialize database and verify state
  getDb();
  verifyDatabaseState();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors());

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Cookie parsing (for auth)
  app.use(cookieParser());

  // Request logging & context
  app.use(requestLogger);
  app.use(logContext);

  // Rate limiting
  app.use('/api/', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 200 }));

  // Static files
  app.use(express.static(path.join(__dirname, '../public')));

  // Health check
  app.get('/api/health', (req, res) => {
    const pkg = { version: '1.0.0' };
    let dbStatus = 'disconnected';
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      dbStatus = 'connected';
    } catch {
      dbStatus = 'error';
    }

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: pkg.version,
      services: {
        database: dbStatus,
      },
    });
  });

  // API routes
  app.use('/api/auth', authRouter);
  app.use('/api/quotes', quotesRouter);
  app.use('/api/authors', authorsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/sources', sourcesRouter);
  app.use('/api/review', reviewRouter);
  app.use('/api/logs', logsRouter);
  app.use('/api/admin', adminRouter);

  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  // Error handler
  app.use(errorHandler);

  return app;
}

// Start server if run directly
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url).includes(process.argv[1].replace(/\\/g, '/').split('/').pop());

if (isMainModule || (!process.argv[1] && process.env.NODE_ENV !== 'test')) {
  const app = createApp();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
    logger.debug('system', 'socket_connected', { socketId: socket.id });
    socket.on('disconnect', () => {
      logger.debug('system', 'socket_disconnected', { socketId: socket.id });
    });
  });

  // Export io for use in other modules
  app.set('io', io);

  // Start the fetch scheduler
  import('./services/scheduler.js').then(({ startFetchScheduler }) => {
    startFetchScheduler(app);
  }).catch(err => {
    logger.error('system', 'scheduler_init_failed', { error: err.message });
  });

  httpServer.listen(config.port, () => {
    logger.info('system', 'startup', {
      version: '1.0.0',
      nodeVersion: process.version,
      env: config.env,
      port: config.port,
    });
    console.log(`Server running on port ${config.port}`);
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    logger.info('system', 'shutdown_initiated', { signal });
    import('./services/scheduler.js').then(({ stopFetchScheduler }) => {
      stopFetchScheduler();
    }).catch(() => {});
    httpServer.close(() => {
      closeDb();
      logger.info('system', 'shutdown_complete', { signal });
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
