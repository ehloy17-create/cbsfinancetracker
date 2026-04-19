import { useEffect, useState } from 'react';
import { XCircle, Search, AlertTriangle, Ban, CheckCircle } from 'lucide-react';
import { fetchRecentSales, fetchRecentVoidedSales, fetchSaleByReceiptNo, RecentSaleLookup, RecentVoidLookup, voidSale } from '../lib/posCheckout';
import { formatCurrency } from '../lib/posUtils';
import { useToast } from '../../contexts/ToastContext';

interface Props {
  shiftId: string;
  terminalId: string;
  actorId: string;
  initialReceiptNo?: string;
  onClose: () => void;
  onVoided: () => void;
}

export default function VoidTransactionModal({ shiftId, terminalId, actorId, initialReceiptNo, onClose, onVoided }: Props) {
  const { showToast } = useToast();

  const [receiptNo, setReceiptNo]   = useState(initialReceiptNo ?? '');
  const [supervisorId, setSupervisorId] = useState('');
  const [reason, setReason]         = useState('');
  const [sale, setSale]             = useState<Record<string, unknown> | null>(null);
  const [searching, setSearching]   = useState(false);
  const [voiding, setVoiding]       = useState(false);
  const [step, setStep]             = useState<'search' | 'confirm'>('search');
  const [recentSales, setRecentSales] = useState<RecentSaleLookup[]>([]);
  const [recentVoids, setRecentVoids] = useState<RecentVoidLookup[]>([]);

  useEffect(() => {
    fetchRecentSales(shiftId)
      .then(setRecentSales)
      .catch(() => setRecentSales([]));
    fetchRecentVoidedSales(shiftId)
      .then(setRecentVoids)
      .catch(() => setRecentVoids([]));
  }, [shiftId]);

  // Auto-search when initialReceiptNo is provided
  useEffect(() => {
    if (!initialReceiptNo) return;
    setSearching(true);
    fetchSaleByReceiptNo(initialReceiptNo)
      .then(data => {
        if (!data) { showToast('Receipt not found or already voided', 'error'); return; }
        setSale(data as Record<string, unknown>);
        setStep('confirm');
      })
      .catch(() => showToast('Error looking up receipt', 'error'))
      .finally(() => setSearching(false));
  }, [initialReceiptNo]);

  async function handleSearch() {
    if (!receiptNo.trim()) return;
    setSearching(true);
    try {
      const data = await fetchSaleByReceiptNo(receiptNo.trim());
      if (!data) { showToast('Receipt not found or already voided', 'error'); setSale(null); return; }
      setSale(data as Record<string, unknown>);
      setStep('confirm');
    } catch {
      showToast('Error looking up receipt', 'error');
    } finally {
      setSearching(false);
    }
  }

  async function handleVoid() {
    if (!sale || !reason.trim()) return;
    setVoiding(true);
    try {
      await voidSale(
        sale.sale_id as string,
        reason.trim(),
        supervisorId.trim() || actorId,
        shiftId, terminalId, actorId
      );
      showToast('Transaction voided', 'success');
      onVoided();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to void', 'error');
    } finally {
      setVoiding(false);
    }
  }

  // Escape: confirm step → back to search; search step → close
  // Enter: confirm step → void; search step → no-op (handled by input onKeyDown)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (step === 'confirm') { setStep('search'); setSale(null); }
        else { onClose(); }
        return;
      }
      if (e.key === 'Enter') {
        if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
        if (step === 'confirm' && !voiding) { e.preventDefault(); void handleVoid(); }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, onClose, voiding]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = (sale?.sale_items as unknown[]) ?? [];
  const salePayments = (sale?.sale_payments as Array<Record<string, unknown>> | undefined) ?? [];
  const hasGcashPayment = salePayments.some(payment => String(payment.payment_method ?? '').toLowerCase() === 'gcash');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Ban className="w-5 h-5 text-red-500" />
            <h2 className="font-semibold text-slate-800">Void Transaction</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {step === 'search' && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Order Slip Reference
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={receiptNo}
                  onChange={e => setReceiptNo(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="e.g. OS-00000001"
                  className="flex-1 px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
                  autoFocus
                />
                <button
                  onClick={handleSearch}
                  disabled={searching || !receiptNo.trim()}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-colors"
                >
                  {searching
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Search className="w-4 h-4" />}
                  Find
                </button>
              </div>
              {recentSales.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Recent Sales</p>
                  <div className="space-y-2">
                    {recentSales.map(recent => (
                      <button
                        key={recent.saleId}
                        type="button"
                        onClick={() => {
                          setReceiptNo(recent.receiptNo);
                          void (async () => {
                            setSearching(true);
                            try {
                              const data = await fetchSaleByReceiptNo(recent.receiptNo);
                              if (!data) {
                                showToast('Order slip not found or already voided', 'error');
                                return;
                              }
                              setSale(data as Record<string, unknown>);
                              setStep('confirm');
                            } catch {
                              showToast('Error looking up order slip', 'error');
                            } finally {
                              setSearching(false);
                            }
                          })();
                        }}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-red-300 hover:bg-red-50 transition-colors"
                      >
                        <div>
                          <p className="font-mono font-semibold text-slate-800">{recent.receiptNo}</p>
                          <p className="text-xs text-slate-500">{recent.createdAt ? new Date(recent.createdAt).toLocaleString('en-PH') : '—'}</p>
                        </div>
                        <p className="font-mono font-semibold text-slate-700">₱{formatCurrency(recent.totalAmount)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {recentVoids.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Recently Voided</p>
                  <div className="space-y-2">
                    {recentVoids.map(recent => (
                      <div
                        key={recent.saleId}
                        className="flex w-full items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm"
                      >
                        <div>
                          <p className="font-mono font-semibold text-red-800">{recent.receiptNo}</p>
                          <p className="text-xs text-red-600">{recent.voidedAt ? new Date(recent.voidedAt).toLocaleString('en-PH') : '—'}</p>
                          {recent.voidReason && <p className="mt-1 text-xs text-red-700">{recent.voidReason}</p>}
                        </div>
                        <p className="font-mono font-semibold text-red-800">₱{formatCurrency(recent.totalAmount)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'confirm' && sale && (
            <>
              <button onClick={() => { setStep('search'); setSale(null); }} className="text-xs text-blue-600 hover:text-blue-800 underline">
                Search different receipt
              </button>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Receipt</span>
                  <span className="font-mono font-semibold text-slate-800">{sale.receipt_no as string}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Total</span>
                  <span className="font-mono font-semibold text-slate-800">₱{formatCurrency(sale.total_amount as number)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Items</span>
                  <span className="font-medium text-slate-700">{items.length}</span>
                </div>
              </div>

              {items.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-3 py-2 text-slate-500 font-medium">Item</th>
                        <th className="text-right px-3 py-2 text-slate-500 font-medium">Qty</th>
                        <th className="text-right px-3 py-2 text-slate-500 font-medium">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((item, i) => {
                        const it = item as Record<string, unknown>;
                        return (
                          <tr key={i}>
                            <td className="px-3 py-2 text-slate-700">
                              <div>{it.product_name_snapshot as string}</div>
                              <div className="text-[11px] text-slate-500">{String(it.selected_unit_name ?? it.base_unit_name ?? 'Unit')}</div>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">
                              {it.qty as number}
                              {it.total_base_qty_deducted ? (
                                <div className="text-[11px] text-slate-500">
                                  {Number(it.total_base_qty_deducted)} {String(it.base_unit_name ?? '')}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-700">₱{formatCurrency(it.subtotal as number)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Supervisor ID (optional)
                </label>
                <input
                  type="text"
                  value={supervisorId}
                  onChange={e => setSupervisorId(e.target.value)}
                  placeholder="Leave blank to use your own ID"
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Void Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={2}
                  placeholder="Reason for voiding this transaction..."
                  autoFocus
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                />
              </div>

              <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">
                  Voiding cannot be undone. Inventory will be restored, and{hasGcashPayment ? ' the related GCash payment will be posted as a reversal entry.' : ' sale records will remain in the audit trail.'}
                </p>
              </div>
            </>
          )}
        </div>

        {step === 'confirm' && sale && (
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100 flex-shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
            <button
              onClick={handleVoid}
              disabled={voiding || !reason.trim()}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {voiding
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <CheckCircle className="w-4 h-4" />}
              Confirm Void
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
