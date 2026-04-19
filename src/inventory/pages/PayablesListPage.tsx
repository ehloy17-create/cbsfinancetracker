import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, CalendarClock, ChevronDown,
  DollarSign, Plus, Search, X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvSupplier, Payable, PayablePaymentStatus } from '../../lib/types';
import {
  PAYABLE_STATUS_COLORS,
  PAYABLE_STATUS_LABELS,
  formatCurrency,
  formatDate,
  isOverdue,
} from '../lib/payableUtils';
import PaymentEntryModal from '../components/PaymentEntryModal';
import ManualPayableModal from '../components/ManualPayableModal';
import { getPayableSource, getPayableSourceLabel, normalizePayable } from '../lib/payableData';

type StatusFilter = 'open' | 'all' | PayablePaymentStatus;
type SourceFilter = 'all' | 'manual' | 'receiving';

type PayableRow = Payable & {
  inv_suppliers?: Pick<InvSupplier, 'id' | 'name' | 'code'>;
  purchase_orders?: { id: string; po_number: string };
  receivings?: { id: string; receiving_number: string };
};

function dateOnly(value: string | null | undefined) {
  return String(value ?? '').slice(0, 10);
}

function addDays(base: string, days: number) {
  const date = new Date(`${base}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function StatusBadge({ status }: { status: PayablePaymentStatus }) {
  const c = PAYABLE_STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {PAYABLE_STATUS_LABELS[status]}
    </span>
  );
}

export default function PayablesListPage() {
  const [payables, setPayables] = useState<PayableRow[]>([]);
  const [suppliers, setSuppliers] = useState<Array<Pick<InvSupplier, 'id' | 'name' | 'code'>>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [supplierId, setSupplierId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [paymentTarget, setPaymentTarget] = useState<PayableRow | null>(null);
  const [manualModalOpen, setManualModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);

    const [payableRes, supplierRes] = await Promise.all([
      supabase.from('payables').select('*').order('created_at', { ascending: false }),
      supabase.from('inv_suppliers').select('id, name, code').eq('is_active', true).order('name'),
    ]);

    const supplierRows = ((supplierRes.data ?? []) as Array<Pick<InvSupplier, 'id' | 'name' | 'code'>>);
    setSuppliers(supplierRows);

    const rawPayables = (payableRes.data ?? []) as Array<Record<string, unknown>>;
    const normalizedPayables = rawPayables.map(normalizePayable);
    const receivingIds = Array.from(new Set(normalizedPayables.map((payable) => payable.receiving_id).filter(Boolean))) as string[];

    const receivingRows = receivingIds.length > 0
      ? (((await supabase.from('receivings').select('id, receiving_number, po_id').in('id', receivingIds)).data ?? []) as Array<{ id: string; receiving_number: string; po_id: string | null }>)
      : [];
    const poIds = Array.from(new Set(receivingRows.map((receiving) => String(receiving.po_id ?? '')).filter(Boolean)));
    const poRows = poIds.length > 0
      ? (((await supabase.from('purchase_orders').select('id, po_number').in('id', poIds)).data ?? []) as Array<{ id: string; po_number: string }>)
      : [];

    const supplierMap = new Map(supplierRows.map((supplier) => [supplier.id, supplier]));
    const receivingMap = new Map(receivingRows.map((receiving) => [receiving.id, receiving]));
    const poMap = new Map(poRows.map((po) => [po.id, po]));

    setPayables(
      normalizedPayables.map((payable) => {
        const receiving = payable.receiving_id ? receivingMap.get(payable.receiving_id) : undefined;
        const purchaseOrder = receiving?.po_id ? poMap.get(receiving.po_id) : undefined;
        return {
          ...payable,
          inv_suppliers: supplierMap.get(payable.supplier_id) as Payable['inv_suppliers'],
          receivings: receiving ? { id: receiving.id, receiving_number: receiving.receiving_number } : undefined,
          purchase_orders: purchaseOrder ? { id: purchaseOrder.id, po_number: purchaseOrder.po_number } : undefined,
        };
      })
    );

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const endOfWeek = useMemo(() => addDays(today, 6), [today]);

  const filtered = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    return payables.filter((payable) => {
      const payableDate = dateOnly(payable.invoice_date || payable.created_at);
      const dueDate = dateOnly(payable.due_date);
      const source = getPayableSource(payable);

      if (statusFilter === 'open' && !['unpaid', 'partial'].includes(payable.payment_status)) return false;
      if (statusFilter !== 'open' && statusFilter !== 'all' && payable.payment_status !== statusFilter) return false;
      if (sourceFilter !== 'all' && source !== sourceFilter) return false;
      if (supplierId && payable.supplier_id !== supplierId) return false;
      if (dateFrom && (!payableDate || payableDate < dateFrom)) return false;
      if (dateTo && (!payableDate || payableDate > dateTo)) return false;
      if (dueFrom && (!dueDate || dueDate < dueFrom)) return false;
      if (dueTo && (!dueDate || dueDate > dueTo)) return false;
      if (!searchTerm) return true;

      return [
        payable.payable_number,
        payable.invoice_number,
        payable.inv_suppliers?.name ?? '',
        payable.purchase_orders?.po_number ?? '',
        payable.receivings?.receiving_number ?? '',
      ].some((value) => String(value).toLowerCase().includes(searchTerm));
    });
  }, [dateFrom, dateTo, dueFrom, dueTo, payables, search, sourceFilter, statusFilter, supplierId]);

  const totalOutstanding = filtered
    .filter((payable) => payable.payment_status !== 'paid' && payable.payment_status !== 'voided')
    .reduce((sum, payable) => sum + Number(payable.balance_due), 0);
  const dueToday = filtered
    .filter((payable) => payable.payment_status !== 'paid' && payable.payment_status !== 'voided' && dateOnly(payable.due_date) === today)
    .reduce((sum, payable) => sum + Number(payable.balance_due), 0);
  const dueThisWeek = filtered
    .filter((payable) => {
      const dueDate = dateOnly(payable.due_date);
      return payable.payment_status !== 'paid'
        && payable.payment_status !== 'voided'
        && !!dueDate
        && dueDate >= today
        && dueDate <= endOfWeek;
    })
    .reduce((sum, payable) => sum + Number(payable.balance_due), 0);
  const overdueTotal = filtered
    .filter((payable) => isOverdue(payable))
    .reduce((sum, payable) => sum + Number(payable.balance_due), 0);

  const activeFilters = [statusFilter !== 'open', sourceFilter !== 'all', supplierId, dateFrom, dateTo, dueFrom, dueTo, search].filter(Boolean).length;

  return (
    <div className="p-6 max-w-screen-2xl">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Accounts Payable</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage supplier liabilities from received goods and manual entries.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setManualModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Manual Payable
          </button>
          <Link
            to="/inventory/payables/supplier-ledger"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <BookOpen className="w-4 h-4" />
            Supplier Ledger
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Outstanding Payables</p>
          <p className="text-2xl font-bold text-slate-800 tabular-nums">₱{formatCurrency(totalOutstanding)}</p>
          <p className="text-xs text-slate-400 mt-1">Open and partially paid balances</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Due Today</p>
          <p className="text-2xl font-bold text-amber-700 tabular-nums">₱{formatCurrency(dueToday)}</p>
          <p className="text-xs text-slate-400 mt-1">Bills needing payment today</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Due This Week</p>
          <p className="text-2xl font-bold text-blue-700 tabular-nums">₱{formatCurrency(dueThisWeek)}</p>
          <p className="text-xs text-slate-400 mt-1">Upcoming due dates in the next 7 days</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Overdue</p>
          <p className="text-2xl font-bold text-red-700 tabular-nums">₱{formatCurrency(overdueTotal)}</p>
          <p className="text-xs text-slate-400 mt-1">Past-due unpaid balances</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-56">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Search</label>
            <Search className="absolute left-3 top-[38px] w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Payable #, reference, supplier, PO, receiving..."
              className="w-full pl-9 pr-9 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-[38px] text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="relative">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="open">Open (Unpaid + Partial)</option>
              <option value="all">All Statuses</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partially Paid</option>
              <option value="paid">Paid</option>
              <option value="voided">Voided</option>
            </select>
            <ChevronDown className="absolute right-2 top-[38px] w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>

          <div className="relative">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Source</label>
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="all">All Sources</option>
              <option value="receiving">PO / Receiving</option>
              <option value="manual">Manual Entry</option>
            </select>
            <ChevronDown className="absolute right-2 top-[38px] w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>

          <div className="relative">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Supplier</label>
            <select
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All Suppliers</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-[38px] w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Payable From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Payable To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Due From</label>
            <input
              type="date"
              value={dueFrom}
              onChange={(event) => setDueFrom(event.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Due To</label>
            <input
              type="date"
              value={dueTo}
              onChange={(event) => setDueTo(event.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {activeFilters > 0 && (
            <button
              onClick={() => {
                setSearch('');
                setStatusFilter('open');
                setSourceFilter('all');
                setSupplierId('');
                setDateFrom('');
                setDateTo('');
                setDueFrom('');
                setDueTo('');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center">
            <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">Loading payables...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <CalendarClock className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-500">No payables found</p>
            <p className="text-xs text-slate-400 mt-1">Receive goods from a PO or create a manual payable to add entries here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Reference No.</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Paid</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Balance</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Due Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((payable) => {
                  const overdue = isOverdue(payable);
                  const sourceLabel = getPayableSourceLabel(payable);

                  return (
                    <tr key={payable.id} className={overdue ? 'bg-red-50/30 hover:bg-red-50/40' : 'hover:bg-slate-50'}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium text-slate-700">{formatDate(payable.invoice_date || payable.created_at)}</div>
                        <div className="font-mono text-xs text-slate-400">{payable.payable_number}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{payable.inv_suppliers?.name ?? 'Unknown supplier'}</div>
                        <div className="font-mono text-xs text-slate-400">{payable.inv_suppliers?.code ?? ''}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <div className="font-medium text-slate-700">{sourceLabel}</div>
                        {payable.purchase_orders && (
                          <Link to={`/inventory/purchase-orders/${payable.purchase_orders.id}`} className="block mt-0.5 text-blue-600 hover:underline font-mono">
                            PO: {payable.purchase_orders.po_number}
                          </Link>
                        )}
                        {payable.receivings && (
                          <Link to={`/inventory/receivings/${payable.receivings.id}`} className="block mt-0.5 text-blue-600 hover:underline font-mono">
                            GR: {payable.receivings.receiving_number}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {payable.invoice_number ? payable.invoice_number : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-700">
                        ₱{formatCurrency(Number(payable.total_amount))}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                        ₱{formatCurrency(Number(payable.amount_paid))}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-red-700">
                        {Number(payable.balance_due) > 0 ? `₱${formatCurrency(Number(payable.balance_due))}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className={overdue ? 'font-semibold text-red-700' : 'text-slate-600'}>
                          {formatDate(payable.due_date)}
                        </div>
                        {overdue && payable.payment_status !== 'paid' && payable.payment_status !== 'voided' && (
                          <div className="text-[11px] text-red-500 mt-0.5">Overdue</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={payable.payment_status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Link to={`/inventory/payables/${payable.id}`} className="text-xs font-medium text-slate-500 hover:text-blue-600 hover:underline">
                            Details
                          </Link>
                          {payable.payment_status !== 'paid' && payable.payment_status !== 'voided' && (
                            <button
                              onClick={() => setPaymentTarget(payable)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                            >
                              <DollarSign className="w-3 h-3" />
                              Pay
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>{filtered.length} payable{filtered.length !== 1 ? 's' : ''}</span>
              <span className="font-semibold">Outstanding: ₱{formatCurrency(totalOutstanding)}</span>
            </div>
          </div>
        )}
      </div>

      <PaymentEntryModal
        open={paymentTarget !== null}
        payable={paymentTarget}
        onClose={() => setPaymentTarget(null)}
        onSaved={() => {
          setPaymentTarget(null);
          void loadData();
        }}
      />

      <ManualPayableModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        onSaved={() => {
          setManualModalOpen(false);
          void loadData();
        }}
      />
    </div>
  );
}
