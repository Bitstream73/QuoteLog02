import logger from '../services/logger.js';

export function logContext(req, res, next) {
  req.logger = logger.child({ requestId: req.requestId, ip: req.ip });
  next();
}
