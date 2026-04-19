import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Printer, Search, X, Save, CheckCircle2,
  FileCheck2, AlertCircle, Filter,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PhysicalCount, PhysicalCountItem, PhysicalCountStatus } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  PC_STATUS_LABELS,
  PC_STATUS_COLORS,
  formatDate,
  formatQty,
  varianceClass,
  varianceSign,
} from '../lib/physicalCountUtils';

type CountedFilter = 'all' | 'counted' | 'uncounted' | 'variance';

interface ItemState extends PhysicalCountItem {
  dirty?: boolean;
  product_name?: string;
  product_sku?: string;
  product_unit?: string;
  product_category?: string;
}

function StatusBadge({ status }: { status: PhysicalCountStatus }) {
  const c = PC_STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {PC_STATUS_LABELS[status]}
    </span>
  );
}

export default function PhysicalCountSheetPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [count, setCount] = useState<PhysicalCount | null>(null);
  const [items, setItems] = useState<ItemState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);

  const [search, setSearch] = useState('');
  const [countedFilter, setCountedFilter] = useState<CountedFilter>('all');
  const [dirtyCount, setDirtyCount] = useState(0);

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data } = await supabase
      .from('physical_counts')
      .select(`
        *,
        inv_locations(id, name, code),
        creator:created_by(name),
        physical_count_items(
          *,
          inv_products(id, name, sku_code, cost_price, inv_units(code), inv_categories(name))
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (!data) { navigate('/inventory/physical-counts'); return; }

    const c = data as unknown as PhysicalCount & { physical_count_items: PhysicalCountItem[] };
    setCount(c);

    const mapped: ItemState[] = (c.physical_count_items ?? [])
      .sort((a: PhysicalCountItem, b: PhysicalCountItem) => a.sort_order - b.sort_order)
      .map((item: PhysicalCountItem) => {
        const p = item.inv_products as unknown as {
          name: string; sku_code: string;
          inv_units?: { code: string };
          inv_categories?: { name: string };
        } | undefined;
        return {
          ...item,
          product_name: p?.name ?? '',
          product_sku: p?.sku_code ?? '',
          product_unit: p?.inv_units?.code ?? '',
          product_category: p?.inv_categories?.name ?? '',
        };
      });

    setItems(mapped);
    setLoading(false);
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  function handleQtyChange(itemId: string, val: string) {
    setItems(prev => prev.map(i => {
      if (i.id !== itemId) return i;
      const counted_qty = val === '' ? null : parseFloat(val);
      return { ...i, counted_qty, dirty: true };
    }));
    setDirtyCount(prev => prev + 1);
  }

  function handleNotesChange(itemId: string, val: string) {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, notes: val, dirty: true } : i));
    setDirtyCount(prev => prev + 1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number, filteredItems: ItemState[]) {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = filteredItems[index + 1];
      if (next) inputRefs.current.get(next.id)?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = filteredItems[index - 1];
      if (prev) inputRefs.current.get(prev.id)?.focus();
    }
  }

  async function handleSave() {
    const dirty = items.filter(i => i.dirty);
    if (dirty.length === 0) { showToast('No changes to save', 'info'); return; }
    setSaving(true);
    try {
      for (const item of dirty) {
        await supabase
          .from('physical_count_items')
          .update({
            counted_qty: item.counted_qty,
            notes: item.notes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);
      }
      setItems(prev => prev.map(i => ({ ...i, dirty: false })));
      setDirtyCount(0);
      showToast(`Saved ${dirty.length} item${dirty.length !== 1 ? 's' : ''}`, 'success');
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkCounted() {
    if (dirtyCount > 0) {
      showToast('Please save changes before marking as counted', 'error');
      return;
    }
    const uncounted = items.filter(i => i.counted_qty === null).length;
    if (uncounted > 0) {
      const ok = confirm(`${uncounted} item${uncounted !== 1 ? 's have' : ' has'} not been counted yet. Mark as counted anyway?`);
      if (!ok) return;
    }
    const { error } = await supabase
      .from('physical_counts')
      .update({ status: 'counted', updated_by: user?.id })
      .eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Status updated to Counted', 'success');
    await load();
  }

  async function handlePost() {
    if (!count) return;
    if (dirtyCount > 0) {
      showToast('Please save changes before posting', 'error');
      return;
    }
    if (!confirm('Post this count? Inventory will be updated for all variances. This cannot be undone.')) return;

    setPosting(true);
    try {
      const variances = items.filter(i => i.counted_qty != null && i.counted_qty !== i.system_qty);

      for (const item of variances) {
        if (item.counted_qty == null) continue;
        const qtyChange = item.counted_qty - item.system_qty;
        const movType = qtyChange > 0 ? 'adjustment_add' : 'adjustment_deduct';

        const { data: mov, error: movErr } = await supabase
          .from('inventory_movements')
          .insert({
            product_id: item.product_id,
            location_id: count.location_id,
            movement_type: movType,
            qty_change: qtyChange,
            qty_before: item.system_qty,
            qty_after: item.counted_qty,
            unit_cost: item.unit_cost,
            ref_number: count.count_number,
            notes: `Physical count — ${item.notes || 'no notes'}`,
            created_by: user?.id ?? null,
          })
          .select('id')
          .single();

        if (movErr) throw movErr;

        const { data: bal } = await supabase
          .from('inventory_balances')
          .select('qty_available')
          .eq('product_id', item.product_id)
          .eq('location_id', count.location_id)
          .maybeSingle();

        if (bal) {
          const availableAdj = (bal.qty_available ?? item.system_qty) + qtyChange;
          await supabase.from('inventory_balances').update({
            qty_on_hand: item.counted_qty,
            qty_available: availableAdj,
            last_movement_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('product_id', item.product_id).eq('location_id', count.location_id);
        } else {
          await supabase.from('inventory_balances').insert({
            product_id: item.product_id,
            location_id: count.location_id,
            qty_on_hand: item.counted_qty,
            qty_available: item.counted_qty,
            last_movement_at: new Date().toISOString(),
          });
        }

        await supabase.from('physical_count_items').update({ movement_id: mov.id }).eq('id', item.id);
      }

      await supabase.from('physical_counts').update({
        status: 'posted',
        posted_by: user?.id,
        posted_at: new Date().toISOString(),
        updated_by: user?.id,
      }).eq('id', count.id);

      showToast(`Posted — ${variances.length} variance${variances.length !== 1 ? 's' : ''} applied`, 'success');
      navigate(`/inventory/physical-counts/${count.id}/variance`);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to post', 'error');
    } finally {
      setPosting(false);
    }
  }

  async function handleCancel() {
    if (!confirm('Cancel this count session?')) return;
    await supabase.from('physical_counts').update({ status: 'cancelled', updated_by: user?.id }).eq('id', id);
    showToast('Count session cancelled', 'success');
    navigate('/inventory/physical-counts');
  }

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchSearch = !search || (
        item.product_name?.toLowerCase().includes(search.toLowerCase()) ||
        item.product_sku?.toLowerCase().includes(search.toLowerCase()) ||
        item.product_category?.toLowerCase().includes(search.toLowerCase())
      );
      const variance = item.counted_qty != null ? item.counted_qty - item.system_qty : null;
      const matchFilter =
        countedFilter === 'all' ? true :
        countedFilter === 'counted' ? item.counted_qty != null :
        countedFilter === 'uncounted' ? item.counted_qty == null :
        countedFilter === 'variance' ? (variance != null && variance !== 0) : true;
      return matchSearch && matchFilter;
    });
  }, [items, search, countedFilter]);

  const progress = items.length > 0 ? items.filter(i => i.counted_qty != null).length : 0;
  const progressPct = items.length > 0 ? Math.round((progress / items.length) * 100) : 0;
  const varCount = items.filter(i => i.counted_qty != null && i.counted_qty !== i.system_qty).length;
  const isReadonly = count?.status === 'posted' || count?.status === 'cancelled';

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!count) return null;
  const loc = count.inv_locations as unknown as { name: string; code: string } | undefined;

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { font-size: 11px; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="p-4 max-w-screen-2xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-4 no-print">
          <Link to="/inventory/physical-counts" className="text-slate-400 hover:text-slate-600 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-slate-800 font-mono">{count.count_number}</h1>
              <StatusBadge status={count.status} />
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {loc ? `[${loc.code}] ${loc.name}` : '—'} &middot; {formatDate(count.count_date)}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end no-print">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>

            {!isReadonly && dirtyCount > 0 && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                Save ({dirtyCount})
              </button>
            )}

            {count.status === 'draft' && (
              <button
                onClick={handleMarkCounted}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                Mark Counted
              </button>
            )}

            {count.status === 'counted' && (
              <button
                onClick={handlePost}
                disabled={posting}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors disabled:opacity-50"
              >
                {posting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <FileCheck2 className="w-4 h-4" />}
                Post Count
              </button>
            )}

            {(count.status === 'draft' || count.status === 'counted') && (
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
              >
                Cancel
              </button>
            )}

            {count.status === 'posted' && (
              <Link
                to={`/inventory/physical-counts/${count.id}/variance`}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
              >
                View Variance Report
              </Link>
            )}
          </div>
        </div>

        {/* Print header */}
        <div className="print-only mb-6">
          <h2 className="text-lg font-bold">Physical Count Sheet — {count.count_number}</h2>
          <p className="text-sm mt-1">Location: {loc ? `[${loc.code}] ${loc.name}` : '—'} &nbsp;|&nbsp; Date: {formatDate(count.count_date)}</p>
          {count.remarks && <p className="text-sm mt-1">Remarks: {count.remarks}</p>}
        </div>

        {/* Progress bar */}
        {!isReadonly && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 no-print">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xs text-slate-500 font-medium">Progress</p>
                  <p className="text-lg font-bold text-slate-800">{progress} / {items.length}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">Variances</p>
                  <p className={`text-lg font-bold ${varCount > 0 ? 'text-red-600' : 'text-slate-800'}`}>{varCount}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">Unsaved</p>
                  <p className={`text-lg font-bold ${dirtyCount > 0 ? 'text-amber-600' : 'text-slate-800'}`}>{dirtyCount}</p>
                </div>
              </div>
              <p className="text-2xl font-bold text-slate-700">{progressPct}%</p>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4 no-print">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search product name, SKU, category..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1">
            {(['all', 'counted', 'uncounted', 'variance'] as CountedFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setCountedFilter(f)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
                  countedFilter === f
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {f === 'variance' ? 'With Variance' : f}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <span>{filteredItems.length} of {items.length} shown</span>
          </div>
        </div>

        {/* Count sheet table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-8">#</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Product</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">Category</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">System Qty</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    {isReadonly ? 'Counted Qty' : (
                      <span className="text-blue-600">Counted Qty *</span>
                    )}
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Variance</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider no-print">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">No items match the current filter</td>
                  </tr>
                ) : filteredItems.map((item, idx) => {
                  const variance = item.counted_qty != null ? item.counted_qty - item.system_qty : null;
                  const hasVariance = variance != null && variance !== 0;
                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        item.dirty ? 'bg-amber-50' :
                        hasVariance ? 'bg-red-50/50' :
                        item.counted_qty != null ? 'bg-emerald-50/30' :
                        'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-3 py-2 text-xs text-slate-400">{idx + 1}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-800 leading-tight">{item.product_name}</p>
                        <p className="text-xs text-slate-400 font-mono">{item.product_sku}</p>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500 hidden md:table-cell">{item.product_category || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">
                        {formatQty(item.system_qty)}
                        <span className="text-xs text-slate-400 ml-1">{item.product_unit}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isReadonly ? (
                          <span className={`font-mono font-medium ${item.counted_qty == null ? 'text-slate-400' : 'text-slate-800'}`}>
                            {formatQty(item.counted_qty)}
                            <span className="text-xs text-slate-400 ml-1">{item.product_unit}</span>
                          </span>
                        ) : (
                          <input
                            ref={el => { if (el) inputRefs.current.set(item.id, el); }}
                            type="number"
                            min="0"
                            step="any"
                            value={item.counted_qty ?? ''}
                            onChange={e => handleQtyChange(item.id, e.target.value)}
                            onKeyDown={e => handleKeyDown(e, idx, filteredItems)}
                            placeholder="—"
                            className={`w-28 px-2 py-1 text-sm text-right rounded border focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono ${
                              item.dirty ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
                            }`}
                          />
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono text-sm ${varianceClass(variance)}`}>
                        {variance != null ? `${varianceSign(variance)}${formatQty(variance)}` : '—'}
                      </td>
                      <td className="px-3 py-2 no-print">
                        {isReadonly ? (
                          <span className="text-xs text-slate-500">{item.notes || '—'}</span>
                        ) : (
                          <input
                            type="text"
                            value={item.notes}
                            onChange={e => handleNotesChange(item.id, e.target.value)}
                            placeholder="Note..."
                            className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400 no-print">
            <span>{items.length} total products &middot; {progress} counted &middot; {varCount} with variance</span>
            {!isReadonly && dirtyCount > 0 && (
              <span className="text-amber-600 font-medium">{dirtyCount} unsaved change{dirtyCount !== 1 ? 's' : ''}</span>
            )}
          </div>

          {/* Print footer */}
          <div className="print-only px-4 py-4 border-t">
            <div className="grid grid-cols-3 gap-8 mt-6">
              <div>
                <p className="text-xs font-semibold">Counted by:</p>
                <div className="mt-8 border-t border-black pt-1"><p className="text-xs">Signature over printed name</p></div>
              </div>
              <div>
                <p className="text-xs font-semibold">Verified by:</p>
                <div className="mt-8 border-t border-black pt-1"><p className="text-xs">Signature over printed name</p></div>
              </div>
              <div>
                <p className="text-xs font-semibold">Approved by:</p>
                <div className="mt-8 border-t border-black pt-1"><p className="text-xs">Signature over printed name</p></div>
              </div>
            </div>
          </div>
        </div>

        {/* Unsaved reminder */}
        {!isReadonly && dirtyCount > 0 && (
          <div className="mt-4 flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl no-print">
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <p className="text-sm text-amber-700">
              You have {dirtyCount} unsaved change{dirtyCount !== 1 ? 's' : ''}.
            </p>
            <button
              onClick={handleSave}
              disabled={saving}
              className="ml-auto px-3 py-1.5 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
            >
              Save Now
            </button>
          </div>
        )}
      </div>
    </>
  );
}
