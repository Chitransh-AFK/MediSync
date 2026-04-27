// ============================================================
//  db.js — MySQL2 Connection Pool
// ============================================================
'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT      || '3306', 10),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASS     || 'mysql123',
  database:           process.env.DB_NAME     || 'medicine_dispenser',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  timezone:           '+00:00',
  dateStrings:        true,     // Return DATE/DATETIME as plain strings, not JS Date objects
});

// Verify connection on startup
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅  MySQL connected successfully');
    conn.release();
  } catch (err) {
    console.error('❌  MySQL connection failed:', err.message);
    process.exit(1);
  }
})();

module.exports = pool;
