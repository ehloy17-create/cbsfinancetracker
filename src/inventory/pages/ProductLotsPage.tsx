import { useState, useEffect, useCallback } from 'react';
import { Search, X, ChevronDown, AlertTriangle, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ProductLot, InvLocation } from '../../lib/types';
import { formatDate, formatCurrency, daysUntilExpiry, expiryWarningLevel } from '../lib/receivingUtils';
import InvTable from '../components/InvTable';

const PAGE_SIZE = 25;

type LotRow = Omit<ProductLot, 'inv_products' | 'inv_locations'> & {
  inv_products: { id: string; sku_code: string; name: string; near_expiry_days: number; inv_units?: { code: string } | null; inv_categories?: { name: string } | null };
  inv_locations: { id: string; name: string; code: string };
};

type FilterExpiry = '' | 'expired' | 'near' | 'ok';

export default function ProductLotsPage() {
  const [rows, setRows] = useState<LotRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterExpiry, setFilterExpiry] = useState<FilterExpiry>('');
  const [showInactive, setShowInactive] = useState(false);

  const [locations, setLocations] = useState<InvLocation[]>([]);

  useEffect(() => {
    supabase.from('inv_locations').select('id, name, code').eq('is_active', true).order('name')
      .then(({ data }) => setLocations(data ?? []));
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('product_lots')
      .select('*')
      .order('expiry_date', { ascending: true });

    const allLots = ((data ?? []) as ProductLot[]).filter((row) => {
      if (!showInactive && !row.is_active) return false;
      if (filterLocation && row.location_id !== filterLocation) return false;
      if (search.trim() && !row.batch_number.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });

    const productIds = Array.from(new Set(allLots.map((row) => row.product_id)));
    const { data: productRows } = productIds.length > 0
      ? await supabase.from('inv_products').select('id, sku_code, name, near_expiry_days, unit_id, category_id').in('id', productIds)
      : { data: [] };
    const products = (productRows ?? []) as Array<{ id: string; sku_code: string; name: string; near_expiry_days: number; unit_id?: string | null; category_id?: string | null }>;
    const unitIds = Array.from(new Set(products.map((row) => row.unit_id).filter(Boolean)));
    const categoryIds = Array.from(new Set(products.map((row) => row.category_id).filter(Boolean)));
    const [{ data: unitRows }, { data: categoryRows }] = await Promise.all([
      unitIds.length > 0 ? supabase.from('inv_units').select('id, code').in('id', unitIds) : Promise.resolve({ data: [] }),
      categoryIds.length > 0 ? supabase.from('inv_categories').select('id, name').in('id', categoryIds) : Promise.resolve({ data: [] }),
    ]);

    const productMap = new Map(products.map((row) => [row.id, row]));
    const unitMap = new Map(((unitRows ?? []) as Array<{ id: string; code: string }>).map((row) => [row.id, row]));
    const categoryMap = new Map(((categoryRows ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row]));
    const locationMap = new Map(locations.map((location) => [location.id, location]));
    const mappedRows: LotRow[] = allLots.map((row) => {
      const product = productMap.get(row.product_id);
      const unit = product?.unit_id ? unitMap.get(product.unit_id) : undefined;
      const category = product?.category_id ? categoryMap.get(product.category_id) : undefined;
      const location = locationMap.get(row.location_id);
      return {
        ...row,
        inv_products: {
          id: product?.id ?? row.product_id,
          sku_code: product?.sku_code ?? '',
          name: product?.name ?? 'Unknown product',
          near_expiry_days: Number(product?.near_expiry_days ?? 90),
          inv_units: unit ? { code: unit.code } : null,
          inv_categories: category ? { name: category.name } : null,
        },
        inv_locations: {
          id: location?.id ?? row.location_id,
          name: location?.name ?? 'Unknown location',
          code: location?.code ?? '',
        },
      };
    });
    const from = (page - 1) * PAGE_SIZE;
    setRows(mappedRows.slice(from, from + PAGE_SIZE));
    setTotal(mappedRows.length);
    setLoading(false);
  }, [page, search, filterLocation, showInactive, locations]);

  useEffect(() => { setPage(1); }, [search, filterLocation, filterExpiry, showInactive]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredRows = filterExpiry
    ? rows.filter(r => {
        const days = daysUntilExpiry(r.expiry_date);
        return expiryWarningLevel(days, r.inv_products.near_expiry_days ?? 90) === filterExpiry;
      })
    : rows;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const activeFilters = [filterExpiry, filterLocation, showInactive ? 'inactive' : ''].filter(Boolean).length;

  const columns = [
    {
      key: 'product',
      label: 'Product',
      render: (r: LotRow) => (
        <div>
          <p className="font-medium text-slate-800">{r.inv_products.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="font-mono text-xs text-slate-400">{r.inv_products.sku_code}</span>
            {r.inv_products.inv_units && <span className="text-xs text-slate-400">{r.inv_products.inv_units.code}</span>}
            {r.inv_products.inv_categories && <span className="text-xs text-slate-400">{r.inv_products.inv_categories.name}</span>}
          </div>
        </div>
      ),
    },
    {
      key: 'location',
      label: 'Location',
      render: (r: LotRow) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{r.inv_locations.code}</span>
          <span className="text-sm text-slate-600">{r.inv_locations.name}</span>
        </div>
      ),
    },
    {
      key: 'expiry_date',
      label: 'Expiry Date',
      render: (r: LotRow) => {
        const days = daysUntilExpiry(r.expiry_date);
        const level = expiryWarningLevel(days, r.inv_products.near_expiry_days ?? 90);
        return (
          <div>
            <div className={`flex items-center gap-1.5 text-sm font-medium ${
              level === 'expired' ? 'text-red-600' :
              level === 'near' ? 'text-amber-700' :
              'text-slate-700'
            }`}>
              {level !== 'ok' && <Clock className="w-3.5 h-3.5" />}
              {formatDate(r.expiry_date)}
            </div>
            {level === 'expired' && <p className="text-xs text-red-500 font-medium mt-0.5">Expired {Math.abs(days)} day{Math.abs(days) !== 1 ? 's' : ''} ago</p>}
            {level === 'near' && <p className="text-xs text-amber-600 mt-0.5">{days} day{days !== 1 ? 's' : ''} remaining</p>}
          </div>
        );
      },
    },
    {
      key: 'batch_number',
      label: 'Batch #',
      render: (r: LotRow) => r.batch_number
        ? <span className="font-mono text-sm text-slate-600">{r.batch_number}</span>
        : <span className="text-slate-300 text-sm">—</span>,
    },
    {
      key: 'qty_on_hand',
      label: 'Qty on Hand',
      className: 'text-right',
      render: (r: LotRow) => (
        <span className={`tabular-nums font-semibold text-sm ${r.qty_on_hand > 0 ? 'text-slate-800' : 'text-slate-300'}`}>
          {Number(r.qty_on_hand).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
        </span>
      ),
    },
    {
      key: 'qty_received',
      label: 'Qty Received',
      className: 'text-right',
      render: (r: LotRow) => (
        <span className="tabular-nums text-sm text-slate-500">
          {Number(r.qty_received).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
        </span>
      ),
    },
    {
      key: 'unit_cost',
      label: 'Unit Cost',
      className: 'text-right',
      render: (r: LotRow) => <span className="tabular-nums text-sm text-slate-600">{formatCurrency(Number(r.unit_cost))}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (r: LotRow) => (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${
          r.is_active
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-slate-100 text-slate-500 border-slate-200'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${r.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          {r.is_active ? 'Active' : 'Depleted'}
        </span>
      ),
    },
  ];

  const expiredCount = rows.filter(r => daysUntilExpiry(r.expiry_date) < 0).length;
  const nearCount = rows.filter(r => {
    const d = daysUntilExpiry(r.expiry_date);
    return d >= 0 && expiryWarningLevel(d, r.inv_products.near_expiry_days ?? 90) === 'near';
  }).length;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">Product Lots</h1>
        <p className="text-sm text-slate-500 mt-0.5">Track expiry dates and batch numbers per lot</p>
      </div>

      {/* Alert banners */}
      {expiredCount > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">
            <span className="font-semibold">{expiredCount} expired lot{expiredCount !== 1 ? 's' : ''}</span> in current view. Review and update inventory.
          </p>
          <button onClick={() => setFilterExpiry('expired')} className="ml-auto text-xs font-medium text-red-600 hover:underline">Show expired</button>
        </div>
      )}
      {nearCount > 0 && expiredCount === 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-700">
            <span className="font-semibold">{nearCount} lot{nearCount !== 1 ? 's' : ''} nearing expiry</span> in current view.
          </p>
          <button onClick={() => setFilterExpiry('near')} className="ml-auto text-xs font-medium text-amber-600 hover:underline">Show near expiry</button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Search Batch #</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Batch number..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>}
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
            <label className="block text-xs font-semibold text-slate-500 mb-1">Expiry Filter</label>
            <div className="relative">
              <select value={filterExpiry} onChange={e => setFilterExpiry(e.target.value as FilterExpiry)}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700">
                <option value="">All</option>
                <option value="expired">Expired</option>
                <option value="near">Near Expiry</option>
                <option value="ok">Good</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer py-2">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm text-slate-600">Show depleted lots</span>
          </label>

          {activeFilters > 0 && (
            <button onClick={() => { setSearch(''); setFilterLocation(''); setFilterExpiry(''); setShowInactive(false); }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <InvTable
          columns={columns}
          data={filteredRows}
          keyField="id"
          page={page}
          pageSize={PAGE_SIZE}
          total={filterExpiry ? filteredRows.length : total}
          onPageChange={setPage}
          loading={loading}
          emptyMessage="No product lots found."
        />
      </div>
    </div>
  );
}
