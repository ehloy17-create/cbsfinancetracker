import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function removeDir(dirPath) {
  await fs.rm(dirPath, { recursive: true, force: true });
}

export async function copyDir(sourceDir, targetDir, options = {}) {
  const { filter } = options;
  await ensureDir(targetDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (filter && !filter(sourcePath, entry)) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath, options);
    } else if (entry.isFile()) {
      await ensureDir(path.dirname(targetPath));
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

function resolveCommand(command) {
  if (process.platform !== 'win32') {
    return command;
  }

  const parsedPath = path.parse(command);
  const hasPath = Boolean(parsedPath.dir);
  const hasExtension = Boolean(parsedPath.ext);

  if (!hasPath && !hasExtension) {
    return `${command}.cmd`;
  }

  return command;
}

function quoteWindowsArg(value) {
  if (value === '') {
    return '""';
  }

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

export function run(command, args, options = {}) {
  const resolvedCommand = resolveCommand(command);
  const isWindowsCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedCommand);
  const result = isWindowsCmd
    ? spawnSync(process.env.ComSpec || 'cmd.exe', [
        '/d',
        '/s',
        '/c',
        `${quoteWindowsArg(resolvedCommand)} ${args.map(quoteWindowsArg).join(' ')}`.trim(),
      ], {
        stdio: 'inherit',
        shell: false,
        ...options,
      })
    : spawnSync(resolvedCommand, args, {
        stdio: 'inherit',
        shell: false,
        ...options,
      });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${resolvedCommand} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
}
