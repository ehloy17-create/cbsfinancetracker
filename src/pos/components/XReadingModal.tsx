import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Printer, RefreshCw, BarChart2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { fetchShiftReport, ShiftReport } from '../lib/posCheckout';
import { formatCurrency } from '../lib/posUtils';
import CashCountForm, { calculateCashCountTotal, createEmptyCashCountState, hasCashCountEntry } from './CashCountForm';
import { openPrintPreviewWindow } from '../lib/printPreview';

interface Props {
  shiftId: string;
  terminalName?: string;
  cashierName?: string;
  locationName?: string;
  onDone: () => void;
  onClose: () => void;
}

function Row({ label, value, highlight, indent, bold }: {
  label: string; value: string | number; highlight?: 'red' | 'green' | 'amber';
  indent?: boolean; bold?: boolean;
}) {
  const colMap = {
    red: 'text-red-600',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
  };
  const textCls = highlight ? colMap[highlight] : 'text-slate-800';
  return (
    <div className={`flex justify-between items-center py-1.5 ${indent ? 'pl-4' : ''}`}>
      <span className={`text-base ${bold ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>{label}</span>
      <span className={`text-base font-mono ${bold ? 'font-bold' : 'font-medium'} ${textCls}`}>{value}</span>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mt-4 mb-1 pb-1 border-b border-slate-200">
      <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">{title}</span>
    </div>
  );
}

type Step = 'count' | 'review';

export default function XReadingModal({ shiftId, terminalName, cashierName, locationName, onDone, onClose }: Props) {
  const { showToast } = useToast();
  const [step, setStep] = useState<Step>('count');
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cashCounts, setCashCounts] = useState(createEmptyCashCountState);
  const printRef = useRef<HTMLDivElement>(null);

  const actualCashVal = calculateCashCountTotal(cashCounts);
  const hasCashCount = hasCashCountEntry(cashCounts);
  const variance = report ? actualCashVal - report.expectedCash : 0;

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await fetchShiftReport(shiftId);
      setReport(data);
    } catch {
      showToast('Failed to load X reading', 'error');
    } finally {
      if (quiet) setRefreshing(false);
      else setLoading(false);
    }
  }, [shiftId, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (step === 'review') setStep('count');
        else onClose();
        return;
      }
      if (e.key === 'Enter' && !saving) {
        e.preventDefault();
        if (step === 'count') {
          if (!hasCashCount) { showToast('Enter the cash count by denomination', 'error'); return; }
          void load(true).then(() => setStep('review'));
        } else if (step === 'review') {
          void handleComplete();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step, onClose, hasCashCount, showToast, saving]); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePrint(existingWindow?: Window | null) {
    const content = printRef.current;
    if (!content) return;
    openPrintPreviewWindow({
      title: 'X Reading Preview',
      windowTitle: 'X Reading',
      contentHtml: content.innerHTML,
      existingWindow,
      width: 1280,
      height: 920,
      previewScale: 1.3,
      contentClassName: 'preview-report',
      documentStyles: `
        .preview-report {
          width: min(100%, 760px);
          margin: 0 auto;
          background: #fff;
          color: #0f172a;
          border-radius: 18px;
          padding: 28px 30px;
          box-shadow: 0 20px 48px rgba(15, 23, 42, 0.18);
          font-family: 'Courier New', monospace;
          font-size: 13px;
        }
        .preview-report h1 { font-size: 22px; text-align: center; margin-bottom: 4px; }
        .preview-report h2 { font-size: 16px; text-align: center; margin-bottom: 12px; color: #475569; }
        .preview-report .meta { text-align: center; margin-bottom: 18px; font-size: 12px; color: #475569; }
        .preview-report .section-header { margin-top: 16px; margin-bottom: 6px; font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; color: #475569; }
        .preview-report .row { display: flex; justify-content: space-between; gap: 16px; padding: 4px 0; font-size: 13px; }
        .preview-report .row.indent { padding-left: 16px; }
        .preview-report .row.bold span { font-weight: bold; }
        .preview-report .sep { border-top: 1px solid #cbd5e1; margin: 4px 0; }
        .preview-report .footer { text-align: center; margin-top: 16px; font-size: 11px; color: #64748b; }
        @media print {
          @page { size: auto; margin: 10mm; }
          .preview-report {
            width: auto;
            border-radius: 0;
            box-shadow: none;
            padding: 0;
            font-size: 12px;
          }
        }
      `,
    });
  }

  async function handleComplete(previewWindow?: Window | null) {
    if (!report || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('close_pos_shift', {
        p_shift_id: shiftId,
        p_actual_cash_count: actualCashVal,
        p_expected_cash_count: report.expectedCash,
      });
      if (error) throw error;
      if (previewWindow) {
        handlePrint(previewWindow);
      }
      showToast('Shift closed successfully', 'success');
      onDone();
    } catch (error) {
      previewWindow?.close();
      showToast(error instanceof Error ? error.message : 'Failed to close shift', 'error');
    } finally {
      setSaving(false);
    }
  }

  const now = new Date();

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full flex flex-col ${step === 'count' ? 'max-w-5xl' : 'max-w-3xl'} max-h-[92vh]`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-blue-600" />
            <h2 className="font-bold text-slate-800">X Reading</h2>
            <span className="text-xs text-slate-400 font-normal ml-1">(Shift Close)</span>
          </div>
          <div className="flex items-center gap-2">
            {step === 'review' && (
              <>
                <button
                  onClick={() => load(true)}
                  disabled={refreshing}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => {
                    const previewWindow = window.open('', '_blank', 'width=1280,height=920');
                    void handleComplete(previewWindow);
                  }}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />
                  {saving ? 'Closing...' : 'Print & Close'}
                </button>
              </>
            )}
            <button onClick={onClose} disabled={saving} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 disabled:opacity-40">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className={`flex-1 px-5 py-4 ${step === 'count' ? 'overflow-visible' : 'overflow-y-auto'}`}>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !report ? (
            <p className="text-center text-slate-500 py-8 text-sm">No data available</p>
          ) : step === 'count' ? (
            <div className="space-y-4">
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-base">
                  <p className="font-semibold text-blue-700">Count the cash on hand before viewing X Reading.</p>
                  <p className="text-blue-600 mt-1">This records the current drawer amount so the interim variance is visible.</p>
                </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-base flex items-center justify-between">
                  <span className="text-slate-500">Opening Cash</span>
                  <span className="font-mono font-semibold text-slate-800">₱{formatCurrency(report.shift.opening_cash)}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-base flex items-center justify-between">
                  <span className="text-slate-500">Expected Cash</span>
                  <span className="font-mono font-semibold text-slate-800">₱{formatCurrency(report.expectedCash)}</span>
                </div>
              </div>

              <div>
                  <label className="block text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Cash Count by Denomination <span className="text-red-500">*</span>
                </label>
                <CashCountForm
                  counts={cashCounts}
                  onChange={setCashCounts}
                  accentRingClass="focus:ring-blue-500"
                  autoFocus
                />
              </div>
            </div>
          ) : (
            <div ref={printRef} className="mx-auto w-full max-w-2xl rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
              <h1 style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 18, fontWeight: 'bold', marginBottom: 2 }}>X READING</h1>
              <h2 style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 13, color: '#555', marginBottom: 8 }}>Shift Closing Report</h2>
              <div className="text-center text-xs text-slate-400 space-y-0.5 mb-4">
                {locationName && <p>{locationName}</p>}
                {terminalName && <p>Terminal: {terminalName}</p>}
                {cashierName && <p>Cashier: {cashierName}</p>}
                <p>Business Date: {report.shift.business_date}</p>
                <p>Shift Opened: {new Date(report.shift.shift_open_time).toLocaleString('en-PH')}</p>
                <p>Printed: {now.toLocaleString('en-PH')}</p>
              </div>

              <div className="border-t border-dashed border-slate-300 my-3" />

              <SectionHeader title="Transactions" />
              <Row label="Transaction Count" value={report.txnCount} />
              <Row label="Void Count" value={report.voidCount} />
              <Row label="Return Count" value={report.returnCount} />

              <SectionHeader title="Sales Summary" />
              <Row label="Gross Sales" value={`₱${formatCurrency(report.grossSales)}`} />
              <Row label="Discounts" value={`-₱${formatCurrency(report.discounts)}`} highlight="red" indent />
              <Row label="Returns" value={`-₱${formatCurrency(report.returnTotal)}`} highlight="red" indent />
              <Row label="Voids" value={`-₱${formatCurrency(report.voidTotal)}`} highlight="red" indent />
              <div className="border-t border-slate-200 mt-1" />
              <Row label="Net Sales" value={`₱${formatCurrency(report.netSales)}`} bold />

              <SectionHeader title="Payment Breakdown" />
              <Row label="Cash Sales" value={`₱${formatCurrency(report.cashSales)}`} />
              <Row label="GCash Sales" value={`₱${formatCurrency(report.gcashSales)}`} />
              <Row label="Non-Cash Total" value={`₱${formatCurrency(report.nonCashSales)}`} />

              <SectionHeader title="Cash Drawer" />
              <Row label="Opening Cash" value={`₱${formatCurrency(report.shift.opening_cash)}`} />
              <Row label="Cash Sales" value={`+₱${formatCurrency(report.cashSales)}`} highlight="green" indent />
              <Row label="Cash Returns" value={`-₱${formatCurrency(report.cashReturnTotal)}`} highlight="red" indent />
              <Row label="Cash Pickups" value={`-₱${formatCurrency(report.cashPickupTotal)}`} highlight="red" indent />
              <div className="border-t border-slate-200 mt-1" />
              <Row label="Expected Cash" value={`₱${formatCurrency(report.expectedCash)}`} bold highlight="amber" />
              <Row label="Actual Cash Count" value={`₱${formatCurrency(actualCashVal)}`} bold />
              <Row
                label={variance >= 0 ? 'OVERAGE' : 'SHORTAGE'}
                value={`${variance >= 0 ? '+' : ''}₱${formatCurrency(Math.abs(variance))}`}
                bold
                highlight={variance >= 0 ? 'green' : 'red'}
              />

              <div className="border-t border-dashed border-slate-300 mt-4 pt-3 text-center text-xs text-slate-400">
                <p>*** X READING — SHIFT CLOSED ***</p>
                <p className="mt-0.5">Proceed to Z Reading to finish the register/day closing.</p>
              </div>
            </div>
          )}
        </div>

        {!loading && report && (
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100 flex-shrink-0">
            {step === 'count' ? (
              <>
                <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!hasCashCount) {
                      showToast('Enter the cash count by denomination', 'error');
                      return;
                    }
                    await load(true);
                    setStep('review');
                  }}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors"
                >
                  Review X Reading
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setStep('count')} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">
                  Back
                </button>
                <button
                  onClick={() => {
                    const previewWindow = window.open('', '_blank', 'width=1280,height=920');
                    void handleComplete(previewWindow);
                  }}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Printer className="w-4 h-4" />
                  {saving ? 'Closing...' : 'Print & Close'}
                </button>
                <button
                  onClick={() => void handleComplete()}
                  disabled={saving}
                  className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Closing...' : 'Close Shift'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
