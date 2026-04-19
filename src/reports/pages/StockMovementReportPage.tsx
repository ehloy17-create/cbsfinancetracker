import { useState, useEffect } from 'react';
import { fetchStockMovementReport, StockMovementRow } from '../lib/reportQueries';
import { getDefaultDateRange } from '../lib/dateRanges';
import { exportToCsv } from '../lib/csvExport';
import ReportShell from '../components/ReportShell';
import { ReportTable, Column } from '../components/ReportTable';

const defaultRange = getDefaultDateRange(29);

const TYPE_COLORS: Record<string, string> = {
  in:         'bg-emerald-100 text-emerald-700',
  out:        'bg-red-100 text-red-700',
  transfer:   'bg-blue-100 text-blue-700',
  adjustment: 'bg-amber-100 text-amber-700',
  opening:    'bg-slate-100 text-slate-600',
  return:     'bg-orange-100 text-orange-700',
};

export default function StockMovementReportPage() {
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo]     = useState(defaultRange.to);
  const [search, setSearch]     = useState('');
  const [data, setData]         = useState<StockMovementRow[]>([]);
  const [loading, setLoading]   = useState(true);

  async function load() {
    setLoading(true);
    setData(await fetchStockMovementReport(dateFrom, dateTo));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = search
    ? data.filter(r => r.product_name.toLowerCase().includes(search.toLowerCase()) || r.sku_code.toLowerCase().includes(search.toLowerCase()) || r.ref_number.toLowerCase().includes(search.toLowerCase()))
    : data;

  const columns: Column<StockMovementRow>[] = [
    { key: 'created_at',   label: 'Date/Time',     render: r => <span className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString('en-PH')}</span> },
    { key: 'sku_code',     label: 'SKU',           render: r => <span className="font-mono text-xs text-slate-500">{r.sku_code}</span> },
    { key: 'product_name', label: 'Product',       render: r => <span className="font-medium text-slate-800">{r.product_name}</span> },
    { key: 'location_name', label: 'Location' },
    { key: 'movement_type', label: 'Type',         render: r => (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${TYPE_COLORS[r.movement_type] ?? 'bg-slate-100 text-slate-600'}`}>
        {r.movement_type}
      </span>
    )},
    { key: 'display_qty', label: 'Entered Qty', align: 'right', render: r => (
      r.display_qty != null
        ? <span className="font-mono">{r.display_qty} {r.display_unit_name ?? ''}</span>
        : <span className="text-slate-400 text-xs">—</span>
    )},
    { key: 'qty_before',   label: 'Before',        align: 'right', render: r => <span className="font-mono text-slate-500">{r.qty_before}</span> },
    { key: 'qty_change',   label: 'Base Change',        align: 'right', render: r => (
      <span className={`font-mono font-semibold ${r.qty_change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
        {r.qty_change >= 0 ? '+' : ''}{r.qty_change}
      </span>
    )},
    { key: 'qty_after',    label: 'After',         align: 'right', render: r => <span className="font-mono font-semibold text-slate-800">{r.qty_after}</span> },
    { key: 'ref_number',   label: 'Reference' },
    { key: 'created_by_name', label: 'By' },
  ];

  function handleExport() {
    exportToCsv('stock-movement.csv',
      ['Date', 'SKU', 'Product', 'Location', 'Type', 'Entered Qty', 'Before', 'Base Change', 'After', 'Reference', 'By', 'Notes'],
      filtered.map(r => [new Date(r.created_at).toLocaleString('en-PH'), r.sku_code, r.product_name, r.location_name, r.movement_type, r.display_qty != null ? `${r.display_qty} ${r.display_unit_name ?? ''}` : '', r.qty_before, r.qty_change, r.qty_after, r.ref_number, r.created_by_name, r.notes])
    );
  }

  return (
    <ReportShell
      title="Stock Movement Ledger"
      subtitle={`${dateFrom} to ${dateTo} — ${filtered.length} movements`}
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
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product, SKU, ref..."
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 w-48" />
        </>
      }
    >
      <ReportTable columns={columns} data={filtered} rowKey={r => r.id} />
    </ReportShell>
  );
}
