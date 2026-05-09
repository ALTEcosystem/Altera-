require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { createServer } = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');

const db = require('./db/database');

const authRoutes = require('./routes/auth');
const feedRoutes = require('./routes/feed');
const postRoutes = require('./routes/posts');
const profileRoutes = require('./routes/profiles');
const followRoutes = require('./routes/follows');
const notificationRoutes = require('./routes/notifications');
const exploreRoutes = require('./routes/explore');
const blockchainRoutes = require('./routes/blockchain');
const messageRoutes = require('./routes/messages');
const storyRoutes = require('./routes/stories');
const aiRoutes = require('./routes/ai');
const { setupSocketIO } = require('./socket/realtime');
const { runAIPostWorker } = require('./services/ai_generator');

const app = express();
const httpServer = createServer(app);
app.set('trust proxy', 1);
const io = new Server(httpServer, {
  maxHttpBufferSize: 1e8, // 100 MB
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: false,
  },
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(morgan('dev'));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false,
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Rate limiting - Increased for stability
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 2000, // Increased from 200
  message: { message: 'Too many requests, please try again later.' },
});
app.use(limiter);

// Strict rate limit for auth - Increased
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // Increased from 20
  message: { message: 'Too many auth attempts, please try again later.' },
});

// Attach io to req
app.use((req, _, next) => { 
  req.io = io;
  req.db = db;
  next(); 
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/auth', authLimiter, authRoutes);
app.use('/feed', feedRoutes);
app.use('/posts', postRoutes);
app.use('/profiles', profileRoutes);
app.use('/follows', followRoutes);
app.use('/notifications', notificationRoutes);
app.use('/explore', exploreRoutes);
app.use('/blockchain', blockchainRoutes);
app.use('/messages', messageRoutes);
app.use('/stories', storyRoutes);
app.use('/ai', aiRoutes);
app.use('/uploads', express.static('public/uploads'));

// Health check
app.get('/health', (_, res) => res.json({
  status: 'ok',
  service: 'ALTERA Node.js API',
  version: '1.0.0',
  timestamp: new Date().toISOString(),
}));

// 404
app.use((req, res) => res.status(404).json({ message: `Route ${req.path} not found` }));

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.stack);
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Process-wide error handling (Prevent crashes from unhandled promises)
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  // Optional: Graceful shutdown if needed
  // process.exit(1);
});

// ─── Socket.IO ───────────────────────────────────────────────────────────────
setupSocketIO(io);

// ─── Scheduled Posts Cron (M15-FE-2) ─────────────────────────────────────────
// Runs every 60 seconds — publishes posts whose scheduled_at has passed
setInterval(async () => {
  try {
    const result = await db.query(
      `UPDATE posts 
       SET status = 'published', approved_at = CURRENT_TIMESTAMP 
       WHERE status = 'scheduled' AND scheduled_at <= NOW() AND deleted_at IS NULL
       RETURNING id, user_id`
    );
    if (result.rowCount > 0) {
      console.log(`[CRON] Published ${result.rowCount} scheduled post(s)`);
    }
  } catch (err) {
    console.error('[CRON] Scheduled post error:', err.message);
  }
}, 60000);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Initialize database and start server
(async () => {
  try {
    await db.initialize();
    
    httpServer.listen(PORT, HOST, () => {
      console.log(`\n🚀 ALTERA API running on http://${HOST}:${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      const dbUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
      console.log(`   Database: ${dbUrl ? dbUrl.host : 'NeonDB'} (NeonDB)`);
      console.log(`   Health:      http://${HOST}:${PORT}/health\n`);
      
      // Start AI Worker (Non-blocking)
      runAIPostWorker().catch(err => {
        console.error('[AI WORKER ERROR] Initial run failed:', err.message);
      });
    });
    
    // Sane timeouts (Standard Express/Node defaults are usually better)
    httpServer.headersTimeout = 65000;
    httpServer.keepAliveTimeout = 61000;
  } catch (err) {
    console.error('[STARTUP ERROR]', err);
    process.exit(1);
  }
})();

module.exports = { app, io };
