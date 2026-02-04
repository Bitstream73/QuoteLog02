import { v4 as uuidv4 } from 'uuid';
import logger from '../services/logger.js';

const SKIP_PATHS = ['/api/health', '/favicon.ico'];

export function requestLogger(req, res, next) {
  req.requestId = uuidv4();
  const start = Date.now();
  const shouldSkip = SKIP_PATHS.some(p => req.path === p);
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (shouldSkip) return;
    const logData = { method: req.method, path: req.path, statusCode: res.statusCode, duration, requestId: req.requestId, ip: req.ip };
    if (duration > 1000) { logger.warn('api', 'slow_request', logData); }
    else { logger.info('api', 'request_complete', logData); }
  });
  next();
}
