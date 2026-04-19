import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getDefaultDateRange } from '../lib/dateRanges';
import { exportToCsv } from '../lib/csvExport';
import ReportShell from '../components/ReportShell';
import { ReportTable, Column } from '../components/ReportTable';

function fmt(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface VarRow {
  id: string;
  count_number: string;
  count_date: string;
  location_name: string;
  status: string;
  product_name: string;
  sku_code: string;
  system_qty: number;
  counted_qty: number;
  variance: number;
  variance_value: number;
}

const defaultRange = getDefaultDateRange(89);

export default function PhysicalCountVarianceReportPage() {
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [data, setData] = useState<VarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOnly, setShowOnly] = useState<'all' | 'variance'>('variance');

  async function load() {
    setLoading(true);
    const { data: counts } = await supabase
      .from('physical_counts')
      .select('id, pc_number, count_date, location_id, status')
      .gte('count_date', dateFrom)
      .lte('count_date', dateTo)
      .in('status', ['posted']);

    const countRows = (counts ?? []) as Array<Record<string, unknown>>;
    const countIds = Array.from(new Set(countRows.map((row) => String(row.id ?? '')).filter(Boolean)));
    const locationIds = Array.from(new Set(countRows.map((row) => String(row.location_id ?? '')).filter(Boolean)));

    const [{ data: locations }, { data: items }] = await Promise.all([
      locationIds.length ? supabase.from('inv_locations').select('id, name').in('id', locationIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      countIds.length
        ? supabase.from('physical_count_items').select('id, physical_count_id, product_id, qty_system, qty_counted, qty_variance').in('physical_count_id', countIds)
        : Promise.resolve({ data: [] as Array<Record<string, string | number>> }),
    ]);

    const countItems = (items ?? []) as Array<Record<string, unknown>>;
    const productIds = Array.from(new Set(countItems.map((item) => String(item.product_id ?? '')).filter(Boolean)));
    const { data: products } = productIds.length
      ? await supabase.from('inv_products').select('id, sku_code, name, cost_price').in('id', productIds)
      : { data: [] as Array<{ id: string; sku_code: string; name: string; cost_price: number }> };

    const locationMap = new Map(((locations ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
    const productRows = (products ?? []) as Array<{ id: string; sku_code: string; name: string; cost_price: number }>;
    const productMap = new Map(productRows.map((row) => [row.id, row]));
    const countMap = new Map(countRows.map((row) => [String(row.id ?? ''), row]));

    const rows: VarRow[] = countItems.map((item) => {
      const count = countMap.get(String(item.physical_count_id ?? ''));
      const product = productMap.get(String(item.product_id ?? ''));
      const variance = Number(item.qty_variance ?? 0);
      return {
        id: String(item.id ?? ''),
        count_number: String(count?.pc_number ?? ''),
        count_date: String(count?.count_date ?? ''),
        location_name: locationMap.get(String(count?.location_id ?? '')) ?? '',
        status: String(count?.status ?? ''),
        product_name: String(product?.name ?? ''),
        sku_code: String(product?.sku_code ?? ''),
        system_qty: Number(item.qty_system ?? 0),
        counted_qty: Number(item.qty_counted ?? 0),
        variance,
        variance_value: variance * Number(product?.cost_price ?? 0),
      };
    });

    setData(rows);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const filtered = showOnly === 'variance' ? data.filter(row => row.variance !== 0) : data;
  const totalVarianceValue = filtered.reduce((sum, row) => sum + row.variance_value, 0);

  const columns: Column<VarRow>[] = [
    { key: 'count_number', label: 'Count #', render: row => <span className="font-mono text-xs text-blue-600">{row.count_number}</span> },
    { key: 'count_date', label: 'Date' },
    { key: 'location_name', label: 'Location' },
    { key: 'sku_code', label: 'SKU', render: row => <span className="font-mono text-xs text-slate-500">{row.sku_code}</span> },
    { key: 'product_name', label: 'Product', render: row => <span className="font-medium text-slate-800">{row.product_name}</span> },
    { key: 'system_qty', label: 'System Qty', align: 'right', render: row => <span className="font-mono">{row.system_qty}</span> },
    { key: 'counted_qty', label: 'Counted Qty', align: 'right', render: row => <span className="font-mono">{row.counted_qty}</span> },
    {
      key: 'variance',
      label: 'Variance',
      align: 'right',
      render: row => (
        <span className={`font-mono font-bold ${row.variance > 0 ? 'text-emerald-600' : row.variance < 0 ? 'text-red-600' : 'text-slate-400'}`}>
          {row.variance > 0 ? '+' : ''}{row.variance}
        </span>
      ),
    },
    {
      key: 'variance_value',
      label: 'Var. Value',
      align: 'right',
      render: row => (
        <span className={`font-mono font-semibold ${row.variance_value > 0 ? 'text-emerald-600' : row.variance_value < 0 ? 'text-red-600' : 'text-slate-400'}`}>
          {row.variance_value !== 0 ? `${row.variance_value > 0 ? '+' : ''}₱${fmt(Math.abs(row.variance_value))}` : '—'}
        </span>
      ),
    },
  ];

  function handleExport() {
    exportToCsv(
      'physical-count-variance.csv',
      ['Count #', 'Date', 'Location', 'SKU', 'Product', 'System Qty', 'Counted Qty', 'Variance', 'Variance Value'],
      filtered.map(row => [row.count_number, row.count_date, row.location_name, row.sku_code, row.product_name, row.system_qty, row.counted_qty, row.variance, row.variance_value]),
    );
  }

  return (
    <ReportShell
      title="Physical Count Variance"
      subtitle={`${dateFrom} to ${dateTo} — Total variance value: ${totalVarianceValue >= 0 ? '+' : ''}₱${fmt(Math.abs(totalVarianceValue))}`}
      loading={loading}
      onRefresh={load}
      onExportCsv={handleExport}
      filters={
        <>
          <label className="text-xs font-medium text-slate-600">From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <label className="text-xs font-medium text-slate-600">To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={load} className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Apply</button>
          <select value={showOnly} onChange={e => setShowOnly(e.target.value as typeof showOnly)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="variance">With Variance Only</option>
            <option value="all">All Items</option>
          </select>
        </>
      }
    >
      <ReportTable
        columns={columns}
        data={filtered}
        rowKey={row => row.id}
        footer={
          <tr>
            <td colSpan={8} className="px-4 py-3 font-bold text-slate-800">TOTAL VARIANCE VALUE</td>
            <td className={`px-4 py-3 text-right font-mono font-bold ${totalVarianceValue >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {totalVarianceValue >= 0 ? '+' : ''}₱{fmt(Math.abs(totalVarianceValue))}
            </td>
          </tr>
        }
      />
    </ReportShell>
  );
}
