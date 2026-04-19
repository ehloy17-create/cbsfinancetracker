import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Printer, LogOut, CheckCircle2, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { fetchZReadingReport, ZReadingReport } from '../lib/posCheckout';
import { formatCurrency } from '../lib/posUtils';
import { PosShift } from '../../lib/types';
import { openPrintPreviewWindow } from '../lib/printPreview';

interface Props {
  shift: PosShift;
  onClose: () => void;
  onClosed: () => void;
}

function Row({ label, value, highlight, indent, bold, separator }: {
  label: string; value: string | number;
  highlight?: 'red' | 'green' | 'amber';
  indent?: boolean; bold?: boolean; separator?: boolean;
}) {
  const colMap = { red: 'text-red-600', green: 'text-emerald-600', amber: 'text-amber-600' };
  const textCls = highlight ? colMap[highlight] : 'text-slate-800';
  return (
    <>
      {separator && <div className="border-t border-slate-200 my-1" />}
      <div className={`flex justify-between items-center py-1.5 ${indent ? 'pl-4' : ''}`}>
        <span className={`text-base ${bold ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>{label}</span>
        <span className={`text-base font-mono ${bold ? 'font-bold' : 'font-medium'} ${textCls}`}>{value}</span>
      </div>
    </>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mt-4 mb-1 pb-1 border-b border-slate-200">
      <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">{title}</span>
    </div>
  );
}

type Step = 'review' | 'closed';

export default function ZReadingModal({ shift, onClose, onClosed }: Props) {
  const { showToast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const [step] = useState<Step>('review');
  const [report, setReport] = useState<ZReadingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadReport = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await fetchZReadingReport(shift.shift_id);
      setReport(data);
    } catch {
      showToast('Failed to load Z reading', 'error');
    } finally {
      if (quiet) setRefreshing(false);
      else setLoading(false);
    }
  }, [shift.shift_id, showToast]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    if (saving) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (step === 'review') void handlePostZ();
        else if (step === 'closed') onClosed();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saving, step, onClose, onClosed]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePostZ() {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('post_z_reading', { p_shift_id: shift.shift_id });
      if (error) throw error;
      showToast('Z Reading posted. Transactions are now locked for this register/day.', 'success');
      onClosed();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to post Z Reading', 'error');
    } finally {
      setSaving(false);
    }
  }

  function handlePrint() {
    const content = printRef.current;
    if (!content) return;
    openPrintPreviewWindow({
      title: 'Z Reading Preview',
      windowTitle: 'Z Reading',
      contentHtml: content.innerHTML,
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
        .preview-report .section-header { margin-top: 16px; margin-bottom: 6px; font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; color: #475569; }
        .preview-report .row { display: flex; justify-content: space-between; gap: 16px; padding: 4px 0; font-size: 13px; }
        .preview-report .row.indent { padding-left: 16px; }
        .preview-report .row.bold span { font-weight: bold; }
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

  const now = new Date();
  const closedAt = step === 'closed' ? now : null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <LogOut className="w-5 h-5 text-red-500" />
            <h2 className="font-bold text-slate-800">Z Reading</h2>
            <span className="text-xs text-slate-400 font-normal ml-1">(Day Summary)</span>
          </div>
          <div className="flex items-center gap-2">
            {(step === 'review' || step === 'closed') && (
              <>
                <button
                  onClick={() => loadReport(true)}
                  disabled={refreshing}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print
                </button>
              </>
            )}
            {step !== 'closed' && (
              <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !report ? (
            <p className="text-center text-slate-500 text-sm py-8">Failed to load report</p>
          ) : (
            <div>
              {step === 'closed' && (
                <div className="text-center mb-6 mt-2">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                  </div>
                  <p className="text-lg font-bold text-slate-800">Shift Closed</p>
                  <p className="text-sm text-slate-500 mt-1">Z Reading has been posted successfully.</p>
                </div>
              )}

              <div ref={printRef}>
                <h1 style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 18, fontWeight: 'bold', marginBottom: 2 }}>Z READING</h1>
                <h2 style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 13, color: '#555', marginBottom: 8 }}>Business Day Summary</h2>
                <div className="text-center text-xs text-slate-400 space-y-0.5 mb-4">
                  <p>Business Date: {report.businessDate}</p>
                  <p>Shifts Included: {report.shiftCount}</p>
                  <p>Open Shifts: {report.openShiftCount}</p>
                  <p>Closed Shifts: {report.closedShiftCount}</p>
                  <p>{step === 'closed' ? 'Shift Closed' : 'Printed'}: {(closedAt ?? now).toLocaleString('en-PH')}</p>
                </div>

                <div className="border-t border-dashed border-slate-300 my-3" />

                <SectionHeader title="Shift Summary" />
                <Row label="Total Shifts" value={report.shiftCount} />
                <Row label="Open Shifts" value={report.openShiftCount} />
                <Row label="Closed Shifts" value={report.closedShiftCount} />

                <SectionHeader title="Transactions" />
                <Row label="Transaction Count" value={report.txnCount} />
                <Row label="Void Count" value={report.voidCount} />
                <Row label="Return Count" value={report.returnCount} />

                <SectionHeader title="Sales Summary" />
                <Row label="Gross Sales" value={`₱${formatCurrency(report.grossSales)}`} />
                <Row label="Discounts" value={`-₱${formatCurrency(report.discounts)}`} highlight="red" indent />
                <Row label="Returns" value={`-₱${formatCurrency(report.returnTotal)}`} highlight="red" indent />
                <Row label="Voids" value={`-₱${formatCurrency(report.voidTotal)}`} highlight="red" indent />
                <Row label="Net Sales" value={`₱${formatCurrency(report.netSales)}`} bold separator />

                <SectionHeader title="Payment Breakdown" />
                <Row label="Cash Sales" value={`₱${formatCurrency(report.cashSales)}`} />
                <Row label="GCash Sales" value={`₱${formatCurrency(report.gcashSales)}`} />
                <Row label="Non-Cash Total" value={`₱${formatCurrency(report.nonCashSales)}`} bold separator />

                <SectionHeader title="Cash Summary" />
                <Row label="Opening Cash Total" value={`₱${formatCurrency(report.openingCash)}`} />
                <Row label="Cash Sales" value={`+₱${formatCurrency(report.cashSales)}`} highlight="green" indent />
                <Row label="Cash Returns" value={`-₱${formatCurrency(report.cashReturnTotal)}`} highlight="red" indent />
                <Row label="Cash Pickups" value={`-₱${formatCurrency(report.cashPickupTotal)}`} highlight="red" indent />
                <Row label="Expected Cash Total" value={`₱${formatCurrency(report.expectedCash)}`} bold separator />

                <div className="border-t border-dashed border-slate-300 mt-4 pt-3 text-center text-xs text-slate-400">
                  <p>*** Z READING — REGISTER DAY CLOSED ***</p>
                  <p className="mt-0.5">This summary includes all POS shifts for this register and business day.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {!loading && report && (
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100 flex-shrink-0">
            {step === 'review' ? (
              <>
                <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  Print
                </button>
                <button
                  onClick={handlePostZ}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {saving
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <LogOut className="w-4 h-4" />
                  }
                  Post Z &amp; Close Shift
                </button>
              </>
            ) : (
              <button
                onClick={onClosed}
                className="px-5 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
              >
                Done
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
