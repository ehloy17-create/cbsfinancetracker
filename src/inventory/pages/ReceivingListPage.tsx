import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, X, ChevronDown, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Receiving, ReceivingStatus, InvSupplier, InvLocation } from '../../lib/types';
import { RECV_STATUS_LABELS, RECV_STATUS_COLORS, formatDate } from '../lib/receivingUtils';
import InvTable from '../components/InvTable';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { writeAuditLog } from '../../lib/audit';

const PAGE_SIZE = 25;

type RecvRow = Omit<Receiving, 'inv_suppliers' | 'inv_locations' | 'purchase_orders'> & {
  inv_suppliers: { id: string; name: string; code: string };
  inv_locations: { id: string; name: string; code: string };
  purchase_orders: { po_number: string };
};

function RecvStatusBadge({ status }: { status: ReceivingStatus }) {
  const c = RECV_STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {RECV_STATUS_LABELS[status]}
    </span>
  );
}

const ALL_STATUSES: ReceivingStatus[] = ['draft', 'posted', 'cancelled'];

export default function ReceivingListPage() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState<RecvRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<RecvRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<ReceivingStatus | ''>('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [suppliers, setSuppliers] = useState<InvSupplier[]>([]);
  const [locations, setLocations] = useState<InvLocation[]>([]);

  useEffect(() => {
    async function loadRefs() {
      const [sups, locs] = await Promise.all([
        supabase.from('inv_suppliers').select('id, name, code').eq('is_active', true).order('name'),
        supabase.from('inv_locations').select('id, name, code').eq('is_active', true).order('name'),
      ]);
      setSuppliers(sups.data ?? []);
      setLocations(locs.data ?? []);
    }
    loadRefs();
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('receivings')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error) {
      const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
      const locationMap = new Map(locations.map((location) => [location.id, location]));
      const baseRows = (data ?? []) as Receiving[];
      const poIds = Array.from(new Set(baseRows.map((row) => row.po_id).filter(Boolean)));
      const { data: poRows } = poIds.length > 0
        ? await supabase.from('purchase_orders').select('id, po_number').in('id', poIds)
        : { data: [] };
      const poMap = new Map(((poRows ?? []) as Array<{ id: string; po_number: string }>).map((row) => [row.id, row]));
      const searchTerm = search.trim().toLowerCase();
      const filteredRows = baseRows.filter((row) => {
        if (filterStatus && row.status !== filterStatus) return false;
        if (filterSupplier && row.supplier_id !== filterSupplier) return false;
        if (filterLocation && row.location_id !== filterLocation) return false;
        if (dateFrom && row.receiving_date < dateFrom) return false;
        if (dateTo && row.receiving_date > dateTo) return false;
        if (!searchTerm) return true;
        return (
          row.receiving_number.toLowerCase().includes(searchTerm) ||
          row.invoice_number.toLowerCase().includes(searchTerm) ||
          row.dr_number.toLowerCase().includes(searchTerm)
        );
      });

      const mappedRows: RecvRow[] = filteredRows.map((row) => ({
        ...row,
        inv_suppliers: {
          id: supplierMap.get(row.supplier_id)?.id ?? row.supplier_id,
          name: supplierMap.get(row.supplier_id)?.name ?? 'Unknown supplier',
          code: supplierMap.get(row.supplier_id)?.code ?? '',
        },
        inv_locations: {
          id: locationMap.get(row.location_id)?.id ?? row.location_id,
          name: locationMap.get(row.location_id)?.name ?? 'Unknown location',
          code: locationMap.get(row.location_id)?.code ?? '',
        },
        purchase_orders: {
          po_number: poMap.get(row.po_id)?.po_number ?? '—',
        },
      }));
      const from = (page - 1) * PAGE_SIZE;
      setRows(mappedRows.slice(from, from + PAGE_SIZE));
      setTotal(mappedRows.length);
    }
    setLoading(false);
  }, [page, search, filterStatus, filterSupplier, filterLocation, dateFrom, dateTo, suppliers, locations]);

  useEffect(() => { setPage(1); }, [search, filterStatus, filterSupplier, filterLocation, dateFrom, dateTo]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const activeFilters = [filterStatus, filterSupplier, filterLocation, dateFrom, dateTo].filter(Boolean).length;

  async function handleDelete() {
    if (!deleteTarget) return;
    if (deleteLoading) return;

    setDeleteLoading(true);
    const target = deleteTarget;
    const { error } = await supabase.rpc('delete_receiving', {
      p_receiving_id: target.id,
    });

    if (error) {
      showToast(error.message || 'Failed to delete receiving', 'error');
      setDeleteLoading(false);
      return;
    }

    await writeAuditLog(user?.id ?? null, 'DELETE', 'Receivings', target.id, {
      receiving_number: target.receiving_number,
      status: target.status,
    });

    showToast('Receiving deleted', 'success');
    setDeleteTarget(null);
    await fetchData();
    setDeleteLoading(false);
  }

  const columns = [
    {
      key: 'receiving_number',
      label: 'RCV Number',
      render: (r: RecvRow) => (
        <Link to={`/inventory/receivings/${r.id}`} className="font-mono font-semibold text-blue-600 hover:text-blue-700 hover:underline">
          {r.receiving_number}
        </Link>
      ),
    },
    {
      key: 'po',
      label: 'PO Number',
      render: (r: RecvRow) => (
        <Link to={`/inventory/purchase-orders/${r.po_id}`} className="font-mono text-sm text-slate-600 hover:text-blue-600 hover:underline">
          {r.purchase_orders.po_number}
        </Link>
      ),
    },
    {
      key: 'receiving_date',
      label: 'Date',
      render: (r: RecvRow) => (
        <div>
          <p className="text-sm text-slate-700">{formatDate(r.receiving_date)}</p>
          {r.invoice_number && <p className="text-xs text-slate-400">INV: {r.invoice_number}</p>}
          {r.dr_number && <p className="text-xs text-slate-400">DR: {r.dr_number}</p>}
        </div>
      ),
    },
    {
      key: 'supplier',
      label: 'Supplier',
      render: (r: RecvRow) => (
        <div>
          <p className="text-sm font-medium text-slate-800">{r.inv_suppliers.name}</p>
          <p className="text-xs text-slate-400 font-mono">{r.inv_suppliers.code}</p>
        </div>
      ),
    },
    {
      key: 'location',
      label: 'Location',
      render: (r: RecvRow) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
            {r.inv_locations.code}
          </span>
          <span className="text-sm text-slate-600">{r.inv_locations.name}</span>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r: RecvRow) => <RecvStatusBadge status={r.status} />,
    },
    {
      key: 'actions',
      label: '',
      className: 'w-20',
      render: (r: RecvRow) => (
        <div className="flex items-center gap-2">
          <Link to={`/inventory/receivings/${r.id}`} className="text-xs font-medium text-slate-500 hover:text-blue-600 hover:underline">
            View
          </Link>
          <button
            onClick={() => setDeleteTarget(r)}
            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Goods Receiving</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Record received goods against purchase orders
            {activeFilters > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full text-xs font-medium">
                {activeFilters} filter{activeFilters > 1 ? 's' : ''} active
              </span>
            )}
          </p>
        </div>
        <Link
          to="/inventory/receivings/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Receiving
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="RCV number, invoice, DR..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Status</label>
            <div className="relative">
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as ReceivingStatus | '')}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700">
                <option value="">All Statuses</option>
                {ALL_STATUSES.map(s => <option key={s} value={s}>{RECV_STATUS_LABELS[s]}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Supplier</label>
            <div className="relative">
              <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700">
                <option value="">All Suppliers</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Location</label>
            <div className="relative">
              <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700">
                <option value="">All Locations</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Date From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Date To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {activeFilters > 0 && (
            <button
              onClick={() => { setSearch(''); setFilterStatus(''); setFilterSupplier(''); setFilterLocation(''); setDateFrom(''); setDateTo(''); }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <InvTable
          columns={columns}
          data={rows}
          keyField="id"
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          loading={loading}
          emptyMessage="No receiving transactions found."
        />
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Receiving"
        message={
          deleteTarget
            ? `Delete ${deleteTarget.receiving_number}? Posted receivings will also roll back stock, PO received quantities, and unpaid payables.`
            : ''
        }
        confirmLabel={deleteLoading ? 'Deleting...' : 'Delete Receiving'}
        danger
        onConfirm={handleDelete}
        onCancel={() => {
          if (!deleteLoading) setDeleteTarget(null);
        }}
      />
    </div>
  );
}

