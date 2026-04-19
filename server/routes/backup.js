import express from 'express';
import multer from 'multer';
import mysql from 'mysql2/promise';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/** Admin-only guard */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/** Safely escape a value for SQL INSERT */
function escapeValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Date) {
    return `'${v.toISOString().replace('T', ' ').slice(0, 19)}'`;
  }
  if (Buffer.isBuffer(v)) {
    return v.length === 0 ? "''" : `0x${v.toString('hex')}`;
  }
  // string — escape backslashes, single-quotes, NULs, newlines
  return `'${String(v)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')}'`;
}

/** Generate a complete SQL dump and stream it into res */
async function streamSqlDump(pool, res) {
  const dbName = process.env.DB_NAME || 'gcash_pos';
  const conn = await pool.getConnection();
  try {
    const dateStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    res.write(`-- BizTracker Database Backup\n`);
    res.write(`-- Generated: ${dateStr}\n`);
    res.write(`-- Database: ${dbName}\n`);
    res.write(`-- Publisher: Cebu DigiBox\n\n`);
    res.write(`SET NAMES utf8mb4;\n`);
    res.write(`SET FOREIGN_KEY_CHECKS = 0;\n`);
    res.write(`SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';\n\n`);

    const [tables] = await conn.query(`SHOW TABLES FROM \`${dbName}\``);
    const tableKey = Object.keys(tables[0] || {})[0];

    for (const tableRow of tables) {
      const tableName = tableRow[tableKey];

      // DDL
      const [[createRow]] = await conn.query(`SHOW CREATE TABLE \`${tableName}\``);
      const createSql = createRow['Create Table'] || createRow['Create View'];
      res.write(`\n-- --------------------------------------------------------\n`);
      res.write(`-- Table: \`${tableName}\`\n`);
      res.write(`-- --------------------------------------------------------\n`);
      res.write(`DROP TABLE IF EXISTS \`${tableName}\`;\n`);
      res.write(`${createSql};\n\n`);

      // Data — fetch in batches of 500 rows to avoid memory pressure
      const BATCH = 500;
      let offset = 0;
      let firstBatch = true;
      while (true) {
        const [rows] = await conn.query(
          `SELECT * FROM \`${tableName}\` LIMIT ${BATCH} OFFSET ${offset}`
        );
        if (rows.length === 0) break;

        if (firstBatch) {
          const cols = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
          res.write(`INSERT INTO \`${tableName}\` (${cols}) VALUES\n`);
          firstBatch = false;
        }

        const valueLines = rows.map(row =>
          `(${Object.values(row).map(escapeValue).join(', ')})`
        );

        // Close previous batch's INSERT if continuing
        if (offset > 0) {
          res.write(`;\n`);
          const cols = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
          res.write(`INSERT INTO \`${tableName}\` (${cols}) VALUES\n`);
        }

        res.write(valueLines.join(',\n') + '\n');
        offset += rows.length;
        if (rows.length < BATCH) break;
      }

      if (!firstBatch) {
        res.write(`;\n`);
      }
    }

    res.write(`\nSET FOREIGN_KEY_CHECKS = 1;\n`);
    res.write(`\n-- End of backup\n`);
  } finally {
    conn.release();
  }
}

// ── Download backup ──────────────────────────────────────────────────────────
router.get('/download', requireAuth, requireAdmin, async (_req, res) => {
  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="biztracker-backup-${dateStr}.sql"`
  );

  try {
    await streamSqlDump(pool, res);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: `Backup failed: ${err.message}` });
    } else {
      res.write(`\n-- ERROR during backup: ${err.message}\n`);
      res.end();
    }
  }
});

// ── Restore from SQL file ────────────────────────────────────────────────────
const restoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith('.sql') || file.mimetype === 'application/octet-stream' || file.mimetype === 'text/plain') {
      cb(null, true);
    } else {
      cb(new Error('Only .sql files are accepted'));
    }
  },
});

router.post('/restore', requireAuth, requireAdmin, restoreUpload.single('backup'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No .sql file uploaded' });
  }

  const sql = req.file.buffer.toString('utf8');

  if (!sql.trim()) {
    return res.status(400).json({ error: 'Uploaded file is empty' });
  }

  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3307),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'gcash_pos',
      multipleStatements: true,
    });

    await conn.query(sql);
    res.json({ success: true, message: 'Database restored successfully. Please reload the app.' });
  } catch (err) {
    res.status(500).json({ error: `Restore failed: ${err.message}` });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
});

// ── Backup info (data paths) ─────────────────────────────────────────────────
router.get('/info', requireAuth, requireAdmin, async (_req, res) => {
  const dbName = process.env.DB_NAME || 'gcash_pos';
  try {
    const [[{ tableCount }]] = await pool.query(
      `SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema = ?`,
      [dbName]
    );
    res.json({
      dbName,
      dbHost: process.env.DB_HOST || '127.0.0.1',
      dbPort: process.env.DB_PORT || '3307',
      tableCount: Number(tableCount),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
