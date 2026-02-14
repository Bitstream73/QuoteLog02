import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import config from './config/index.js';
import { getDb, closeDb, verifyDatabaseState, isDbReady, initDbAsync } from './config/database.js';
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
import articlesRouter from './routes/articles.js';
// votes route kept for reference but unmounted — replaced by importants
// import votesRouter from './routes/votes.js';
import importantsRouter from './routes/importants.js';
import trackingRouter from './routes/tracking.js';
import topicsRouter from './routes/topics.js';
import analyticsRouter from './routes/analytics.js';
import historicalSourcesRouter from './routes/historicalSources.js';
import contextRouter from './routes/context.js';
import factCheckRouter from './routes/factCheck.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ skipDbInit = false } = {}) {
  const app = express();

  // Initialize database and verify state (skip in production — deferred to async init)
  if (!skipDbInit) {
    getDb();
    verifyDatabaseState();
  }

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors());

  // Body parsing
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Cookie parsing (for auth)
  app.use(cookieParser());

  // Request logging & context
  app.use(requestLogger);
  app.use(logContext);

  // Rate limiting
  app.use('/api/', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 200 }));

  // Service worker — must never be cached by browser so updates are detected
  app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '../public/sw.js'));
  });

  // Static files
  app.use(express.static(path.join(__dirname, '../public')));

  // Health check — always returns 200 so Railway healthcheck passes during volume mount
  app.get('/api/health', (req, res) => {
    const pkg = { version: '1.0.0' };
    let dbStatus = 'starting';
    if (isDbReady()) {
      try {
        const db = getDb();
        db.prepare('SELECT 1').get();
        dbStatus = 'connected';
      } catch {
        dbStatus = 'error';
      }
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
  app.use('/api/articles', articlesRouter);
  // app.use('/api', votesRouter); // unmounted — replaced by importants
  app.use('/api/importants', importantsRouter);
  app.use('/api/tracking', trackingRouter);
  app.use('/api/topics', topicsRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/historical-sources', historicalSourcesRouter);
  app.use('/api/quotes', contextRouter);
  app.use('/api/fact-check', factCheckRouter);

  // SPA fallback - serve index.html for all non-API routes
  // For /quote/:id, inject OG/Twitter meta tags for social sharing
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }

    const quoteMatch = req.path.match(/^\/quote\/(\d+)$/);
    if (quoteMatch && isDbReady()) {
      try {
        const db = getDb();
        const quote = db.prepare(`
          SELECT q.text, q.context, q.created_at, p.canonical_name, p.disambiguation, p.photo_url,
                 a.title AS article_title, s.name AS source_name
          FROM quotes q
          JOIN persons p ON q.person_id = p.id
          LEFT JOIN quote_articles qa ON qa.quote_id = q.id
          LEFT JOIN articles a ON qa.article_id = a.id
          LEFT JOIN sources s ON a.source_id = s.id
          WHERE q.id = ?
        `).get(quoteMatch[1]);

        if (quote) {
          let html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
          const truncText = quote.text.length > 200 ? quote.text.substring(0, 200) + '...' : quote.text;
          const esc = (s) => s ? s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
          const title = `"${esc(truncText)}" - ${esc(quote.canonical_name)}`;
          const description = [
            quote.disambiguation,
            quote.context,
            quote.article_title ? `From: ${quote.article_title}` : null,
            quote.source_name ? `Source: ${quote.source_name}` : null,
          ].filter(Boolean).join(' | ');
          const proto = req.get('x-forwarded-proto') || req.protocol;
          const url = `${proto}://${req.get('host')}/quote/${quoteMatch[1]}`;
          const image = quote.photo_url || '';

          const metaTags = `
    <meta property="og:type" content="article">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${esc(url)}">
    ${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${esc(description)}">
    ${image ? `<meta name="twitter:image" content="${esc(image)}">` : ''}
    <title>${title} | WhatTheySaid.News</title>`;

          html = html.replace('<title>WhatTheySaid.News</title>', metaTags);
          return res.send(html);
        }
      } catch (err) {
        // Fall through to default index.html
      }
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
  const isProduction = config.env === 'production';
  // In production, skip synchronous DB init — use async retry for volume mount race condition
  const app = createApp({ skipDbInit: isProduction });
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

  httpServer.listen(config.port, () => {
    logger.info('system', 'startup', {
      version: '1.0.0',
      nodeVersion: process.version,
      env: config.env,
      port: config.port,
    });
    console.log(`Server running on port ${config.port}`);

    // In production, initialize DB asynchronously (with retries for volume mount)
    // then start the scheduler once DB is ready
    if (isProduction) {
      initDbAsync().then(() => {
        verifyDatabaseState();
        console.log('[startup] Database ready, starting scheduler');
        return import('./services/scheduler.js');
      }).then(({ startFetchScheduler }) => {
        startFetchScheduler(app);
      }).catch(err => {
        console.error('[startup] Database initialization failed:', err.message);
        process.exit(1);
      });
    } else {
      // In dev, DB is already initialized synchronously — start scheduler immediately
      import('./services/scheduler.js').then(({ startFetchScheduler }) => {
        startFetchScheduler(app);
      }).catch(err => {
        logger.error('system', 'scheduler_init_failed', { error: err.message });
      });
    }
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
