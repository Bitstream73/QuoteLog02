import 'dotenv/config';
import crypto from 'crypto';

const config = {
  env: process.env.NODE_ENV || 'development',
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  databasePath: process.env.DATABASE_PATH || './data/database.sqlite',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  pineconeApiKey: process.env.PINECONE_API_KEY || '',
  pineconeIndexHost: process.env.PINECONE_INDEX_HOST || '',
  // Auth configuration
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  resendApiKey: process.env.RESEND_API_KEY || '',
  appUrl: process.env.APP_URL || `http://localhost:${parseInt(process.env.PORT || '3000', 10)}`,
  adminEmail: process.env.ADMIN_EMAIL || 'jakob@karlsmark.com',
};

export default config;
