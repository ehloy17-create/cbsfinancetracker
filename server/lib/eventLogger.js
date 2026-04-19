import fs from 'fs';
import path from 'path';
import { logsDir } from '../loadEnv.js';

export const eventsLogPath = path.join(logsDir, 'events.log');

function normalizeDetails(value, depth = 0) {
  if (depth > 4) return '[MaxDepth]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeDetails(entry, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeDetails(entry, depth + 1)])
    );
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  return value;
}

function formatEventLine(source, event, details = {}) {
  const timestamp = new Date().toISOString();
  const payload = details && Object.keys(details).length > 0
    ? ` ${JSON.stringify(normalizeDetails(details))}`
    : '';
  return `${timestamp} [${source}] ${event}${payload}\n`;
}

function appendLine(line) {
  fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(eventsLogPath, line, 'utf8');
}

export function logEventSync(source, event, details = {}) {
  try {
    appendLine(formatEventLine(source, event, details));
  } catch (error) {
    console.error('Failed to write event log:', error);
  }
}

export async function logEvent(source, event, details = {}) {
  logEventSync(source, event, details);
}

let processLoggingInstalled = false;

export function installProcessEventLogging(source = 'api') {
  if (processLoggingInstalled) return;
  processLoggingInstalled = true;

  process.on('unhandledRejection', (reason) => {
    logEventSync(source, 'process.unhandled_rejection', { reason });
  });

  process.on('uncaughtException', (error) => {
    logEventSync(source, 'process.uncaught_exception', { error });
  });

  process.on('warning', (warning) => {
    logEventSync(source, 'process.warning', { warning });
  });
}
