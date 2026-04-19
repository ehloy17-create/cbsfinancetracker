import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getDefaultDateRange } from '../lib/dateRanges';
import { exportToCsv } from '../lib/csvExport';
import ReportShell from '../components/ReportShell';
import { ReportTable, Column } from '../components/ReportTable';

interface AdjRow {
  id: string;
  adjustment_number: string;
  location_name: string;
  adjustment_date: string;
  adjustment_type: string;
  reason: string;
  status: string;
  item_count: number;
  created_by_name: string;
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  posted: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const defaultRange = getDefaultDateRange(89);

export default function AdjustmentHistoryReportPage() {
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [data, setData] = useState<AdjRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data: rows } = await supabase
      .from('adjustments')
      .select('id, adj_number, location_id, adj_date, adj_type, reason, status, created_by')
      .gte('adj_date', dateFrom)
      .lte('adj_date', dateTo)
      .order('adj_date', { ascending: false });

    const adjustmentRows = (rows ?? []) as Array<Record<string, unknown>>;
    const adjustmentIds = Array.from(new Set(adjustmentRows.map((row) => String(row.id ?? '')).filter(Boolean)));
    const locationIds = Array.from(new Set(adjustmentRows.map((row) => String(row.location_id ?? '')).filter(Boolean)));
    const userIds = Array.from(new Set(adjustmentRows.map((row) => String(row.created_by ?? '')).filter(Boolean)));

    const [{ data: locations }, { data: users }, { data: items }] = await Promise.all([
      locationIds.length ? supabase.from('inv_locations').select('id, name').in('id', locationIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      userIds.length ? supabase.from('profiles').select('id, name').in('id', userIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      adjustmentIds.length ? supabase.from('adjustment_items').select('adjustment_id').in('adjustment_id', adjustmentIds) : Promise.resolve({ data: [] as Array<{ adjustment_id: string }> }),
    ]);

    const locationMap = new Map(((locations ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
    const userMap = new Map(((users ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
    const itemCountMap = new Map<string, number>();
    for (const item of items ?? []) {
      const adjustmentId = String(item.adjustment_id ?? '');
      itemCountMap.set(adjustmentId, (itemCountMap.get(adjustmentId) ?? 0) + 1);
    }

    setData(adjustmentRows.map((row) => ({
      id: String(row.id ?? ''),
      adjustment_number: String(row.adj_number ?? ''),
      location_name: locationMap.get(String(row.location_id ?? '')) ?? '',
      adjustment_date: String(row.adj_date ?? ''),
      adjustment_type: String(row.adj_type ?? ''),
      reason: String(row.reason ?? ''),
      status: String(row.status ?? ''),
      item_count: itemCountMap.get(String(row.id ?? '')) ?? 0,
      created_by_name: userMap.get(String(row.created_by ?? '')) ?? '',
    })));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const columns: Column<AdjRow>[] = [
    { key: 'adjustment_number', label: 'Adj #', render: row => <span className="font-mono text-xs text-blue-600">{row.adjustment_number}</span> },
    { key: 'location_name', label: 'Location', render: row => <span className="font-medium text-slate-800">{row.location_name}</span> },
    { key: 'adjustment_date', label: 'Date' },
    { key: 'adjustment_type', label: 'Type', render: row => <span className="capitalize text-slate-600">{row.adjustment_type.split('_').join(' ')}</span> },
    { key: 'reason', label: 'Reason', render: row => <span className="text-xs text-slate-500">{row.reason || '—'}</span> },
    { key: 'item_count', label: 'Items', align: 'right' },
    {
      key: 'status',
      label: 'Status',
      render: row => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[row.status] ?? 'bg-slate-100 text-slate-600'}`}>
          {row.status}
        </span>
      ),
    },
    { key: 'created_by_name', label: 'Created By' },
  ];

  function handleExport() {
    exportToCsv(
      'adjustment-history.csv',
      ['Adj #', 'Location', 'Date', 'Type', 'Reason', 'Items', 'Status', 'Created By'],
      data.map(row => [row.adjustment_number, row.location_name, row.adjustment_date, row.adjustment_type, row.reason, row.item_count, row.status, row.created_by_name]),
    );
  }

  return (
    <ReportShell
      title="Adjustment History"
      subtitle={`${dateFrom} to ${dateTo}`}
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
        </>
      }
    >
      <ReportTable columns={columns} data={data} rowKey={row => row.id} />
    </ReportShell>
  );
}
