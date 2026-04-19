import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getDefaultDateRange } from '../lib/dateRanges';
import { exportToCsv } from '../lib/csvExport';
import ReportShell from '../components/ReportShell';
import { ReportTable, Column } from '../components/ReportTable';

interface TransferRow {
  id: string;
  transfer_number: string;
  from_location: string;
  to_location: string;
  transfer_date: string;
  status: string;
  notes: string;
  item_count: number;
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  approved: 'bg-blue-100 text-blue-700',
  issued: 'bg-indigo-100 text-indigo-700',
  partially_received: 'bg-amber-100 text-amber-700',
  fully_received: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const defaultRange = getDefaultDateRange(89);

export default function TransferHistoryReportPage() {
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [data, setData] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data: rows } = await supabase
      .from('stock_transfers')
      .select('id, transfer_number, source_location_id, destination_location_id, transfer_date, status, notes')
      .gte('transfer_date', dateFrom)
      .lte('transfer_date', dateTo)
      .order('transfer_date', { ascending: false });

    const transferRows = (rows ?? []) as Array<Record<string, unknown>>;
    const transferIds = Array.from(new Set(transferRows.map((row) => String(row.id ?? '')).filter(Boolean)));
    const locationIds = Array.from(new Set(transferRows.flatMap((row) => [String(row.source_location_id ?? ''), String(row.destination_location_id ?? '')]).filter(Boolean)));

    const [{ data: locations }, { data: items }] = await Promise.all([
      locationIds.length ? supabase.from('inv_locations').select('id, name').in('id', locationIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      transferIds.length ? supabase.from('stock_transfer_items').select('transfer_id').in('transfer_id', transferIds) : Promise.resolve({ data: [] as Array<{ transfer_id: string }> }),
    ]);

    const locationMap = new Map(((locations ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
    const countMap = new Map<string, number>();
    for (const item of items ?? []) {
      const transferId = String(item.transfer_id ?? '');
      countMap.set(transferId, (countMap.get(transferId) ?? 0) + 1);
    }

    setData(transferRows.map((row) => ({
      id: String(row.id ?? ''),
      transfer_number: String(row.transfer_number ?? ''),
      from_location: locationMap.get(String(row.source_location_id ?? '')) ?? '',
      to_location: locationMap.get(String(row.destination_location_id ?? '')) ?? '',
      transfer_date: String(row.transfer_date ?? ''),
      status: String(row.status ?? ''),
      notes: String(row.notes ?? ''),
      item_count: countMap.get(String(row.id ?? '')) ?? 0,
    })));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const columns: Column<TransferRow>[] = [
    { key: 'transfer_number', label: 'Transfer #', render: row => <span className="font-mono text-xs text-blue-600">{row.transfer_number}</span> },
    { key: 'from_location', label: 'From', render: row => <span className="font-medium text-slate-800">{row.from_location}</span> },
    { key: 'to_location', label: 'To', render: row => <span className="font-medium text-slate-800">{row.to_location}</span> },
    { key: 'transfer_date', label: 'Date' },
    { key: 'item_count', label: 'Items', align: 'right' },
    {
      key: 'status',
      label: 'Status',
      render: row => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[row.status] ?? 'bg-slate-100 text-slate-600'}`}>
          {row.status.split('_').join(' ')}
        </span>
      ),
    },
    { key: 'notes', label: 'Notes', render: row => <span className="text-xs text-slate-500 truncate max-w-xs block">{row.notes || '—'}</span> },
  ];

  function handleExport() {
    exportToCsv(
      'transfer-history.csv',
      ['Transfer #', 'From', 'To', 'Date', 'Items', 'Status', 'Notes'],
      data.map(row => [row.transfer_number, row.from_location, row.to_location, row.transfer_date, row.item_count, row.status, row.notes]),
    );
  }

  return (
    <ReportShell
      title="Stock Transfer History"
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
