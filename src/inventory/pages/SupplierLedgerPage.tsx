import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search, X, ChevronDown, BookOpen } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Payable, PayablePayment } from '../../lib/types';
import {
  PAYABLE_STATUS_LABELS, PAYABLE_STATUS_COLORS,
  formatCurrency, formatDate, isOverdue, PAYMENT_METHOD_LABELS,
} from '../lib/payableUtils';
import { normalizePayable, normalizePayablePayment } from '../lib/payableData';

type TxRow =
  | { kind: 'payable'; date: string; data: Payable }
  | { kind: 'payment'; date: string; data: PayablePayment & { payable_number?: string } };

interface InvSupplierRow {
  id: string;
  code: string;
  name: string;
}

export default function SupplierLedgerPage() {
  const [suppliers, setSuppliers] = useState<InvSupplierRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [rows, setRows] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase.from('suppliers').select('id, code, name').eq('is_active', true).order('name').then(({ data }) => {
      setSuppliers((data ?? []) as InvSupplierRow[]);
    });
  }, []);

  const loadLedger = useCallback(async (suppId: string) => {
    if (!suppId) { setRows([]); return; }
    setLoading(true);

    const payRes = await supabase
      .from('payables')
      .select('*')
      .eq('supplier_id', suppId)
      .order('created_at', { ascending: true });

    const payables = ((payRes.data ?? []) as Array<Record<string, unknown>>).map(normalizePayable);
    const poIds = payables.map(payable => payable.po_id).filter(Boolean) as string[];
    const receivingIds = payables.map(payable => payable.receiving_id).filter(Boolean) as string[];
    const [{ data: poRows }, { data: receivingRows }] = await Promise.all([
      poIds.length > 0
        ? supabase.from('purchase_orders').select('id, po_number').in('id', poIds)
        : Promise.resolve({ data: [] }),
      receivingIds.length > 0
        ? supabase.from('receivings').select('id, receiving_number').in('id', receivingIds)
        : Promise.resolve({ data: [] }),
    ]);
    const poMap = new Map(((poRows ?? []) as Array<{ id: string; po_number: string }>).map(row => [row.id, row]));
    const receivingMap = new Map(((receivingRows ?? []) as Array<{ id: string; receiving_number: string }>).map(row => [row.id, row]));
    const payableIds = payables.map(payable => payable.id);
    const payments = payableIds.length > 0
      ? ((await supabase
          .from('payable_payments')
          .select('*')
          .in('payable_id', payableIds)
          .order('payment_date', { ascending: true }))
          .data ?? []).map((row: unknown) => normalizePayablePayment(row as Record<string, unknown>))
      : [];
    const payableNumberMap = new Map(payables.map(payable => [payable.id, payable.payable_number]));

    const allRows: TxRow[] = [
      ...payables.map(p => ({
        kind: 'payable' as const,
        date: p.invoice_date,
        data: {
          ...p,
          purchase_orders: p.po_id ? poMap.get(p.po_id) : undefined,
          receivings: p.receiving_id ? receivingMap.get(p.receiving_id) : undefined,
        },
      })),
      ...payments.map((p: PayablePayment) => ({
        kind: 'payment' as const,
        date: p.payment_date,
        data: { ...p, payable_number: payableNumberMap.get(p.payable_id) },
      })),
    ];

    allRows.sort((a, b) => {
      if (a.date === b.date) {
        if (a.kind === 'payable' && b.kind === 'payment') return -1;
        if (a.kind === 'payment' && b.kind === 'payable') return 1;
        return 0;
      }
      return a.date < b.date ? -1 : 1;
    });

    setRows(allRows);
    setLoading(false);
  }, []);

  useEffect(() => { loadLedger(selectedId); }, [selectedId, loadLedger]);

  const selectedSupplier = suppliers.find(s => s.id === selectedId);

  let runningBalance = 0;
  const rowsWithBalance = rows.map(row => {
    if (row.kind === 'payable') {
      runningBalance += Number((row.data as Payable).total_amount);
    } else {
      runningBalance -= Number((row.data as PayablePayment).amount);
    }
    return { ...row, runningBalance };
  });

  const totalBilled = rows.filter(r => r.kind === 'payable').reduce((s, r) => s + Number((r.data as Payable).total_amount), 0);
  const totalPaid = rows.filter(r => r.kind === 'payment').reduce((s, r) => s + Number((r.data as PayablePayment).amount), 0);
  const netBalance = totalBilled - totalPaid;

  const filteredRows = search
    ? rowsWithBalance.filter(row => {
        const q = search.toLowerCase();
        if (row.kind === 'payable') {
          const p = row.data as Payable;
          return p.payable_number?.toLowerCase().includes(q) || p.invoice_number?.toLowerCase().includes(q);
        }
        const p = row.data as PayablePayment & { payable_number?: string };
        return (p.payable_number ?? '').toLowerCase().includes(q) || (p.reference_number ?? '').toLowerCase().includes(q);
      })
    : rowsWithBalance;

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/inventory/payables" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Accounts Payable
        </Link>
        <span className="text-slate-300">/</span>
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-slate-400" />
          <h1 className="text-lg font-bold text-slate-800">Supplier Ledger</h1>
        </div>
      </div>

      {/* Supplier selector */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-56">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Select Supplier</label>
            <div className="relative">
              <select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— Choose a supplier —</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>[{s.code}] {s.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {selectedId && (
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter by payable #, invoice, ref..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {selectedId && !loading && rows.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Billed</p>
            <p className="text-xl font-bold text-slate-800 tabular-nums">₱{formatCurrency(totalBilled)}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Paid</p>
            <p className="text-xl font-bold text-emerald-700 tabular-nums">₱{formatCurrency(totalPaid)}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Net Balance</p>
            <p className={`text-xl font-bold tabular-nums ${netBalance > 0 ? 'text-red-700' : 'text-slate-300'}`}>
              ₱{formatCurrency(netBalance)}
            </p>
          </div>
        </div>
      )}

      {/* Ledger table */}
      {!selectedId ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm py-20 text-center">
          <BookOpen className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">Select a supplier to view their ledger</p>
          <p className="text-xs text-slate-400 mt-1">Shows all payables and payments in chronological order</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm py-16 text-center">
          <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading ledger...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm py-16 text-center">
          <p className="text-sm font-medium text-slate-500">No transactions found for {selectedSupplier?.name}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">
              {selectedSupplier?.name} — Transaction Ledger
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{filteredRows.length} entries</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Reference</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Details</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Debit (Bill)</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Credit (Payment)</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row, idx) => {
                  if (row.kind === 'payable') {
                    const p = row.data as Payable;
                    const overdue = isOverdue(p);
                    const po = p.purchase_orders as { id: string; po_number: string } | null | undefined;
                    const recv = p.receivings as { id: string; receiving_number: string } | null | undefined;
                    const sc = PAYABLE_STATUS_COLORS[p.payment_status];

                    return (
                      <tr key={`pay-${p.id}`} className={`hover:bg-slate-50 transition-colors ${overdue ? 'bg-red-50/20' : ''}`}>
                        <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">{formatDate(p.invoice_date)}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700">
                            Bill
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Link to={`/inventory/payables/${p.id}`} className="font-mono text-xs text-blue-600 hover:underline font-semibold">
                            {p.payable_number}
                          </Link>
                          {p.invoice_number && (
                            <p className="text-xs text-slate-400 mt-0.5">Inv: {p.invoice_number}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 space-y-0.5">
                          {po && (
                            <Link to={`/inventory/purchase-orders/${po.id}`} className="block text-blue-600 hover:underline font-mono">
                              PO: {po.po_number}
                            </Link>
                          )}
                          {recv && (
                            <Link to={`/inventory/receivings/${recv.id}`} className="block text-blue-600 hover:underline font-mono">
                              GR: {recv.receiving_number}
                            </Link>
                          )}
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border ${sc.bg} ${sc.text} ${sc.border}`}>
                            {PAYABLE_STATUS_LABELS[p.payment_status]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800">
                          ₱{formatCurrency(Number(p.total_amount))}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">—</td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-800">
                          ₱{formatCurrency(row.runningBalance)}
                        </td>
                      </tr>
                    );
                  } else {
                    const p = row.data as PayablePayment & { payable_number?: string };
                    return (
                      <tr key={`pymt-${p.id}-${idx}`} className="hover:bg-emerald-50/30 transition-colors">
                        <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">{formatDate(p.payment_date)}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700">
                            Payment
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {p.payable_number && (
                            <p className="font-mono text-xs text-slate-600">{p.payable_number}</p>
                          )}
                          {p.reference_number && (
                            <p className="text-xs text-slate-400 mt-0.5">Ref: {p.reference_number}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method}
                          {p.remarks && <p className="text-slate-400 mt-0.5">{p.remarks}</p>}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">—</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">
                          ₱{formatCurrency(Number(p.amount))}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-800">
                          ₱{formatCurrency(row.runningBalance)}
                        </td>
                      </tr>
                    );
                  }
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200">
                  <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-slate-700 text-right">Totals</td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-800">₱{formatCurrency(totalBilled)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-700">₱{formatCurrency(totalPaid)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums font-bold text-lg ${netBalance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    ₱{formatCurrency(netBalance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

