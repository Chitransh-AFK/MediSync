// ============================================================
//  routes/schedule.js — Medicine Schedule CRUD
// ============================================================
'use strict';

const express   = require('express');
const { body, query, param, validationResult } = require('express-validator');
const db        = require('../db');
const router    = express.Router();

// ─── Helper: send validation errors ─────────────────────────
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, errors: errors.array() });
    return true;
  }
  return false;
}

// ─── Helper: calculate end_date ─────────────────────────────
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Number(days) - 1);
  return d.toISOString().split('T')[0];
}

// ============================================================
// POST /api/schedules
// Nurse creates a new medicine schedule.
// ============================================================
router.post(
  '/',
  [
    body('bed_id')       .trim().notEmpty().withMessage('bed_id is required'),
    body('medicine_name').trim().notEmpty().withMessage('medicine_name is required'),
    body('compartment')  .isInt({ min: 1, max: 2 }).withMessage('compartment must be 1 or 2'),
    body('dose_time')    .matches(/^\d{2}:\d{2}$/).withMessage('dose_time must be HH:MM'),
    body('start_date')   .isDate().withMessage('start_date must be YYYY-MM-DD'),
    body('duration_days').isInt({ min: 1, max: 365 }).withMessage('duration_days must be 1–365'),
  ],
  async (req, res) => {
    if (validate(req, res)) return;

    const { bed_id, medicine_name, compartment, dose_time, start_date, duration_days } = req.body;
    const end_date = addDays(start_date, duration_days);

    try {
      // Ensure bed exists — auto-create if not (demo convenience)
      await db.execute(
        'INSERT IGNORE INTO beds (bed_id) VALUES (?)',
        [bed_id]
      );

      const [result] = await db.execute(
        `INSERT INTO schedules
           (bed_id, medicine_name, compartment, dose_time, start_date, duration_days, end_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [bed_id, medicine_name, compartment, dose_time + ':00', start_date, duration_days, end_date]
      );

      const [rows] = await db.execute(
        'SELECT * FROM schedules WHERE id = ?',
        [result.insertId]
      );

      res.status(201).json({ success: true, schedule: rows[0] });
    } catch (err) {
      console.error('POST /schedules error:', err);
      res.status(500).json({ success: false, message: 'Database error', detail: err.message });
    }
  }
);

// ============================================================
// GET /api/schedules
// Dashboard: all schedules with optional filters.
// Query params: bed_id, status, date (YYYY-MM-DD)
// ============================================================
router.get(
  '/',
  [
    query('bed_id') .optional().trim(),
    query('status') .optional().isIn(['PENDING','DISPENSED','TAKEN','NOT_TAKEN']),
    query('date')   .optional().isDate(),
  ],
  async (req, res) => {
    if (validate(req, res)) return;

    const { bed_id, status, date } = req.query;
    let sql   = 'SELECT * FROM schedules WHERE 1=1';
    const params = [];

    if (bed_id) { sql += ' AND bed_id = ?';  params.push(bed_id); }
    if (status) { sql += ' AND status = ?';  params.push(status); }
    if (date)   { sql += ' AND start_date <= ? AND end_date >= ?'; params.push(date, date); }

    sql += ' ORDER BY dose_time ASC, created_at DESC';

    try {
      const [rows] = await db.execute(sql, params);
      res.json({ success: true, schedules: rows });
    } catch (err) {
      console.error('GET /schedules error:', err);
      res.status(500).json({ success: false, message: 'Database error' });
    }
  }
);

// ============================================================
// GET /api/schedules/beds
// Returns all registered beds (for dropdown in UI).
// ============================================================
router.get('/beds', async (_req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM beds ORDER BY bed_id ASC');
    res.json({ success: true, beds: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ============================================================
// GET /api/schedules/device/:bedId
// ESP8266 fetches today's PENDING schedules for its bed.
// ============================================================
router.get(
  '/device/:bedId',
  [param('bedId').trim().notEmpty()],
  async (req, res) => {
    if (validate(req, res)) return;

    const { bedId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    try {
      const [rows] = await db.execute(
        `SELECT id, medicine_name, compartment, dose_time, status
         FROM schedules
         WHERE bed_id = ?
           AND start_date <= ?
           AND end_date   >= ?
           AND status = 'PENDING'
         ORDER BY dose_time ASC`,
        [bedId, today, today]
      );

      res.json({ success: true, bed_id: bedId, schedules: rows });
    } catch (err) {
      console.error('GET /schedules/device error:', err);
      res.status(500).json({ success: false, message: 'Database error' });
    }
  }
);

// ============================================================
// DELETE /api/schedules/:id
// Nurse removes a schedule.
// ============================================================
router.delete(
  '/:id',
  [param('id').isInt({ min: 1 })],
  async (req, res) => {
    if (validate(req, res)) return;

    try {
      const [result] = await db.execute(
        'DELETE FROM schedules WHERE id = ?',
        [req.params.id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: 'Schedule not found' });
      }
      res.json({ success: true, message: 'Schedule deleted' });
    } catch (err) {
      console.error('DELETE /schedules error:', err);
      res.status(500).json({ success: false, message: 'Database error' });
    }
  }
);

module.exports = router;
