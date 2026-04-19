import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Download, Receipt, RefreshCw, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { downloadCSV, formatCurrency, formatDateTime, getTodayDateString, objectsToCSV, round2 } from '../lib/utils';
import { useToast } from '../contexts/ToastContext';

const MAX_ROWS = 200;
const MAX_EXPORT_ROWS = 5000;

type PaymentFilter = 'all' | 'cash' | 'gcash';

interface SalesFilters {
  dateFrom: string;
  dateTo: string;
  receiptSearch: string;
  paymentMethod: PaymentFilter;
  cashierId: string;
}

interface SalesTransactionRow {
  saleId: string;
  createdAt: string;
  receiptNo: string;
  customerName: string;
  paymentMethodLabel: string;
  totalAmount: number;
  costOfSales: number;
  grossProfit: number;
  cashierName: string;
  status: string;
  terminalName: string;
  itemCount: number;
  matchesPaymentFilter: boolean;
}

interface SalesTransactionLogProps {
  title: string;
  subtitle: string;
  showCostMetrics?: boolean;
  defaultDateFrom?: string;
  defaultDateTo?: string;
}

function normalizeSalePaymentMethod(value: unknown): 'cash' | 'gcash' | null {
  const method = String(value ?? '').trim().toLowerCase();
  if (method === 'cash') return 'cash';
  if (method === 'gcash' || method === 'card' || method === 'bank') return 'gcash';
  return null;
}

function getCustomerName(row: Record<string, unknown> | undefined) {
  if (!row) return 'Walk-in';
  const firstName = String(row.first_name ?? '').trim();
  const lastName = String(row.last_name ?? '').trim();
  return `${firstName} ${lastName}`.trim() || 'Walk-in';
}

function getPaymentLabel(methods: Array<'cash' | 'gcash'>) {
  if (methods.length === 0) return '--';
  if (methods.length === 2) return 'Cash + GCash';
  return methods[0] === 'gcash' ? 'GCash' : 'Cash';
}

