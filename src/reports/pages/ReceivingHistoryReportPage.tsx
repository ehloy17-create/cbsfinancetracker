import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getDefaultDateRange } from '../lib/dateRanges';
import { exportToCsv } from '../lib/csvExport';
import ReportShell from '../components/ReportShell';
import { ReportTable, Column } from '../components/ReportTable';

function fmt(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface ReceivingRow {
  id: string;
  receiving_number: string;
  supplier_name: string;
  location_name: string;
  receiving_date: string;
  status: string;
  total_cost: number;
  po_number: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  posted: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const defaultRange = getDefaultDateRange(89);

export default function ReceivingHistoryReportPage() {
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [data, setData] = useState<ReceivingRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data: rows } = await supabase
      .from('receivings')
      .select('id, receiving_number, po_id, supplier_id, location_id, receiving_date, status')
      .gte('receiving_date', dateFrom)
      .lte('receiving_date', dateTo)
      .order('receiving_date', { ascending: false });

    const receivingRows = (rows ?? []) as Array<Record<string, unknown>>;
    const receivingIds = Array.from(new Set(receivingRows.map((row) => String(row.id ?? '')).filter(Boolean)));
    const supplierIds = Array.from(new Set(receivingRows.map((row) => String(row.supplier_id ?? '')).filter(Boolean)));
    const locationIds = Array.from(new Set(receivingRows.map((row) => String(row.location_id ?? '')).filter(Boolean)));
    const poIds = Array.from(new Set(receivingRows.map((row) => String(row.po_id ?? '')).filter(Boolean)));

    const [{ data: suppliers }, { data: locations }, { data: purchaseOrders }, { data: items }] = await Promise.all([
      supplierIds.length ? supabase.from('inv_suppliers').select('id, name').in('id', supplierIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      locationIds.length ? supabase.from('inv_locations').select('id, name').in('id', locationIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      poIds.length ? supabase.from('purchase_orders').select('id, po_number').in('id', poIds) : Promise.resolve({ data: [] as Array<{ id: string; po_number: string }> }),
      receivingIds.length
        ? supabase.from('receiving_items').select('receiving_id, qty_received, unit_cost, qty_received_in_base_unit, unit_cost_per_base').in('receiving_id', receivingIds)
        : Promise.resolve({ data: [] as Array<Record<string, number | string>> }),
    ]);

    const supplierMap = new Map(((suppliers ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
    const locationMap = new Map(((locations ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
    const poMap = new Map(((purchaseOrders ?? []) as Array<{ id: string; po_number: string }>).map((row) => [row.id, row.po_number]));
    const totalMap = new Map<string, number>();
    for (const item of items ?? []) {
      const receivingId = String(item.receiving_id ?? '');
      const qty = Number(item.qty_received_in_base_unit ?? item.qty_received ?? 0);
      const unitCost = Number(item.unit_cost_per_base ?? item.unit_cost ?? 0);
      totalMap.set(receivingId, (totalMap.get(receivingId) ?? 0) + qty * unitCost);
    }

    setData(receivingRows.map((row) => ({
      id: String(row.id ?? ''),
      receiving_number: String(row.receiving_number ?? ''),
      supplier_name: supplierMap.get(String(row.supplier_id ?? '')) ?? '',
      location_name: locationMap.get(String(row.location_id ?? '')) ?? '',
      receiving_date: String(row.receiving_date ?? ''),
      status: String(row.status ?? ''),
      total_cost: Number(totalMap.get(String(row.id ?? '')) ?? 0),
      po_number: poMap.get(String(row.po_id ?? '')) ?? null,
    })));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const total = data.reduce((sum, row) => sum + row.total_cost, 0);

  const columns: Column<ReceivingRow>[] = [
    { key: 'receiving_number', label: 'Receiving #', render: row => <span className="font-mono text-xs text-blue-600">{row.receiving_number}</span> },
    { key: 'supplier_name', label: 'Supplier', render: row => <span className="font-medium text-slate-800">{row.supplier_name}</span> },
    { key: 'po_number', label: 'PO #', render: row => row.po_number ? <span className="font-mono text-xs text-slate-500">{row.po_number}</span> : <span className="text-slate-400">—</span> },
    { key: 'location_name', label: 'Location' },
    { key: 'receiving_date', label: 'Date' },
    {
      key: 'status',
      label: 'Status',
      render: row => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[row.status] ?? 'bg-slate-100 text-slate-600'}`}>
          {row.status}
        </span>
      ),
    },
    { key: 'total_cost', label: 'Total Cost', align: 'right', render: row => <span className="font-mono font-semibold">₱{fmt(row.total_cost)}</span> },
  ];

  function handleExport() {
    exportToCsv(
      'receiving-history.csv',
      ['Receiving #', 'Supplier', 'PO #', 'Location', 'Date', 'Status', 'Total Cost'],
      data.map(row => [row.receiving_number, row.supplier_name, row.po_number ?? '', row.location_name, row.receiving_date, row.status, row.total_cost]),
    );
  }

  return (
    <ReportShell
      title="Receiving History"
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
      <ReportTable
        columns={columns}
        data={data}
        rowKey={row => row.id}
        footer={
          <tr>
            <td colSpan={6} className="px-4 py-3 font-bold text-slate-800">TOTAL</td>
            <td className="px-4 py-3 text-right font-mono font-bold">₱{fmt(total)}</td>
          </tr>
        }
      />
    </ReportShell>
  );
}
