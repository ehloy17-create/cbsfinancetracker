import './loadEnv.js';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'gcash_pos',
  waitForConnections: true,
  connectionLimit:    20,
  queueLimit:         0,
  timezone: '+00:00',
  dateStrings: false,
});

// Force utf8mb4_unicode_ci on every new physical connection.
// MariaDB 10.6+ defaults to utf8mb4_uca1400_ai_ci which causes
// "Illegal mix of collations" errors when comparing against columns
// that were created with utf8mb4_unicode_ci.
pool.on('connection', (conn) => {
  conn.query("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'");
});

export default pool;
