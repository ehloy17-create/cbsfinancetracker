import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, X, ArrowUpRight, ArrowDownLeft, ArrowRightLeft } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvMovementType, InvProduct, InvLocation } from '../../lib/types';
import { MOVEMENT_LABELS, MOVEMENT_COLORS, ALL_MOVEMENT_TYPES } from '../lib/movementUtils';
import InvTable from '../components/InvTable';
import { useToast } from '../../contexts/ToastContext';

const PAGE_SIZE = 30;

interface MovementRow {
  id: string;
  product_id: string;
  location_id: string;
  related_location_id?: string | null;
  movement_type: InvMovementType;
  qty_change: number;
  qty_before: number;
  qty_after: number;
  ref_number: string;
  notes: string;
  created_at: string;
  display_unit_name?: string;
  base_unit_name?: string;
  inv_products: { id: string; sku_code: string; name: string; inv_units?: { code: string } | null };
  inv_locations: { id: string; name: string; code: string };
  related_location?: { id: string; name: string; code: string } | null;
}

function MovementTypeBadge({ type }: { type: InvMovementType }) {
  const c = MOVEMENT_COLORS[type];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${c.bg} ${c.text} ${c.border}`}>
      {MOVEMENT_LABELS[type]}
    </span>
  );
}

export default function InvStockLedgerPage() {
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const preProductId = searchParams.get('product_id') ?? '';
  const preLocationId = searchParams.get('location_id') ?? '';

  const [rows, setRows] = useState<MovementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [filterProduct, setFilterProduct] = useState(preProductId);
  const [filterLocation, setFilterLocation] = useState(preLocationId);
  const [filterType, setFilterType] = useState<InvMovementType | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [products, setProducts] = useState<InvProduct[]>([]);
  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [currentBalance, setCurrentBalance] = useState<number | null>(null);

  useEffect(() => {
    async function loadRefs() {
      const [prods, locs] = await Promise.all([
        supabase.from('inv_products').select('id, sku_code, name').eq('is_active', true).order('name').limit(500),
        supabase.from('inv_locations').select('*').eq('is_active', true).order('name'),
      ]);
      setProducts(prods.data ?? []);
      setLocations(locs.data ?? []);
    }
    loadRefs();
  }, []);

  useEffect(() => {
    if (filterProduct && filterLocation) {
      supabase
        .from('inventory_balances')
        .select('qty_on_hand')
        .eq('product_id', filterProduct)
        .eq('location_id', filterLocation)
        .maybeSingle()
        .then(({ data }) => setCurrentBalance(data ? Number(data.qty_on_hand) : 0));
    } else {
      setCurrentBalance(null);
    }
  }, [filterProduct, filterLocation]);

  const fetchData = useCallback(async () => {
    setLoading(true);

    let q = supabase
      .from('inventory_movements')
      .select('id, product_id, location_id, related_location_id, movement_type, qty_change, qty_before, qty_after, ref_number, notes, created_at, display_unit_name, base_unit_name');

    if (filterProduct) q = q.eq('product_id', filterProduct);
    if (filterLocation) q = q.eq('location_id', filterLocation);
    if (filterType) q = q.eq('movement_type', filterType);
    if (dateFrom) q = q.gte('created_at', `${dateFrom}T00:00:00`);
    if (dateTo) q = q.lte('created_at', `${dateTo}T23:59:59`);

    q = q.order('created_at', { ascending: false }).limit(3000);

    const { data, error } = await q;
    if (error) {
      showToast('Failed to load inventory ledger: ' + error.message, 'error');
      setLoading(false);
      return;
    }
    if (!error) {
      const productMap = new Map(products.map(product => [product.id, product]));
      const locationMap = new Map(locations.map(location => [location.id, location]));
      const allRows: MovementRow[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
        const product = productMap.get(String(row.product_id ?? ''));
        const location = locationMap.get(String(row.location_id ?? ''));
        const relatedLocation = locationMap.get(String(row.related_location_id ?? ''));
        const unitCode = row.display_unit_name
          ? String(row.display_unit_name)
          : row.base_unit_name
            ? String(row.base_unit_name)
            : undefined;

        return {
          id: String(row.id ?? ''),
          product_id: String(row.product_id ?? ''),
          location_id: String(row.location_id ?? ''),
          related_location_id: row.related_location_id ? String(row.related_location_id) : null,
          movement_type: String(row.movement_type ?? '') as InvMovementType,
          qty_change: Number(row.qty_change ?? 0),
          qty_before: Number(row.qty_before ?? 0),
          qty_after: Number(row.qty_after ?? 0),
          ref_number: String(row.ref_number ?? ''),
          notes: String(row.notes ?? ''),
          created_at: String(row.created_at ?? ''),
          display_unit_name: row.display_unit_name ? String(row.display_unit_name) : undefined,
          base_unit_name: row.base_unit_name ? String(row.base_unit_name) : undefined,
          inv_products: {
            id: product?.id ?? String(row.product_id ?? ''),
            sku_code: product?.sku_code ?? '',
            name: product?.name ?? 'Unknown product',
            inv_units: unitCode ? { code: unitCode } : null,
          },
          inv_locations: {
            id: location?.id ?? String(row.location_id ?? ''),
            name: location?.name ?? 'Unknown location',
            code: location?.code ?? '',
          },
          related_location: relatedLocation
            ? { id: relatedLocation.id, name: relatedLocation.name, code: relatedLocation.code }
            : null,
        };
      });
      const from = (page - 1) * PAGE_SIZE;
      setRows(allRows.slice(from, from + PAGE_SIZE));
      setTotal(allRows.length);
    }
    setLoading(false);
  }, [page, filterProduct, filterLocation, filterType, dateFrom, dateTo, products, locations]);

  useEffect(() => { setPage(1); }, [filterProduct, filterLocation, filterType, dateFrom, dateTo]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const selectedProduct = products.find(p => p.id === filterProduct);
  const selectedLocation = locations.find(l => l.id === filterLocation);

  const columns = [
    {
      key: 'created_at',
      label: 'Date & Time',
      render: (r: MovementRow) => (
        <div>
          <p className="text-sm text-slate-700 font-medium">
            {new Date(r.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
          <p className="text-xs text-slate-400">
            {new Date(r.created_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      ),
    },
    {
      key: 'movement_type',
      label: 'Type',
      render: (r: MovementRow) => <MovementTypeBadge type={r.movement_type} />,
    },
    ...(!filterProduct ? [{
      key: 'product',
      label: 'Product',
      render: (r: MovementRow) => (
        <div>
          <p className="text-sm font-medium text-slate-800">{r.inv_products.name}</p>
          <p className="text-xs text-slate-400 font-mono">{r.inv_products.sku_code}</p>
        </div>
      ),
    }] : []),
    ...(!filterLocation ? [{
      key: 'location',
      label: 'Location',
      render: (r: MovementRow) => (
        <span className="text-sm text-slate-600">{r.inv_locations.name}</span>
      ),
    }] : []),
    {
      key: 'qty_change',
      label: 'Movement',
      className: 'text-right',
      render: (r: MovementRow) => {
        const positive = r.qty_change > 0;
        const zero = r.qty_change === 0;
        return (
          <div className="flex items-center justify-end gap-1.5">
            {!zero && (positive
              ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              : <ArrowDownLeft className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
            )}
            <span className={`font-semibold tabular-nums ${
              positive ? 'text-emerald-700' : zero ? 'text-slate-400' : 'text-red-600'
            }`}>
              {positive ? '+' : ''}{Number(r.qty_change).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
              {r.inv_products.inv_units && (
                <span className="text-xs font-normal text-slate-400 ml-1">{r.inv_products.inv_units.code}</span>
              )}
            </span>
          </div>
        );
      },
    },
    {
      key: 'qty_before',
      label: 'Before',
      className: 'text-right',
      render: (r: MovementRow) => (
        <span className="text-sm text-slate-500 tabular-nums">
          {Number(r.qty_before).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
        </span>
      ),
    },
    {
      key: 'qty_after',
      label: 'After',
      className: 'text-right',
      render: (r: MovementRow) => (
        <span className="text-sm font-medium text-slate-700 tabular-nums">
          {Number(r.qty_after).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
        </span>
      ),
    },
    {
      key: 'ref',
      label: 'Ref / Notes',
      render: (r: MovementRow) => (
        <div>
          {r.ref_number && <p className="text-xs font-mono text-slate-500">{r.ref_number}</p>}
          {r.related_location && (
            <p className="text-xs text-slate-400 flex items-center gap-1">
              <ArrowRightLeft className="w-3 h-3" />
              {r.related_location.name}
            </p>
          )}
          {r.notes && <p className="text-xs text-slate-400 truncate max-w-40">{r.notes}</p>}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link to="/inventory/stock" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />
              Stock List
            </Link>
          </div>
          <h1 className="text-xl font-bold text-slate-800">
            {selectedProduct ? selectedProduct.name : 'Stock Ledger'}
          </h1>
          {(selectedProduct || selectedLocation) && (
            <p className="text-sm text-slate-500 mt-0.5">
              {selectedLocation ? `@ ${selectedLocation.name}` : 'All Locations'}
              {currentBalance !== null && (
                <span className="ml-3 font-semibold text-slate-700">
                  Current On Hand: {currentBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-52">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Product</label>
            <div className="relative">
              <select
                value={filterProduct}
                onChange={e => setFilterProduct(e.target.value)}
                className="appearance-none w-full pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700"
              >
                <option value="">All Products</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
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
            <label className="block text-xs font-semibold text-slate-500 mb-1">Movement Type</label>
            <div className="relative">
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value as InvMovementType | '')}
                className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700"
              >
                <option value="">All Types</option>
                {ALL_MOVEMENT_TYPES.map(t => (
                  <option key={t} value={t}>{MOVEMENT_LABELS[t]}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {(filterProduct || filterLocation || filterType || dateFrom || dateTo) && (
            <button
              onClick={() => { setFilterProduct(''); setFilterLocation(''); setFilterType(''); setDateFrom(''); setDateTo(''); }}
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
          emptyMessage="No movements found for the selected filters."
        />
      </div>
    </div>
  );
}
