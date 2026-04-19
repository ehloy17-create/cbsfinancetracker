import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ensureDir, run } from './utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const releaseRoot = path.join(projectRoot, 'release', 'windows-installer');
const outputDir = path.join(projectRoot, 'release', 'installer');

function resolveStageRoot() {
  const candidates = fs.readdirSync(releaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^app(?:-\d{8}-\d{4})?$/.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(releaseRoot, entry.name);
      const stats = fs.statSync(fullPath);
      return { fullPath, mtimeMs: stats.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.fullPath ?? path.join(releaseRoot, 'app');
}

function resolveIscc() {
  const whereResult = spawnSync('where', ['ISCC.exe'], { encoding: 'utf8', shell: true });
  if (whereResult.status === 0) {
    const candidate = whereResult.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean);
    if (candidate) return candidate;
  }

  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Inno Setup 6', 'ISCC.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Inno Setup 6', 'ISCC.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

async function main() {
  const stageRoot = resolveStageRoot();
  if (!fs.existsSync(stageRoot)) {
    throw new Error('Installer staging folder is missing. Run npm run deploy:stage first.');
  }

  console.log(`Using staged app payload: ${stageRoot}`);

  const iscc = resolveIscc();
  if (!iscc) {
    throw new Error('Inno Setup compiler (ISCC.exe) was not found. Install Inno Setup 6, then rerun npm run deploy:installer.');
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  await ensureDir(outputDir);

  run(iscc, [
    `/DStageDir=${stageRoot}`,
    `/DOutputDir=${outputDir}`,
    `/DAppVersion=${pkg.version || '0.0.0'}`,
    path.join(projectRoot, 'deploy', 'windows', 'installer.iss'),
  ]);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
