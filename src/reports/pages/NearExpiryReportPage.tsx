import { useState, useEffect } from 'react';
import { fetchExpiryReport, ExpiryRow } from '../lib/reportQueries';
import { exportToCsv } from '../lib/csvExport';
import ReportShell from '../components/ReportShell';
import { ReportTable, Column } from '../components/ReportTable';

const STATUS_BADGE: Record<string, string> = {
  expired:  'bg-red-100 text-red-700',
  critical: 'bg-orange-100 text-orange-700',
  near:     'bg-amber-100 text-amber-700',
};
const STATUS_LABEL: Record<string, string> = {
  expired: 'Expired', critical: 'Critical (≤7d)', near: 'Near Expiry',
};

export default function NearExpiryReportPage() {
  const [daysAhead, setDaysAhead] = useState(30);
  const [data, setData]           = useState<ExpiryRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'expired' | 'critical' | 'near'>('all');

  async function load() {
    setLoading(true);
    setData(await fetchExpiryReport(daysAhead));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = statusFilter === 'all' ? data : data.filter(r => r.status === statusFilter);

  const columns: Column<ExpiryRow>[] = [
    { key: 'expiry_date',   label: 'Expiry Date',  render: r => <span className="font-medium">{r.expiry_date}</span> },
    { key: 'days_to_expiry', label: 'Days',         align: 'right', render: r => (
      <span className={`font-mono font-semibold ${r.days_to_expiry < 0 ? 'text-red-600' : r.days_to_expiry <= 7 ? 'text-orange-600' : 'text-amber-600'}`}>
        {r.days_to_expiry < 0 ? `${Math.abs(r.days_to_expiry)} overdue` : r.days_to_expiry}
      </span>
    )},
    { key: 'sku_code',      label: 'SKU',          render: r => <span className="font-mono text-xs text-slate-500">{r.sku_code}</span> },
    { key: 'product_name',  label: 'Product',      render: r => <span className="font-medium text-slate-800">{r.product_name}</span> },
    { key: 'location_name', label: 'Location' },
    { key: 'batch_number',  label: 'Batch No.',    render: r => <span className="font-mono text-xs">{r.batch_number || '—'}</span> },
    { key: 'qty_on_hand',   label: 'Qty On Hand',  align: 'right', render: r => <span className="font-mono font-semibold">{r.qty_on_hand}</span> },
    { key: 'status',        label: 'Status',       render: r => (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[r.status]}`}>
        {STATUS_LABEL[r.status]}
      </span>
    )},
  ];

  function handleExport() {
    exportToCsv('near-expiry.csv',
      ['Expiry Date', 'Days', 'SKU', 'Product', 'Location', 'Batch No', 'Qty On Hand', 'Status'],
      filtered.map(r => [r.expiry_date, r.days_to_expiry, r.sku_code, r.product_name, r.location_name, r.batch_number, r.qty_on_hand, r.status])
    );
  }

  return (
    <ReportShell
      title="Near Expiry / Expired Items"
      subtitle={`${filtered.length} lots within ${daysAhead} days`}
      loading={loading}
      onRefresh={load}
      onExportCsv={handleExport}
      filters={
        <>
          <label className="text-xs font-medium text-slate-600">Days ahead</label>
          <select value={daysAhead} onChange={e => setDaysAhead(Number(e.target.value))}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
          <button onClick={load} className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Apply</button>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">All Status</option>
            <option value="expired">Expired</option>
            <option value="critical">Critical (≤7d)</option>
            <option value="near">Near Expiry</option>
          </select>
        </>
      }
    >
      <ReportTable columns={columns} data={filtered} rowKey={r => r.lot_id} />
    </ReportShell>
  );
}
