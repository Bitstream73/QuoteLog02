import config from '../config/index.js';

const SENSITIVE_KEYS = ['apikey', 'api_key', 'token', 'secret', 'password', 'pineconekey', 'geminikey', 'railwaytoken', 'authorization'];

function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitize(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function createEntry(level, category, action, details = {}, error = null, duration = null, context = {}) {
  const sanitizedDetails = sanitize(details);
  return {
    timestamp: new Date().toISOString(),
    level,
    category,
    action,
    requestId: context.requestId || null,
    ip: context.ip || null,
    details: sanitizedDetails,
    duration,
    error: error ? (typeof error === 'string' ? error : error.message) : null,
  };
}

let dbModule = null;

async function loadDbModule() {
  if (!dbModule) {
    try {
      dbModule = await import('../config/database.js');
    } catch {
      dbModule = null;
    }
  }
  return dbModule;
}

function writeToDbAsync(entry) {
  loadDbModule().then(mod => {
    if (!mod) return;
    try {
      const db = mod.getDb();
      db.prepare(
        `INSERT INTO application_logs (timestamp, level, category, action, request_id, ip_address, details, duration, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        entry.timestamp,
        entry.level,
        entry.category,
        entry.action,
        entry.requestId || null,
        entry.ip || null,
        JSON.stringify(entry.details),
        entry.duration || null,
        entry.error || null
      );
    } catch {
      // Silently fail
    }
  });
}

const logger = {
  _context: {},

  error(category, action, details = {}, error = null, duration = null) {
    const entry = createEntry('error', category, action, details, error, duration, this._context);
    console.error(`[ERROR]`, JSON.stringify(entry));
    writeToDbAsync(entry);
  },

  warn(category, action, details = {}, error = null, duration = null) {
    const entry = createEntry('warn', category, action, details, error, duration, this._context);
    console.warn(`[WARN]`, JSON.stringify(entry));
    writeToDbAsync(entry);
  },

  info(category, action, details = {}, error = null, duration = null) {
    const entry = createEntry('info', category, action, details, error, duration, this._context);
    console.info(`[INFO]`, JSON.stringify(entry));
    writeToDbAsync(entry);
  },

  debug(category, action, details = {}, error = null, duration = null) {
    if (config.env === 'production' || config.env === 'test') return;
    const entry = createEntry('debug', category, action, details, error, duration, this._context);
    console.debug(`[DEBUG]`, JSON.stringify(entry));
    writeToDbAsync(entry);
  },

  child(context) {
    const childLogger = Object.create(logger);
    childLogger._context = { ...this._context, ...context };
    return childLogger;
  },
};

export default logger;
