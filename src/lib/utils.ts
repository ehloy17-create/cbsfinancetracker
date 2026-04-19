export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function normalizeDateValue(dateValue: unknown): Date | null {
  if (dateValue instanceof Date) {
    return Number.isNaN(dateValue.getTime()) ? null : dateValue;
  }

  if (typeof dateValue !== 'string') {
    return null;
  }

  const trimmed = dateValue.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const normalized = trimmed.includes(' ') && !trimmed.includes('T')
    ? trimmed.replace(' ', 'T')
    : trimmed;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(dateStr: unknown): string {
  const parsed = normalizeDateValue(dateStr);
  if (!parsed) return '--';
  return parsed.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(dateStr: unknown): string {
  const parsed = normalizeDateValue(dateStr);
  if (!parsed) return '--';
  return parsed.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

export function downloadCSV(data: string, filename: string): void {
  const blob = new Blob(['\uFEFF', data], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJSON(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function objectsToCSV(objects: Record<string, unknown>[]): string {
  if (objects.length === 0) return '';
  const headers = Object.keys(objects[0]);
  const rows = objects.map(obj =>
    headers.map(h => {
      const val = obj[h];
      if (val === null || val === undefined) return '';
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export function classNames(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toNum(value: unknown): number {
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

export function parseMoneyInput(value: unknown, label = 'Amount'): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be a valid number`);
    }
    return round2(value);
  }

  if (typeof value !== 'string') {
    throw new Error(`${label} must be a valid amount`);
  }

  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }

  if (!/^-?\d+(\.\d{0,2})?$/.test(normalized)) {
    throw new Error(`${label} must have at most 2 decimal places`);
  }

  const sign = normalized.startsWith('-') ? -1 : 1;
  const unsigned = normalized.replace(/^-/, '');
  const [wholePart, decimalPart = ''] = unsigned.split('.');
  const cents = (Number(wholePart) * 100) + Number(decimalPart.padEnd(2, '0'));
  return sign * (cents / 100);
}

export function generateUUID(): string {
  const cryptoApi = typeof globalThis !== 'undefined'
    ? (globalThis as typeof globalThis & { crypto?: Crypto }).crypto
    : undefined;

  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

export function generateShortId(prefix = '', length = 10): string {
  const token = generateUUID().replace(/-/g, '').slice(0, length).toUpperCase();
  return prefix ? `${prefix}${token}` : token;
}
