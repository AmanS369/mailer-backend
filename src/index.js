const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config/env');
const { connectDB } = require('./config/db');
const { getRedisClient } = require('./config/redis');
const { startEmailWorker } = require('./workers/emailWorker');
const { reconcileJobsOnStartup } = require('./services/emailService');
const { syncAllPendingReplies } = require('./services/syncService');

// Route imports
const contactsRoutes = require('./routes/contacts');
const resumesRoutes = require('./routes/resumes');
const emailsRoutes = require('./routes/emails');
const gmailRoutes = require('./routes/gmail');
const repliesRoutes = require('./routes/replies');
const dashboardRoutes = require('./routes/dashboard');
const activityRoutes = require('./routes/activity');
const settingsRoutes = require('./routes/settings');

const app = express();

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health Check
app.get('/health', async (req, res) => {
  let redisStatus = 'disconnected';
  try {
    const client = getRedisClient();
    const ping = await client.ping();
    if (ping === 'PONG') redisStatus = 'connected';
  } catch (err) {
    redisStatus = 'error';
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    redis: redisStatus,
  });
});

// Register API Routes
app.use('/api/contacts', contactsRoutes);
app.use('/api/resumes', resumesRoutes);
app.use('/api/emails', emailsRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/replies', repliesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/settings', settingsRoutes);

// Central Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('[Error Handler]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
  });
});

// Recurring reply synchronization (runs every 3 minutes, protected by single-instance distributed lock)
let syncInterval = null;
function startRecurringSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(async () => {
    try {
      await syncAllPendingReplies();
    } catch (err) {
      console.error('[RecurringSync] Error:', err.message);
    }
  }, 3 * 60 * 1000); // 3 minutes
  console.log('[Sync] Recurring Gmail reply synchronization initialized (every 3 mins).');
}

// Start Server
async function startServer() {
  try {
    // 1. Connect MongoDB
    await connectDB();

    // 2. Initialize Redis client
    getRedisClient();

    // 3. Start BullMQ consumer inside this backend process
    startEmailWorker();

    // 4. Start HTTP Server immediately
    const server = app.listen(config.PORT, () => {
      console.log(`===============================================`);
      console.log(`🚀 Antigravity Mailer Backend running on port ${config.PORT}`);
      console.log(`📡 Environment: ${config.NODE_ENV}`);
      console.log(`🔗 API Base: ${config.API_BASE_URL}`);
      console.log(`===============================================`);
    });

    // 5. Reconcile pending jobs after startup
    await reconcileJobsOnStartup();

    // 6. Start background reply sync
    startRecurringSync();

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
      if (syncInterval) clearInterval(syncInterval);
      server.close(() => {
        console.log('[Server] HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('Fatal initialization error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };

