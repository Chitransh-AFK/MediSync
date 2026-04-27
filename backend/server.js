// ============================================================
//  server.js — Smart Medicine Dispenser API Server
// ============================================================
'use strict';

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');

const scheduleRoutes = require('./routes/schedule');
const statusRoutes   = require('./routes/status');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Middleware ──────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Serve the Nurse Dashboard (static frontend) ────────────
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── API Routes ─────────────────────────────────────────────
app.use('/api/schedules', scheduleRoutes);
app.use('/api/status',    statusRoutes);

// ─── Health Check ───────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    service: 'Smart Medicine Dispenser API',
    version: '1.0.0',
    time:    new Date().toISOString(),
  });
});

// ─── Catch-all → serving frontend SPA ───────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ─── Global error handler ───────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ─── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Smart Medicine Dispenser API Server    ║');
  console.log(`║   Running at http://localhost:${PORT}       ║`);
  console.log('║   Dashboard: http://localhost:3000       ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
});
