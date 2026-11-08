const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
// Also fallback to backend/.env if present
require('dotenv').config();

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/job_outreach',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/gmail/callback',
  GMAIL_SENDER_NAME: process.env.GMAIL_SENDER_NAME || '',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'default_secret_key_32_bytes_long!!', // Must be 32 bytes for aes-256-gcm
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:5000',
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads/resumes'),
  DAILY_SENDING_LIMIT: parseInt(process.env.DAILY_SENDING_LIMIT, 10) || 50,
  TIMEZONE: process.env.TIMEZONE || 'Asia/Kolkata',
};

