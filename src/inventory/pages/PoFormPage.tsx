import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvSupplier, InvLocation } from '../../lib/types';
import { computeCostPerBase, fetchProductUnitBundles } from '../../lib/productUnits';
import { formatCurrency } from '../lib/poUtils';
import { generateUUID } from '../../lib/utils';
import { useToast } from '../../contexts/ToastContext';
import ProductPicker, { PickedProduct } from '../components/ProductPicker';

interface LineItem {
  _key: string;
  id?: string;
  product_id: string;
  product?: PickedProduct | null;
  purchase_unit_id: string;
  purchase_unit_name: string;
  purchase_unit_code: string;
  qty_in_base_unit_per_purchase: number;
  qty_ordered: string;
  unit_cost: string;
  qty_ordered_in_base_unit: number;
  cost_per_base_unit: number;
  notes: string;
  sort_order: number;
}

interface HeaderState {
  supplier_id: string;
  location_id: string;
  order_date: string;
  expected_date: string;
  notes: string;
}

const EMPTY_HEADER: HeaderState = {
  supplier_id: '',
  location_id: '',
  order_date: new Date().toISOString().split('T')[0],
  expected_date: '',
  notes: '',
};

function parseDecimal(value: string) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return 0;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeDecimalInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '');
  const firstDotIndex = cleaned.indexOf('.');
  if (firstDotIndex === -1) return cleaned;
  return `${cleaned.slice(0, firstDotIndex + 1)}${cleaned.slice(firstDotIndex + 1).replace(/\./g, '')}`;
}

function newLine(sort_order = 0): LineItem {
  return {
    _key: generateUUID(),
    product_id: '',
    product: null,
    purchase_unit_id: '',
    purchase_unit_name: '',
    purchase_unit_code: '',
    qty_in_base_unit_per_purchase: 1,
    qty_ordered: '',
    unit_cost: '',
    qty_ordered_in_base_unit: 0,
    cost_per_base_unit: 0,
    notes: '',
    sort_order,
  };
}

