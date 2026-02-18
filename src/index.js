import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
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
import { csrfProtection } from './middleware/csrfProtection.js';

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
import analyticsRouter from './routes/analytics.js';
import historicalSourcesRouter from './routes/historicalSources.js';
import contextRouter from './routes/context.js';
import factCheckRouter from './routes/factCheck.js';
import searchRouter from './routes/search.js';
import { loadFonts } from './services/shareImage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function escapeHtmlAttr(s) {
  return s ? s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
}

function injectMetaTags(htmlContent, meta, jsonLd) {
  const esc = escapeHtmlAttr;
  const imgTags = meta.image ? `
    <meta property="og:image" content="${esc(meta.image)}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:type" content="image/jpeg">
    <meta name="twitter:image" content="${esc(meta.image)}">` : '';

  const metaTags = `
    <meta property="og:type" content="${meta.type || 'website'}">
    <meta property="og:title" content="${esc(meta.title)}">
    <meta property="og:description" content="${esc(meta.description)}">
    <meta property="og:url" content="${esc(meta.url)}">${imgTags}
    <meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">
    <meta name="twitter:title" content="${esc(meta.title)}">
    <meta name="twitter:description" content="${esc(meta.description)}">
    <link rel="canonical" href="${esc(meta.url)}">
    <title>${esc(meta.title)}</title>${jsonLd ? `
    <script type="application/ld+json">${jsonLd}</script>` : ''}`;

  return htmlContent.replace('<title>WhatTheySaid.News</title>', metaTags);
}

