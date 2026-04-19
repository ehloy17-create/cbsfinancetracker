const VITE_DEV_PORTS = new Set(['5173', '4173']);
const DEFAULT_DEV_API_PORT = (import.meta.env.VITE_DEV_API_PORT?.trim() || '4000');

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function resolveApiBase() {
  const configuredBase = import.meta.env.VITE_API_URL?.trim();
  if (configuredBase) {
    return trimTrailingSlash(configuredBase);
  }

  if (typeof window !== 'undefined' && /^https?:/i.test(window.location.origin)) {
    const { hostname, port, protocol } = window.location;
    if (VITE_DEV_PORTS.has(port)) {
      return `${protocol}//${hostname}:${DEFAULT_DEV_API_PORT}`;
    }
    return '';
  }

  return `http://127.0.0.1:${DEFAULT_DEV_API_PORT}`;
}

export const API_BASE = resolveApiBase();

export function buildApiUrl(path: string) {
  return `${API_BASE}${path}`;
}
