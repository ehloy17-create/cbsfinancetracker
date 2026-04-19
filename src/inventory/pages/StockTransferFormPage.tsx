import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, ChevronDown, Search, X, Package } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvProduct, InvLocation, StockTransfer, StockTransferItem } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { formatQty } from '../lib/transferUtils';

interface LineState {
  id?: string;
  product_id: string;
  product_sku: string;
  product_name: string;
  unit_code: string;
  qty_requested: string;
  unit_cost: string;
  notes: string;
  onhand_at_source: number | null;
}

const EMPTY_HEADER = {
  source_location_id: '',
  destination_location_id: '',
  transfer_date: new Date().toISOString().split('T')[0],
  expected_date: '',
  notes: '',
};

type ProductRow = InvProduct & { inv_units?: { code: string } | null; onhand?: number };

export default function StockTransferFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [header, setHeader] = useState(EMPTY_HEADER);
  const [lines, setLines] = useState<LineState[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [searchResults, setSearchResults] = useState<ProductRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);

  useEffect(() => {
    supabase.from('inv_locations').select('*').eq('is_active', true).order('name').then(({ data }) => {
      setLocations((data ?? []) as InvLocation[]);
    });
  }, []);

  // Debounced product search using RPC
  useEffect(() => {
    if (!productSearch.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc('search_products', {
        search: productSearch.trim(),
        filter_active: 'active',
        filter_category: '',
        page: 1,
        page_size: 20,
      });
      type RpcProduct = InvProduct & { unit_code?: string };
      const products = ((data ?? {}) as { products: RpcProduct[] }).products ?? [];
      setSearchResults(products
        .filter(p => !lines.some(l => l.product_id === p.id))
        .map(p => ({ ...p, inv_units: p.unit_code ? { code: p.unit_code } : null })) as unknown as ProductRow[]);
      setSearchLoading(false);
    }, 280);
    return () => clearTimeout(timer);
  }, [productSearch, lines]);

  const loadExisting = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const [txRes, itemsRes] = await Promise.all([
      supabase.from('stock_transfers').select('*').eq('id', id).maybeSingle(),
      supabase.from('stock_transfer_items')
        .select('*')
        .eq('transfer_id', id)
        .order('sort_order'),
    ]);

    if (!txRes.data) {
      showToast('Transfer not found', 'error');
      navigate('/inventory/transfers');
      return;
    }
    const tx = txRes.data as StockTransfer;
    if (tx.status !== 'draft') {
      showToast('Only draft transfers can be edited', 'error');
      navigate(`/inventory/transfers/${id}`);
      return;
    }

    setHeader({
      source_location_id: tx.source_location_id,
      destination_location_id: tx.destination_location_id,
      transfer_date: tx.transfer_date,
      expected_date: tx.expected_date ?? '',
      notes: tx.notes,
    });

    const items = (itemsRes.data ?? []) as unknown as StockTransferItem[];

    // Fetch product details for each line separately
    const productIds = [...new Set(items.map(i => i.product_id))];
    let prodMap: Record<string, { name: string; sku_code: string; unit_code: string; cost_price: number }> = {};
    if (productIds.length > 0) {
      const { data: prodData } = await supabase.rpc('search_products', {
        search: '', filter_active: '', filter_category: '', page: 1, page_size: 200,
      });
      type RpcProduct = { id: string; name: string; sku_code: string; unit_code: string; cost_price: number };
      const allProds = ((prodData ?? {}) as { products: RpcProduct[] }).products ?? [];
      prodMap = Object.fromEntries(allProds.filter(p => productIds.includes(p.id)).map(p => [
        p.id, { name: p.name, sku_code: p.sku_code, unit_code: p.unit_code ?? '', cost_price: p.cost_price ?? 0 },
      ]));
    }

    const mapped: LineState[] = items.map(item => {
      const prod = prodMap[item.product_id] ?? { name: item.product_id, sku_code: '', unit_code: '', cost_price: 0 };
      return {
        id: item.id,
        product_id: item.product_id,
        product_sku: prod.sku_code,
        product_name: prod.name,
        unit_code: prod.unit_code,
        qty_requested: String(item.qty_requested),
        unit_cost: String(item.unit_cost ?? prod.cost_price ?? ''),
        notes: item.notes,
        onhand_at_source: null,
      };
    });
    setLines(mapped);
    setLoading(false);
  }, [id, navigate, showToast]);

  useEffect(() => { if (isEdit) loadExisting(); }, [isEdit, loadExisting]);

  function setH<K extends keyof typeof EMPTY_HEADER>(k: K, v: string) {
    setHeader(h => ({ ...h, [k]: v }));
  }

  function addProduct(product: ProductRow) {
    if (lines.some(l => l.product_id === product.id)) {
      showToast('Product already added', 'error');
      return;
    }
    setLines(prev => [...prev, {
      product_id: product.id,
      product_sku: product.sku_code,
      product_name: product.name,
      unit_code: product.inv_units?.code ?? '',
      qty_requested: '',
      unit_cost: String(product.cost_price ?? ''),
      notes: '',
      onhand_at_source: null,
    }]);
    setProductSearch('');
    setProductDropdownOpen(false);
  }

  function removeLine(idx: number) {
    setLines(prev => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: keyof LineState, value: string) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  const filteredProducts = searchResults;

  async function loadOnHandBalances() {
    if (!header.source_location_id || lines.length === 0) return;
    const productIds = lines.map(l => l.product_id);
    const { data } = await supabase
      .from('inventory_balances')
      .select('product_id, qty_on_hand')
      .eq('location_id', header.source_location_id)
      .in('product_id', productIds);
    const map: Record<string, number> = {};
    (data ?? []).forEach((b: { product_id: string; qty_on_hand: number }) => {
      map[b.product_id] = Number(b.qty_on_hand);
    });
    setLines(prev => prev.map(l => ({ ...l, onhand_at_source: map[l.product_id] ?? 0 })));
  }

  useEffect(() => {
    if (header.source_location_id) loadOnHandBalances();
  }, [header.source_location_id, lines.length]);

  async function handleSave() {
    if (!header.source_location_id) { showToast('Select source location', 'error'); return; }
    if (!header.destination_location_id) { showToast('Select destination location', 'error'); return; }
    if (header.source_location_id === header.destination_location_id) {
      showToast('Source and destination must be different', 'error'); return;
    }
    const validLines = lines.filter(l => parseFloat(l.qty_requested) > 0);
    if (validLines.length === 0) { showToast('Add at least one item with quantity', 'error'); return; }

    setSaving(true);
    try {
      let transferId = id;

      if (isEdit && transferId) {
        const { error } = await supabase.from('stock_transfers').update({
          source_location_id: header.source_location_id,
          destination_location_id: header.destination_location_id,
          transfer_date: header.transfer_date,
          expected_date: header.expected_date || null,
          notes: header.notes,
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
        }).eq('id', transferId);
        if (error) throw error;
        await supabase.from('stock_transfer_items').delete().eq('transfer_id', transferId);
      } else {
        const seq = Date.now();
        const tn = 'TRF-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(seq).slice(-4);
        const { data, error } = await supabase.from('stock_transfers').insert({
          transfer_number: tn,
          source_location_id: header.source_location_id,
          destination_location_id: header.destination_location_id,
          transfer_date: header.transfer_date,
          expected_date: header.expected_date || null,
          notes: header.notes,
          created_by: user?.id,
          updated_by: user?.id,
        }).select('id').single();
        if (error) throw error;
        transferId = data.id;
      }

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const qty = parseFloat(l.qty_requested);
        if (!qty || qty <= 0) continue;
        const { error } = await supabase.from('stock_transfer_items').insert({
          transfer_id: transferId,
          product_id: l.product_id,
          qty_requested: qty,
          unit_cost: parseFloat(l.unit_cost) || null,
          notes: l.notes,
          sort_order: i,
        });
        if (error) throw error;
      }

      showToast(isEdit ? 'Transfer updated' : 'Transfer saved as draft', 'success');
      navigate(`/inventory/transfers/${transferId}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const srcLocation = locations.find(l => l.id === header.source_location_id);
  const dstLocation = locations.find(l => l.id === header.destination_location_id);

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <Link to="/inventory/transfers" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Stock Transfers
        </Link>
        <h1 className="text-xl font-bold text-slate-800">{isEdit ? 'Edit Transfer' : 'New Stock Transfer'}</h1>
        <p className="text-sm text-slate-500 mt-0.5">Move inventory between locations</p>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-4 pb-2 border-b border-slate-100">Transfer Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">From Location <span className="text-red-500">*</span></label>
            <div className="relative">
              <select
                value={header.source_location_id}
                onChange={e => setH('source_location_id', e.target.value)}
                className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— Select source —</option>
                {locations.filter(l => l.id !== header.destination_location_id).map(l => (
                  <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">To Location <span className="text-red-500">*</span></label>
            <div className="relative">
              <select
                value={header.destination_location_id}
                onChange={e => setH('destination_location_id', e.target.value)}
                className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— Select destination —</option>
                {locations.filter(l => l.id !== header.source_location_id).map(l => (
                  <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Transfer Date <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={header.transfer_date}
              onChange={e => setH('transfer_date', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Expected Delivery Date</label>
            <input
              type="date"
              value={header.expected_date}
              onChange={e => setH('expected_date', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Notes</label>
            <input
              type="text"
              value={header.notes}
              onChange={e => setH('notes', e.target.value)}
              placeholder="Optional remarks..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Route summary */}
      {srcLocation && dstLocation && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 flex items-center gap-3 text-sm">
          <div className="font-medium text-blue-800">{srcLocation.name}</div>
          <div className="flex items-center gap-1 text-blue-400">
            <div className="h-px w-8 bg-blue-300" />
            <span className="text-xs font-semibold uppercase tracking-wider">Transfer</span>
            <div className="h-px w-8 bg-blue-300" />
          </div>
          <div className="font-medium text-blue-800">{dstLocation.name}</div>
        </div>
      )}

      {/* Items */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-4">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Transfer Items</h2>
          <div className="relative">
            <div className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-500 hover:border-blue-300 cursor-pointer bg-white"
              onClick={() => setProductDropdownOpen(v => !v)}
            >
              <Plus className="w-3.5 h-3.5" />
              Add Item
            </div>
            {productDropdownOpen && (
              <div className="absolute right-0 top-9 z-20 w-80 bg-white border border-slate-200 rounded-xl shadow-xl">
                <div className="p-2 border-b border-slate-100">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      autoFocus
                      type="text"
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      placeholder="Search products..."
                      className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {productSearch && (
                      <button onClick={() => setProductSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                        <X className="w-3 h-3 text-slate-400" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {searchLoading ? (
                    <p className="px-3 py-3 text-xs text-slate-400 text-center">Searching…</p>
                  ) : filteredProducts.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-slate-400 text-center">
                      {productSearch ? 'No products found' : 'Type to search products'}
                    </p>
                  ) : (
                    filteredProducts.map(p => (
                      <button
                        key={p.id}
                        onClick={() => addProduct(p)}
                        className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-blue-50 transition-colors text-left"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-800">{p.name}</p>
                          <p className="text-xs text-slate-400 font-mono">{p.sku_code}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
                <div className="border-t border-slate-100 p-2">
                  <button
                    onClick={() => setProductDropdownOpen(false)}
                    className="w-full px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="py-12 text-center">
            <Package className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No items added yet. Click "Add Item" to start.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Product</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">On Hand (Src)</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Qty to Transfer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Unit Cost</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line, idx) => {
                  const qty = parseFloat(line.qty_requested) || 0;
                  const onhand = line.onhand_at_source;
                  const overStock = onhand !== null && qty > onhand;
                  return (
                    <tr key={line.product_id} className={`hover:bg-slate-50 ${overStock ? 'bg-red-50/30' : ''}`}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-800">{line.product_name}</p>
                        <p className="text-xs text-slate-400 font-mono">{line.product_sku} {line.unit_code && `· ${line.unit_code}`}</p>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {onhand !== null ? (
                          <span className={`tabular-nums font-semibold text-sm ${onhand === 0 ? 'text-red-500' : overStock ? 'text-amber-600' : 'text-emerald-700'}`}>
                            {formatQty(onhand)}
                          </span>
                        ) : (
                          header.source_location_id ? (
                            <span className="text-xs text-slate-300">—</span>
                          ) : (
                            <span className="text-xs text-slate-300">Select src</span>
                          )
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={line.qty_requested}
                          onChange={e => updateLine(idx, 'qty_requested', e.target.value)}
                          className={`w-full px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-right tabular-nums ${
                            overStock ? 'border-red-300 bg-red-50' : 'border-slate-200'
                          }`}
                        />
                        {overStock && <p className="text-xs text-red-500 mt-0.5">Exceeds on-hand</p>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">₱</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unit_cost}
                            onChange={e => updateLine(idx, 'unit_cost', e.target.value)}
                            className="w-full pl-5 pr-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-right tabular-nums"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={line.notes}
                          onChange={e => updateLine(idx, 'notes', e.target.value)}
                          placeholder="Optional..."
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <button
                          onClick={() => removeLine(idx)}
                          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">
          {lines.filter(l => parseFloat(l.qty_requested) > 0).length} item(s) with quantity
        </span>
        <div className="flex items-center gap-3">
          <Link
            to={id ? `/inventory/transfers/${id}` : '/inventory/transfers'}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </Link>
          <button
            onClick={handleSave}
            disabled={saving || !header.source_location_id || !header.destination_location_id || lines.filter(l => parseFloat(l.qty_requested) > 0).length === 0}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : isEdit ? 'Update Transfer' : 'Save as Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
