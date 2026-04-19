import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Save, AlertTriangle, CheckCircle,
  ChevronDown, Info, Calendar, Clock,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PurchaseOrderItem, InvProduct } from '../../lib/types';
import { formatDate, daysUntilExpiry, expiryWarningLevel } from '../lib/receivingUtils';
import { useToast } from '../../contexts/ToastContext';

interface PoOption {
  id: string;
  po_number: string;
  order_date: string;
  status: string;
  suppliers: { id: string; name: string; code: string };
  inv_locations: { id: string; name: string; code: string };
}

type ProductMeta = {
  id: string;
  sku_code: string;
  name: string;
  cost_price?: number | null;
  is_expiry_tracked?: boolean | null;
  near_expiry_days?: number | null;
  inv_units?: { code: string; name: string } | null;
};

interface LineState {
  po_item_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  is_expiry_tracked: boolean;
  near_expiry_days: number;
  purchase_unit_id: string;
  purchase_unit_name: string;
  purchase_unit_code: string;
  base_unit_name: string;
  qty_in_base_unit_per_purchase: number;
  qty_ordered: number;
  qty_prev_received: number;
  qty_remaining: number;
  qty_accepted: string;
  qty_rejected: string;
  unit_cost: string;
  unit_cost_per_base: number;
  expiry_date: string;
  batch_number: string;
  notes: string;
}

const EMPTY_HEADER = {
  po_id: '',
  receiving_date: new Date().toISOString().split('T')[0],
  invoice_number: '',
  dr_number: '',
  remarks: '',
};

async function loadProductMeta(productIds: string[]) {
  if (productIds.length === 0) {
    return new Map<string, ProductMeta>();
  }

  const [productsRes, unitsRes] = await Promise.all([
    supabase.from('inv_products').select('id, sku_code, name, cost_price, is_expiry_tracked, near_expiry_days, unit_id').in('id', productIds),
    supabase.from('inv_units').select('id, code, name'),
  ]);

  const unitMap = new Map(((unitsRes.data ?? []) as Array<{ id: string; code: string; name: string }>).map((unit) => [unit.id, unit]));
  return new Map(
    ((productsRes.data ?? []) as Array<InvProduct & { unit_id?: string | null }>).map((product) => [
      product.id,
      {
        id: product.id,
        sku_code: product.sku_code,
        name: product.name,
        cost_price: product.cost_price,
        is_expiry_tracked: product.is_expiry_tracked,
        near_expiry_days: product.near_expiry_days,
        inv_units: product.unit_id ? unitMap.get(product.unit_id) ?? null : null,
      },
    ])
  );
}

