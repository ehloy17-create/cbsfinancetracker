import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const CLIENT_EVENT_ENDPOINT = `${window.location.origin}/events/client`;

function normalizeClientValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[MaxDepth]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeClientValue(entry, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, normalizeClientValue(entry, depth + 1)])
    );
  }
  return value;
}

function stringifyConsoleArgs(args: unknown[]) {
  return args.map((arg) => {
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(normalizeClientValue(arg));
    } catch {
      return String(arg);
    }
  }).join(' ');
}

function sendClientEvent(event: string, payload: { level?: string; message?: string; details?: Record<string, unknown> } = {}) {
  const body = JSON.stringify({
    event,
    level: payload.level ?? 'info',
    message: payload.message ?? '',
    details: normalizeClientValue(payload.details ?? {}),
    url: window.location.href,
    userAgent: navigator.userAgent,
  });

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(CLIENT_EVENT_ENDPOINT, blob)) return;
    }
  } catch {
    // Ignore telemetry transport errors and fall back to fetch.
  }

  void fetch(CLIENT_EVENT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

if (import.meta.env.PROD) {
  sendClientEvent('app.boot');

  window.addEventListener('error', (event) => {
    sendClientEvent('window.error', {
      level: 'error',
      message: event.message,
      details: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    sendClientEvent('window.unhandled_rejection', {
      level: 'error',
      message: 'Unhandled promise rejection',
      details: {
        reason: event.reason,
      },
    });
  });

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    sendClientEvent('console.error', {
      level: 'error',
      message: stringifyConsoleArgs(args),
      details: {
        args,
      },
    });
    originalConsoleError(...args);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