export function createApp({ skipDbInit = false } = {}) {
  const app = express();

  // Initialize database and verify state (skip in production — deferred to async init)
  if (!skipDbInit) {
    getDb();
    verifyDatabaseState();
  }

  // Trust first proxy (Railway, nginx, etc.) for correct req.hostname / req.protocol
  app.set('trust proxy', 1);

  // Compression (gzip/brotli) for all responses
  app.use(compression());

  // Security middleware
  const corsOptions = config.corsOrigins.includes('*')
    ? { credentials: true }
    : { origin: config.corsOrigins, credentials: true };
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "wss:", "ws:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors(corsOptions));

  // Body parsing
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Cookie parsing (for auth)
  app.use(cookieParser());

  // Request logging & context
  app.use(requestLogger);
  app.use(logContext);

  // Rate limiting
  app.use('/api/', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 200, skipPaths: ['/auth/'] }));

  // CSRF protection for state-changing API requests (skip login endpoint)
  app.use('/api/', (req, res, next) => {
    if (req.path === '/auth/login') return next();
    csrfProtection(req, res, next);
  });

  // Service worker — must never be cached by browser so updates are detected
  app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '../public/sw.js'));
  });

  // robots.txt
  app.get('/robots.txt', (req, res) => {
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('host');
    const sitemapUrl = `${proto}://${host}/sitemap.xml`;
    const body = [
      'User-agent: *',
      'Allow: /',
      'Allow: /quote/*',
      'Allow: /author/*',
      'Allow: /article/*',
      'Allow: /analytics',
      '',
      'Allow: /api/quotes/*/share-image',
      'Disallow: /api/',
      'Disallow: /login',
      'Disallow: /settings',
      'Disallow: /review',
      'Disallow: /admin',
      'Disallow: /forgot-password',
      'Disallow: /reset-password',
      '',
      `Sitemap: ${sitemapUrl}`,
    ].join('\n');
    res.set('Content-Type', 'text/plain');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(body);
  });

  // sitemap.xml
  app.get('/sitemap.xml', (req, res) => {
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('host');
    const base = `${proto}://${host}`;
    const today = new Date().toISOString().split('T')[0];

    let urls = '';
    const addUrl = (loc, priority, changefreq, lastmod) => {
      urls += `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${lastmod || today}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>\n`;
    };

    // Static pages
    addUrl(base + '/', '1.0', 'daily');
    addUrl(base + '/analytics', '0.5', 'weekly');

    if (isDbReady()) {
      try {
        const db = getDb();
        // Recent visible quotes (last 90 days, limit 1000)
        const quotes = db.prepare(`
          SELECT id, created_at FROM quotes
          WHERE is_visible = 1 AND canonical_quote_id IS NULL
            AND created_at >= datetime('now', '-90 days')
          ORDER BY created_at DESC LIMIT 1000
        `).all();
        for (const q of quotes) {
          const lastmod = q.created_at ? q.created_at.split('T')[0] : today;
          addUrl(`${base}/quote/${q.id}`, '0.8', 'weekly', lastmod);
        }

        // Authors with quotes
        const authors = db.prepare(`
          SELECT id, last_seen_at FROM persons WHERE quote_count > 0 ORDER BY last_seen_at DESC LIMIT 1000
        `).all();
        for (const a of authors) {
          const lastmod = a.last_seen_at ? a.last_seen_at.split('T')[0] : today;
          addUrl(`${base}/author/${a.id}`, '0.7', 'weekly', lastmod);
        }

        // Recent articles (last 90 days, limit 500)
        const articles = db.prepare(`
          SELECT id, published_at FROM articles
          WHERE published_at >= datetime('now', '-90 days')
          ORDER BY published_at DESC LIMIT 500
        `).all();
        for (const art of articles) {
          const lastmod = art.published_at ? art.published_at.split('T')[0] : today;
          addUrl(`${base}/article/${art.id}`, '0.6', 'monthly', lastmod);
        }
      } catch {
        // DB not ready — serve static-only sitemap
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>`;
    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  });

  // Homepage — inject meta tags + JSON-LD before static middleware serves index.html
  app.get('/', (req, res) => {
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('host');
    const baseUrl = `${proto}://${host}`;
    let html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
    const meta = {
      title: 'WhatTheySaid.News - Accountability Through Quotes',
      description: 'Track what public figures say with AI-powered quote extraction from news sources.',
      url: baseUrl + '/',
      type: 'website',
    };
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'WhatTheySaid.News',
      url: baseUrl + '/',
      potentialAction: {
        '@type': 'SearchAction',
        target: baseUrl + '/?search={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    });
    res.send(injectMetaTags(html, meta, jsonLd));
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
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/historical-sources', historicalSourcesRouter);
  app.use('/api/quotes', contextRouter);
  app.use('/api/fact-check', factCheckRouter);
  app.use('/api/search', searchRouter);

  // SPA fallback - serve index.html for all non-API routes
  // Inject OG/Twitter meta tags, canonical URL, and JSON-LD for public pages
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }

    const proto = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('host');
    const baseUrl = `${proto}://${host}`;

    // Phase 5a: 301 redirect for name-based author URLs
    const authorMatch = req.path.match(/^\/author\/(.+)$/);
    if (authorMatch && !/^\d+$/.test(authorMatch[1]) && isDbReady()) {
      try {
        const db = getDb();
        const person = db.prepare('SELECT id FROM persons WHERE canonical_name = ?')
          .get(decodeURIComponent(authorMatch[1]));
        if (person) {
          return res.redirect(301, `/author/${person.id}`);
        }
      } catch {
        // Fall through to default HTML
      }
    }

    // Try to inject meta tags for known public routes
    let meta = null;
    let jsonLd = null;

    // Analytics
    if (req.path === '/analytics') {
      meta = {
        title: 'Quote Analytics & Trends | WhatTheySaid.News',
        description: 'Explore trends in public statements, top quoted figures, and source analytics.',
        url: baseUrl + '/analytics',
        type: 'website',
      };
    }

    // Quote page
    const quoteMatch = req.path.match(/^\/quote\/(\d+)$/);
    if (quoteMatch && isDbReady()) {
      try {
        const db = getDb();
        const quote = db.prepare(`
          SELECT q.text, q.context, q.created_at, q.quote_datetime, p.canonical_name, p.disambiguation, p.photo_url,
                 a.title AS article_title, s.name AS source_name
          FROM quotes q
          JOIN persons p ON q.person_id = p.id
          LEFT JOIN quote_articles qa ON qa.quote_id = q.id
          LEFT JOIN articles a ON qa.article_id = a.id
          LEFT JOIN sources s ON a.source_id = s.id
          WHERE q.id = ?
        `).get(quoteMatch[1]);

        if (quote) {
          const truncText = quote.text.length > 200 ? quote.text.substring(0, 200) + '...' : quote.text;
          const description = [
            quote.disambiguation,
            quote.context,
            quote.article_title ? `From: ${quote.article_title}` : null,
            quote.source_name ? `Source: ${quote.source_name}` : null,
          ].filter(Boolean).join(' | ');
          meta = {
            title: `"${escapeHtmlAttr(truncText)}" - ${escapeHtmlAttr(quote.canonical_name)}`,
            description,
            url: `${baseUrl}/quote/${quoteMatch[1]}`,
            image: `${baseUrl}/api/quotes/${quoteMatch[1]}/share-image`,
            type: 'article',
          };
          jsonLd = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Quotation',
            text: quote.text,
            creator: { '@type': 'Person', name: quote.canonical_name },
            datePublished: quote.quote_datetime || quote.created_at || undefined,
            isPartOf: quote.article_title ? {
              '@type': 'Article',
              headline: quote.article_title,
              publisher: quote.source_name ? { '@type': 'Organization', name: quote.source_name } : undefined,
            } : undefined,
          });
        }
      } catch {
        // Fall through to default HTML
      }
    }

    // Author page
    const authorNumMatch = req.path.match(/^\/author\/(\d+)$/);
    if (authorNumMatch && isDbReady()) {
      try {
        const db = getDb();
        const person = db.prepare('SELECT id, canonical_name, disambiguation, category_context, photo_url, quote_count FROM persons WHERE id = ?')
          .get(authorNumMatch[1]);
        if (person) {
          const descParts = [
            person.disambiguation,
            person.category_context,
            `${person.quote_count} quote${person.quote_count !== 1 ? 's' : ''} tracked`,
          ].filter(Boolean);
          meta = {
            title: `${escapeHtmlAttr(person.canonical_name)} - Quotes & Statements | WhatTheySaid.News`,
            description: descParts.join(' | '),
            url: `${baseUrl}/author/${person.id}`,
            image: person.photo_url || null,
            type: 'profile',
          };
          jsonLd = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Person',
            name: person.canonical_name,
            description: person.disambiguation || person.category_context || undefined,
            image: person.photo_url || undefined,
            url: `${baseUrl}/author/${person.id}`,
          });
        }
      } catch {
        // Fall through
      }
    }

    // Article page
    const articleMatch = req.path.match(/^\/article\/(\d+)$/);
    if (articleMatch && isDbReady()) {
      try {
        const db = getDb();
        const article = db.prepare(`
          SELECT a.id, a.title, a.published_at, s.name AS source_name, s.domain AS source_domain
          FROM articles a
          LEFT JOIN sources s ON a.source_id = s.id
          WHERE a.id = ?
        `).get(articleMatch[1]);
        if (article) {
          const sourceName = article.source_name || article.source_domain || '';
          const quoteCount = db.prepare('SELECT COUNT(*) as count FROM quote_articles WHERE article_id = ?').get(article.id).count;
          const descParts = [
            sourceName,
            article.published_at ? article.published_at.split('T')[0] : null,
            `${quoteCount} quote${quoteCount !== 1 ? 's' : ''} extracted`,
          ].filter(Boolean);
          meta = {
            title: `${escapeHtmlAttr(article.title || 'Untitled')} | ${escapeHtmlAttr(sourceName)} - WhatTheySaid.News`,
            description: descParts.join(' | '),
            url: `${baseUrl}/article/${article.id}`,
            type: 'article',
          };
          jsonLd = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: article.title,
            datePublished: article.published_at || undefined,
            publisher: sourceName ? { '@type': 'Organization', name: sourceName } : undefined,
          });
        }
      } catch {
        // Fall through
      }
    }

    // Inject meta tags if we have them
    if (meta) {
      const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf-8');
      return res.send(injectMetaTags(html, meta, jsonLd));
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
  const socketCorsOptions = config.corsOrigins.includes('*')
    ? { origin: true, credentials: true }
    : { origin: config.corsOrigins, credentials: true };
  const io = new SocketServer(httpServer, {
    cors: socketCorsOptions,
  });

  // Socket.IO authentication middleware — tag authenticated connections
  io.use((socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]*)/);
      if (match) {
        try {
          const decoded = jwt.verify(match[1], config.jwtSecret);
          socket.data.authenticated = true;
          socket.data.admin = decoded;
        } catch {
          socket.data.authenticated = false;
        }
      } else {
        socket.data.authenticated = false;
      }
    } else {
      socket.data.authenticated = false;
    }
    // Allow all connections (public news app) but tag auth status
    next();
  });

  io.on('connection', (socket) => {
    logger.debug('system', 'socket_connected', { socketId: socket.id, authenticated: socket.data.authenticated });
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

    // Pre-load fonts for share image generation (non-blocking)
    loadFonts().catch(err => {
      console.warn('[startup] Font loading failed (share images will retry on first request):', err.message);
    });

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
