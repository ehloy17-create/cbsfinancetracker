import { useState, useEffect } from 'react';
import { fetchInventoryOnHandReport, InventoryOnHandRow } from '../lib/reportQueries';
import { exportToCsv } from '../lib/csvExport';
import ReportShell from '../components/ReportShell';
import { ReportTable, Column } from '../components/ReportTable';

function fmt(n: number) { return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const STATUS_BADGE: Record<string, string> = {
  ok:  'bg-emerald-100 text-emerald-700',
  low: 'bg-amber-100 text-amber-700',
  out: 'bg-red-100 text-red-700',
};
const STATUS_LABEL: Record<string, string> = { ok: 'OK', low: 'Low', out: 'Out' };

export default function InventoryOnHandReportPage() {
  const [data, setData]         = useState<InventoryOnHandRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<'all' | 'low' | 'out'>('all');
  const [search, setSearch]     = useState('');

  async function load() {
    setLoading(true);
    setData(await fetchInventoryOnHandReport());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = data.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.product_name.toLowerCase().includes(q) || r.sku_code.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
    }
    return true;
  });

  const totalValue = filtered.reduce((s, r) => s + r.stock_value, 0);

  const columns: Column<InventoryOnHandRow>[] = [
    { key: 'sku_code',      label: 'SKU',          render: r => <span className="font-mono text-xs text-slate-500">{r.sku_code}</span> },
    { key: 'product_name',  label: 'Product',      render: r => <span className="font-medium text-slate-800">{r.product_name}</span> },
    { key: 'category',      label: 'Category' },
    { key: 'brand',         label: 'Brand' },
    { key: 'unit',          label: 'Unit' },
    { key: 'location_name', label: 'Location' },
    { key: 'qty_on_hand',   label: 'Qty On Hand',  align: 'right', render: r => <span className="font-mono text-slate-500">{r.qty_on_hand}</span> },
    { key: 'qty_available', label: 'Qty Available', align: 'right', render: r => <span className="font-mono font-semibold">{r.qty_available}</span> },
    { key: 'reorder_point', label: 'Reorder Pt',   align: 'right', render: r => <span className="font-mono text-slate-500">{r.reorder_point || '—'}</span> },
    { key: 'unit_cost',     label: 'Unit Cost',    align: 'right', render: r => <span className="font-mono">₱{fmt(r.unit_cost)}</span> },
    { key: 'stock_value',   label: 'Stock Value',  align: 'right', render: r => <span className="font-mono font-semibold">₱{fmt(r.stock_value)}</span> },
    { key: 'status',        label: 'Status',       render: r => (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[r.status]}`}>
        {STATUS_LABEL[r.status]}
      </span>
    )},
  ];

  function handleExport() {
    exportToCsv('inventory-on-hand.csv',
      ['SKU', 'Product', 'Category', 'Brand', 'Unit', 'Location', 'Qty On Hand', 'Qty Available', 'Reorder Point', 'Unit Cost', 'Stock Value', 'Status'],
      filtered.map(r => [r.sku_code, r.product_name, r.category, r.brand, r.unit, r.location_name, r.qty_on_hand, r.qty_available, r.reorder_point, r.unit_cost, r.stock_value, r.status])
    );
  }

  return (
    <ReportShell
      title="Inventory On Hand"
      subtitle={`${filtered.length} items — Total Value: ₱${fmt(totalValue)}`}
      loading={loading}
      onRefresh={load}
      onExportCsv={handleExport}
      filters={
        <>
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search product, SKU, category..."
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
          />
          <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">All Status</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
          </select>
        </>
      }
    >
      <ReportTable
        columns={columns}
        data={filtered}
        rowKey={r => `${r.product_id}-${r.location_name}`}
        footer={
          <tr>
            <td colSpan={10} className="px-4 py-3 font-bold text-slate-800">TOTAL STOCK VALUE</td>
            <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">₱{fmt(totalValue)}</td>
            <td />
          </tr>
        }
      />
    </ReportShell>
  );
}