export default function PoFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [header, setHeader] = useState(EMPTY_HEADER);
  const [lines, setLines] = useState<LineItem[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  const [suppliers, setSuppliers] = useState<InvSupplier[]>([]);
  const [locations, setLocations] = useState<InvLocation[]>([]);

  useEffect(() => {
    async function loadRefs() {
      const [sups, locs] = await Promise.all([
        supabase.from('inv_suppliers').select('*').eq('is_active', true).order('name'),
        supabase.from('inv_locations').select('*').eq('is_active', true).order('name'),
      ]);
      setSuppliers(sups.data ?? []);
      setLocations(locs.data ?? []);
    }
    loadRefs();
  }, []);

  const loadPo = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const [poRes, itemsRes] = await Promise.all([
      supabase.from('purchase_orders').select('*').eq('id', id).maybeSingle(),
      supabase.from('purchase_order_items').select('*').eq('po_id', id).order('sort_order'),
    ]);

    if (!poRes.data) {
      showToast('Purchase order not found', 'error');
      navigate('/inventory/purchase-orders');
      return;
    }

    const po = poRes.data;
    if (po.status !== 'draft') {
      showToast('Only draft POs can be edited', 'error');
      navigate(`/inventory/purchase-orders/${id}`);
      return;
    }

    setHeader({
      supplier_id: po.supplier_id,
      location_id: po.location_id,
      order_date: po.order_date,
      expected_date: po.expected_date ?? '',
      notes: po.notes ?? '',
    });

    const items = (itemsRes.data ?? []);
    // Fetch product details for lines via RPC
    const productIds = [...new Set(items.map((i: { product_id: string }) => i.product_id))];
    let prodMap: Record<string, PickedProduct> = {};
    if (productIds.length > 0) {
      const { data: prodData } = await supabase.rpc('search_products', {
        search: '', filter_active: '', filter_category: '', page: 1, page_size: 200,
      });
      type RpcProd = PickedProduct;
      const allProds = ((prodData ?? {}) as { products: RpcProd[] }).products ?? [];
      prodMap = Object.fromEntries(allProds.filter(p => productIds.includes(p.id)).map(p => [
        p.id,
        {
          ...p,
          unit_code: p.default_purchase_unit_code ?? p.unit_code ?? '',
          default_cost: p.default_cost ?? p.cost_price ?? 0,
        },
      ]));
    }

    const mapped: LineItem[] = items.map((item: {
      id: string;
      product_id: string;
      purchase_unit_id?: string | null;
      purchase_unit_name?: string;
      qty_in_base_unit_per_purchase?: number;
      qty_ordered: number;
      unit_cost: number;
      qty_ordered_in_base_unit?: number;
      cost_per_base_unit?: number;
      notes?: string;
      sort_order: number;
    }) => ({
      _key: item.id,
      id: item.id,
      product_id: item.product_id,
      product: prodMap[item.product_id] ?? null,
      purchase_unit_id: item.purchase_unit_id ?? prodMap[item.product_id]?.default_purchase_unit_id ?? '',
      purchase_unit_name: item.purchase_unit_name ?? prodMap[item.product_id]?.default_purchase_unit_name ?? '',
      purchase_unit_code: prodMap[item.product_id]?.default_purchase_unit_code ?? prodMap[item.product_id]?.unit_code ?? '',
      qty_in_base_unit_per_purchase: Number(item.qty_in_base_unit_per_purchase ?? 1),
      qty_ordered: String(item.qty_ordered),
      unit_cost: String(item.unit_cost),
      qty_ordered_in_base_unit: Number(item.qty_ordered_in_base_unit ?? 0),
      cost_per_base_unit: Number(item.cost_per_base_unit ?? 0),
      notes: item.notes ?? '',
      sort_order: item.sort_order,
    }));
    setLines(mapped.length > 0 ? mapped : [newLine()]);
    setLoading(false);
  }, [id, navigate, showToast]);

  useEffect(() => { if (isEdit) loadPo(); }, [isEdit, loadPo]);

  function setH(field: keyof HeaderState, value: string) {
    setHeader(h => ({ ...h, [field]: value }));
  }

  async function setProductOnLine(key: string, product: PickedProduct | null) {
    if (!product) {
      setLines(prev => prev.map(l => l._key !== key ? l : newLine(l.sort_order)));
      return;
    }

    const bundleMap = await fetchProductUnitBundles([product.id]);
    const bundle = bundleMap.get(product.id);
    const qtyInBase = Number(
      bundle?.conversions.find(row => row.unit_id === (product.default_purchase_unit_id ?? ''))?.equivalent_qty_in_base_unit
      ?? 1
    );

    setLines(prev => prev.map(l => {
      if (l._key !== key) return l;
      return {
        ...l,
        product_id: product.id,
        product,
        purchase_unit_id: product.default_purchase_unit_id ?? '',
        purchase_unit_name: product.default_purchase_unit_name ?? '',
        purchase_unit_code: product.default_purchase_unit_code ?? product.unit_code ?? '',
        qty_in_base_unit_per_purchase: qtyInBase,
        unit_cost: String(product.default_cost ?? product.cost_price ?? 0),
        cost_per_base_unit: computeCostPerBase(product.default_cost ?? product.cost_price ?? 0, qtyInBase),
      };
    }));
  }

  function updateLine(key: string, field: keyof LineItem, value: string) {
    setLines(prev => prev.map(l => {
      if (l._key !== key) return l;
      const normalizedValue = field === 'qty_ordered' || field === 'unit_cost'
        ? sanitizeDecimalInput(value)
        : value;
      const next = { ...l, [field]: normalizedValue };
      const qtyOrdered = parseDecimal(field === 'qty_ordered' ? normalizedValue : next.qty_ordered);
      const unitCost = parseDecimal(field === 'unit_cost' ? normalizedValue : next.unit_cost);
      next.qty_ordered_in_base_unit = qtyOrdered * next.qty_in_base_unit_per_purchase;
      next.cost_per_base_unit = computeCostPerBase(unitCost, next.qty_in_base_unit_per_purchase);
      return next;
    }));
  }

  function addLine() {
    setLines(prev => [...prev, newLine(prev.length)]);
  }

  function removeLine(key: string) {
    if (lines.length === 1) return;
    setLines(prev => prev.filter(l => l._key !== key));
  }

  // Totals
  const subtotal = lines.reduce((sum, l) => {
    const qty = parseDecimal(l.qty_ordered);
    const cost = parseDecimal(l.unit_cost);
    return sum + qty * cost;
  }, 0);
  const total = subtotal;

  const validLines = lines.filter(l => l.product_id && l.qty_ordered && parseDecimal(l.qty_ordered) > 0 && parseDecimal(l.unit_cost) >= 0);
  const isValid = header.supplier_id && header.location_id && header.order_date && validLines.length > 0;

  async function handleSave() {
    if (!isValid) { showToast('Fill in supplier, location, date, and at least one product line', 'error'); return; }
    setSaving(true);

    try {
      const payload = {
        po_id: id,
        supplier_id: header.supplier_id,
        location_id: header.location_id,
        order_date: header.order_date,
        expected_date: header.expected_date || null,
        notes: header.notes,
        items: validLines.map((line, index) => {
          const qtyOrdered = parseDecimal(line.qty_ordered);
          const unitCost = parseDecimal(line.unit_cost);
          return {
            product_id: line.product_id,
            purchase_unit_id: line.purchase_unit_id || null,
            purchase_unit_name: line.purchase_unit_name,
            qty_in_base_unit_per_purchase: line.qty_in_base_unit_per_purchase,
            qty_ordered: qtyOrdered,
            unit_cost: unitCost,
            cost_per_base_unit: computeCostPerBase(unitCost, line.qty_in_base_unit_per_purchase),
            notes: line.notes,
            sort_order: index,
          };
        }),
      };

      const { data, error } = await supabase.rpc('save_purchase_order', payload);
      if (error) throw error;
      const poId = data?.id ?? id;
      if (!poId) throw new Error('Purchase order was saved but no ID was returned');

      showToast(isEdit ? 'Purchase order updated' : 'Purchase order created', 'success');
      navigate(`/inventory/purchase-orders/${poId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      showToast(msg, 'error');
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

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <Link to="/inventory/purchase-orders" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Purchase Orders
        </Link>
        <h1 className="text-xl font-bold text-slate-800">{isEdit ? 'Edit Purchase Order' : 'New Purchase Order'}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {isEdit ? 'Update draft purchase order details' : 'Create a new purchase order for a supplier'}
        </p>
      </div>

      {/* Header Form */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 mb-4 pb-2 border-b border-slate-100">Order Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Supplier <span className="text-red-500">*</span></label>
            <select
              value={header.supplier_id}
              onChange={e => setH('supplier_id', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">— Select Supplier —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Deliver To (Location) <span className="text-red-500">*</span></label>
            <select
              value={header.location_id}
              onChange={e => setH('location_id', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">— Select Location —</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Order Date <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={header.order_date}
              onChange={e => setH('order_date', e.target.value)}
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

          <div className="sm:col-span-2 lg:col-span-3">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Notes</label>
            <textarea
              value={header.notes}
              onChange={e => setH('notes', e.target.value)}
              placeholder="Optional notes..."
              rows={3}
              className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-4">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">Line Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-8">#</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider min-w-64">Product</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Qty Ordered</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-36">Purchase Cost (₱)</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-36">Line Total</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line, idx) => {
                const lineTotal = parseDecimal(line.qty_ordered) * parseDecimal(line.unit_cost);
                return (
                  <tr key={line._key} className="align-top hover:bg-slate-50/50">
                    <td className="px-4 py-3 text-xs text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-3">
                      <ProductPicker
                        value={line.product ?? null}
                        onChange={p => { void setProductOnLine(line._key, p); }}
                        placeholder="Select product"
                      />
                      {line.purchase_unit_code && (
                        <div className="mt-1 text-[11px] text-slate-500">
                          Purchase unit: <span className="font-medium">{line.purchase_unit_code}</span>
                          {line.qty_in_base_unit_per_purchase > 0 && (
                            <span> · 1 = {line.qty_in_base_unit_per_purchase.toLocaleString(undefined, { maximumFractionDigits: 6 })} base</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={line.qty_ordered}
                        onChange={e => updateLine(line._key, 'qty_ordered', e.target.value)}
                        placeholder="0"
                        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={line.unit_cost}
                        onChange={e => updateLine(line._key, 'unit_cost', e.target.value)}
                        placeholder="0.00"
                        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-slate-700">
                      {lineTotal > 0 ? formatCurrency(lineTotal) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="text"
                        value={line.notes}
                        onChange={e => updateLine(line._key, 'notes', e.target.value)}
                        placeholder="Optional..."
                        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <button
                        onClick={() => removeLine(line._key)}
                        disabled={lines.length === 1}
                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
          <button onClick={addLine} className="flex items-center gap-2 text-sm text-blue-600 font-medium hover:text-blue-700 transition-colors">
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        </div>
      </div>

      {/* Totals */}
      <div className="mb-6 flex justify-end">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Summary</h3>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-slate-600"><span>Subtotal</span><span className="tabular-nums">{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between font-bold text-base text-slate-800 pt-2 border-t border-slate-200">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          {validLines.length > 0 ? (
            <span className="text-emerald-600">{validLines.length} line{validLines.length !== 1 ? 's' : ''} ready</span>
          ) : (
            <span className="flex items-center gap-1.5 text-slate-400">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Add at least one product with quantity
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            to={id ? `/inventory/purchase-orders/${id}` : '/inventory/purchase-orders'}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </Link>
          <button
            onClick={handleSave}
            disabled={saving || !isValid}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : isEdit ? 'Update PO' : 'Create PO'}
          </button>
        </div>
      </div>
    </div>
  );
}

