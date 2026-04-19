import { useState } from 'react';
import { Loader2, MessageCircleMore } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { writeAuditLog } from '../../lib/audit';
import { getMetaBusinessSuiteInboxUrl, openExternalWindow, prepareExternalWindow } from '../lib/holdSlip';
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

  async function ensureImage() {
    setLoading(true);
    try {
      return await getOrCreateHoldSlipImage(payload);
    } finally {
      setLoading(false);
    }
  }

  async function handleBusinessSuite() {
    const businessSuiteUrl = getMetaBusinessSuiteInboxUrl();
    const pendingWindow = prepareExternalWindow(businessSuiteUrl);

    if (!pendingWindow) {
      openExternalWindow(businessSuiteUrl);
      return;
    }

    try {
      const { dataUrl, expiresAt } = await ensureImage();
      const blob = await dataUrlToBlob(dataUrl);
      const parsed = new Date(expiresAt);
      const expiryLabel = Number.isNaN(parsed.getTime())
        ? 'the end of the day'
        : parsed.toLocaleString('en-PH', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });

      await copyImageToClipboard(blob);
      openExternalWindow(businessSuiteUrl, pendingWindow);
      showToast(`Hold slip image copied. Meta Business Suite inbox is opening so you can paste it into the customer conversation. Expires ${expiryLabel}.`, 'success');

      await writeAuditLog(userId, 'SEND_HOLD_SLIP_IMAGE', 'POS Hold Slip', payload.heldSaleId, {
        channel: 'meta_business_suite',
        status: 'clipboard',
        expires_at: expiresAt,
      });
    } catch (error) {
      openExternalWindow(businessSuiteUrl, pendingWindow);
      await writeAuditLog(userId, 'SEND_HOLD_SLIP_IMAGE', 'POS Hold Slip', payload.heldSaleId, {
        channel: 'meta_business_suite',
        status: 'failed',
        error_message: (error as Error).message || 'Unknown error',
      });
      showToast('Business Suite was opened, but the hold slip image could not be copied automatically.', 'error');
    }
  }

  return (
    <button
      type="button"
      onClick={handleBusinessSuite}
      className={buttonClassName}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircleMore className="h-4 w-4" />}
      {buttonLabel}
    </button>
  );
}
