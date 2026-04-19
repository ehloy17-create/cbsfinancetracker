import { useState } from 'react';
import { Loader2, MessageCircleMore, Copy, CheckCircle2, ExternalLink, X } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { writeAuditLog } from '../../lib/audit';
import { getMetaBusinessSuiteInboxUrl, openExternalWindow } from '../lib/holdSlip';
import {
  copyImageToClipboard,
  dataUrlToBlob,
  getOrCreateHoldSlipImage,
  HoldSlipImagePayload,
} from '../lib/holdSlipImage';

interface Props {
  payload: HoldSlipImagePayload;
  userId?: string | null;
  buttonLabel?: string;
  buttonClassName?: string;
}

export default function HoldSlipShareButton({
  payload,
  userId = null,
  buttonLabel = 'Open Business Suite',
  buttonClassName = 'inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors',
}: Props) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewExpiresAt, setPreviewExpiresAt] = useState<string>('');
  const [copied, setCopied] = useState(false);

  async function handleBusinessSuite() {
    setLoading(true);
    setCopied(false);
    try {
      const { dataUrl, expiresAt } = await getOrCreateHoldSlipImage(payload);
      setPreviewDataUrl(dataUrl);
      setPreviewExpiresAt(expiresAt);

      // Auto-copy to clipboard immediately
      try {
        const blob = await dataUrlToBlob(dataUrl);
        await copyImageToClipboard(blob);
        setCopied(true);
      } catch {
        // Clipboard copy failed — user can try manual copy in preview
      }
    } catch (error) {
      showToast('Failed to generate hold slip image.', 'error');
      await writeAuditLog(userId, 'SEND_HOLD_SLIP_IMAGE', 'POS Hold Slip', payload.heldSaleId, {
        channel: 'meta_business_suite',
        status: 'failed',
        error_message: (error as Error).message || 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyAndOpen() {
    if (!previewDataUrl) return;
    try {
      const blob = await dataUrlToBlob(previewDataUrl);
      await copyImageToClipboard(blob);
      setCopied(true);
    } catch {
      // ignore — still open Business Suite
    }
    openExternalWindow(getMetaBusinessSuiteInboxUrl());
    const parsed = new Date(previewExpiresAt);
    const expiryLabel = Number.isNaN(parsed.getTime())
      ? 'the end of the day'
      : parsed.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    showToast(`Image ${copied ? 'copied to clipboard. ' : ''}Business Suite opened. Expires ${expiryLabel}.`, 'success');
    await writeAuditLog(userId, 'SEND_HOLD_SLIP_IMAGE', 'POS Hold Slip', payload.heldSaleId, {
      channel: 'meta_business_suite',
      status: copied ? 'clipboard' : 'opened_no_clipboard',
      expires_at: previewExpiresAt,
    });
    setPreviewDataUrl(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleBusinessSuite}
        className={buttonClassName}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircleMore className="h-4 w-4" />}
        {buttonLabel}
      </button>

      {previewDataUrl && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                {copied
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  : <Copy className="w-4 h-4 text-slate-500" />
                }
                <span className="text-sm font-semibold text-slate-800">
                  {copied ? 'Image copied to clipboard' : 'Hold Slip Preview'}
                </span>
              </div>
              <button onClick={() => setPreviewDataUrl(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-slate-100 flex justify-center overflow-y-auto max-h-[60vh]">
              <img src={previewDataUrl} alt="Hold slip preview" className="max-w-full rounded-lg shadow" />
            </div>
            <div className="px-4 py-3 border-t border-slate-100 space-y-2">
              {!copied && (
                <p className="text-xs text-amber-600 text-center">
                  Clipboard copy unavailable — click below to open and paste manually.
                </p>
              )}
              <button
                onClick={handleCopyAndOpen}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                {copied ? 'Open Business Suite' : 'Copy & Open Business Suite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
