import fs from 'fs';
import path from 'path';
import config from '../config/index.js';
import logger from '../services/logger.js';

export function checkPersistence() {
  const dbDir = path.dirname(config.databasePath);

  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Write a test file to check persistence
    const testFile = path.join(dbDir, '.persistence-check');
    fs.writeFileSync(testFile, new Date().toISOString());

    logger.info('system', 'persistence_check', { status: 'writable', path: dbDir });
    return true;
  } catch (error) {
    logger.warn('system', 'persistence_check', {
      status: 'ephemeral',
      path: dbDir,
      warning: 'Data may be lost on restart',
    }, error);
    return false;
  }
}