function toStatusLabel(value: unknown) {
  const status = String(value ?? '').trim();
  if (!status) return '--';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function SalesTransactionLog({
  title,
  subtitle,
  showCostMetrics = false,
  defaultDateFrom,
  defaultDateTo,
}: SalesTransactionLogProps) {
  const { showToast } = useToast();
  const initialFilters = useMemo<SalesFilters>(() => ({
    dateFrom: defaultDateFrom || getTodayDateString(),
    dateTo: defaultDateTo || getTodayDateString(),
    receiptSearch: '',
    paymentMethod: 'all',
    cashierId: '',
  }), [defaultDateFrom, defaultDateTo]);

  const [draftFilters, setDraftFilters] = useState<SalesFilters>(initialFilters);
  const [activeFilters, setActiveFilters] = useState<SalesFilters>(initialFilters);
  const [rows, setRows] = useState<SalesTransactionRow[]>([]);
  const [cashiers, setCashiers] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [truncated, setTruncated] = useState(false);

  const loadCashiers = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name')
      .order('name')
      .limit(200);

    if (error) {
      throw new Error(error.message || 'Failed to load cashiers');
    }

    setCashiers(
      ((data ?? []) as Array<Record<string, unknown>>)
        .map(row => ({
          id: String(row.id ?? ''),
          name: String(row.name ?? '').trim(),
        }))
        .filter(row => row.id && row.name)
    );
  }, []);

  const loadTransactions = useCallback(async (filters: SalesFilters, silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      let salesQuery = supabase
        .from('sales')
        .select('sale_id, receipt_no, created_at, total_amount, customer_id, cashier_id, terminal_id, sale_status')
        .gte('created_at', `${filters.dateFrom} 00:00:00`)
        .lte('created_at', `${filters.dateTo} 23:59:59`)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS + 1);

      if (filters.cashierId) {
        salesQuery = salesQuery.eq('cashier_id', filters.cashierId);
      }

      if (filters.receiptSearch.trim()) {
        salesQuery = salesQuery.ilike('receipt_no', `%${filters.receiptSearch.trim()}%`);
      }

      const { data, error } = await salesQuery;
      if (error) {
        throw new Error(error.message || 'Failed to load POS sales');
      }

      const salesRows = (data ?? []) as Array<Record<string, unknown>>;
      setTruncated(salesRows.length > MAX_ROWS);
      const visibleSales = salesRows.slice(0, MAX_ROWS);

      if (visibleSales.length === 0) {
        setRows([]);
        return;
      }

      const saleIds = Array.from(new Set(visibleSales.map(row => String(row.sale_id ?? '')).filter(Boolean)));
      const customerIds = Array.from(new Set(visibleSales.map(row => String(row.customer_id ?? '')).filter(Boolean)));
      const cashierIds = Array.from(new Set(visibleSales.map(row => String(row.cashier_id ?? '')).filter(Boolean)));
      const terminalIds = Array.from(new Set(visibleSales.map(row => String(row.terminal_id ?? '')).filter(Boolean)));

      const [
        paymentResponse,
        itemResponse,
        customerResponse,
        cashierResponse,
        terminalResponse,
      ] = await Promise.all([
        supabase.from('sale_payments').select('sale_id, payment_method').in('sale_id', saleIds),
        supabase.from('sale_items').select('sale_id, qty, total_base_qty_deducted, cost_at_sale, cost_per_base_unit').in('sale_id', saleIds),
        customerIds.length > 0
          ? supabase.from('pos_customers').select('customer_id, first_name, last_name').in('customer_id', customerIds)
          : Promise.resolve({ data: [], error: null }),
        cashierIds.length > 0
          ? supabase.from('profiles').select('id, name').in('id', cashierIds)
          : Promise.resolve({ data: [], error: null }),
        terminalIds.length > 0
          ? supabase.from('pos_terminals').select('terminal_id, terminal_name').in('terminal_id', terminalIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const lookupErrors = [
        paymentResponse.error,
        itemResponse.error,
        customerResponse.error,
        cashierResponse.error,
        terminalResponse.error,
      ].filter(Boolean);

      if (lookupErrors.length > 0) {
        throw new Error(lookupErrors[0]?.message || 'Failed to load sales transaction details');
      }

      const customerMap = new Map(
        ((customerResponse.data ?? []) as Array<Record<string, unknown>>).map(row => [String(row.customer_id ?? ''), row])
      );
      const cashierMap = new Map(
        ((cashierResponse.data ?? []) as Array<Record<string, unknown>>).map(row => [String(row.id ?? ''), String(row.name ?? '').trim() || 'Unknown'])
      );
      const terminalMap = new Map(
        ((terminalResponse.data ?? []) as Array<Record<string, unknown>>).map(row => [String(row.terminal_id ?? ''), String(row.terminal_name ?? '').trim() || '--'])
      );

      const itemCountBySaleId = new Map<string, number>();
      const costBySaleId = new Map<string, number>();
      for (const row of (itemResponse.data ?? []) as Array<Record<string, unknown>>) {
        const saleId = String(row.sale_id ?? '');
        if (!saleId) continue;
        itemCountBySaleId.set(saleId, (itemCountBySaleId.get(saleId) ?? 0) + 1);
        const baseQty = Number(row.total_base_qty_deducted ?? 0);
        const qty = baseQty > 0 ? baseQty : Number(row.qty ?? 0);
        const perUnitCost = Number(row.cost_per_base_unit ?? 0) > 0
          ? Number(row.cost_per_base_unit ?? 0)
          : Number(row.cost_at_sale ?? 0);
        costBySaleId.set(saleId, round2((costBySaleId.get(saleId) ?? 0) + (qty * perUnitCost)));
      }

      const paymentMethodsBySaleId = new Map<string, Array<'cash' | 'gcash'>>();
      for (const row of (paymentResponse.data ?? []) as Array<Record<string, unknown>>) {
        const saleId = String(row.sale_id ?? '');
        const method = normalizeSalePaymentMethod(row.payment_method);
        if (!saleId || !method) continue;
        const existing = paymentMethodsBySaleId.get(saleId) ?? [];
        if (!existing.includes(method)) existing.push(method);
        paymentMethodsBySaleId.set(saleId, existing);
      }

      const mappedRows = visibleSales
        .map<SalesTransactionRow>(row => {
          const saleId = String(row.sale_id ?? '');
          const paymentMethods = paymentMethodsBySaleId.get(saleId) ?? [];
          const matchesPaymentFilter = filters.paymentMethod === 'all'
            ? true
            : paymentMethods.includes(filters.paymentMethod);

          return {
            saleId,
            createdAt: String(row.created_at ?? ''),
            receiptNo: String(row.receipt_no ?? ''),
            customerName: getCustomerName(customerMap.get(String(row.customer_id ?? ''))),
            paymentMethodLabel: getPaymentLabel(paymentMethods),
            totalAmount: Number(row.total_amount ?? 0),
            costOfSales: costBySaleId.get(saleId) ?? 0,
            grossProfit: round2(Number(row.total_amount ?? 0) - (costBySaleId.get(saleId) ?? 0)),
            cashierName: cashierMap.get(String(row.cashier_id ?? '')) ?? 'Unknown',
            status: toStatusLabel(row.sale_status),
            terminalName: terminalMap.get(String(row.terminal_id ?? '')) ?? '--',
            itemCount: itemCountBySaleId.get(saleId) ?? 0,
            matchesPaymentFilter,
          };
        })
        .filter(row => row.matchesPaymentFilter);

      setRows(mappedRows);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to load daily sales', 'error');
      setRows([]);
      setTruncated(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    void Promise.all([
      loadCashiers(),
      loadTransactions(initialFilters, false),
    ]);
  }, [initialFilters, loadCashiers, loadTransactions]);

  const cashierLabel = useMemo(
    () => cashiers.find(cashier => cashier.id === activeFilters.cashierId)?.name ?? 'All cashiers',
    [activeFilters.cashierId, cashiers]
  );
  const totals = useMemo(() => ({
    sales: round2(rows.reduce((sum, row) => sum + row.totalAmount, 0)),
    costOfSales: round2(rows.reduce((sum, row) => sum + row.costOfSales, 0)),
    grossProfit: round2(rows.reduce((sum, row) => sum + row.grossProfit, 0)),
  }), [rows]);

  function handleApplyFilters() {
    const nextFilters = {
      ...draftFilters,
      receiptSearch: draftFilters.receiptSearch.trim(),
    };
    setActiveFilters(nextFilters);
    void loadTransactions(nextFilters, false);
  }

  async function handleExport() {
    setExporting(true);

    try {
      let salesQuery = supabase
        .from('sales')
        .select('sale_id, receipt_no, created_at, total_amount, customer_id, cashier_id, terminal_id, sale_status')
        .gte('created_at', `${activeFilters.dateFrom} 00:00:00`)
        .lte('created_at', `${activeFilters.dateTo} 23:59:59`)
        .order('created_at', { ascending: false })
        .limit(MAX_EXPORT_ROWS + 1);

      if (activeFilters.cashierId) {
        salesQuery = salesQuery.eq('cashier_id', activeFilters.cashierId);
      }

      if (activeFilters.receiptSearch.trim()) {
        salesQuery = salesQuery.ilike('receipt_no', `%${activeFilters.receiptSearch.trim()}%`);
      }

      const { data, error } = await salesQuery;
      if (error) throw new Error(error.message || 'Failed to export sales');

      const exportSales = ((data ?? []) as Array<Record<string, unknown>>).slice(0, MAX_EXPORT_ROWS);
      if (exportSales.length === 0) {
        showToast('No sales transactions available to export', 'error');
        return;
      }

      const saleIds = Array.from(new Set(exportSales.map(row => String(row.sale_id ?? '')).filter(Boolean)));
      const customerIds = Array.from(new Set(exportSales.map(row => String(row.customer_id ?? '')).filter(Boolean)));
      const cashierIds = Array.from(new Set(exportSales.map(row => String(row.cashier_id ?? '')).filter(Boolean)));
      const terminalIds = Array.from(new Set(exportSales.map(row => String(row.terminal_id ?? '')).filter(Boolean)));

      const [paymentResponse, itemResponse, customerResponse, cashierResponse, terminalResponse] = await Promise.all([
        supabase.from('sale_payments').select('sale_id, payment_method').in('sale_id', saleIds),
        supabase.from('sale_items').select('sale_id, qty, total_base_qty_deducted, cost_at_sale, cost_per_base_unit').in('sale_id', saleIds),
        customerIds.length > 0
          ? supabase.from('pos_customers').select('customer_id, first_name, last_name').in('customer_id', customerIds)
          : Promise.resolve({ data: [], error: null }),
        cashierIds.length > 0
          ? supabase.from('profiles').select('id, name').in('id', cashierIds)
          : Promise.resolve({ data: [], error: null }),
        terminalIds.length > 0
          ? supabase.from('pos_terminals').select('terminal_id, terminal_name').in('terminal_id', terminalIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const lookupErrors = [paymentResponse.error, itemResponse.error, customerResponse.error, cashierResponse.error, terminalResponse.error].filter(Boolean);
      if (lookupErrors.length > 0) {
        throw new Error(lookupErrors[0]?.message || 'Failed to load sales transaction details');
      }

      const customerMap = new Map(((customerResponse.data ?? []) as Array<Record<string, unknown>>).map(row => [String(row.customer_id ?? ''), row]));
      const cashierMap = new Map(((cashierResponse.data ?? []) as Array<Record<string, unknown>>).map(row => [String(row.id ?? ''), String(row.name ?? '').trim() || 'Unknown']));
      const terminalMap = new Map(((terminalResponse.data ?? []) as Array<Record<string, unknown>>).map(row => [String(row.terminal_id ?? ''), String(row.terminal_name ?? '').trim() || '--']));

      const itemCountBySaleId = new Map<string, number>();
      const costBySaleId = new Map<string, number>();
      for (const row of (itemResponse.data ?? []) as Array<Record<string, unknown>>) {
        const saleId = String(row.sale_id ?? '');
        if (!saleId) continue;
        itemCountBySaleId.set(saleId, (itemCountBySaleId.get(saleId) ?? 0) + 1);
        const baseQty = Number(row.total_base_qty_deducted ?? 0);
        const qty = baseQty > 0 ? baseQty : Number(row.qty ?? 0);
        const perUnitCost = Number(row.cost_per_base_unit ?? 0) > 0
          ? Number(row.cost_per_base_unit ?? 0)
          : Number(row.cost_at_sale ?? 0);
        costBySaleId.set(saleId, round2((costBySaleId.get(saleId) ?? 0) + (qty * perUnitCost)));
      }

      const paymentMethodsBySaleId = new Map<string, Array<'cash' | 'gcash'>>();
      for (const row of (paymentResponse.data ?? []) as Array<Record<string, unknown>>) {
        const saleId = String(row.sale_id ?? '');
        const method = normalizeSalePaymentMethod(row.payment_method);
        if (!saleId || !method) continue;
        const existing = paymentMethodsBySaleId.get(saleId) ?? [];
        if (!existing.includes(method)) existing.push(method);
        paymentMethodsBySaleId.set(saleId, existing);
      }

      const exportRows = exportSales
        .map(row => {
          const saleId = String(row.sale_id ?? '');
          const paymentMethods = paymentMethodsBySaleId.get(saleId) ?? [];
          const matchesPaymentFilter = activeFilters.paymentMethod === 'all'
            ? true
            : paymentMethods.includes(activeFilters.paymentMethod);

          return matchesPaymentFilter
            ? {
                DateTime: formatDateTime(row.created_at),
                ReceiptNo: String(row.receipt_no ?? ''),
                Customer: getCustomerName(customerMap.get(String(row.customer_id ?? ''))),
                Payment: getPaymentLabel(paymentMethods),
                TotalAmount: Number(row.total_amount ?? 0),
                CostOfSales: costBySaleId.get(saleId) ?? 0,
                GrossProfit: round2(Number(row.total_amount ?? 0) - (costBySaleId.get(saleId) ?? 0)),
                Cashier: cashierMap.get(String(row.cashier_id ?? '')) ?? 'Unknown',
                Status: toStatusLabel(row.sale_status),
                Register: terminalMap.get(String(row.terminal_id ?? '')) ?? '--',
                ItemCount: itemCountBySaleId.get(saleId) ?? 0,
              }
            : null;
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      downloadCSV(objectsToCSV(exportRows), `sales_${getTodayDateString()}.csv`);
      showToast(exportSales.length > MAX_EXPORT_ROWS ? `Sales export capped at ${MAX_EXPORT_ROWS} rows` : 'Sales exported for Excel', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to export sales', 'error');
    } finally {
      setExporting(false);
    }
  }

  function handleResetFilters() {
    setDraftFilters(initialFilters);
    setActiveFilters(initialFilters);
    void loadTransactions(initialFilters, false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
          <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting || loading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-colors shadow-sm disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting...' : 'Export Excel'}
          </button>
          <button
            onClick={() => void loadTransactions(activeFilters, true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.2fr_0.9fr_1.2fr_auto]">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">From</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={draftFilters.dateFrom}
                onChange={event => setDraftFilters(current => ({ ...current, dateFrom: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">To</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={draftFilters.dateTo}
                onChange={event => setDraftFilters(current => ({ ...current, dateTo: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Receipt No.</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={draftFilters.receiptSearch}
                onChange={event => setDraftFilters(current => ({ ...current, receiptSearch: event.target.value }))}
                placeholder="Search receipt number"
                className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Payment</label>
            <select
              value={draftFilters.paymentMethod}
              onChange={event => setDraftFilters(current => ({ ...current, paymentMethod: event.target.value as PaymentFilter }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All payments</option>
              <option value="cash">Cash</option>
              <option value="gcash">GCash</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Cashier</label>
            <select
              value={draftFilters.cashierId}
              onChange={event => setDraftFilters(current => ({ ...current, cashierId: event.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All cashiers</option>
              {cashiers.map(cashier => (
                <option key={cashier.id} value={cashier.id}>{cashier.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              onClick={handleApplyFilters}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Apply
            </button>
            <button
              onClick={handleResetFilters}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">POS Transactions</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeFilters.dateFrom} to {activeFilters.dateTo} · {activeFilters.paymentMethod === 'all' ? 'All payments' : activeFilters.paymentMethod === 'gcash' ? 'GCash' : 'Cash'} · {cashierLabel}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-slate-800">{rows.length} transaction{rows.length === 1 ? '' : 's'}</p>
            {showCostMetrics && (
              <p className="text-xs text-slate-500 mt-0.5">
                Sales {formatCurrency(totals.sales)} · Cost {formatCurrency(totals.costOfSales)} · Gross {formatCurrency(totals.grossProfit)}
              </p>
            )}
            {truncated && (
              <p className="text-xs text-amber-600 mt-0.5">Showing the latest {MAX_ROWS} matches only</p>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
            <Receipt className="w-10 h-10 opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium text-slate-500">No sales transactions found</p>
              <p className="text-xs text-slate-400 mt-1">Try adjusting the date range or clearing one of the filters.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Date / Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Receipt No.</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Payment</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Total Amount</th>
                  {showCostMetrics && (
                    <>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Cost of Sales</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Gross Profit</th>
                    </>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Cashier</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Register</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Items</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(row => (
                  <tr key={row.saleId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(row.createdAt)}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-800">{row.receiptNo || '--'}</td>
                    <td className="px-4 py-3 text-slate-700">{row.customerName}</td>
                    <td className="px-4 py-3 text-slate-700">{row.paymentMethodLabel}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{formatCurrency(row.totalAmount)}</td>
                    {showCostMetrics && (
                      <>
                        <td className="px-4 py-3 text-right font-mono text-amber-700">{formatCurrency(row.costOfSales)}</td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-700">{formatCurrency(row.grossProfit)}</td>
                      </>
                    )}
                    <td className="px-4 py-3 text-slate-700">{row.cashierName}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.status === 'Completed'
                          ? 'bg-emerald-100 text-emerald-700'
                          : row.status === 'Voided'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.terminalName}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{row.itemCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
