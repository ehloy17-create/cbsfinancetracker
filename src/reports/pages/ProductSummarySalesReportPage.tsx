import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '../../lib/utils';
import ReportShell from '../components/ReportShell';
import { Column, ReportTable } from '../components/ReportTable';
import { exportToCsv } from '../lib/csvExport';
import { getTodayDate } from '../lib/dateRanges';
import { fetchMonthlySalesItemSummaryReport, MonthlySalesItemSummaryRow } from '../lib/reportQueries';

function getMonthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function formatQty(value: number) {
  return value.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

export default function ProductSummarySalesReportPage() {
  const today = getTodayDate();
  const [dateFrom, setDateFrom] = useState(getMonthStart(today));
  const [dateTo, setDateTo] = useState(today);
  const [productSearch, setProductSearch] = useState('');
  const [data, setData] = useState<MonthlySalesItemSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRange = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setData(await fetchMonthlySalesItemSummaryReport(from, to));
    setLoading(false);
  }, []);

  async function load() {
    await loadRange(dateFrom, dateTo);
  }

  useEffect(() => { void loadRange(getMonthStart(today), today); }, [loadRange, today]);

  const filtered = useMemo(() => {
    const needle = productSearch.trim().toLowerCase();
    if (!needle) return data;
    return data.filter(row => `${row.product_name} ${row.sku_code} ${row.unit}`.toLowerCase().includes(needle));
  }, [data, productSearch]);

  const totals = useMemo(() => ({
    sales: filtered.reduce((sum, row) => sum + row.total_sales, 0),
    cost: filtered.reduce((sum, row) => sum + row.total_cost_of_sales, 0),
    gross: filtered.reduce((sum, row) => sum + row.gross_profit, 0),
  }), [filtered]);

  const columns: Column<MonthlySalesItemSummaryRow>[] = [
    {
      key: 'product_name',
      label: 'Product Name',
      render: row => (
        <div>
          <p className="font-medium text-slate-800">{row.product_name}</p>
          {row.sku_code && <p className="text-xs font-mono text-slate-400">{row.sku_code}</p>}
        </div>
      ),
    },
    { key: 'total_quantity', label: 'Total Quantity Sold', align: 'right', render: row => <span className="font-mono">{formatQty(row.total_quantity)}</span> },
    { key: 'unit', label: 'Unit', render: row => row.unit || '--', className: 'whitespace-nowrap' },
    { key: 'total_sales', label: 'Total Sales', align: 'right', render: row => <span className="font-mono">{formatCurrency(row.total_sales)}</span> },
    { key: 'total_cost_of_sales', label: 'Total Cost of Sales', align: 'right', render: row => <span className="font-mono">{formatCurrency(row.total_cost_of_sales)}</span> },
    { key: 'gross_profit', label: 'Gross Profit', align: 'right', render: row => <span className={`font-mono font-semibold ${row.gross_profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(row.gross_profit)}</span> },
  ];

  function handleReset() {
    const nextToday = getTodayDate();
    const nextFrom = getMonthStart(nextToday);
    setDateFrom(nextFrom);
    setDateTo(nextToday);
    setProductSearch('');
    void loadRange(nextFrom, nextToday);
  }

  function handleExport() {
    exportToCsv(
      'product-summary-sales-report.csv',
      ['Product Name', 'SKU', 'Total Quantity Sold', 'Unit', 'Total Sales', 'Total Cost of Sales', 'Gross Profit'],
      filtered.map(row => [
        row.product_name,
        row.sku_code,
        row.total_quantity,
        row.unit,
        row.total_sales,
        row.total_cost_of_sales,
        row.gross_profit,
      ]),
    );
  }

  return (
    <ReportShell
      title="Product Summary Sales Report"
      subtitle={`${dateFrom} to ${dateTo}`}
      loading={loading}
      onRefresh={() => void load()}
      onExportCsv={handleExport}
      printTitle={`Product Summary Sales Report (${dateFrom} to ${dateTo})`}
      filters={
        <>
          <label className="text-xs font-medium text-slate-600">From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <label className="text-xs font-medium text-slate-600">To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="text" value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Search product / SKU" className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={() => void load()} className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Apply</button>
          <button onClick={handleReset} className="px-4 py-1.5 text-sm font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">Reset</button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-4 mb-4">
        <SummaryCard label="Item Summaries" value={filtered.length.toLocaleString('en-PH')} />
        <SummaryCard label="Total Sales" value={formatCurrency(totals.sales)} />
        <SummaryCard label="Total Cost" value={formatCurrency(totals.cost)} />
        <SummaryCard label="Gross Profit" value={formatCurrency(totals.gross)} />
      </div>

      <ReportTable
        columns={columns}
        data={filtered}
        rowKey={row => row.product_key}
        emptyMessage="No sold items found for the selected range."
        footer={
          <tr>
            <td className="px-4 py-3 font-bold text-slate-800">TOTAL</td>
            <td className="px-4 py-3"></td>
            <td className="px-4 py-3"></td>
            <td className="px-4 py-3 text-right font-mono font-bold">{formatCurrency(totals.sales)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold">{formatCurrency(totals.cost)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold">{formatCurrency(totals.gross)}</td>
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
