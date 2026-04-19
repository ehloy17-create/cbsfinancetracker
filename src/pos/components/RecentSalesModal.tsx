import { useEffect, useState, useCallback } from 'react';
import { X, Clock, Ban, RotateCcw, Receipt, ChevronLeft, RefreshCw, Banknote, Smartphone } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../lib/posUtils';

interface Props {
  shiftId: string;
  onClose: () => void;
  onVoid: (receiptNo: string) => void;
  onReturn: (receiptNo: string) => void;
}

type PaymentEntry = { method: string; amount: number };

function normalizePaymentMethod(method: string): 'cash' | 'gcash' | '' {
  const normalized = method.trim().toLowerCase();
  if (normalized === 'cash') return 'cash';
  if (normalized === 'gcash' || normalized === 'card' || normalized === 'bank') return 'gcash';
  return '';
}

type SaleRow = {
  saleId: string;
  receiptNo: string;
  totalAmount: number;
  time: string | null;
  customerId?: string | null;
  customerName: string;
  status: 'completed' | 'voided';
  voidReason?: string;
  payments: PaymentEntry[];
};

function paymentLabel(payments: PaymentEntry[]): { label: string; icon: React.ReactNode } {
  if (payments.length === 0) return { label: '—', icon: null };
  if (payments.length > 1) return {
    label: 'Split',
    icon: null,
  };
  const m = normalizePaymentMethod(payments[0].method);
  if (m === 'gcash') return { label: 'GCash', icon: <Smartphone className="w-3.5 h-3.5" /> };
  return { label: 'Cash', icon: <Banknote className="w-3.5 h-3.5" /> };
}

