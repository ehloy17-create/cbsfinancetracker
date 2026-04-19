import { useState, useEffect } from 'react';
import { fetchCashierSalesReport, CashierSalesRow } from '../lib/reportQueries';
import { getDefaultDateRange } from '../lib/dateRanges';
import { exportToCsv } from '../lib/csvExport';
import ReportShell from '../components/ReportShell';
import { ReportTable, Column } from '../components/ReportTable';

function fmt(n: number) { return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const defaultRange = getDefaultDateRange(29);

export default function CashierSalesReportPage() {
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo]     = useState(defaultRange.to);
  const [data, setData]         = useState<CashierSalesRow[]>([]);
  const [loading, setLoading]   = useState(true);

  async function load() {
    setLoading(true);
    setData(await fetchCashierSalesReport(dateFrom, dateTo));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const totals = data.reduce((acc, r) => ({
    shift_count: acc.shift_count + r.shift_count,
    txn_count:   acc.txn_count   + r.txn_count,
    gross_sales: acc.gross_sales + r.gross_sales,
    discounts:   acc.discounts   + r.discounts,
    net_sales:   acc.net_sales   + r.net_sales,
    voids:       acc.voids       + r.voids,
    returns:     acc.returns     + r.returns,
  }), { shift_count: 0, txn_count: 0, gross_sales: 0, discounts: 0, net_sales: 0, voids: 0, returns: 0 });

  const columns: Column<CashierSalesRow>[] = [
    { key: 'cashier_name', label: 'Cashier',      render: r => <span className="font-medium text-slate-800">{r.cashier_name}</span> },
    { key: 'shift_count',  label: 'Shifts',       align: 'right' },
    { key: 'txn_count',    label: 'Transactions', align: 'right' },
    { key: 'gross_sales',  label: 'Gross Sales',  align: 'right', render: r => <span className="font-mono">₱{fmt(r.gross_sales)}</span> },
    { key: 'discounts',    label: 'Discounts',    align: 'right', render: r => <span className="font-mono text-red-600">-₱{fmt(r.discounts)}</span> },
    { key: 'net_sales',    label: 'Net Sales',    align: 'right', render: r => <span className="font-mono font-semibold">₱{fmt(r.net_sales)}</span> },
    { key: 'voids',        label: 'Voids',        align: 'right', render: r => <span className="font-mono text-red-500">₱{fmt(r.voids)}</span> },
    { key: 'returns',      label: 'Returns',      align: 'right', render: r => <span className="font-mono text-orange-500">₱{fmt(r.returns)}</span> },
  ];

  function handleExport() {
    exportToCsv('cashier-sales.csv',
      ['Cashier', 'Shifts', 'Transactions', 'Gross Sales', 'Discounts', 'Net Sales', 'Voids', 'Returns'],
      data.map(r => [r.cashier_name, r.shift_count, r.txn_count, r.gross_sales, r.discounts, r.net_sales, r.voids, r.returns])
    );
  }

  return (
    <ReportShell
      title="Cashier Sales Report"
      subtitle={`${dateFrom} to ${dateTo}`}
      loading={loading}
      onRefresh={load}
      onExportCsv={handleExport}
      filters={
        <>
          <label className="text-xs font-medium text-slate-600">From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <label className="text-xs font-medium text-slate-600">To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={load} className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Apply</button>
        </>
      }
    >
      <ReportTable
        columns={columns}
        data={data}
        rowKey={r => r.cashier_id}
        footer={
          <tr>
            <td className="px-4 py-3 font-bold text-slate-800">TOTAL</td>
            <td className="px-4 py-3 text-right font-bold">{totals.shift_count}</td>
            <td className="px-4 py-3 text-right font-bold">{totals.txn_count}</td>
            <td className="px-4 py-3 text-right font-mono font-bold">₱{fmt(totals.gross_sales)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold text-red-600">-₱{fmt(totals.discounts)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold">₱{fmt(totals.net_sales)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold text-red-500">₱{fmt(totals.voids)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold text-orange-500">₱{fmt(totals.returns)}</td>
          </tr>
        }
      />
    </ReportShell>
  );
}
