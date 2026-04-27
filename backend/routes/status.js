// ============================================================
//  routes/status.js — ESP8266 Status Updates & Alert Logging
// ============================================================
'use strict';

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const db      = require('../db');
const router  = express.Router();

// In-memory NOT_TAKEN alert store (for dashboard polling; no auth needed)
const recentAlerts = [];
const MAX_ALERTS   = 50;

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, errors: errors.array() });
    return true;
  }
  return false;
}

// ============================================================
// POST /api/status/update
// ESP sends a status update: DISPENSED | TAKEN | NOT_TAKEN
//
// Body: {
//   deviceId    : "BED-01",
//   scheduleId  : 5,           ← optional if medicine/compartment given
//   medicine    : "Paracetamol",
//   compartment : 1,
//   status      : "DISPENSED",
//   timestamp   : "2024-04-25T04:30:00Z"  ← optional, defaults to NOW()
// }
// ============================================================
router.post(
  '/update',
  [
    body('deviceId')   .trim().notEmpty().withMessage('deviceId is required'),
    body('status')     .isIn(['DISPENSED','TAKEN','NOT_TAKEN']).withMessage('status must be DISPENSED | TAKEN | NOT_TAKEN'),
    body('compartment').isInt({ min: 1, max: 2 }).withMessage('compartment must be 1 or 2'),
    body('medicine')   .trim().notEmpty().withMessage('medicine is required'),
  ],
  async (req, res) => {
    if (validate(req, res)) return;

    const { deviceId, scheduleId, medicine, compartment, status, timestamp } = req.body;
    const ts = timestamp ? new Date(timestamp) : new Date();

    try {
      // ── 1. Resolve schedule ID if not provided ───────────────
      let resolvedId = scheduleId;
      if (!resolvedId) {
        const today = ts.toISOString().split('T')[0];
        const [rows] = await db.execute(
          `SELECT id FROM schedules
           WHERE bed_id       = ?
             AND compartment  = ?
             AND start_date  <= ?
             AND end_date    >= ?
           ORDER BY ABS(TIMEDIFF(dose_time, ?)) ASC
           LIMIT 1`,
          [deviceId, compartment, today, today, ts.toTimeString().slice(0, 8)]
        );
        if (rows.length > 0) resolvedId = rows[0].id;
      }

      // ── 2. Update schedules table ────────────────────────────
      if (resolvedId) {
        await db.execute(
          'UPDATE schedules SET status = ?, updated_at = ? WHERE id = ?',
          [status, ts, resolvedId]
        );
      }

      // ── 2.5. Auto-mark previously DISPENSED meds as TAKEN ────
      if (status === 'TAKEN') {
        const today = ts.toISOString().split('T')[0];
        const [dispensedRows] = await db.execute(
          `SELECT id, medicine_name as medicine, compartment FROM schedules
           WHERE bed_id = ? AND status = 'DISPENSED' AND start_date <= ? AND end_date >= ?`,
          [deviceId, today, today]
        );

        if (dispensedRows.length > 0) {
          await db.execute(
            `UPDATE schedules SET status = 'TAKEN', updated_at = ?
             WHERE bed_id = ? AND status = 'DISPENSED' AND start_date <= ? AND end_date >= ?`,
            [ts, deviceId, today, today]
          );

          for (let row of dispensedRows) {
            console.log(`📡  Auto-Marked [TAKEN] — Bed: ${deviceId}, Medicine: ${row.medicine} (was DISPENSED)`);
            await db.execute(
              `INSERT INTO logs (schedule_id, bed_id, medicine, compartment, event_status, device_id, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [row.id, deviceId, row.medicine, row.compartment, 'TAKEN', deviceId, ts]
            );
          }
        }
      }

      // ── 3. Insert into logs ──────────────────────────────────
      if (resolvedId) {
        await db.execute(
          `INSERT INTO logs (schedule_id, bed_id, medicine, compartment, event_status, device_id, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [resolvedId, deviceId, medicine, compartment, status, deviceId, ts]
        );
      }

      // ── 4. Push to in-memory alert store if NOT_TAKEN ─────────
      if (status === 'NOT_TAKEN') {
        const alert = {
          id:          Date.now(),
          bed_id:      deviceId,
          medicine,
          compartment,
          timestamp:   ts.toISOString(),
          schedule_id: resolvedId || null,
        };
        recentAlerts.unshift(alert);
        if (recentAlerts.length > MAX_ALERTS) recentAlerts.pop();
        console.warn(`🚨  NOT_TAKEN alert — Bed: ${deviceId}, Medicine: ${medicine}`);
      }

      console.log(`📡  Status [${status}] — Bed: ${deviceId}, Medicine: ${medicine}, Compartment: ${compartment}`);
      res.json({ success: true, status, schedule_id: resolvedId || null });
    } catch (err) {
      console.error('POST /status/update error:', err);
      res.status(500).json({ success: false, message: 'Database error', detail: err.message });
    }
  }
);

// ============================================================
// GET /api/status/alerts
// Dashboard polls this for missed-dose notifications.
// Returns last N NOT_TAKEN alerts since a given timestamp.
// ============================================================
router.get(
  '/alerts',
  [query('since').optional()],
  (req, res) => {
    const { since } = req.query;
    let alerts = recentAlerts;

    if (since) {
      const sinceTs = new Date(since).getTime();
      alerts = alerts.filter(a => new Date(a.timestamp).getTime() > sinceTs);
    }

    res.json({ success: true, alerts });
  }
);

// ============================================================
// GET /api/logs
// Full activity log — filterable by bed_id and date range.
// ============================================================
router.get(
  '/logs',
  [
    query('bed_id').optional().trim(),
    query('from')  .optional().isDate(),
    query('to')    .optional().isDate(),
    query('limit') .optional().isInt({ min: 1, max: 500 }),
  ],
  async (req, res) => {
    if (validate(req, res)) return;

    const { bed_id, from, to, limit } = req.query;
    let sql    = 'SELECT * FROM logs WHERE 1=1';
    const params = [];

    if (bed_id) { sql += ' AND bed_id = ?';   params.push(bed_id); }
    if (from)   { sql += ' AND timestamp >= ?'; params.push(from + ' 00:00:00'); }
    if (to)     { sql += ' AND timestamp <= ?'; params.push(to   + ' 23:59:59'); }

    sql += ' ORDER BY timestamp DESC';

    // ⚠️  MySQL2 bug: LIMIT ? as a prepared-statement param throws ER_WRONG_ARGUMENTS.
    // Safe fix: validate as integer first, then embed directly in the SQL string.
    const limitVal = Math.min(Math.max(parseInt(limit || '100', 10), 1), 500);
    sql += ` LIMIT ${limitVal}`;  // already an integer — safe to interpolate

    try {
      const [rows] = await db.execute(sql, params);
      res.json({ success: true, logs: rows });
    } catch (err) {
      console.error('GET /logs error:', err);
      res.status(500).json({ success: false, message: 'Database error' });
    }
  }
);

module.exports = router;
