import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Package, ChevronDown, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { InvLocation, InvCategory, InvBrand } from '../../lib/types';
import InvTable from '../components/InvTable';

const PAGE_SIZE = 30;

interface BalanceRow {
  id: string;
  product_id: string;
  location_id: string;
  qty_on_hand: number;
  updated_at: string;
  inv_products: {
    id: string;
    sku_code: string;
    name: string;
    reorder_point: number;
    is_active: boolean;
    inv_categories?: { id?: string; name: string } | null;
    inv_brands?: { id?: string; name: string } | null;
    inv_units?: { id?: string; code: string; name?: string } | null;
  };
  inv_locations: { id: string; name: string; code: string };
}

export default function InvStockListPage() {
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterLowStock, setFilterLowStock] = useState(false);

  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [categories, setCategories] = useState<InvCategory[]>([]);
  const [brands, setBrands] = useState<InvBrand[]>([]);

  useEffect(() => {
    async function loadRefs() {
      const [locs, cats, brs] = await Promise.all([
        supabase.from('inv_locations').select('*').eq('is_active', true).order('name'),
        supabase.from('inv_categories').select('*').order('name'),
        supabase.from('inv_brands').select('*').order('name'),
      ]);
      setLocations(locs.data ?? []);
      setCategories(cats.data ?? []);
      setBrands(brs.data ?? []);
    }
    loadRefs();
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase.rpc('search_stock_balances', {
      search: search.trim(),
      filter_location: filterLocation,
      filter_category: filterCategory,
      filter_brand: filterBrand,
      filter_low_stock: filterLowStock,
      page,
      page_size: PAGE_SIZE,
    });

    if (!error && data) {
      const result = data as { balances: BalanceRow[]; total: number };
      setRows(result.balances ?? []);
      setTotal(result.total ?? 0);
    }
    setLoading(false);
  }, [page, search, filterLocation, filterCategory, filterBrand, filterLowStock]);

  useEffect(() => { setPage(1); }, [search, filterLocation, filterCategory, filterBrand, filterLowStock]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const activeFilters = [filterLocation, filterCategory, filterBrand, filterLowStock ? 'low' : ''].filter(Boolean).length;

  const columns = [
    {
      key: 'product',
      label: 'Product',
      render: (r: BalanceRow) => (
        <div>
          <Link
            to={`/inventory/ledger?product_id=${r.product_id}&location_id=${r.location_id}`}
            className="font-medium text-slate-800 hover:text-blue-600 transition-colors"
          >
            {r.inv_products.name}
          </Link>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="font-mono text-xs text-slate-400">{r.inv_products.sku_code}</span>
            {r.inv_products.inv_categories && (
              <span className="text-xs text-slate-400">{r.inv_products.inv_categories.name}</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'brand',
      label: 'Brand',
      render: (r: BalanceRow) => (
        <span className="text-sm text-slate-600">{r.inv_products.inv_brands?.name ?? '—'}</span>
      ),
    },
    {
      key: 'location',
      label: 'Location',
      render: (r: BalanceRow) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
            {r.inv_locations.code}
          </span>
          <span className="text-sm text-slate-600">{r.inv_locations.name}</span>
        </div>
      ),
    },
    {
      key: 'qty_on_hand',
      label: 'Qty Available',
      className: 'text-right',
      render: (r: BalanceRow) => {
        const isLow = r.inv_products.reorder_point > 0 && r.qty_on_hand <= r.inv_products.reorder_point;
        const isZero = r.qty_on_hand <= 0;
        return (
          <div className="flex items-center justify-end gap-2">
            {isLow && (
              <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 ${isZero ? 'text-red-500' : 'text-amber-500'}`} />
            )}
            <span className={`font-semibold tabular-nums ${
              isZero ? 'text-red-600' : isLow ? 'text-amber-700' : 'text-slate-800'
            }`}>
              {Number(r.qty_on_hand).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
            </span>
            {r.inv_products.inv_units && (
              <span className="text-xs text-slate-400">{r.inv_products.inv_units.code}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'reorder_point',
      label: 'Reorder At',
      className: 'text-right',
      render: (r: BalanceRow) => (
        <span className="text-sm text-slate-500 tabular-nums">
          {r.inv_products.reorder_point > 0 ? r.inv_products.reorder_point : <span className="text-slate-300">—</span>}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Stock Status',
      render: (r: BalanceRow) => {
        const isZero = r.qty_on_hand <= 0;
        const isLow = r.inv_products.reorder_point > 0 && r.qty_on_hand <= r.inv_products.reorder_point;
        if (isZero) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">Out of Stock</span>;
        if (isLow) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">Low Stock</span>;
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">In Stock</span>;
      },
    },
    {
      key: 'ledger',
      label: '',
      className: 'w-24',
      render: (r: BalanceRow) => (
        <Link
          to={`/inventory/ledger?product_id=${r.product_id}&location_id=${r.location_id}`}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
        >
          View Ledger
        </Link>
      ),
    },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Inventory</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Quantity available per product per location
            {activeFilters > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full text-xs font-medium">
                {activeFilters} filter{activeFilters > 1 ? 's' : ''} active
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/inventory/opening-balance"
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            <Package className="w-4 h-4" />
            Opening Balance
          </Link>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Search Product</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Name or SKU..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
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
            <label className="block text-xs font-semibold text-slate-500 mb-1">Category</label>
            <div className="relative">
              <select
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700"
              >
                <option value="">All Categories</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Brand</label>
            <div className="relative">
              <select
                value={filterBrand}
                onChange={e => setFilterBrand(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700"
              >
                <option value="">All Brands</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div className="pb-0.5">
            <label className="flex items-center gap-2 cursor-pointer select-none h-9">
              <input
                type="checkbox"
                checked={filterLowStock}
                onChange={e => setFilterLowStock(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
              />
              <span className="text-sm text-slate-700 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                Low Stock Only
              </span>
            </label>
          </div>

          {activeFilters > 0 && (
            <button
              onClick={() => { setSearch(''); setFilterLocation(''); setFilterCategory(''); setFilterBrand(''); setFilterLowStock(false); }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Clear
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
          emptyMessage="No inventory records found. Add opening balances to get started."
        />
      </div>
    </div>
  );
}
