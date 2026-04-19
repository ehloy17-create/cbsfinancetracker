import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ChevronDown, X, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PurchaseOrder, PoStatus, InvSupplier, InvLocation } from '../../lib/types';
import { PO_STATUS_LABELS, PO_STATUS_COLORS, ALL_PO_STATUSES, formatCurrency, formatDate } from '../lib/poUtils';
import InvTable from '../components/InvTable';

const PAGE_SIZE = 25;

type PoRow = Omit<PurchaseOrder, 'suppliers' | 'inv_locations'> & {
  suppliers: { id: string; name: string; code: string };
  inv_locations: { id: string; name: string; code: string };
};

function PoStatusBadge({ status }: { status: PoStatus }) {
  const c = PO_STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {PO_STATUS_LABELS[status]}
    </span>
  );
}

export default function PoListPage() {
  const [rows, setRows] = useState<PoRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<PoStatus | ''>('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [suppliers, setSuppliers] = useState<InvSupplier[]>([]);
  const [locations, setLocations] = useState<InvLocation[]>([]);

  useEffect(() => {
    async function loadRefs() {
      const [sups, locs] = await Promise.all([
        supabase.from('suppliers').select('id, name, code').eq('is_active', true).order('name'),
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
      .from('purchase_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error) {
      const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
      const locationMap = new Map(locations.map((location) => [location.id, location]));
      const searchTerm = search.trim().toLowerCase();
      const filteredRows = ((data ?? []) as PurchaseOrder[]).filter((row) => {
        if (filterStatus && row.status !== filterStatus) return false;
        if (filterSupplier && row.supplier_id !== filterSupplier) return false;
        if (filterLocation && row.location_id !== filterLocation) return false;
        if (dateFrom && row.order_date < dateFrom) return false;
        if (dateTo && row.order_date > dateTo) return false;
        if (!searchTerm) return true;
        return row.po_number.toLowerCase().includes(searchTerm) || row.notes.toLowerCase().includes(searchTerm);
      });

      const mappedRows: PoRow[] = filteredRows.map((row) => ({
        ...row,
        suppliers: {
          id: supplierMap.get(row.supplier_id)?.id ?? row.supplier_id,
          name: supplierMap.get(row.supplier_id)?.name ?? 'Unknown supplier',
          code: supplierMap.get(row.supplier_id)?.code ?? '',
        },
        inv_locations: {
          id: locationMap.get(row.location_id)?.id ?? row.location_id,
          name: locationMap.get(row.location_id)?.name ?? 'Unknown location',
          code: locationMap.get(row.location_id)?.code ?? '',
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

  const columns = [
    {
      key: 'po_number',
      label: 'PO Number',
      render: (r: PoRow) => (
        <Link to={`/inventory/purchase-orders/${r.id}`} className="font-mono font-semibold text-blue-600 hover:text-blue-700 hover:underline">
          {r.po_number}
        </Link>
      ),
    },
    {
      key: 'order_date',
      label: 'Date',
      render: (r: PoRow) => (
        <div>
          <p className="text-sm text-slate-700">{formatDate(r.order_date)}</p>
          {r.expected_date && (
            <p className="text-xs text-slate-400">Expected: {formatDate(r.expected_date)}</p>
          )}
        </div>
      ),
    },
    {
      key: 'supplier',
      label: 'Supplier',
      render: (r: PoRow) => (
        <div>
          <p className="text-sm font-medium text-slate-800">{r.suppliers.name}</p>
          <p className="text-xs text-slate-400 font-mono">{r.suppliers.code}</p>
        </div>
      ),
    },
    {
      key: 'location',
      label: 'Location',
      render: (r: PoRow) => (
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
      render: (r: PoRow) => <PoStatusBadge status={r.status} />,
    },
    {
      key: 'total_amount',
      label: 'Total',
      className: 'text-right',
      render: (r: PoRow) => (
        <span className="font-semibold text-slate-800 tabular-nums">{formatCurrency(r.total_amount)}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      className: 'w-20',
      render: (r: PoRow) => (
        <div className="flex items-center gap-2">
          <Link
            to={`/inventory/purchase-orders/${r.id}`}
            className="text-xs font-medium text-slate-500 hover:text-blue-600 hover:underline"
          >
            View
          </Link>
          {(r.status === 'draft') && (
            <Link
              to={`/inventory/purchase-orders/${r.id}/edit`}
              className="text-xs font-medium text-slate-500 hover:text-blue-600 hover:underline"
            >
              Edit
            </Link>
          )}
          {['approved', 'partially_received'].includes(r.status) && (
            <Link
              to={`/inventory/receivings/new?po=${r.id}`}
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              Receive
            </Link>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Purchase Orders</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage supplier purchase orders
            {activeFilters > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full text-xs font-medium">
                {activeFilters} filter{activeFilters > 1 ? 's' : ''} active
              </span>
            )}
          </p>
        </div>
        <Link
          to="/inventory/purchase-orders/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Purchase Order
        </Link>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="PO number or notes..."
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
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value as PoStatus | '')}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700"
              >
                <option value="">All Statuses</option>
                {ALL_PO_STATUSES.map(s => <option key={s} value={s}>{PO_STATUS_LABELS[s]}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Supplier</label>
            <div className="relative">
              <select
                value={filterSupplier}
                onChange={e => setFilterSupplier(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700"
              >
                <option value="">All Suppliers</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Location</label>
            <div className="relative">
              <select
                value={filterLocation}
                onChange={e => setFilterLocation(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700"
              >
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

      {/* Table */}
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
          emptyMessage="No purchase orders found."
        />
      </div>
    </div>
  );
}

