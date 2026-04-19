import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const serverRootDir = __dirname;
export const projectRootDir = path.resolve(__dirname, '..');

function getDefaultAppDataDir() {
  if (process.env.APP_DATA_DIR) {
    return process.env.APP_DATA_DIR;
  }

  if (process.platform === 'win32') {
    const sharedAppDataDir = process.env.PROGRAMDATA && path.join(process.env.PROGRAMDATA, 'BizTracker');
    const legacySharedAppDataDir = process.env.PROGRAMDATA && path.join(process.env.PROGRAMDATA, 'GCashPOSLocal');
    const legacyAppDataDir = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'GCashPOSLocal');

    if (sharedAppDataDir && fs.existsSync(path.join(sharedAppDataDir, 'config', 'app.env'))) {
      return sharedAppDataDir;
    }

    if (legacySharedAppDataDir && fs.existsSync(path.join(legacySharedAppDataDir, 'config', 'app.env'))) {
      return legacySharedAppDataDir;
    }

    if (legacyAppDataDir && fs.existsSync(path.join(legacyAppDataDir, 'config', 'app.env'))) {
      return legacyAppDataDir;
    }

    if (sharedAppDataDir) {
      return sharedAppDataDir;
    }
  }

  if (process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'GCashPOSLocal');
  }

  if (process.env.XDG_DATA_HOME) {
    return path.join(process.env.XDG_DATA_HOME, 'biztracker');
  }

  return path.join(os.homedir(), '.biztracker');
}

export const appDataDir = getDefaultAppDataDir();
export const configDir = path.join(appDataDir, 'config');
export const logsDir = process.env.APP_LOGS_DIR || path.join(appDataDir, 'logs');
export const runtimeEnvFile = process.env.APP_ENV_FILE || path.join(configDir, 'app.env');
export const frontendDistDir = path.join(projectRootDir, 'dist');
export const uploadsDir = path.join(appDataDir, 'uploads');
const projectEnvFile = path.join(projectRootDir, '.env');

function loadIfPresent(filePath, override = false) {
  if (!filePath || !fs.existsSync(filePath)) return;
  dotenv.config({ path: filePath, override });
}

loadIfPresent(projectEnvFile);

const shouldLoadRuntimeEnv = Boolean(
  process.env.APP_ENV_FILE
  || process.env.APP_DATA_DIR
  || !fs.existsSync(projectEnvFile)
);

if (shouldLoadRuntimeEnv) {
  loadIfPresent(runtimeEnvFile, true);
}
