import { useState, useEffect } from 'react';
import { fetchLowStockReport, LowStockRow } from '../lib/reportQueries';
import { exportToCsv } from '../lib/csvExport';
import ReportShell from '../components/ReportShell';
import { ReportTable, Column } from '../components/ReportTable';

export default function LowStockReportPage() {
  const [data, setData]       = useState<LowStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  async function load() {
    setLoading(true);
    setData(await fetchLowStockReport());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = search
    ? data.filter(r => r.product_name.toLowerCase().includes(search.toLowerCase()) || r.sku_code.toLowerCase().includes(search.toLowerCase()))
    : data;

  const columns: Column<LowStockRow>[] = [
    { key: 'sku_code',      label: 'SKU',           render: r => <span className="font-mono text-xs text-slate-500">{r.sku_code}</span> },
    { key: 'product_name',  label: 'Product',       render: r => <span className="font-medium text-slate-800">{r.product_name}</span> },
    { key: 'category',      label: 'Category' },
    { key: 'location_name', label: 'Location' },
    { key: 'reorder_point', label: 'Reorder Pt',   align: 'right', render: r => <span className="font-mono">{r.reorder_point}</span> },
    { key: 'qty_available', label: 'Qty Available',  align: 'right', render: r => (
      <span className={`font-mono font-semibold ${r.qty_available <= 0 ? 'text-red-600' : 'text-amber-600'}`}>{r.qty_available}</span>
    )},
    { key: 'shortage',      label: 'Shortage',     align: 'right', render: r => (
      <span className="font-mono font-bold text-red-600">{r.shortage}</span>
    )},
    { key: 'status',        label: 'Status',       render: r => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${r.qty_available <= 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
          {r.qty_available <= 0 ? 'Out of Stock' : 'Low Stock'}
        </span>
    )},
  ];

  function handleExport() {
    exportToCsv('low-stock.csv',
      ['SKU', 'Product', 'Category', 'Location', 'Reorder Point', 'Qty Available', 'Shortage'],
      filtered.map(r => [r.sku_code, r.product_name, r.category, r.location_name, r.reorder_point, r.qty_available, r.shortage])
    );
  }

  return (
    <ReportShell
      title="Low Stock Report"
      subtitle={`${filtered.length} items at or below reorder point`}
      loading={loading}
      onRefresh={load}
      onExportCsv={handleExport}
      filters={
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product or SKU..."
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 w-56" />
      }
    >
      <ReportTable columns={columns} data={filtered} rowKey={r => `${r.product_id}-${r.location_name}`} />
    </ReportShell>
  );
}
