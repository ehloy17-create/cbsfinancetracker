import { useState, useEffect, useCallback } from 'react';
import { fetchXZReadingReport, XZReadingRow } from '../lib/reportQueries';
import { getDefaultDateRange } from '../lib/dateRanges';
import { exportToCsv } from '../lib/csvExport';
import ReportShell from '../components/ReportShell';
import { ReportTable, Column } from '../components/ReportTable';

function fmt(n: number) { return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const defaultRange = getDefaultDateRange(29);

export default function XZReadingReportPage() {
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo]     = useState(defaultRange.to);
  const [data, setData]         = useState<XZReadingRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setData(await fetchXZReadingReport(dateFrom, dateTo));
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { void load(); }, [load]);

  const filtered = statusFilter === 'all' ? data : data.filter(r => r.status === statusFilter);

  const totals = filtered.reduce((acc, r) => ({
    txn_count:    acc.txn_count    + r.txn_count,
    gross_sales:  acc.gross_sales  + r.gross_sales,
    discounts:    acc.discounts    + r.discounts,
    net_sales:    acc.net_sales    + r.net_sales,
    voids:        acc.voids        + r.voids,
    returns:      acc.returns      + r.returns,
    cash_sales:   acc.cash_sales   + r.cash_sales,
    gcash_sales:  acc.gcash_sales  + r.gcash_sales,
  }), { txn_count: 0, gross_sales: 0, discounts: 0, net_sales: 0, voids: 0, returns: 0, cash_sales: 0, gcash_sales: 0 });

  const columns: Column<XZReadingRow>[] = [
    { key: 'business_date', label: 'Date',         render: r => <span className="font-medium">{r.business_date}</span> },
    { key: 'cashier_name',  label: 'Cashier' },
    { key: 'terminal_name', label: 'Terminal',     render: r => <span className="text-xs text-slate-500">{r.terminal_name}</span> },
    { key: 'location_name', label: 'Location' },
    { key: 'status',        label: 'Status',       render: r => (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${r.status === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
        {r.status}
      </span>
    )},
    { key: 'txn_count',     label: 'Txns',         align: 'right' },
    { key: 'gross_sales',   label: 'Gross',        align: 'right', render: r => <span className="font-mono">₱{fmt(r.gross_sales)}</span> },
    { key: 'net_sales',     label: 'Net Sales',    align: 'right', render: r => <span className="font-mono font-semibold">₱{fmt(r.net_sales)}</span> },
    { key: 'cash_sales',    label: 'Cash',         align: 'right', render: r => <span className="font-mono">₱{fmt(r.cash_sales)}</span> },
    { key: 'gcash_sales',   label: 'GCash',        align: 'right', render: r => <span className="font-mono">₱{fmt(r.gcash_sales)}</span> },
    { key: 'voids',         label: 'Voids',        align: 'right', render: r => <span className="font-mono text-red-500">₱{fmt(r.voids)}</span> },
    { key: 'returns',       label: 'Returns',      align: 'right', render: r => <span className="font-mono text-orange-500">₱{fmt(r.returns)}</span> },
    { key: 'expected_cash', label: 'Exp. Cash',    align: 'right', render: r => <span className="font-mono">₱{fmt(r.expected_cash)}</span> },
    { key: 'actual_cash',   label: 'Actual Cash',  align: 'right', render: r => r.actual_cash !== null
      ? <span className="font-mono">₱{fmt(r.actual_cash)}</span>
      : <span className="text-slate-400 text-xs">Open</span>
    },
    { key: 'over_short',    label: 'Over/Short',   align: 'right', render: r => r.over_short !== null
      ? <span className={`font-mono font-bold ${r.over_short >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {r.over_short >= 0 ? '+' : ''}₱{fmt(Math.abs(r.over_short))}
        </span>
      : <span className="text-slate-400 text-xs">—</span>
    },
  ];

  function handleExport() {
    exportToCsv('xz-reading-report.csv',
      ['Date', 'Cashier', 'Terminal', 'Location', 'Status', 'Txns', 'Gross Sales', 'Net Sales', 'Cash', 'GCash', 'Voids', 'Returns', 'Expected Cash', 'Actual Cash', 'Over/Short'],
      filtered.map(r => [r.business_date, r.cashier_name, r.terminal_name, r.location_name, r.status, r.txn_count, r.gross_sales, r.net_sales, r.cash_sales, r.gcash_sales, r.voids, r.returns, r.expected_cash, r.actual_cash ?? '', r.over_short ?? ''])
    );
  }

  return (
    <ReportShell
      title="X/Z Reading Report"
      subtitle={`${dateFrom} to ${dateTo} — ${filtered.length} shifts`}
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
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">All Shifts</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </>
      }
    >
      <ReportTable
        columns={columns}
        data={filtered}
        rowKey={r => r.shift_id}
        footer={
          <tr>
            <td colSpan={5} className="px-4 py-3 font-bold text-slate-800">TOTAL</td>
            <td className="px-4 py-3 text-right font-bold">{totals.txn_count}</td>
            <td className="px-4 py-3 text-right font-mono font-bold">₱{fmt(totals.gross_sales)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold">₱{fmt(totals.net_sales)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold">₱{fmt(totals.cash_sales)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold">₱{fmt(totals.gcash_sales)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold text-red-500">₱{fmt(totals.voids)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold text-orange-500">₱{fmt(totals.returns)}</td>
            <td colSpan={3} />
          </tr>
        }
      />
    </ReportShell>
  );
}
