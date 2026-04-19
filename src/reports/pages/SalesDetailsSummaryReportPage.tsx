import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCurrency, formatDateTime } from '../../lib/utils';
import ReportShell from '../components/ReportShell';
import { Column, ReportTable } from '../components/ReportTable';
import { exportToCsv } from '../lib/csvExport';
import { getDefaultDateRange } from '../lib/dateRanges';
import { fetchSalesDetailSummaryReport, SalesDetailSummaryRow } from '../lib/reportQueries';

type PaymentFilter = 'all' | 'cash' | 'gcash';

const defaultRange = getDefaultDateRange(0);

function formatQty(value: number) {
  return value.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function matchesPaymentFilter(label: string, filter: PaymentFilter) {
  if (filter === 'all') return true;
  if (filter === 'cash') return label === 'Cash' || label === 'Cash + GCash';
  return label === 'GCash' || label === 'Cash + GCash';
}

export default function SalesDetailsSummaryReportPage() {
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [receiptSearch, setReceiptSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [cashierSearch, setCashierSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [data, setData] = useState<SalesDetailSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRange = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setData(await fetchSalesDetailSummaryReport(from, to));
    setLoading(false);
  }, []);

  async function load() {
    await loadRange(dateFrom, dateTo);
  }

  useEffect(() => { void loadRange(defaultRange.from, defaultRange.to); }, [loadRange]);

  const filtered = useMemo(() => {
    const receiptNeedle = receiptSearch.trim().toLowerCase();
    const productNeedle = productSearch.trim().toLowerCase();
    const customerNeedle = customerSearch.trim().toLowerCase();
    const cashierNeedle = cashierSearch.trim().toLowerCase();

    return data.filter(row => {
      if (receiptNeedle && !row.receipt_no.toLowerCase().includes(receiptNeedle)) return false;
      if (productNeedle && !`${row.product_name} ${row.sku_code}`.toLowerCase().includes(productNeedle)) return false;
      if (customerNeedle && !row.customer_name.toLowerCase().includes(customerNeedle)) return false;
      if (cashierNeedle && !row.cashier_name.toLowerCase().includes(cashierNeedle)) return false;
      if (!matchesPaymentFilter(row.payment_method, paymentFilter)) return false;
      return true;
    });
  }, [cashierSearch, customerSearch, data, paymentFilter, productSearch, receiptSearch]);

  const totals = useMemo(() => ({
    quantity: filtered.reduce((sum, row) => sum + row.quantity, 0),
    sales: filtered.reduce((sum, row) => sum + row.sales_amount, 0),
    cost: filtered.reduce((sum, row) => sum + row.cost_of_sales, 0),
    gross: filtered.reduce((sum, row) => sum + row.gross_profit, 0),
  }), [filtered]);

  const columns: Column<SalesDetailSummaryRow>[] = [
    { key: 'created_at', label: 'Date / Time', render: row => formatDateTime(row.created_at), className: 'whitespace-nowrap' },
    { key: 'receipt_no', label: 'Receipt No.', render: row => <span className="font-mono font-semibold text-slate-800">{row.receipt_no || '--'}</span>, className: 'whitespace-nowrap' },
    { key: 'customer_name', label: 'Customer', render: row => row.customer_name || 'Walk-in' },
    {
      key: 'product_name',
      label: 'Product',
      render: row => (
        <div>
          <p className="font-medium text-slate-800">{row.product_name}</p>
          {row.sku_code && <p className="text-xs font-mono text-slate-400">{row.sku_code}</p>}
        </div>
      ),
    },
    { key: 'quantity', label: 'Quantity', align: 'right', render: row => <span className="font-mono">{formatQty(row.quantity)}</span> },
    { key: 'unit', label: 'Unit', render: row => row.unit || '--', className: 'whitespace-nowrap' },
    { key: 'sales_amount', label: 'Sales Amount', align: 'right', render: row => <span className="font-mono">{formatCurrency(row.sales_amount)}</span> },
    { key: 'cost_of_sales', label: 'Cost of Sales', align: 'right', render: row => <span className="font-mono">{formatCurrency(row.cost_of_sales)}</span> },
    { key: 'gross_profit', label: 'Gross Profit', align: 'right', render: row => <span className={`font-mono font-semibold ${row.gross_profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(row.gross_profit)}</span> },
    { key: 'cashier_name', label: 'Cashier', render: row => row.cashier_name || 'Unknown' },
    { key: 'payment_method', label: 'Payment', render: row => row.payment_method || '--', className: 'whitespace-nowrap' },
  ];

  function handleReset() {
    setDateFrom(defaultRange.from);
    setDateTo(defaultRange.to);
    setReceiptSearch('');
    setProductSearch('');
    setCustomerSearch('');
    setCashierSearch('');
    setPaymentFilter('all');
    void loadRange(defaultRange.from, defaultRange.to);
  }

  function handleExport() {
    exportToCsv(
      'sales-details-summary-report.csv',
      ['Date / Time', 'Receipt No.', 'Customer', 'Product', 'SKU', 'Quantity', 'Unit', 'Sales Amount', 'Cost of Sales', 'Gross Profit', 'Cashier', 'Payment Method'],
      filtered.map(row => [
        formatDateTime(row.created_at),
        row.receipt_no,
        row.customer_name,
        row.product_name,
        row.sku_code,
        row.quantity,
        row.unit,
        row.sales_amount,
        row.cost_of_sales,
        row.gross_profit,
        row.cashier_name,
        row.payment_method,
      ]),
    );
  }

  return (
    <ReportShell
      title="Sales Details Summary Report"
      subtitle={`${dateFrom} to ${dateTo}`}
      loading={loading}
      onRefresh={() => void load()}
      onExportCsv={handleExport}
      printTitle={`Sales Details Summary Report (${dateFrom} to ${dateTo})`}
      filters={
        <>
          <label className="text-xs font-medium text-slate-600">From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <label className="text-xs font-medium text-slate-600">To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="text" value={receiptSearch} onChange={e => setReceiptSearch(e.target.value)} placeholder="Receipt no." className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="text" value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Product / SKU" className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="text" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder="Customer" className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="text" value={cashierSearch} onChange={e => setCashierSearch(e.target.value)} placeholder="Cashier" className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value as PaymentFilter)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="all">All payments</option>
            <option value="cash">Cash</option>
            <option value="gcash">GCash</option>
          </select>
          <button onClick={() => void load()} className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Apply</button>
          <button onClick={handleReset} className="px-4 py-1.5 text-sm font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">Reset</button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-4 mb-4">
        <SummaryCard label="Line Items" value={filtered.length.toLocaleString('en-PH')} />
        <SummaryCard label="Quantity Sold" value={formatQty(totals.quantity)} />
        <SummaryCard label="Sales Amount" value={formatCurrency(totals.sales)} />
        <SummaryCard label="Gross Profit" value={formatCurrency(totals.gross)} />
      </div>

      <ReportTable
        columns={columns}
        data={filtered}
        rowKey={row => row.item_id}
        emptyMessage="No sold items found for the selected range."
        footer={
          <tr>
            <td className="px-4 py-3 font-bold text-slate-800" colSpan={4}>TOTAL</td>
            <td className="px-4 py-3 text-right font-mono font-bold">{formatQty(totals.quantity)}</td>
            <td className="px-4 py-3"></td>
            <td className="px-4 py-3 text-right font-mono font-bold">{formatCurrency(totals.sales)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold">{formatCurrency(totals.cost)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold">{formatCurrency(totals.gross)}</td>
            <td className="px-4 py-3"></td>
            <td className="px-4 py-3"></td>
          </tr>
        }
      />
    </ReportShell>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-800">{value}</p>
    </div>
  );
}
