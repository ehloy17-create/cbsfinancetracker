export interface PrintPreviewOptions {
  title: string;
  contentHtml: string;
  documentStyles: string;
  windowTitle?: string;
  width?: number;
  height?: number;
  previewScale?: number;
  contentClassName?: string;
  existingWindow?: Window | null;
}

export function openPrintPreviewWindow({
  title,
  contentHtml,
  documentStyles,
  windowTitle,
  width = 1200,
  height = 900,
  previewScale = 1.6,
  contentClassName = '',
  existingWindow,
}: PrintPreviewOptions) {
  const previewWindow = existingWindow ?? window.open('', '_blank', `width=${width},height=${height}`);
  if (!previewWindow) return null;

  previewWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${windowTitle ?? title}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #0f172a; color: #e2e8f0; font-family: Inter, system-ui, sans-serif; }
    .preview-shell { min-height: 100vh; display: flex; flex-direction: column; }
    .preview-toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 20px;
      background: rgba(15, 23, 42, 0.96);
      border-bottom: 1px solid rgba(148, 163, 184, 0.2);
      backdrop-filter: blur(12px);
    }
    .preview-title { font-size: 18px; font-weight: 700; color: #f8fafc; }
    .preview-subtitle { font-size: 13px; color: #94a3b8; margin-top: 4px; }
    .preview-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .preview-button {
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 12px;
      padding: 10px 14px;
      background: #1e293b;
      color: #e2e8f0;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .preview-button:hover { background: #334155; }
    .preview-button.primary {
      background: #2563eb;
      border-color: #2563eb;
      color: #fff;
    }
    .preview-button.primary:hover { background: #1d4ed8; }
    .preview-stage {
      flex: 1;
      overflow: auto;
      padding: 28px;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    .preview-canvas {
      transform-origin: top center;
      transform: scale(${previewScale});
      margin-bottom: ${Math.round((previewScale - 1) * 420)}px;
    }
    ${documentStyles}
    @media print {
      html, body { background: #fff; color: #000; }
      .preview-toolbar { display: none; }
      .preview-stage { padding: 0; overflow: visible; }
      .preview-canvas { transform: none; margin: 0; }
    }
  </style>
</head>
<body>
  <div class="preview-shell">
    <div class="preview-toolbar">
      <div>
        <div class="preview-title">${title}</div>
        <div class="preview-subtitle">Larger on-screen preview. Use Print when ready.</div>
      </div>
      <div class="preview-actions">
        <button class="preview-button" onclick="window.close()">Close Preview</button>
        <button class="preview-button primary" onclick="window.print()">Print</button>
      </div>
    </div>
    <div class="preview-stage">
      <div class="preview-canvas">
        <div class="${contentClassName}">${contentHtml}</div>
      </div>
    </div>
  </div>
</body>
</html>`);
  previewWindow.document.close();
  previewWindow.focus();
  return previewWindow;
}
