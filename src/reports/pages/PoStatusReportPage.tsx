import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getDefaultDateRange } from '../lib/dateRanges';
import { exportToCsv } from '../lib/csvExport';
import ReportShell from '../components/ReportShell';
import { ReportTable, Column } from '../components/ReportTable';

function fmt(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface PoRow {
  id: string;
  po_number: string;
  supplier_name: string;
  order_date: string;
  expected_date: string | null;
  status: string;
  total_amount: number;
  notes: string;
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-indigo-100 text-indigo-700',
  partially_received: 'bg-amber-100 text-amber-700',
  fully_received: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const defaultRange = getDefaultDateRange(89);

export default function PoStatusReportPage() {
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [data, setData] = useState<PoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  async function load() {
    setLoading(true);
    const { data: rows } = await supabase
      .from('purchase_orders')
      .select('id, po_number, supplier_id, order_date, expected_date, status, total_amount, notes')
      .gte('order_date', dateFrom)
      .lte('order_date', dateTo)
      .order('order_date', { ascending: false });

    const purchaseOrderRows = (rows ?? []) as Array<Record<string, unknown>>;
    const supplierIds = Array.from(new Set(purchaseOrderRows.map((row) => String(row.supplier_id ?? '')).filter(Boolean)));
    const { data: suppliers } = supplierIds.length
      ? await supabase.from('inv_suppliers').select('id, name').in('id', supplierIds)
      : { data: [] as Array<{ id: string; name: string }> };

    const supplierMap = new Map(((suppliers ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
    setData(purchaseOrderRows.map((row) => ({
      id: String(row.id ?? ''),
      po_number: String(row.po_number ?? ''),
      supplier_name: supplierMap.get(String(row.supplier_id ?? '')) ?? '',
      order_date: String(row.order_date ?? ''),
      expected_date: row.expected_date ? String(row.expected_date) : null,
      status: String(row.status ?? ''),
      total_amount: Number(row.total_amount ?? 0),
      notes: String(row.notes ?? ''),
    })));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const filtered = statusFilter === 'all' ? data : data.filter(row => row.status === statusFilter);
  const total = filtered.reduce((sum, row) => sum + row.total_amount, 0);

  const columns: Column<PoRow>[] = [
    { key: 'po_number', label: 'PO #', render: row => <span className="font-mono text-xs text-blue-600">{row.po_number}</span> },
    { key: 'supplier_name', label: 'Supplier', render: row => <span className="font-medium text-slate-800">{row.supplier_name}</span> },
    { key: 'order_date', label: 'Order Date' },
    { key: 'expected_date', label: 'Expected', render: row => row.expected_date ?? <span className="text-slate-400">—</span> },
    {
      key: 'status',
      label: 'Status',
      render: row => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[row.status] ?? 'bg-slate-100 text-slate-600'}`}>
          {row.status.split('_').join(' ')}
        </span>
      ),
    },
    { key: 'total_amount', label: 'Amount', align: 'right', render: row => <span className="font-mono font-semibold">₱{fmt(row.total_amount)}</span> },
  ];

  function handleExport() {
    exportToCsv(
      'po-status.csv',
      ['PO #', 'Supplier', 'Order Date', 'Expected', 'Status', 'Amount'],
      filtered.map(row => [row.po_number, row.supplier_name, row.order_date, row.expected_date ?? '', row.status, row.total_amount]),
    );
  }

  return (
    <ReportShell
      title="Purchase Order Status"
      subtitle={`${dateFrom} to ${dateTo} — ${filtered.length} POs`}
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
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="partially_received">Partially Received</option>
            <option value="fully_received">Fully Received</option>
            <option value="cancelled">Cancelled</option>
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
            <td colSpan={5} className="px-4 py-3 font-bold text-slate-800">TOTAL</td>
            <td className="px-4 py-3 text-right font-mono font-bold">₱{fmt(total)}</td>
          </tr>
        }
      />
    </ReportShell>
  );
}
