import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, ChevronDown, Search, X, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvProduct, InvLocation, Adjustment, AdjustmentItem, AdjustmentReason, AdjustmentDirection } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  ADJUSTMENT_REASON_LABELS,
  ADJUSTMENT_REASON_DEFAULT_DIRECTION,
  DIRECTION_LABELS,
  formatQty,
} from '../lib/adjustmentUtils';
import { generateUUID } from '../../lib/utils';

interface LineState {
  id: string;
  product_id: string;
  product: InvProduct | null;
  qty: string;
  unit_cost: string;
  notes: string;
  sort_order: number;
  existing_id?: string;
}

function newLine(sort_order: number): LineState {
  return {
    id: generateUUID(),
    product_id: '',
    product: null,
    qty: '',
    unit_cost: '',
    notes: '',
    sort_order,
  };
}

function ProductSearch({
  value,
  onSelect,
  locationId,
}: {
  value: InvProduct | null;
  onSelect: (p: InvProduct | null) => void;
  locationId: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(InvProduct & { qty_on_hand?: number })[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (term: string) => {
    if (!term.trim()) { setResults([]); return; }
    setLoading(true);
    const { data } = await supabase.rpc('search_products', {
      search: term.trim(),
      filter_active: 'active',
      filter_category: '',
      page: 1,
      page_size: 20,
    });
    const products = ((data ?? {}) as { products: InvProduct[] }).products ?? [];
    if (products.length > 0 && locationId) {
      const ids = (products as InvProduct[]).map(p => p.id);
      const { data: bals } = await supabase
        .from('inventory_balances')
        .select('product_id, qty_on_hand')
        .eq('location_id', locationId)
        .in('product_id', ids);
      const balMap = Object.fromEntries((bals ?? []).map((b: { product_id: string; qty_on_hand: number }) => [b.product_id, b.qty_on_hand]));
      setResults((products as InvProduct[]).map(p => ({ ...p, qty_on_hand: balMap[p.id] ?? 0 })));
    } else {
      setResults(products as InvProduct[]);
    }
    setLoading(false);
  }, [locationId]);

  useEffect(() => {
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
  }, [q, search]);

  if (value) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg bg-white min-h-[38px]">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{value.name}</p>
          <p className="text-xs text-slate-400 font-mono">{value.sku_code}</p>
        </div>
        <button type="button" onClick={() => onSelect(null)} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          type="text"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search product..."
          className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {open && (q.length > 0) && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {loading ? (
            <p className="px-3 py-2 text-xs text-slate-400">Searching...</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400">No products found</p>
          ) : results.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={() => { onSelect(p); setOpen(false); setQ(''); }}
              className="w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors border-b border-slate-100 last:border-0"
            >
              <p className="text-sm font-medium text-slate-800">{p.name}</p>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-slate-400 font-mono">{p.sku_code}</span>
                {locationId && (
                  <span className="text-xs text-slate-500">
                    On hand: <span className="font-semibold">{formatQty((p as InvProduct & { qty_on_hand?: number }).qty_on_hand ?? 0)}</span>
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdjustmentFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const isEdit = !!id;

  const [locationId, setLocationId] = useState('');
  const [adjustmentDate, setAdjustmentDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState<AdjustmentReason>('damaged');
  const [direction, setDirection] = useState<AdjustmentDirection>('deduct');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<LineState[]>([newLine(0)]);

  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    supabase.from('inv_locations').select('*').eq('is_active', true).order('name').then(({ data }) => {
      setLocations((data ?? []) as InvLocation[]);
    });
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    supabase
      .from('adjustments')
      .select('*, adjustment_items(*, inv_products(*, inv_units(code)))')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) { navigate('/inventory/adjustments'); return; }
        const adj = data as unknown as Adjustment & { adjustment_items: AdjustmentItem[] };
        setLocationId(adj.location_id);
        setAdjustmentDate(adj.adjustment_date);
        setReason(adj.reason);
        setDirection(adj.direction);
        setRemarks(adj.remarks);
        const existingLines: LineState[] = (adj.adjustment_items ?? [])
          .sort((a: AdjustmentItem, b: AdjustmentItem) => a.sort_order - b.sort_order)
          .map((item: AdjustmentItem, i: number) => ({
            id: generateUUID(),
            product_id: item.product_id,
            product: item.inv_products as unknown as InvProduct | null,
            qty: item.qty.toString(),
            unit_cost: item.unit_cost != null ? item.unit_cost.toString() : '',
            notes: item.notes,
            sort_order: i,
            existing_id: item.id,
          }));
        setLines(existingLines.length > 0 ? existingLines : [newLine(0)]);
        setLoading(false);
      });
  }, [id, isEdit, navigate]);

  function handleReasonChange(r: AdjustmentReason) {
    setReason(r);
    setDirection(ADJUSTMENT_REASON_DEFAULT_DIRECTION[r]);
  }

  function addLine() {
    setLines(prev => [...prev, newLine(prev.length)]);
  }

  function removeLine(lineId: string) {
    setLines(prev => prev.filter(l => l.id !== lineId));
  }

  function updateLine(lineId: string, patch: Partial<LineState>) {
    setLines(prev => prev.map(l => l.id === lineId ? { ...l, ...patch } : l));
  }

  function handleProductSelect(lineId: string, product: InvProduct | null) {
    updateLine(lineId, {
      product,
      product_id: product?.id ?? '',
      unit_cost: product?.cost_price != null ? product.cost_price.toString() : '',
    });
  }

  async function handleSave(submitForApproval = false) {
    if (!locationId) { showToast('Please select a location', 'error'); return; }
    if (!remarks.trim()) { showToast('Remarks are required', 'error'); return; }
    const validLines = lines.filter(l => l.product_id && parseFloat(l.qty) > 0);
    if (validLines.length === 0) { showToast('Add at least one product line', 'error'); return; }

    setSaving(true);
    try {
      const adjPayload = {
        location_id: locationId,
        adjustment_date: adjustmentDate,
        reason,
        direction,
        remarks: remarks.trim(),
        status: submitForApproval ? 'pending_approval' : 'draft',
        updated_by: user?.id ?? null,
      };

      let adjId = id;
      if (isEdit) {
        const { error } = await supabase.from('adjustments').update(adjPayload).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('adjustments').insert({
          ...adjPayload,
          created_by: user?.id ?? null,
        }).select('id').single();
        if (error) throw error;
        adjId = data.id;
      }

      if (isEdit) {
        const existingIds = lines.filter(l => l.existing_id).map(l => l.existing_id!);
        if (existingIds.length > 0) {
          const { data: currentItems, error: currentItemsError } = await supabase
            .from('adjustment_items')
            .select('id')
            .eq('adjustment_id', adjId);
          if (currentItemsError) throw currentItemsError;

          const deleteIds = (currentItems ?? [])
            .map((row: { id?: string | null }) => String(row.id ?? ''))
            .filter((itemId: string) => itemId && !existingIds.includes(itemId));

          for (const deleteId of deleteIds) {
            const { error: deleteError } = await supabase
              .from('adjustment_items')
              .delete()
              .eq('adjustment_id', adjId)
              .eq('id', deleteId);
            if (deleteError) throw deleteError;
          }
        } else {
          await supabase.from('adjustment_items').delete().eq('adjustment_id', adjId);
        }
      }

      const itemsPayload = validLines.map((l, i) => ({
        ...(l.existing_id ? { id: l.existing_id } : {}),
        adjustment_id: adjId,
        product_id: l.product_id,
        qty: parseFloat(l.qty),
        unit_cost: l.unit_cost ? parseFloat(l.unit_cost) : null,
        notes: l.notes.trim(),
        sort_order: i,
      }));

      const { error: itemErr } = await supabase.from('adjustment_items').upsert(itemsPayload);
      if (itemErr) throw itemErr;

      showToast(submitForApproval ? 'Submitted for approval' : 'Adjustment saved', 'success');
      navigate(`/inventory/adjustments/${adjId}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to save';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  const reasons = Object.entries(ADJUSTMENT_REASON_LABELS) as [AdjustmentReason, string][];

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link to="/inventory/adjustments" className="text-slate-400 hover:text-slate-600 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-800">{isEdit ? 'Edit Adjustment' : 'New Adjustment'}</h1>
          <p className="text-sm text-slate-500 mt-0.5">Correct stock levels with a reason and approval</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* Header fields */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Adjustment Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Location <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={locationId}
                  onChange={e => setLocationId(e.target.value)}
                  className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Select location...</option>
                  {locations.map(l => (
                    <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Adjustment Date
              </label>
              <input
                type="date"
                value={adjustmentDate}
                onChange={e => setAdjustmentDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Reason <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={reason}
                  onChange={e => handleReasonChange(e.target.value as AdjustmentReason)}
                  className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {reasons.map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Direction <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-3">
                {(['add', 'deduct'] as AdjustmentDirection[]).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg border transition-colors ${
                      direction === d
                        ? d === 'add'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-red-600 text-white border-red-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {DIRECTION_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Remarks <span className="text-red-500">*</span>
              </label>
              <textarea
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                rows={3}
                placeholder="Describe why this adjustment is needed..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Products</h2>
            <button
              type="button"
              onClick={addLine}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              <Plus className="w-4 h-4" />
              Add Product
            </button>
          </div>

          {!locationId && (
            <div className="px-5 py-4 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border-b border-amber-100">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Select a location to see current stock levels alongside products.
            </div>
          )}

          <div className="divide-y divide-slate-100">
            {lines.map((line, idx) => (
              <div key={line.id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 text-xs font-semibold text-slate-400 mt-2.5">{idx + 1}</div>

                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-3">
                    {/* Product */}
                    <div className="sm:col-span-5">
                      <label className="block text-xs text-slate-500 mb-1">Product</label>
                      <ProductSearch
                        value={line.product}
                        onSelect={p => handleProductSelect(line.id, p)}
                        locationId={locationId}
                      />
                    </div>

                    {/* Qty */}
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-slate-500 mb-1">Qty</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={line.qty}
                        onChange={e => updateLine(line.id, { qty: e.target.value })}
                        placeholder="0"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-right"
                      />
                    </div>

                    {/* Unit cost */}
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-slate-500 mb-1">Unit Cost</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={line.unit_cost}
                        onChange={e => updateLine(line.id, { unit_cost: e.target.value })}
                        placeholder="0.00"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-right"
                      />
                    </div>

                    {/* Notes */}
                    <div className="sm:col-span-3">
                      <label className="block text-xs text-slate-500 mb-1">Notes</label>
                      <input
                        type="text"
                        value={line.notes}
                        onChange={e => updateLine(line.id, { notes: e.target.value })}
                        placeholder="Optional note..."
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    disabled={lines.length === 1}
                    className="flex-shrink-0 mt-2.5 text-slate-300 hover:text-red-500 transition-colors disabled:opacity-30"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Link to="/inventory/adjustments" className="text-sm text-slate-500 hover:text-slate-700">
            Cancel
          </Link>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              Save Draft
            </button>
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Submit for Approval
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
