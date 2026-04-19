import { buildApiUrl } from '../../lib/apiBase';

export interface HoldSlipShareLink {
  heldSaleId: string;
  token: string;
  expiresAt: string;
  link: string;
}

export interface PublicHoldSlipItem {
  item_id: string;
  product_name_snapshot: string;
  qty: number;
  unit_price: number;
  subtotal: number;
  selected_unit_name?: string;
  base_unit_name?: string;
  pricing_breakdown?: string;
}

export interface PublicHoldSlipData {
  held_sale_id: string;
  hold_reference: string;
  customer_name_snapshot: string;
  customer_price_level_snapshot: string;
  status: string;
  subtotal: number;
  notes: string;
  created_at: string;
  updated_at: string;
  cashier_name: string;
  items: PublicHoldSlipItem[];
}

export interface HoldSlipApiError extends Error {
  code?: string;
  status?: number;
}

function getAccessToken() {
  return localStorage.getItem('access_token');
}

async function holdSlipFetch(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }

  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(buildApiUrl(path), {
    ...options,
    headers,
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error?: string }).error ?? 'Request failed')
        : 'Request failed'
    ) as HoldSlipApiError;
    error.status = response.status;
    if (typeof data === 'object' && data && 'code' in data) {
      error.code = String((data as { code?: string }).code ?? '');
    }
    throw error;
  }

  return data;
}

export async function generateHoldSlipLink(heldSaleId: string): Promise<HoldSlipShareLink> {
  const data = await holdSlipFetch(`/hold-slip/${encodeURIComponent(heldSaleId)}/link`, {
    method: 'POST',
  }) as HoldSlipShareLink;

  return data;
}

export async function getHoldSlipData(heldSaleId: string, token: string) {
  return holdSlipFetch(
    `/hold-slip/public/${encodeURIComponent(heldSaleId)}?token=${encodeURIComponent(token)}`
  ) as Promise<{ data: PublicHoldSlipData; expiresAt: string | null }>;
}

export function buildWhatsAppShareUrl(link: string) {
  return `https://wa.me/?text=${encodeURIComponent(`Hold slip: ${link}`)}`;
}

export async function copyHoldSlipLink(link: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard is unavailable in this browser');
  }
  await navigator.clipboard.writeText(link);
}

// Named window target — browser reuses/focuses this tab instead of opening a new one each time.
const META_WINDOW_TARGET = 'meta_business_suite';

export function prepareExternalWindow(url: string) {
  try {
    // Using a named target reuses an already-open Meta tab rather than spawning a new one.
    // Omitting noopener so we retain the window reference needed to focus it later.
    const opened = window.open(url, META_WINDOW_TARGET);
    if (opened) {
      opened.focus();
      return opened;
    }
  } catch {
    // fall through
  }
  return null;
}

export function openExternalWindow(url: string, existingWindow: Window | null = null) {
  // Focus/navigate the already-opened named window if we still hold a reference to it.
  try {
    if (existingWindow && !existingWindow.closed) {
      existingWindow.location.href = url;
      existingWindow.focus();
      return;
    }
  } catch {
    // continue
  }

  // Re-open or focus the named window — never navigates the POS tab away.
  try {
    const opened = window.open(url, META_WINDOW_TARGET);
    if (opened) {
      opened.focus();
      return;
    }
  } catch {
    // silent failure — POS stays on its own tab regardless
  }
}

export function getMetaBusinessSuiteInboxUrl() {
  return 'https://business.facebook.com/latest/inbox';
}
