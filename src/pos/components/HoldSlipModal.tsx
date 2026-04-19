import { useEffect, useMemo, useRef } from 'react';
import { X, Printer, PauseCircle, Image as ImageIcon } from 'lucide-react';
import { CartLine } from '../hooks/useCart';
import { SLIP_STYLES } from '../lib/slip';
import { openPrintPreviewWindow } from '../lib/printPreview';
import HoldSlipPaper, { HoldSlipPaperLine } from './HoldSlipPaper';
import HoldSlipShareButton from './HoldSlipShareButton';
import { getOrCreateHoldSlipImage, openHoldSlipImagePreview } from '../lib/holdSlipImage';
import { useToast } from '../../contexts/ToastContext';

interface Props {
  heldSaleId: string;
  userId?: string | null;
  holdReference: string;
  customerName: string;
  cashierName?: string;
  createdAt?: string;
  notes?: string;
  lines: CartLine[];
  totalDue: number;
  onClose: () => void;
}

export default function HoldSlipModal({
  heldSaleId,
  userId = null,
  holdReference,
  customerName,
  cashierName,
  createdAt,
  notes,
  lines,
  totalDue,
  onClose,
}: Props) {
  const { showToast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function handlePrint() {
    if (!printRef.current) return;
    openPrintPreviewWindow({
      title: `Hold Slip Preview - ${holdReference}`,
      windowTitle: `Hold Slip ${holdReference}`,
      contentHtml: printRef.current.innerHTML,
      documentStyles: `
        ${SLIP_STYLES}
        .preview-slip { width: 58mm; margin: 0 auto; background: #fff; color: #111827; }
        @media print { @page { size: 58mm auto; margin: 0; } }
      `,
      previewScale: 2.15,
      contentClassName: 'preview-slip',
      width: 1360,
      height: 980,
    });
  }

  const slipLines = useMemo<HoldSlipPaperLine[]>(() => lines.map(line => ({
    id: line.lineId,
    productName: line.productName,
    qty: Number(line.qty ?? 0),
    unitPrice: Number(line.unitPrice ?? 0),
    subtotal: Number(line.subtotal ?? 0),
    selectedUnitName: line.selectedUnitName,
    baseUnitName: line.baseUnitName,
    pricingBreakdown: line.pricingBreakdown,
  })), [lines]);

  const imagePayload = useMemo(() => ({
    heldSaleId,
    cacheKey: `${heldSaleId}:${createdAt ?? ''}:${totalDue}:${notes ?? ''}`,
    holdReference,
    customerName,
    cashierName,
    createdAt,
    notes,
    lines: slipLines,
    totalDue,
  }), [heldSaleId, createdAt, totalDue, notes, holdReference, customerName, cashierName, slipLines]);

  async function handlePreviewImage() {
    try {
      const { dataUrl } = await getOrCreateHoldSlipImage(imagePayload);
      openHoldSlipImagePreview(dataUrl, `Hold Slip ${holdReference}`);
    } catch (error) {
      showToast((error as Error).message || 'Failed to generate hold slip image', 'error');
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <PauseCircle className="w-5 h-5 text-amber-400" />
            <h2 className="text-white font-bold">Hold Slip Preview</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="bg-slate-900/40 rounded-xl p-8 shadow-inner overflow-auto">
            <div className="mx-auto w-fit min-h-[340mm]">
            <div className="origin-top scale-[2.05]">
            <div className="mx-auto w-[58mm] min-h-[120mm] bg-white text-gray-900 rounded-md shadow-sm overflow-hidden">
              <div ref={printRef}>
                <HoldSlipPaper
                  holdReference={holdReference}
                  customerName={customerName}
                  cashierName={cashierName}
                  createdAt={createdAt}
                  notes={notes}
                  lines={slipLines}
                  totalDue={totalDue}
                />
              </div>
            </div>
            </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-700 flex gap-3 flex-shrink-0">
          <button
            onClick={handlePreviewImage}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm rounded-xl border border-slate-600 transition-colors"
          >
            <ImageIcon className="w-4 h-4" />
            Preview Image
          </button>
          <HoldSlipShareButton
            payload={imagePayload}
            userId={userId}
            buttonLabel="Open Business Suite"
            buttonClassName="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl transition-colors"
          />
          <button
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm rounded-xl border border-slate-600 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print Hold Slip
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl transition-colors"
          >
            Back to POS
          </button>
        </div>
      </div>
    </div>
  );
}
