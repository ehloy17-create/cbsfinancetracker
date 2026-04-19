import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvLocation, InvCategory, InvBrand, PhysicalCountFilterType } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { FILTER_TYPE_LABELS } from '../lib/physicalCountUtils';

export default function PhysicalCountFormPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [locationId, setLocationId] = useState('');
  const [countDate, setCountDate] = useState(new Date().toISOString().slice(0, 10));
  const [filterType, setFilterType] = useState<PhysicalCountFilterType>('all');
  const [filterId, setFilterId] = useState('');
  const [remarks, setRemarks] = useState('');

  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [categories, setCategories] = useState<InvCategory[]>([]);
  const [brands, setBrands] = useState<InvBrand[]>([]);
  const [productPreview, setProductPreview] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('inv_locations').select('*').eq('is_active', true).order('name').then(({ data }) => setLocations((data ?? []) as InvLocation[]));
    supabase.from('inv_categories').select('*').eq('is_active', true).order('name').then(({ data }) => setCategories((data ?? []) as InvCategory[]));
    supabase.from('inv_brands').select('*').eq('is_active', true).order('name').then(({ data }) => setBrands((data ?? []) as InvBrand[]));
  }, []);

  useEffect(() => {
    if (!locationId) { setProductPreview(null); return; }
    setPreviewLoading(true);
    const fetchPreview = async () => {
      const { data: balanceRows } = await supabase
        .from('inventory_balances')
        .select('product_id')
        .eq('location_id', locationId);

      const productIds = Array.from(new Set(((balanceRows ?? []) as Array<{ product_id: string }>).map(row => row.product_id)));
      if (productIds.length === 0) {
        setProductPreview(0);
        setPreviewLoading(false);
        return;
      }

      let productQuery = supabase
        .from('inv_products')
        .select('id')
        .in('id', productIds)
        .eq('is_active', true);

      if (filterType === 'category' && filterId) {
        productQuery = productQuery.eq('category_id', filterId);
      } else if (filterType === 'brand' && filterId) {
        productQuery = productQuery.eq('brand_id', filterId);
      }

      const { data: productRows } = await productQuery;
      setProductPreview((productRows ?? []).length);
      setPreviewLoading(false);
    };
    fetchPreview();
  }, [locationId, filterType, filterId]);

  async function handleCreate() {
    if (!locationId) { showToast('Please select a location', 'error'); return; }
    if ((filterType === 'category' || filterType === 'brand') && !filterId) {
      showToast(`Please select a ${filterType}`, 'error');
      return;
    }

    setSaving(true);
    try {
      const { data: countData, error: countErr } = await supabase
        .from('physical_counts')
        .insert({
          location_id: locationId,
          count_date: countDate,
          filter_type: filterType,
          filter_id: (filterType !== 'all' && filterId) ? filterId : null,
          remarks: remarks.trim(),
          status: 'draft',
          created_by: user?.id ?? null,
          updated_by: user?.id ?? null,
        })
        .select('id')
        .single();

      if (countErr) throw countErr;
      const countId = countData.id;

      let productQuery = supabase
        .from('inv_products')
        .select('id, cost_price')
        .eq('is_active', true)
        .order('name');

      if (filterType === 'category' && filterId) {
        productQuery = productQuery.eq('category_id', filterId);
      } else if (filterType === 'brand' && filterId) {
        productQuery = productQuery.eq('brand_id', filterId);
      }

      const { data: products } = await productQuery;

      if (!products || products.length === 0) {
        showToast('No products found for the selected filters', 'error');
        await supabase.from('physical_counts').delete().eq('id', countId);
        setSaving(false);
        return;
      }

      const productIds = (products as { id: string; cost: number | null }[]).map(p => p.id);

      const { data: balances } = await supabase
        .from('inventory_balances')
        .select('product_id, qty_on_hand')
        .eq('location_id', locationId)
        .in('product_id', productIds);

      const balMap = Object.fromEntries(((balances ?? []) as Array<{ product_id: string; qty_on_hand: number }>).map((b) => [b.product_id, b.qty_on_hand]));
      const costMap = Object.fromEntries((products as { id: string; cost_price: number | null }[]).map(p => [p.id, p.cost_price]));

      const items = productIds.map((pid, i) => ({
        count_id: countId,
        product_id: pid,
        system_qty: balMap[pid] ?? 0,
        counted_qty: null,
        unit_cost: costMap[pid] ?? null,
        sort_order: i,
      }));

      const BATCH = 500;
      for (let i = 0; i < items.length; i += BATCH) {
        const { error: itemErr } = await supabase.from('physical_count_items').insert(items.slice(i, i + BATCH));
        if (itemErr) throw itemErr;
      }

      showToast(`Count session created with ${items.length} products`, 'success');
      navigate(`/inventory/physical-counts/${countId}/sheet`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create count session';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  const filterOptions = filterType === 'category' ? categories : brands;

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-4 mb-6">
        <Link to="/inventory/physical-counts" className="text-slate-400 hover:text-slate-600 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-800">New Physical Count</h1>
          <p className="text-sm text-slate-500 mt-0.5">Set up a stock count session</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
        {/* Location */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            Location <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <select
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
              className="w-full appearance-none pl-3 pr-8 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Select location...</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>

        {/* Count Date */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            Count Date
          </label>
          <input
            type="date"
            value={countDate}
            onChange={e => setCountDate(e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Product Filter */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            Product Scope
          </label>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {(['all', 'category', 'brand'] as PhysicalCountFilterType[]).map(ft => (
              <button
                key={ft}
                type="button"
                onClick={() => { setFilterType(ft); setFilterId(''); }}
                className={`py-2 px-3 text-sm font-medium rounded-lg border transition-colors ${
                  filterType === ft
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {FILTER_TYPE_LABELS[ft]}
              </button>
            ))}
          </div>

          {filterType !== 'all' && (
            <div className="relative">
              <select
                value={filterId}
                onChange={e => setFilterId(e.target.value)}
                className="w-full appearance-none pl-3 pr-8 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Select {filterType}...</option>
                {filterOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          )}
        </div>

        {/* Product preview */}
        {locationId && (
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${
            productPreview === 0 ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'
          }`}>
            {previewLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            ) : (
              <AlertCircle className={`w-4 h-4 flex-shrink-0 ${productPreview === 0 ? 'text-amber-500' : 'text-blue-500'}`} />
            )}
            <p className={`text-sm ${productPreview === 0 ? 'text-amber-700' : 'text-blue-700'}`}>
              {previewLoading
                ? 'Calculating...'
                : productPreview === 0
                  ? 'No products found for the selected location and scope.'
                  : `${productPreview} product${productPreview !== 1 ? 's' : ''} will be included in this count session.`
              }
            </p>
          </div>
        )}

        {/* Remarks */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            Remarks
          </label>
          <textarea
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            rows={2}
            placeholder="Optional notes about this count session..."
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <Link to="/inventory/physical-counts" className="text-sm text-slate-500 hover:text-slate-700">
            Cancel
          </Link>
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !locationId || productPreview === 0}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Count Session'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
