import { useEffect, useState } from 'react';
import { XCircle, Search, RotateCcw, CheckCircle, Minus, Plus } from 'lucide-react';
import { fetchRecentReturns, fetchRecentSales, fetchSaleByReceiptNo, postReturn, RecentReturnLookup, RecentSaleLookup } from '../lib/posCheckout';
import { formatCurrency } from '../lib/posUtils';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';

interface Props {
  shiftId: string;
  terminalId: string;
  locationId: string;
  cashierId: string;
  initialReceiptNo?: string;
  onClose: () => void;
  onReturned: (returnNo: string) => void;
}

type RefundMethod = 'cash' | 'store_credit' | 'original_method';

interface ReturnLine {
  originalSaleItemId: string;
  productId: string | null;
  productNameSnapshot: string;
  skuCode: string;
  selectedUnitName: string;
  baseUnitName: string;
  qtyInBaseUnitPerUnit: number;
  maxQty: number;
  qtyToReturn: number;
  unitPrice: number;
}

export default function SalesReturnModal({ shiftId, terminalId, locationId, cashierId, initialReceiptNo, onClose, onReturned }: Props) {
  const { showToast } = useToast();

  const [receiptNo, setReceiptNo]       = useState(initialReceiptNo ?? '');
  const [sale, setSale]                 = useState<Record<string, unknown> | null>(null);
  const [searching, setSearching]       = useState(false);
  const [step, setStep]                 = useState<'search' | 'select'>('search');
  const [returnLines, setReturnLines]   = useState<ReturnLine[]>([]);
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('cash');
  const [reason, setReason]             = useState('');
  const [notes, setNotes]               = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [processing, setProcessing]     = useState(false);
  const [recentSales, setRecentSales]   = useState<RecentSaleLookup[]>([]);
  const [recentReturns, setRecentReturns] = useState<RecentReturnLookup[]>([]);

  useEffect(() => {
    fetchRecentSales(shiftId)
      .then(setRecentSales)
      .catch(() => setRecentSales([]));
    fetchRecentReturns(shiftId)
      .then(setRecentReturns)
      .catch(() => setRecentReturns([]));
  }, [shiftId]);

  async function buildReturnLines(items: unknown[]) {
    const itemIds = items
      .map(item => String((item as Record<string, unknown>).item_id ?? ''))
      .filter(Boolean);

    const returnedMap = new Map<string, number>();
    if (itemIds.length > 0) {
      const { data } = await supabase
        .from('sale_return_items')
        .select('original_sale_item_id, qty_returned')
        .in('original_sale_item_id', itemIds);

      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const key = String(row.original_sale_item_id ?? '');
        const qty = Number(row.qty_returned ?? 0);
        returnedMap.set(key, (returnedMap.get(key) ?? 0) + qty);
      }
    }

    return items.map(item => {
      const it = item as Record<string, unknown>;
      const originalSaleItemId = String(it.item_id ?? '');
      const soldQty = Number(it.qty ?? 0);
      const alreadyReturned = returnedMap.get(originalSaleItemId) ?? 0;
      return {
        originalSaleItemId,
        productId: (it.product_id as string | null) ?? null,
        productNameSnapshot: it.product_name_snapshot as string,
        skuCode: (it.sku_code as string) ?? '',
        selectedUnitName: String(it.selected_unit_name ?? it.base_unit_name ?? 'Unit'),
        baseUnitName: String(it.base_unit_name ?? ''),
        qtyInBaseUnitPerUnit: Number(it.qty_in_base_unit_per_unit ?? 1),
        maxQty: Math.max(0, soldQty - alreadyReturned),
        qtyToReturn: 0,
        unitPrice: Number(it.unit_price ?? 0),
      };
    });
  }

  async function loadSale(reference: string) {
    const data = await fetchSaleByReceiptNo(reference.trim());
    if (!data) {
      showToast('Order slip not found or already voided', 'error');
      return false;
    }

    const saleData = data as Record<string, unknown>;
    const items = (saleData.sale_items as unknown[]) ?? [];
    const nextLines = await buildReturnLines(items);
    setSale(saleData);
    setReturnLines(nextLines);
    setStep('select');
    return true;
  }

  // Auto-load when initialReceiptNo is provided
  useEffect(() => {
    if (!initialReceiptNo) return;
    setSearching(true);
    loadSale(initialReceiptNo)
      .catch(() => showToast('Error looking up receipt', 'error'))
      .finally(() => setSearching(false));
  }, [initialReceiptNo]);

  // Escape: select step → back to search; search step → close
  // Enter: select step → process return; search step → no-op (handled by input onKeyDown)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (step === 'select') { setStep('search'); setSale(null); setReturnLines([]); }
        else { onClose(); }
        return;
      }
      if (e.key === 'Enter') {
        if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
        if (step === 'select' && !processing) { e.preventDefault(); void handleReturn(); }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, onClose, processing]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSearch() {
    if (!receiptNo.trim()) return;
    setSearching(true);
    try {
      await loadSale(receiptNo);
    } catch {
      showToast('Error looking up receipt', 'error');
    } finally {
      setSearching(false);
    }
  }

  function updateQty(idx: number, delta: number) {
    setReturnLines(prev => {
      const updated = [...prev];
      const line = updated[idx];
      updated[idx] = { ...line, qtyToReturn: Math.min(line.maxQty, Math.max(0, line.qtyToReturn + delta)) };
      return updated;
    });
  }

  function setQty(idx: number, val: number) {
    setReturnLines(prev => {
      const updated = [...prev];
      const line = updated[idx];
      updated[idx] = { ...line, qtyToReturn: Math.min(line.maxQty, Math.max(0, val)) };
      return updated;
    });
  }

  const selectedLines = returnLines.filter(l => l.qtyToReturn > 0);
  const totalReturnAmt = selectedLines.reduce((s, l) => s + l.qtyToReturn * l.unitPrice, 0);

  async function handleReturn() {
    if (selectedLines.length === 0 || !reason.trim() || !sale) return;
    setProcessing(true);
    try {
      const returnNo = await postReturn({
        originalSaleId: sale.sale_id as string,
        shiftId, terminalId, locationId, cashierId,
        supervisorId: supervisorId.trim() || undefined,
        reason: reason.trim(),
        refundMethod,
        items: selectedLines.map(l => ({
          original_sale_item_id: l.originalSaleItemId,
          product_id: l.productId,
          product_name_snapshot: l.productNameSnapshot,
          sku_code: l.skuCode,
          qty_returned: l.qtyToReturn,
          unit_price: l.unitPrice,
          subtotal: l.qtyToReturn * l.unitPrice,
        })),
        totalReturnAmt,
        notes: notes.trim(),
      });
      showToast(`Return processed — ${returnNo}`, 'success');
      onReturned(returnNo);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Return failed', 'error');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-orange-500" />
            <h2 className="font-semibold text-slate-800">Sales Return / Refund</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {step === 'search' && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Original Order Slip Reference
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={receiptNo}
                  onChange={e => setReceiptNo(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="e.g. OS-00000001"
                  className="flex-1 px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
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
                              await loadSale(recent.receiptNo);
                            } catch {
                              showToast('Error looking up order slip', 'error');
                            } finally {
                              setSearching(false);
                            }
                          })();
                        }}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-orange-300 hover:bg-orange-50 transition-colors"
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
              {recentReturns.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Recent Returns</p>
                  <div className="space-y-2">
                    {recentReturns.map(recent => (
                      <div
                        key={recent.returnId}
                        className="flex w-full items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-left text-sm"
                      >
                        <div>
                          <p className="font-mono font-semibold text-orange-800">{recent.returnNo}</p>
                          <p className="text-xs text-orange-700">
                            OS: <span className="font-mono">{recent.originalReceiptNo}</span> · {recent.createdAt ? new Date(recent.createdAt).toLocaleString('en-PH') : '—'}
                          </p>
                          <p className="mt-1 text-xs text-orange-700">Refund: {recent.refundMethod.replace(/_/g, ' ')}</p>
                        </div>
                        <p className="font-mono font-semibold text-orange-800">₱{formatCurrency(recent.totalReturnAmt)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'select' && sale && (
            <>
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="text-slate-500">Receipt: </span>
                  <span className="font-mono font-semibold text-slate-800">{sale.receipt_no as string}</span>
                  <span className="text-slate-400 ml-2">— ₱{formatCurrency(sale.total_amount as number)}</span>
                </div>
                <button onClick={() => { setStep('search'); setSale(null); setReturnLines([]); }} className="text-xs text-blue-600 hover:text-blue-800 underline">
                  Change receipt
                </button>
              </div>

              <p className="text-xs text-slate-500">Select quantities to return:</p>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-3 py-2.5 text-slate-500 font-medium text-xs">Item</th>
                      <th className="text-center px-3 py-2.5 text-slate-500 font-medium text-xs">Returnable</th>
                      <th className="text-center px-3 py-2.5 text-slate-500 font-medium text-xs">Return Qty</th>
                      <th className="text-right px-3 py-2.5 text-slate-500 font-medium text-xs">Refund</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {returnLines.map((line, idx) => (
                      <tr key={idx} className={line.qtyToReturn > 0 ? 'bg-orange-50' : ''}>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-slate-800 leading-tight">{line.productNameSnapshot}</p>
                          {line.skuCode && <p className="text-xs text-slate-400">{line.skuCode}</p>}
                          <p className="text-xs text-slate-500">{line.selectedUnitName}</p>
                        </td>
                        <td className="px-3 py-2.5 text-center text-slate-600">
                          <div>{line.maxQty}</div>
                          {line.qtyInBaseUnitPerUnit > 0 ? (
                            <div className="text-[11px] text-slate-500">
                              {line.qtyInBaseUnitPerUnit.toLocaleString('en-PH', { maximumFractionDigits: 6 })} {line.baseUnitName}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1.5">
                            <button onClick={() => updateQty(idx, -1)} disabled={line.qtyToReturn === 0} className="w-6 h-6 rounded-full bg-slate-200 hover:bg-slate-300 disabled:opacity-30 flex items-center justify-center transition-colors">
                              <Minus className="w-3 h-3 text-slate-700" />
                            </button>
                            <input
                              type="number" step="1" inputMode="numeric"
                              min={0}
                              max={line.maxQty}
                              value={line.qtyToReturn}
                              onChange={e => setQty(idx, parseInt(e.target.value) || 0)}
                              className="w-12 text-center text-sm border border-slate-200 rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-orange-400 font-mono"
                            />
                            <button onClick={() => updateQty(idx, 1)} disabled={line.qtyToReturn >= line.maxQty} className="w-6 h-6 rounded-full bg-slate-200 hover:bg-slate-300 disabled:opacity-30 flex items-center justify-center transition-colors">
                              <Plus className="w-3 h-3 text-slate-700" />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700">
                          {line.qtyToReturn > 0 ? `₱${formatCurrency(line.qtyToReturn * line.unitPrice)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedLines.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 bg-orange-50 border border-orange-200 rounded-xl">
                  <span className="text-sm font-medium text-orange-800">{selectedLines.length} line{selectedLines.length !== 1 ? 's' : ''} selected</span>
                  <span className="font-mono font-bold text-orange-700 text-lg">₱{formatCurrency(totalReturnAmt)}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Refund Method</label>
                <div className="flex gap-2">
                  {(['cash', 'store_credit', 'original_method'] as RefundMethod[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setRefundMethod(m)}
                      className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                        refundMethod === m
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {m === 'cash' ? 'Cash' : m === 'store_credit' ? 'Store Credit' : 'Original Method'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Return Reason <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Defective item, wrong product..."
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Supervisor ID (optional)</label>
                <input
                  type="text"
                  value={supervisorId}
                  onChange={e => setSupervisorId(e.target.value)}
                  placeholder="Leave blank to use your own ID"
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Additional notes..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                />
              </div>
            </>
          )}
        </div>

        {step === 'select' && (
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100 flex-shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
            <button
              onClick={handleReturn}
              disabled={processing || selectedLines.length === 0 || !reason.trim()}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors"
            >
              {processing
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <CheckCircle className="w-4 h-4" />}
              Process Return
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