export default function RecentSalesModal({ shiftId, onClose, onVoid, onReturn }: Props) {
  const [sales, setSales]       = useState<SaleRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<SaleRow | null>(null);
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'cash' | 'gcash'>('all');

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      // Fetch all completed + voided sales for this shift (no date cap — shift = "the day")
      const [{ data: completedData }, { data: voidedData }, { data: customerRows }] = await Promise.all([
        supabase
          .from('sales')
          .select('sale_id, receipt_no, total_amount, created_at, customer_id')
          .eq('shift_id', shiftId)
          .eq('sale_status', 'completed')
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('sales')
          .select('sale_id, receipt_no, total_amount, voided_at, void_reason, customer_id')
          .eq('shift_id', shiftId)
          .eq('sale_status', 'voided')
          .order('voided_at', { ascending: false })
          .limit(500),
        supabase
          .from('pos_customers')
          .select('customer_id, first_name, last_name')
          .eq('is_active', true),
      ]);

      const customerMap = new Map(
        ((customerRows ?? []) as Array<Record<string, unknown>>).map(row => {
          const firstName = String(row.first_name ?? '').trim();
          const lastName = String(row.last_name ?? '').trim();
          return [
            String(row.customer_id ?? ''),
            `${firstName} ${lastName}`.trim() || 'Walk-in',
          ];
        })
      );

      const allRows = [
        ...((completedData ?? []) as Array<Record<string, unknown>>).map(r => ({
          saleId: String(r.sale_id ?? ''),
          receiptNo: String(r.receipt_no ?? ''),
          totalAmount: Number(r.total_amount ?? 0),
          time: r.created_at ? String(r.created_at) : null,
          customerId: r.customer_id ? String(r.customer_id) : null,
          customerName: customerMap.get(String(r.customer_id ?? '')) ?? 'Walk-in',
          status: 'completed' as const,
          payments: [] as PaymentEntry[],
        })),
        ...((voidedData ?? []) as Array<Record<string, unknown>>).map(r => ({
          saleId: String(r.sale_id ?? ''),
          receiptNo: String(r.receipt_no ?? ''),
          totalAmount: Number(r.total_amount ?? 0),
          time: r.voided_at ? String(r.voided_at) : null,
          customerId: r.customer_id ? String(r.customer_id) : null,
          customerName: customerMap.get(String(r.customer_id ?? '')) ?? 'Walk-in',
          status: 'voided' as const,
          voidReason: String(r.void_reason ?? ''),
          payments: [] as PaymentEntry[],
        })),
      ];

      // Fetch payment methods for all sales
      const allSaleIds = allRows.map(r => r.saleId).filter(Boolean);
      if (allSaleIds.length > 0) {
        const { data: pmtData } = await supabase
          .from('sale_payments')
          .select('sale_id, payment_method, amount')
          .in('sale_id', allSaleIds);

        const pmtMap = new Map<string, PaymentEntry[]>();
        for (const p of (pmtData ?? []) as Array<Record<string, unknown>>) {
          const sid = String(p.sale_id ?? '');
          const method = normalizePaymentMethod(String(p.payment_method ?? ''));
          if (!method) continue;
          if (!pmtMap.has(sid)) pmtMap.set(sid, []);
          pmtMap.get(sid)!.push({ method, amount: Number(p.amount ?? 0) });
        }
        for (const row of allRows) {
          row.payments = pmtMap.get(row.saleId) ?? [];
        }
      }

      // Sort by time desc
      allRows.sort((a, b) => {
        const ta = a.time ? new Date(a.time).getTime() : 0;
        const tb = b.time ? new Date(b.time).getTime() : 0;
        return tb - ta;
      });

      setSales(allRows);
    } finally {
      if (quiet) setRefreshing(false);
      else setLoading(false);
    }
  }, [shiftId]);

  useEffect(() => { load(); }, [load]);

  // Escape: back to list if detail open, otherwise close modal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (selected) setSelected(null);
      else onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, onClose]);

  // Totals by payment method (completed sales only)
  const completedSales = sales.filter(s => s.status === 'completed');
  const filteredSales = completedSales.filter(sale => {
    if (paymentFilter === 'cash') return sale.payments.some(payment => payment.method === 'cash');
    if (paymentFilter === 'gcash') return sale.payments.some(payment => payment.method === 'gcash');
    return true;
  });
  const cashTotal  = completedSales.flatMap(s => s.payments).filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
  const gcashTotal = completedSales.flatMap(s => s.payments).filter(p => p.method === 'gcash').reduce((s, p) => s + p.amount, 0);
  const grandTotal = completedSales.reduce((sum, sale) => sum + sale.totalAmount, 0);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            {selected ? (
              <button
                onClick={() => setSelected(null)}
                className="flex items-center gap-1 text-slate-500 hover:text-slate-800 text-sm transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Back to Transactions
              </button>
            ) : (
              <>
                <Clock className="w-5 h-5 text-slate-600" />
                <h2 className="font-semibold text-slate-800">Recent Transactions</h2>
                <span className="text-xs text-slate-400 font-normal ml-1">({filteredSales.length})</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!selected && (
              <button
                onClick={() => load(true)}
                disabled={refreshing}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Payment method totals summary */}
        {!selected && !loading && (
          <div className="px-5 py-3 border-b border-slate-100 flex-shrink-0 grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setPaymentFilter('cash')}
              className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                paymentFilter === 'cash' ? 'bg-emerald-50 border-emerald-300 shadow-sm' : 'bg-slate-50 border-slate-200 hover:border-emerald-200'
              }`}
            >
              <Banknote className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-slate-500 font-medium">Cash</p>
                <p className="font-mono font-bold text-slate-800 text-sm truncate">₱{formatCurrency(cashTotal)}</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setPaymentFilter('gcash')}
              className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                paymentFilter === 'gcash' ? 'bg-blue-50 border-blue-300 shadow-sm' : 'bg-slate-50 border-slate-200 hover:border-blue-200'
              }`}
            >
              <Smartphone className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-slate-500 font-medium">GCash</p>
                <p className="font-mono font-bold text-slate-800 text-sm truncate">₱{formatCurrency(gcashTotal)}</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setPaymentFilter('all')}
              className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                paymentFilter === 'all' ? 'bg-emerald-50 border-emerald-300 shadow-sm' : 'bg-slate-50 border-slate-200 hover:border-emerald-200'
              }`}
            >
              <Receipt className="w-5 h-5 text-emerald-700 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-emerald-700 font-medium">Total</p>
                <p className="font-mono font-bold text-emerald-800 text-sm truncate">₱{formatCurrency(grandTotal)}</p>
              </div>
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !selected ? (
            filteredSales.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Receipt className="w-10 h-10 mb-3 opacity-40" />
                <p className="text-sm">No transactions match the selected filter.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                  <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Receipt / Customer</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Time</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSales.map(sale => {
                    const { label, icon } = paymentLabel(sale.payments);
                    return (
                      <tr
                        key={sale.saleId}
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                        onClick={() => setSelected(sale)}
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-mono font-semibold text-slate-800">{sale.receiptNo}</p>
                            <p className="text-xs text-slate-500">{sale.customerName || 'Walk-in'}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">
                          {sale.time ? new Date(sale.time).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                            label === 'GCash'  ? 'bg-blue-100 text-blue-700' :
                            label === 'Cash'   ? 'bg-emerald-100 text-emerald-700' :
                            label === 'Split'  ? 'bg-purple-100 text-purple-700' :
                            'bg-slate-100 text-slate-500'
                          }`}>
                            {icon}{label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-slate-700">
                          ₱{formatCurrency(sale.totalAmount)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {sale.status === 'voided' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                              <Ban className="w-3 h-3" /> Voided
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                              <Receipt className="w-3 h-3" /> Completed
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : (
            /* ── Transaction detail ── */
            <div className="p-5 space-y-5">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Receipt No.</span>
                  <span className="font-mono font-bold text-slate-800">{selected.receiptNo}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Customer</span>
                  <span className="text-sm font-medium text-slate-700">{selected.customerName || 'Walk-in'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Total Amount</span>
                  <span className="font-mono font-bold text-slate-800">₱{formatCurrency(selected.totalAmount)}</span>
                </div>
                {/* Payment breakdown */}
                {selected.payments.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 space-y-1.5">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Payment</p>
                    {selected.payments.map((p, i) => (
                      <div key={i} className="flex items-center justify-between">
                        {(() => {
                          const method = normalizePaymentMethod(p.method);
                          const isGcash = method === 'gcash';
                          return (
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                          isGcash ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {isGcash ? <Smartphone className="w-3 h-3" /> : <Banknote className="w-3 h-3" />}
                          {isGcash ? 'GCash' : 'Cash'}
                        </span>
                          );
                        })()}
                        <span className="font-mono font-semibold text-slate-700 text-sm">₱{formatCurrency(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                  <span className="text-sm text-slate-500">Time</span>
                  <span className="text-sm text-slate-700">
                    {selected.time ? new Date(selected.time).toLocaleString('en-PH') : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Status</span>
                  {selected.status === 'voided' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                      <Ban className="w-3 h-3" /> Voided
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                      <Receipt className="w-3 h-3" /> Completed
                    </span>
                  )}
                </div>
                {selected.status === 'voided' && selected.voidReason && (
                  <div className="pt-2 border-t border-slate-200">
                    <p className="text-xs text-red-700">
                      <span className="font-semibold">Void Reason:</span> {selected.voidReason}
                    </p>
                  </div>
                )}
              </div>

              {selected.status === 'completed' ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => onVoid(selected.receiptNo)}
                      className="flex flex-col items-center justify-center gap-2 p-5 rounded-xl border-2 border-red-200 bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-700 transition-colors"
                    >
                      <Ban className="w-7 h-7" />
                      <span className="text-sm font-semibold">Void Transaction</span>
                      <span className="text-xs text-red-500 text-center leading-tight">Cancel this sale entirely</span>
                    </button>
                    <button
                      onClick={() => onReturn(selected.receiptNo)}
                      className="flex flex-col items-center justify-center gap-2 p-5 rounded-xl border-2 border-orange-200 bg-orange-50 hover:bg-orange-100 active:bg-orange-200 text-orange-700 transition-colors"
                    >
                      <RotateCcw className="w-7 h-7" />
                      <span className="text-sm font-semibold">Sales Return</span>
                      <span className="text-xs text-orange-500 text-center leading-tight">Return items from this sale</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-center">
                  <Ban className="w-6 h-6 text-red-400 mx-auto mb-1" />
                  <p className="text-sm text-red-700 font-medium">This transaction has been voided.</p>
                  <p className="text-xs text-red-500 mt-0.5">No further actions are available.</p>
                </div>
              )}

              <p className="text-xs text-slate-400 text-center">
                Press{' '}
                <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 font-mono text-xs">Esc</kbd>
                {' '}to go back to the list
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        {!selected && !loading && (
          <div className="px-5 py-3 border-t border-slate-100 flex-shrink-0 text-center">
            <p className="text-xs text-slate-400">
              Click a transaction to view details and actions ·{' '}
              <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-500 font-mono text-xs">Esc</kbd>
              {' '}to close
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
