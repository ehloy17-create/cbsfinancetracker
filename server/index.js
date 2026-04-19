import './loadEnv.js';

import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import pool from './db.js';

import authRoutes      from './routes/auth.js';
import holdSlipRoutes  from './routes/holdSlip.js';
import profileRoutes   from './routes/profiles.js';
import genericRoutes   from './routes/generic.js';
import rpcRoutes       from './routes/rpc.js';
import backupRoutes    from './routes/backup.js';
import { ensureFinanceMonitoringSchema, ensurePosMultiPricingSchema, ensurePayrollTables, ensureCompanySettings, ensureDbCollation } from './schemaCompat.js';
import { ensureRuntimeReady } from './runtimeSetup.js';
import { frontendDistDir, uploadsDir } from './loadEnv.js';
import { installProcessEventLogging, logEvent } from './lib/eventLogger.js';
import { getServerAccessUrls, isAllowedAppOrigin, normalizeBaseUrl } from './lib/network.js';

const app  = express();
const PORT = Number(process.env.PORT || process.env.API_PORT || 4000);
const HOST = process.env.API_HOST || '0.0.0.0';
const distIndexPath = path.join(frontendDistDir, 'index.html');
const hasFrontendBuild = fs.existsSync(distIndexPath);
const cloudOrigins = [
  process.env.RENDER_EXTERNAL_URL,
  process.env.PUBLIC_URL,
  process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '',
  process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : '',
];
const allowedOrigins = new Set(
  [
    process.env.APP_PUBLIC_BASE_URL,
    process.env.VITE_APP_URL,
    ...cloudOrigins,
    `http://127.0.0.1:${PORT}`,
    `http://localhost:${PORT}`,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
  ].map(normalizeBaseUrl).filter(Boolean)
);

installProcessEventLogging('api');

const AUDIT_LOG_RETENTION_DAYS = 5;

async function purgeExpiredAuditLogs() {
  try {
    const [result] = await pool.query(
      `DELETE FROM \`audit_logs\`
        WHERE \`created_at\` IS NOT NULL
          AND DATE(\`created_at\`) < DATE_SUB(CURDATE(), INTERVAL ${AUDIT_LOG_RETENTION_DAYS} DAY)`
    );

    const deletedCount = Number(result?.affectedRows ?? 0);
    if (deletedCount > 0) {
      await logEvent('api', 'audit.cleanup', {
        deletedCount,
        retentionDays: AUDIT_LOG_RETENTION_DAYS,
      });
    }
  } catch (error) {
    console.error('Audit log cleanup failed:', error.message);
  }
}

app.use(cors({
  origin(origin, callback) {
    const normalizedOrigin = normalizeBaseUrl(origin);
    if (!origin || allowedOrigins.has(normalizedOrigin) || isAllowedAppOrigin(origin, PORT)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req, res) => {
  res.status(204).end();
});

app.post('/events/client', async (req, res) => {
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  await logEvent('frontend', String(payload.event ?? 'client.event'), {
    level: String(payload.level ?? 'info'),
    message: typeof payload.message === 'string' ? payload.message : '',
    details: payload.details ?? null,
    url: typeof payload.url === 'string' ? payload.url : '',
    userAgent: typeof payload.userAgent === 'string' ? payload.userAgent : '',
  });
  res.status(204).end();
});

// ── Logo upload ────────────────────────────────────────────────
// uploadsDir lives in ProgramData (writable) not in dist (read-only in Program Files)
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Serve uploads from the writable data directory
app.use('/uploads', express.static(uploadsDir));

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, _file, cb) => cb(null, 'company-logo.png'),
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpeg|jpg|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

app.post('/upload/logo', (req, res, next) => {
  logoUpload.single('logo')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large. Maximum allowed size is 5 MB.'
        : (err.message || 'Upload failed');
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ url: '/uploads/company-logo.png' });
  });
});

// ── Public company settings (no auth) ─────────────────────────
app.get('/public/company-settings', async (_req, res) => {
  try {
    const [[row]] = await pool.query('SELECT * FROM `company_settings` WHERE id = 1 LIMIT 1');
    res.json(row ?? { company_name: 'My Business', publisher: 'Cebu DigiBox' });
  } catch {
    res.json({ company_name: 'My Business', publisher: 'Cebu DigiBox' });
  }
});

// ── Routes ──────────────────────────────────────────────────
app.use('/auth',        authRoutes);
app.use('/hold-slip',   holdSlipRoutes);
app.use('/profiles',    profileRoutes);
app.use('/rpc',         rpcRoutes);
app.use('/backup',      backupRoutes);

// ── Health check ─────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  ok: true,
  host: HOST,
  port: PORT,
  access: getServerAccessUrls(PORT),
}));

if (hasFrontendBuild) {
  app.use(express.static(frontendDistDir));
  app.get('*', (req, res, next) => {
    const reservedPrefixes = ['/auth', '/hold-slip', '/profiles', '/rpc', '/rest/v1', '/health', '/upload', '/public', '/backup'];
    if (reservedPrefixes.some(prefix => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
      next();
      return;
    }
    res.sendFile(distIndexPath);
  });
}

app.use('/',            genericRoutes);   // handles /rest/v1/:table

async function start() {
  const accessUrls = getServerAccessUrls(PORT);
  await logEvent('api', 'startup.begin', {
    host: HOST,
    port: PORT,
    frontendDistDir,
    hasFrontendBuild,
    accessUrls,
  });
  await ensureRuntimeReady();
  await ensureDbCollation();
  await ensurePosMultiPricingSchema();
  await ensureFinanceMonitoringSchema();
  await ensurePayrollTables();
  await ensureCompanySettings();
  await purgeExpiredAuditLogs();
  setInterval(() => {
    void purgeExpiredAuditLogs();
  }, 60 * 60 * 1000);

  app.listen(PORT, HOST, () => {
    void logEvent('api', 'startup.ready', {
      host: HOST,
      port: PORT,
      frontendDistDir,
      hasFrontendBuild,
      accessUrls,
    });
    console.log(`✅  API server listening on ${HOST}:${PORT}`);
    for (const url of accessUrls.local) {
      console.log(`   Local: ${url}`);
    }
    for (const url of accessUrls.lan) {
      console.log(`   LAN:   ${url}`);
    }
  });
}

start().catch((error) => {
  void logEvent('api', 'startup.failed', { error });
  console.error('Failed to start API server', error);
  process.exit(1);
});