export default function ReceivingFormPage() {
  const { id } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [header, setHeader] = useState({ ...EMPTY_HEADER, po_id: searchParams.get('po') ?? '' });
  const [lines, setLines] = useState<LineState[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  const [poOptions, setPoOptions] = useState<PoOption[]>([]);
  const [selectedPo, setSelectedPo] = useState<PoOption | null>(null);
  const [poLoading, setPoLoading] = useState(false);

  useEffect(() => {
    async function loadPoOptions() {
      const { data } = await supabase
        .from('purchase_orders')
        .select('id, po_number, order_date, status, supplier_id, location_id')
        .in('status', ['approved', 'partially_received'])
        .order('created_at', { ascending: false })
        .limit(200);

      const rows = (data ?? []) as Array<{
        id: string;
        po_number: string;
        order_date: string;
        status: string;
        supplier_id: string;
        location_id: string;
      }>;
      const supplierIds = [...new Set(rows.map((row) => row.supplier_id).filter(Boolean))];
      const locationIds = [...new Set(rows.map((row) => row.location_id).filter(Boolean))];
      const [suppliersRes, locationsRes] = await Promise.all([
        supplierIds.length > 0
          ? supabase.from('suppliers').select('id, name, code').in('id', supplierIds)
          : Promise.resolve({ data: [], error: null }),
        locationIds.length > 0
          ? supabase.from('inv_locations').select('id, name, code').in('id', locationIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      const supplierMap = new Map(((suppliersRes.data ?? []) as Array<{ id: string; name: string; code: string }>).map((supplier) => [supplier.id, supplier]));
      const locationMap = new Map(((locationsRes.data ?? []) as Array<{ id: string; name: string; code: string }>).map((location) => [location.id, location]));

      setPoOptions(rows.map((row) => ({
        id: row.id,
        po_number: row.po_number,
        order_date: row.order_date,
        status: row.status,
        suppliers: supplierMap.get(row.supplier_id) ?? { id: row.supplier_id, name: 'Unknown supplier', code: '' },
        inv_locations: locationMap.get(row.location_id) ?? { id: row.location_id, name: 'Unknown location', code: '' },
      })));
    }
    loadPoOptions();
  }, []);

  const loadPoLines = useCallback(async (poId: string) => {
    if (!poId) { setLines([]); setSelectedPo(null); return; }
    setPoLoading(true);

    const po = poOptions.find(p => p.id === poId) ?? null;
    setSelectedPo(po);

    const { data } = await supabase
      .from('purchase_order_items')
      .select('*')
      .eq('po_id', poId)
      .order('sort_order');

    const poItems = (data ?? []) as PurchaseOrderItem[];
    const productMeta = await loadProductMeta([...new Set(poItems.map((item) => item.product_id).filter(Boolean))]);

    const mapped: LineState[] = poItems
      .filter(item => item.qty_ordered - item.qty_received > 0)
      .map(item => {
        const product = productMeta.get(item.product_id);
        return {
        po_item_id: item.id,
        product_id: item.product_id,
        product_name: product?.name ?? 'Unknown product',
        product_sku: product?.sku_code ?? '',
        is_expiry_tracked: Boolean(product?.is_expiry_tracked),
        near_expiry_days: product?.near_expiry_days ?? 90,
        purchase_unit_id: item.purchase_unit_id ?? '',
        purchase_unit_name: item.purchase_unit_name ?? '',
        purchase_unit_code: item.purchase_unit_name ?? product?.inv_units?.code ?? '',
        base_unit_name: product?.inv_units?.name ?? '',
        qty_in_base_unit_per_purchase: Number(item.qty_in_base_unit_per_purchase ?? 1),
        qty_ordered: Number(item.qty_ordered),
        qty_prev_received: Number(item.qty_received),
        qty_remaining: Number(item.qty_ordered) - Number(item.qty_received),
        qty_accepted: String(Number(item.qty_ordered) - Number(item.qty_received)),
        qty_rejected: '0',
        unit_cost: String(Number(item.unit_cost)),
        unit_cost_per_base: Number(item.cost_per_base_unit ?? product?.cost_price ?? 0),
        expiry_date: '',
        batch_number: '',
        notes: '',
        };
      });

    setLines(mapped);
    setPoLoading(false);
  }, [poOptions]);

  useEffect(() => {
    if (header.po_id && poOptions.length > 0 && !isEdit) {
      loadPoLines(header.po_id);
    }
  }, [header.po_id, poOptions, isEdit, loadPoLines]);

  const loadExisting = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const [recvRes, itemsRes] = await Promise.all([
      supabase.from('receivings').select('*').eq('id', id).maybeSingle(),
      supabase.from('receiving_items')
        .select('*')
        .eq('receiving_id', id)
        .order('sort_order'),
    ]);

    if (!recvRes.data) {
      showToast('Receiving not found', 'error');
      navigate('/inventory/receivings');
      return;
    }

    const recv = recvRes.data;
    if (recv.status !== 'draft') {
      showToast('Only draft receivings can be edited', 'error');
      navigate(`/inventory/receivings/${id}`);
      return;
    }

    setHeader({
      po_id: recv.po_id,
      receiving_date: recv.receiving_date,
      invoice_number: recv.invoice_number,
      dr_number: recv.dr_number,
      remarks: recv.remarks,
    });

    const poRes = await supabase
      .from('purchase_orders')
      .select('id, po_number, order_date, status, supplier_id, location_id')
      .eq('id', recv.po_id)
      .maybeSingle();

    if (poRes.data) {
      const poRow = poRes.data as {
        id: string;
        po_number: string;
        order_date: string;
        status: string;
        supplier_id: string;
        location_id: string;
      };
      const [supplierRes, locationRes] = await Promise.all([
        supabase.from('suppliers').select('id, name, code').eq('id', poRow.supplier_id).maybeSingle(),
        supabase.from('inv_locations').select('id, name, code').eq('id', poRow.location_id).maybeSingle(),
      ]);
      setSelectedPo({
        id: poRow.id,
        po_number: poRow.po_number,
        order_date: poRow.order_date,
        status: poRow.status,
        suppliers: supplierRes.data ?? { id: poRow.supplier_id, name: 'Unknown supplier', code: '' },
        inv_locations: locationRes.data ?? { id: poRow.location_id, name: 'Unknown location', code: '' },
      });
    } else {
      setSelectedPo(null);
    }

    interface ItemWithProd {
      id: string;
      po_item_id: string | null;
      product_id: string;
      qty_ordered: number;
      qty_prev_received: number;
      qty_remaining: number;
      qty_accepted: number;
      qty_rejected: number;
      purchase_unit_id?: string | null;
      purchase_unit_name?: string;
      qty_in_base_unit_per_purchase?: number;
      unit_cost_per_base?: number;
      unit_cost: number;
      expiry_date: string | null;
      batch_number: string;
      notes: string;
      sort_order: number;
    }

    const receivingItems = (itemsRes.data ?? []) as ItemWithProd[];
    const productMeta = await loadProductMeta([...new Set(receivingItems.map((item) => item.product_id).filter(Boolean))]);

    const mapped: LineState[] = receivingItems.map(item => {
      const product = productMeta.get(item.product_id);
      return {
      po_item_id: item.po_item_id ?? '',
      product_id: item.product_id,
      product_name: product?.name ?? 'Unknown product',
      product_sku: product?.sku_code ?? '',
      is_expiry_tracked: Boolean(product?.is_expiry_tracked),
      near_expiry_days: product?.near_expiry_days ?? 90,
      purchase_unit_id: item.purchase_unit_id ?? '',
      purchase_unit_name: item.purchase_unit_name ?? '',
      purchase_unit_code: item.purchase_unit_name ?? product?.inv_units?.code ?? '',
      base_unit_name: product?.inv_units?.name ?? '',
      qty_in_base_unit_per_purchase: Number(item.qty_in_base_unit_per_purchase ?? 1),
      qty_ordered: Number(item.qty_ordered),
      qty_prev_received: Number(item.qty_prev_received),
      qty_remaining: Number(item.qty_remaining),
      qty_accepted: String(item.qty_accepted),
      qty_rejected: String(item.qty_rejected),
      unit_cost: String(item.unit_cost),
      unit_cost_per_base: Number(item.unit_cost_per_base ?? 0),
      expiry_date: item.expiry_date ?? '',
      batch_number: item.batch_number ?? '',
      notes: item.notes ?? '',
      };
    });
    setLines(mapped);
    setLoading(false);
  }, [id, navigate, showToast]);

  useEffect(() => { if (isEdit) loadExisting(); }, [isEdit, loadExisting]);

  function setH<K extends keyof typeof EMPTY_HEADER>(field: K, value: typeof EMPTY_HEADER[K]) {
    setHeader(h => ({ ...h, [field]: value }));
  }

  function updateLine(idx: number, field: keyof LineState, value: string | boolean) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }

  function fillAllAccepted() {
    setLines(prev => prev.map(l => ({ ...l, qty_accepted: String(l.qty_remaining) })));
  }

  const validLines = lines.filter(l => {
    const acc = parseFloat(l.qty_accepted) || 0;
    const rej = parseFloat(l.qty_rejected) || 0;
    return acc > 0 || rej > 0;
  });

  const overLimit = lines.some(l => {
    const acc = parseFloat(l.qty_accepted) || 0;
    return acc > l.qty_remaining;
  });

  const missingExpiry = lines.some(l => l.is_expiry_tracked && (parseFloat(l.qty_accepted) || 0) > 0 && !l.expiry_date);

  async function handleSave() {
    if (isEdit) {
      showToast('Create receiving from the purchase order screen for new transactions', 'error');
      return;
    }
    if (!header.po_id) { showToast('Select a purchase order', 'error'); return; }
    if (validLines.length === 0) { showToast('Enter received quantity for at least one item', 'error'); return; }
    if (overLimit) { showToast('Some items exceed the remaining PO quantity', 'error'); return; }
    if (missingExpiry) { showToast('Enter expiry date for all expiry-tracked items', 'error'); return; }

    setSaving(true);
    try {
      const payload = {
        po_id: header.po_id,
        receiving_date: header.receiving_date,
        invoice_number: header.invoice_number,
        dr_number: header.dr_number,
        remarks: header.remarks,
        items: validLines.map((line) => ({
          po_item_id: line.po_item_id,
          qty_accepted: parseFloat(line.qty_accepted) || 0,
          qty_rejected: parseFloat(line.qty_rejected) || 0,
          unit_cost: parseFloat(line.unit_cost) || 0,
          expiry_date: line.expiry_date || null,
          batch_number: line.batch_number,
          notes: line.notes,
          purchase_unit_id: line.purchase_unit_id || null,
          purchase_unit_name: line.purchase_unit_name,
          qty_in_base_unit_per_purchase: line.qty_in_base_unit_per_purchase,
        })),
      };
      const { data, error } = await supabase.rpc('receive_purchase_order', payload);
      if (error) throw error;

      showToast('Receiving posted. Inventory and payable updated.', 'success');
      navigate(`/inventory/receivings/${data.receiving_id}`);
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
    <div className="p-6 max-w-7xl">
      <div className="mb-6">
        <Link to="/inventory/receivings" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Goods Receiving
        </Link>
        <h1 className="text-xl font-bold text-slate-800">{isEdit ? 'View Draft Receiving' : 'Receive Goods'}</h1>
        <p className="text-sm text-slate-500 mt-0.5">Receive products directly from an approved purchase order</p>
      </div>

      {/* Header Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-4 pb-2 border-b border-slate-100">Receiving Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Purchase Order <span className="text-red-500">*</span></label>
            <div className="relative">
              <select
                value={header.po_id}
                onChange={e => { setH('po_id', e.target.value); }}
                disabled={isEdit}
                className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="">— Select Approved PO —</option>
                {poOptions.map(po => (
                  <option key={po.id} value={po.id}>
                    {po.po_number} — {po.suppliers.name} ({po.status.replace('_', ' ')})
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Receiving Date <span className="text-red-500">*</span></label>
            <input type="date" value={header.receiving_date} onChange={e => setH('receiving_date', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Invoice Number</label>
            <input type="text" value={header.invoice_number} onChange={e => setH('invoice_number', e.target.value)}
              placeholder="Supplier invoice #"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Delivery Receipt (DR) Number</label>
            <input type="text" value={header.dr_number} onChange={e => setH('dr_number', e.target.value)}
              placeholder="DR / waybill #"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Remarks</label>
            <input type="text" value={header.remarks} onChange={e => setH('remarks', e.target.value)}
              placeholder="Optional remarks..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

      </div>

      {/* PO Summary Card */}
      {selectedPo && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex flex-wrap gap-6 text-sm">
          <div>
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-0.5">PO Number</p>
            <p className="font-mono font-bold text-blue-800">{selectedPo.po_number}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-0.5">Supplier</p>
            <p className="font-medium text-blue-800">{selectedPo.suppliers.name}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-0.5">Deliver To</p>
            <p className="font-medium text-blue-800">{selectedPo.inv_locations.name}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-0.5">Status</p>
            <p className="font-medium text-blue-800 capitalize">{selectedPo.status.replace('_', ' ')}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-0.5">Order Date</p>
            <p className="font-medium text-blue-800">{formatDate(selectedPo.order_date)}</p>
          </div>
        </div>
      )}

      {/* Line Items */}
      {poLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center mb-4">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-slate-400">Loading PO items...</p>
        </div>
      ) : lines.length > 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-4">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Items to Receive</h2>
            <button
              onClick={fillAllAccepted}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
              Fill All Remaining
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider min-w-56">Product</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Ordered</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Prev Rcvd</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Remaining</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Accepted Qty</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Rejected Qty</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Purchase Cost</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-36">Expiry Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Batch #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line, idx) => {
                  const acc = parseFloat(line.qty_accepted) || 0;
                  const exceedsRemaining = acc > line.qty_remaining;
                  const expiryDays = line.expiry_date ? daysUntilExpiry(line.expiry_date) : null;
                  const expiryLevel = expiryDays !== null ? expiryWarningLevel(expiryDays, line.near_expiry_days) : null;

                  return (
                    <tr key={line.po_item_id} className={`hover:bg-slate-50/50 ${exceedsRemaining ? 'bg-red-50/30' : ''}`}>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-800">{line.product_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-xs text-slate-400">{line.product_sku}</span>
                          {line.purchase_unit_code && <span className="text-xs text-slate-400">{line.purchase_unit_code}</span>}
                          {line.is_expiry_tracked && (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                              <Calendar className="w-3 h-3" />
                              Expiry
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          1 {line.purchase_unit_code || line.purchase_unit_name || 'unit'} = {line.qty_in_base_unit_per_purchase.toLocaleString(undefined, { maximumFractionDigits: 6 })} {line.base_unit_name || 'base'}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{line.qty_ordered.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{line.qty_prev_received.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`tabular-nums font-semibold ${line.qty_remaining > 0 ? 'text-amber-700' : 'text-slate-300'}`}>
                          {line.qty_remaining.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="space-y-1">
                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              value={line.qty_accepted}
                              onChange={e => updateLine(idx, 'qty_accepted', e.target.value)}
                              className={`w-full px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-right tabular-nums ${
                                exceedsRemaining
                                  ? 'border-red-300 bg-red-50 focus:ring-red-400'
                                  : 'border-slate-200'
                              }`}
                            />
                            {exceedsRemaining && (
                              <AlertTriangle className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-red-500 pointer-events-none" />
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 text-right">
                            {(acc * line.qty_in_base_unit_per_purchase).toLocaleString(undefined, { maximumFractionDigits: 6 })} {line.base_unit_name || 'base'}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={line.qty_rejected}
                          onChange={e => updateLine(idx, 'qty_rejected', e.target.value)}
                          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-right tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="space-y-1">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unit_cost}
                            onChange={e => updateLine(idx, 'unit_cost', e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-right tabular-nums"
                          />
                          <p className="text-[11px] text-slate-500 text-right">
                            ₱{((parseFloat(line.unit_cost) || 0) / (line.qty_in_base_unit_per_purchase || 1)).toFixed(2)} / {line.base_unit_name || 'base'}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {line.is_expiry_tracked ? (
                          <div>
                            <input
                              type="date"
                              value={line.expiry_date}
                              onChange={e => updateLine(idx, 'expiry_date', e.target.value)}
                              className={`w-full px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                (parseFloat(line.qty_accepted) || 0) > 0 && !line.expiry_date
                                  ? 'border-red-300 bg-red-50'
                                  : 'border-slate-200'
                              }`}
                            />
                            {expiryLevel === 'near' && expiryDays !== null && (
                              <div className="flex items-center gap-1 mt-0.5 text-amber-600">
                                <Clock className="w-3 h-3" />
                                <span className="text-xs">{expiryDays}d until expiry</span>
                              </div>
                            )}
                            {expiryLevel === 'expired' && (
                              <div className="flex items-center gap-1 mt-0.5 text-red-600">
                                <AlertTriangle className="w-3 h-3" />
                                <span className="text-xs">Already expired!</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">N/A</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {line.is_expiry_tracked ? (
                          <input
                            type="text"
                            value={line.batch_number}
                            onChange={e => updateLine(idx, 'batch_number', e.target.value)}
                            placeholder="Optional..."
                            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <span className="text-xs text-slate-300">N/A</span>
                        )}
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : header.po_id ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center mb-4">
          <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-600">All items on this PO have been fully received.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center mb-4">
          <Info className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">Select an approved purchase order to load items.</p>
        </div>
      )}

      {/* Warnings */}
      {overLimit && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">Some items exceed the remaining PO quantity and cannot be received.</p>
        </div>
      )}
      {missingExpiry && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <Calendar className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700">Expiry date is required for all expiry-tracked products with accepted quantity.</p>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="text-sm">
          {validLines.length > 0 ? (
            <span className="text-emerald-600">{validLines.length} item{validLines.length !== 1 ? 's' : ''} with quantities entered</span>
          ) : (
            <span className="text-slate-400">Enter accepted or rejected quantity to save</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            to={id ? `/inventory/receivings/${id}` : '/inventory/receivings'}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </Link>
          <button
            onClick={handleSave}
            disabled={saving || isEdit || !header.po_id || validLines.length === 0 || overLimit || missingExpiry}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Posting...' : isEdit ? 'Draft Locked' : 'Receive Goods'}
          </button>
        </div>
      </div>
    </div>
  );
}

