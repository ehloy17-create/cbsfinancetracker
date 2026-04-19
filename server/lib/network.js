import os from 'os';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DEV_SERVER_PORTS = new Set(['5173', '4173']);

function normalizeHostname(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

export function isLoopbackHostname(hostname) {
  return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

export function isPrivateIpv4(hostname) {
  const normalized = normalizeHostname(hostname);
  const match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return false;
  }

  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isLinkLocalOrPrivateIpv6(hostname) {
  const normalized = normalizeHostname(hostname).replace(/^\[|\]$/g, '');
  return normalized.startsWith('fe80:')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd');
}

export function isLanHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  return isLoopbackHostname(normalized)
    || isPrivateIpv4(normalized)
    || isLinkLocalOrPrivateIpv6(normalized)
    || normalized.endsWith('.local');
}

export function getLanIpv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal || entry.family !== 'IPv4') continue;
      if (!isPrivateIpv4(entry.address)) continue;
      addresses.push(entry.address);
    }
  }

  return [...new Set(addresses)];
}

export function getServerAccessUrls(port) {
  const portValue = String(port);
  return {
    local: [
      `http://127.0.0.1:${portValue}`,
      `http://localhost:${portValue}`,
    ],
    lan: getLanIpv4Addresses().map((address) => `http://${address}:${portValue}`),
  };
}

export function getPreferredServerUrl(port) {
  const accessUrls = getServerAccessUrls(port);
  return accessUrls.lan[0] ?? accessUrls.local[0];
}

export function isAllowedAppOrigin(origin, apiPort) {
  if (!origin) return true;

  const normalizedOrigin = normalizeBaseUrl(origin);
  const explicitOrigins = new Set(
    [
      process.env.APP_PUBLIC_BASE_URL,
      process.env.VITE_APP_URL,
      `http://127.0.0.1:${apiPort}`,
      `http://localhost:${apiPort}`,
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'http://127.0.0.1:4173',
      'http://localhost:4173',
    ].map(normalizeBaseUrl).filter(Boolean)
  );

  if (explicitOrigins.has(normalizedOrigin)) {
    return true;
  }

  let url;
  try {
    url = new URL(normalizedOrigin);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  const effectivePort = url.port || (url.protocol === 'https:' ? '443' : '80');
  const allowedPorts = new Set([String(apiPort), ...DEV_SERVER_PORTS]);
  if (!allowedPorts.has(effectivePort)) {
    return false;
  }

  return isLanHostname(url.hostname);
}

export function resolveAppBaseUrlFromRequest(req, fallbackPort) {
  const configuredBase = normalizeBaseUrl(process.env.APP_PUBLIC_BASE_URL || process.env.VITE_APP_URL);
  const host = String(req.get('host') ?? '').trim();
  const requestBase = host ? `${req.protocol}://${host}`.replace(/\/+$/, '') : '';

  if (configuredBase) {
    try {
      const configuredUrl = new URL(configuredBase);
      const requestUrl = requestBase ? new URL(requestBase) : null;
      const requestIsLan = requestUrl && isLanHostname(requestUrl.hostname) && !isLoopbackHostname(requestUrl.hostname);

      if (isLoopbackHostname(configuredUrl.hostname) && requestIsLan) {
        return requestBase;
      }
    } catch {
      // Fall back to the configured base below if it is not a valid URL.
    }

    return configuredBase;
  }

  if (requestBase) {
    return requestBase;
  }

  return getPreferredServerUrl(fallbackPort);
}
