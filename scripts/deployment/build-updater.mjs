/**
 * build-updater.mjs
 *
 * Produces a lightweight update bundle for devices that already have BizTracker
 * installed. Unlike the full installer, this bundle omits vendor runtimes (Node,
 * MariaDB) so the ZIP stays small (~5–15 MB instead of ~150 MB+).
 *
 * Output:
 *   release/updater/biztracker-update-vX.Y.Z-YYYYMMDD-HHMM.zip
 *
 * Bundle contents:
 *   dist/                  — built frontend assets
 *   server/                — server code + production node_modules
 *   install-db.ps1         — schema migration runner
 *   uninstall-db.ps1
 *   launch-app.ps1 / .vbs / .cmd
 *   run-api.cmd
 *   update-installed.ps1   — the update runner called by the end-user
 *   update-installed.cmd   — double-click launcher (requests UAC)
 *   HOW-TO-UPDATE.txt      — human instructions
 *
 * Usage:
 *   npm run deploy:updater
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { copyDir, ensureDir, removeDir, run } from './utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const serverDir   = path.join(projectRoot, 'server');
const windowsDir  = path.join(projectRoot, 'deploy', 'windows');
const releaseDir  = path.join(projectRoot, 'release', 'updater');

const DEPLOY_SCRIPTS = [
  'install-db.ps1',
  'uninstall-db.ps1',
  'launch-app.ps1',
  'launch-app.vbs',
  'launch-app.cmd',
  'run-api.cmd',
  'update-installed.ps1',
  'update-installed.cmd',
];

function makeTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  );
}

function readPackageVersion() {
  const pkgPath = path.join(projectRoot, 'package.json');
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function runPowerShell(command) {
  const shells = process.platform === 'win32'
    ? ['powershell.exe', 'pwsh.exe']
    : ['pwsh', 'powershell'];

  for (const shell of shells) {
    const result = spawnSync(
      shell,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { stdio: 'inherit', shell: false }
    );
    if (!result.error && result.status === 0) return;
  }
  throw new Error('PowerShell was not found. Cannot create ZIP archive.');
}

async function zipDirectory(sourceDir, zipPath) {
  if (fs.existsSync(zipPath)) {
    await fs.promises.rm(zipPath, { force: true });
  }
  await ensureDir(path.dirname(zipPath));
  const src = sourceDir.replace(/'/g, "''");
  const dst = zipPath.replace(/'/g, "''");
  runPowerShell(`Compress-Archive -Path '${src}\\*' -DestinationPath '${dst}' -Force`);
}

async function writeUpdateGuide(targetDir, version) {
  const content = [
    `BizTracker Update Bundle — v${version}`,
    '',
    'HOW TO INSTALL THIS UPDATE',
    '──────────────────────────',
    '1. Extract this ZIP to any folder on the target device.',
    '2. Right-click  update-installed.cmd  and choose',
    '   "Run as administrator".',
    '3. Approve the UAC prompt when asked.',
    '4. Wait for the update to finish. The app will restart automatically.',
    '',
    'WHAT THIS UPDATE DOES',
    '─────────────────────',
    '• Replaces the app frontend (dist/) and server (server/).',
    '• Applies any new database schema changes.',
    '• Refreshes desktop and Start Menu shortcuts.',
    '• Does NOT touch your database data or config files.',
    '',
    'ROLLBACK',
    '────────',
    'If something goes wrong, re-run the previous updater bundle.',
    'Database data is never modified by the updater.',
    '',
    `Built: ${new Date().toISOString()}`,
  ].join('\r\n');

  await fs.promises.writeFile(path.join(targetDir, 'HOW-TO-UPDATE.txt'), content, 'utf8');
}

async function writeVersionFile(targetDir, version) {
  const content = JSON.stringify(
    { version, built_at: new Date().toISOString() },
    null,
    2
  );
  await fs.promises.writeFile(path.join(targetDir, 'version.json'), content, 'utf8');
}

async function pruneOldBundles(dir, keepZipPath) {
  const keepAbs = path.resolve(keepZipPath);
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.resolve(dir, entry.name);
    if (full === keepAbs) continue;
    if (/^biztracker-update-.*\.zip$/.test(entry.name)) {
      try {
        await fs.promises.rm(full, { force: true });
        console.log(`Removed old bundle: ${entry.name}`);
      } catch {
        console.warn(`Could not remove old bundle: ${entry.name}`);
      }
    }
  }
}

async function main() {
  const version   = readPackageVersion();
  const timestamp = makeTimestamp();
  const stageDir  = path.join(releaseDir, 'stage');
  const zipName   = `biztracker-update-v${version}-${timestamp}.zip`;
  const zipPath   = path.join(releaseDir, zipName);

  console.log(`\nBizTracker Updater Builder`);
  console.log(`  version   : ${version}`);
  console.log(`  output    : ${zipPath}\n`);

  // 1 ── Build frontend
  console.log('==> Building frontend...');
  run('npm', ['run', 'build'], {
    cwd: projectRoot,
    env: { ...process.env, VITE_API_URL: '' },
  });

  // 2 ── Install server production dependencies
  console.log('==> Installing server dependencies...');
  run('npm', ['install', '--omit=dev'], { cwd: serverDir });

  // 3 ── Stage the bundle
  console.log('==> Staging update bundle...');
  await removeDir(stageDir);
  await ensureDir(stageDir);

  await copyDir(path.join(projectRoot, 'dist'), path.join(stageDir, 'dist'));
  await copyDir(serverDir, path.join(stageDir, 'server'), {
    filter: (srcPath, entry) => {
      // Skip dev-only dirs that shouldn't be deployed
      if (entry.isDirectory() && entry.name === '.cache') return false;
      return true;
    },
  });

  for (const file of DEPLOY_SCRIPTS) {
    const src = path.join(windowsDir, file);
    if (fs.existsSync(src)) {
      await fs.promises.copyFile(src, path.join(stageDir, file));
    } else {
      console.warn(`  Warning: deploy script not found, skipped: ${file}`);
    }
  }

  // Copy README if present
  const readmeSrc = path.join(projectRoot, 'README.md');
  if (fs.existsSync(readmeSrc)) {
    await fs.promises.copyFile(readmeSrc, path.join(stageDir, 'README.md'));
  }

  await writeUpdateGuide(stageDir, version);
  await writeVersionFile(stageDir, version);

  // 4 ── ZIP the bundle
  console.log(`==> Creating ${zipName}...`);
  await ensureDir(releaseDir);
  await zipDirectory(stageDir, zipPath);

  // 5 ── Clean up staging dir and old ZIPs
  await removeDir(stageDir);
  await pruneOldBundles(releaseDir, zipPath);

  const stats = fs.statSync(zipPath);
  const sizeMb = (stats.size / 1024 / 1024).toFixed(1);

  console.log(`\n✓ Updater bundle ready (${sizeMb} MB)`);
  console.log(`  ${zipPath}`);
  console.log(`\nDistribute this ZIP to target devices.`);
  console.log(`Recipients extract it and run update-installed.cmd as Administrator.\n`);
}

main().catch((err) => {
  console.error(`\nUpdater build failed: ${err.message || err}`);
  process.exit(1);
});
