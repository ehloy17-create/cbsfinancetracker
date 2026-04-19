import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { copyDir, ensureDir, removeDir, run } from './utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const releaseRoot = path.join(projectRoot, 'release', 'windows-installer');
const stageRoot = path.join(releaseRoot, 'app');
const updaterRoot = path.join(releaseRoot, 'updater');
const appZipPath = path.join(releaseRoot, 'app.zip');
const updaterZipPath = path.join(releaseRoot, 'biztracker-updater-bundle.zip');
const vendorRoot = path.join(projectRoot, 'deploy', 'vendor');
const nodeRuntimeDir = path.join(vendorRoot, 'node-runtime');
const mariadbRuntimeDir = path.join(vendorRoot, 'mariadb-runtime');
const serverDir = path.join(projectRoot, 'server');

function assertExists(filePath, message) {
  if (!fs.existsSync(filePath)) {
    throw new Error(message);
  }
}

function runPowerShell(command) {
  const candidates = process.platform === 'win32'
    ? ['powershell.exe', 'pwsh.exe']
    : ['pwsh', 'powershell'];

  for (const shell of candidates) {
    const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      stdio: 'inherit',
      shell: false,
    });

    if (!result.error && result.status === 0) {
      return;
    }
  }

  throw new Error('Unable to create deployment ZIP archive. PowerShell was not available.');
}

async function zipDirectory(sourceDir, zipPath) {
  if (fs.existsSync(zipPath)) {
    await fs.promises.rm(zipPath, { force: true });
  }

  await ensureDir(path.dirname(zipPath));
  const normalizedSource = sourceDir.replace(/'/g, "''");
  const normalizedZip = zipPath.replace(/'/g, "''");
  runPowerShell(`Compress-Archive -Path '${normalizedSource}\\*' -DestinationPath '${normalizedZip}' -Force`);
}

async function cleanupReleaseArtifacts(releaseDir, preservePaths = []) {
  const keep = new Set(preservePaths.map((item) => path.resolve(item)));
  const entries = await fs.promises.readdir(releaseDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.resolve(releaseDir, entry.name);
    if (keep.has(fullPath)) continue;

    const isUpdaterFolder = /^updater(?:-\d{8}-\d{4})?$/.test(entry.name);
    const isUpdaterZip = /^biztracker-updater-bundle(?:-\d{8}-\d{4})?\.zip$/.test(entry.name);
    const isOldAppStage = /^app-\d{8}-\d{4}$/.test(entry.name);

    if (!isUpdaterFolder && !isUpdaterZip && !isOldAppStage) continue;

    try {
      await fs.promises.rm(fullPath, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Skipping locked cleanup target: ${fullPath}`);
    }
  }
}

async function writeUpdaterGuide(targetDir) {
  const guidePath = path.join(targetDir, 'HOW-TO-UPDATE.txt');
  const content = [
    'BizTracker Existing Device Update',
    '',
    '1. Extract this updater bundle.',
    '2. Right-click update-installed.cmd and run as Administrator.',
    '3. Wait for the update to finish.',
    '',
    'Your existing database and settings in ProgramData\\BizTracker are preserved.',
  ].join('\r\n');

  await fs.promises.writeFile(guidePath, content, 'utf8');
}

function makeTimestampLabel() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}`;
}

async function main() {
  assertExists(
    path.join(nodeRuntimeDir, 'node.exe'),
    'Portable Node runtime not found. Extract a Windows Node runtime to deploy\\vendor\\node-runtime before staging.'
  );
  assertExists(
    path.join(mariadbRuntimeDir, 'bin', 'mariadb-install-db.exe'),
    'Portable MariaDB runtime not found. Extract a MariaDB Windows ZIP package to deploy\\vendor\\mariadb-runtime before staging.'
  );

  run('npm', ['run', 'build'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      VITE_API_URL: '',
    },
  });

  if (!fs.existsSync(path.join(serverDir, 'node_modules'))) {
    run('npm', ['install', '--omit=dev'], { cwd: serverDir });
  }

  let resolvedStageRoot = stageRoot;
  let resolvedUpdaterRoot = updaterRoot;

  try {
    await removeDir(stageRoot);
    await removeDir(updaterRoot);
    await ensureDir(stageRoot);
  } catch (error) {
    if (error?.code !== 'EPERM') {
      throw error;
    }

    const stamp = makeTimestampLabel();
    resolvedStageRoot = path.join(releaseRoot, `app-${stamp}`);
    resolvedUpdaterRoot = path.join(releaseRoot, `updater-${stamp}`);

    console.warn(`Primary staging folder is locked. Using timestamped fallback: ${resolvedStageRoot}`);
    await removeDir(resolvedStageRoot);
    await removeDir(resolvedUpdaterRoot);
    await ensureDir(resolvedStageRoot);
  }

  await copyDir(path.join(projectRoot, 'dist'), path.join(resolvedStageRoot, 'dist'));
  await copyDir(serverDir, path.join(resolvedStageRoot, 'server'));
  await copyDir(nodeRuntimeDir, path.join(resolvedStageRoot, 'vendor', 'node'));
  await copyDir(mariadbRuntimeDir, path.join(resolvedStageRoot, 'vendor', 'mariadb'));
  await copyDir(path.join(projectRoot, 'deploy', 'windows'), resolvedStageRoot);

  await ensureDir(resolvedStageRoot);
  await fs.promises.copyFile(path.join(projectRoot, 'README.md'), path.join(resolvedStageRoot, 'README.md'));

  await copyDir(resolvedStageRoot, resolvedUpdaterRoot);
  await writeUpdaterGuide(resolvedUpdaterRoot);
  await zipDirectory(resolvedStageRoot, appZipPath);
  await zipDirectory(resolvedUpdaterRoot, updaterZipPath);
  await cleanupReleaseArtifacts(releaseRoot, [resolvedStageRoot, stageRoot, appZipPath, updaterZipPath]);

  console.log(`Windows installer staging complete: ${resolvedStageRoot}`);
  console.log(`Updater bundle refreshed: ${updaterZipPath}`);
  console.log(`Only the latest updater ZIP is retained in the release folder.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
