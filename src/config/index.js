import 'dotenv/config';
import crypto from 'crypto';
import path from 'path';

const isProduction = (process.env.NODE_ENV || 'development') === 'production';

// Database path: use absolute /app/data path in production, relative in dev
let databasePath = process.env.DATABASE_PATH || (isProduction ? '/app/data/database.sqlite' : './data/database.sqlite');

// Guard against Windows Git Bash path mangling (e.g. /app -> C:/Program Files/Git/app)
if (isProduction && /^[A-Z]:/i.test(databasePath)) {
  console.error(`[CRITICAL] DATABASE_PATH contains Windows path in production: "${databasePath}"`);
  console.error('[CRITICAL] Falling back to /app/data/database.sqlite \u2014 fix the DATABASE_PATH env var!');
  databasePath = '/app/data/database.sqlite';
}

// Resolve to absolute path
databasePath = path.resolve(databasePath);

const config = {
  env: process.env.NODE_ENV || 'development',
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  databasePath,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  pineconeApiKey: process.env.PINECONE_API_KEY || '',
  pineconeIndexHost: process.env.PINECONE_INDEX_HOST || '',
  pineconeNamespace: process.env.PINECONE_NAMESPACE || 'quotes',
  // Auth configuration
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  resendApiKey: process.env.RESEND_API_KEY || '',
  appUrl: process.env.APP_URL || `http://localhost:${parseInt(process.env.PORT || '3000', 10)}`,
  adminEmail: process.env.ADMIN_EMAIL || 'jakob@karlsmark.com',
};

export default config;
