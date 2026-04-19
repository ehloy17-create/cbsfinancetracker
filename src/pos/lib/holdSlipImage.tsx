import { toPng } from 'html-to-image';
import { createRoot } from 'react-dom/client';
import HoldSlipPaper, { HoldSlipPaperLine } from '../components/HoldSlipPaper';

const CACHE_PREFIX = 'hold-slip-image:';

export interface HoldSlipImagePayload {
  heldSaleId: string;
  cacheKey: string;
  holdReference: string;
  customerName?: string;
  cashierName?: string;
  createdAt?: string;
  notes?: string;
  lines: HoldSlipPaperLine[];
  totalDue: number;
}

interface CachedHoldSlipImage {
  cacheKey: string;
  dataUrl: string;
  expiresAt: string;
}

export function getHoldSlipImageExpiry(now = new Date()) {
  const expiry = new Date(now);
  expiry.setHours(23, 59, 59, 999);
  return expiry;
}

function getStorageKey(heldSaleId: string) {
  return `${CACHE_PREFIX}${heldSaleId}`;
}

function cleanupExpiredCachedImages() {
  const now = Date.now();
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index);
    if (!key || !key.startsWith(CACHE_PREFIX)) continue;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<CachedHoldSlipImage>;
      if (!parsed.expiresAt || Number.isNaN(new Date(parsed.expiresAt).getTime()) || new Date(parsed.expiresAt).getTime() < now) {
        sessionStorage.removeItem(key);
      }
    } catch {
      sessionStorage.removeItem(key);
    }
  }
}

function readCachedImage(payload: HoldSlipImagePayload) {
  cleanupExpiredCachedImages();
  const raw = sessionStorage.getItem(getStorageKey(payload.heldSaleId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CachedHoldSlipImage;
    if (parsed.cacheKey !== payload.cacheKey) return null;
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      sessionStorage.removeItem(getStorageKey(payload.heldSaleId));
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(getStorageKey(payload.heldSaleId));
    return null;
  }
}

function writeCachedImage(payload: HoldSlipImagePayload, dataUrl: string, expiresAt: string) {
  const cacheEntry: CachedHoldSlipImage = {
    cacheKey: payload.cacheKey,
    dataUrl,
    expiresAt,
  };
  sessionStorage.setItem(getStorageKey(payload.heldSaleId), JSON.stringify(cacheEntry));
}

async function waitForRenderedLayout() {
  const fontsReady = document.fonts?.ready;
  if (fontsReady) {
    try {
      await fontsReady;
    } catch {
      // ignore font readiness errors and continue with the render capture
    }
  }

  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function renderPayloadToImage(payload: HoldSlipImagePayload) {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.padding = '24px';
  host.style.background = '#ffffff';
  host.style.zIndex = '-1';
  document.body.appendChild(host);

  const root = createRoot(host);

  try {
    root.render(
      <div style={{ background: '#ffffff', padding: '16px', width: 'fit-content' }}>
        <HoldSlipPaper
          holdReference={payload.holdReference}
          customerName={payload.customerName}
          cashierName={payload.cashierName}
          createdAt={payload.createdAt}
          notes={payload.notes}
          lines={payload.lines}
          totalDue={payload.totalDue}
        />
      </div>
    );

    await waitForRenderedLayout();

    const target = host.firstElementChild as HTMLElement | null;
    if (!target) {
      throw new Error('Unable to render hold slip image');
    }

    return await toPng(target, {
      pixelRatio: 3,
      backgroundColor: '#ffffff',
      cacheBust: true,
    });
  } finally {
    root.unmount();
    host.remove();
  }
}

export async function getOrCreateHoldSlipImage(payload: HoldSlipImagePayload) {
  const cached = readCachedImage(payload);
  if (cached) {
    return {
      dataUrl: cached.dataUrl,
      expiresAt: cached.expiresAt,
    };
  }

  const expiresAt = getHoldSlipImageExpiry().toISOString();
  const dataUrl = await renderPayloadToImage(payload);
  writeCachedImage(payload, dataUrl, expiresAt);

  return { dataUrl, expiresAt };
}

export async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return await response.blob();
}

export async function copyImageToClipboard(blob: Blob) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Image clipboard is unavailable in this browser');
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type || 'image/png']: blob,
    }),
  ]);
}

export function openHoldSlipImagePreview(dataUrl: string, title: string) {
  const previewWindow = window.open('', '_blank', 'width=1100,height=900');
  if (!previewWindow) {
    throw new Error('Unable to open the image preview window');
  }

  previewWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #020617;
      padding: 24px;
      font-family: Inter, system-ui, sans-serif;
    }
    .frame {
      background: #0f172a;
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 24px;
      padding: 24px;
      box-shadow: 0 30px 60px rgba(15, 23, 42, 0.45);
    }
    img {
      display: block;
      max-width: min(100%, 560px);
      height: auto;
      background: #fff;
      border-radius: 18px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.35);
    }
  </style>
</head>
<body>
  <div class="frame">
    <img src="${dataUrl}" alt="${title}" />
  </div>
</body>
</html>`);
  previewWindow.document.close();
  previewWindow.focus();
}
