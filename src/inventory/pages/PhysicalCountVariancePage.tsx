import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Printer, TrendingUp, TrendingDown, Minus,
  AlertCircle, CheckCircle2, BarChart3,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PhysicalCount, PhysicalCountItem } from '../../lib/types';
import {
  PC_STATUS_LABELS,
  PC_STATUS_COLORS,
  formatDate,
  formatQty,
  formatCurrency,
  varianceClass,
  varianceSign,
} from '../lib/physicalCountUtils';

interface EnrichedItem extends PhysicalCountItem {
  variance: number;
  variance_value: number;
  product_name: string;
  product_sku: string;
  product_unit: string;
  product_category: string;
}

export default function PhysicalCountVariancePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [count, setCount] = useState<PhysicalCount | null>(null);
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showVarianceOnly, setShowVarianceOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'variance' | 'value'>('variance');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data } = await supabase
      .from('physical_counts')
      .select(`
        *,
        inv_locations(id, name, code),
        creator:created_by(name),
        poster:posted_by(name),
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

    const enriched: EnrichedItem[] = (c.physical_count_items ?? [])
      .sort((a: PhysicalCountItem, b: PhysicalCountItem) => a.sort_order - b.sort_order)
      .map((item: PhysicalCountItem) => {
        const p = item.inv_products as unknown as {
          name: string; sku_code: string;
          inv_units?: { code: string };
          inv_categories?: { name: string };
        } | undefined;
        const variance = item.counted_qty != null ? item.counted_qty - item.system_qty : 0;
        const variance_value = item.unit_cost != null ? Math.abs(variance) * item.unit_cost : 0;
        return {
          ...item,
          variance,
          variance_value,
          product_name: p?.name ?? '',
          product_sku: p?.sku_code ?? '',
          product_unit: p?.inv_units?.code ?? '',
          product_category: p?.inv_categories?.name ?? '',
        };
      });

    setItems(enriched);
    setLoading(false);
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(() => {
    const base = showVarianceOnly ? items.filter(i => i.variance !== 0) : items;
    return [...base].sort((a, b) => {
      let diff = 0;
      if (sortBy === 'name') diff = a.product_name.localeCompare(b.product_name);
      else if (sortBy === 'variance') diff = a.variance - b.variance;
      else if (sortBy === 'value') diff = a.variance_value - b.variance_value;
      return sortDir === 'desc' ? -diff : diff;
    });
  }, [items, showVarianceOnly, sortBy, sortDir]);

  function toggleSort(col: typeof sortBy) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  }

  const stats = useMemo(() => {
    const counted = items.filter(i => i.counted_qty != null);
    const withVar = counted.filter(i => i.variance !== 0);
    const overages = withVar.filter(i => i.variance > 0);
    const shortages = withVar.filter(i => i.variance < 0);
    const totalOverageQty = overages.reduce((s, i) => s + i.variance, 0);
    const totalShortageQty = shortages.reduce((s, i) => s + i.variance, 0);
    const totalOverageValue = overages.reduce((s, i) => s + i.variance_value, 0);
    const totalShortageValue = shortages.reduce((s, i) => s + i.variance_value, 0);
    const netVarianceValue = items.reduce((s, i) => s + (i.unit_cost != null ? i.variance * i.unit_cost : 0), 0);
    return { counted: counted.length, withVar: withVar.length, overages: overages.length, shortages: shortages.length, totalOverageQty, totalShortageQty, totalOverageValue, totalShortageValue, netVarianceValue };
  }, [items]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!count) return null;
  const loc = count.inv_locations as unknown as { name: string; code: string } | undefined;
  const poster = count.poster as unknown as { name: string } | undefined;

  const isPosted = count.status === 'posted';

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-show { display: block !important; }
          body { font-size: 11px; }
        }
        .print-show { display: none; }
      `}</style>

      <div className="p-6 max-w-screen-2xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6 no-print">
          <Link to="/inventory/physical-counts" className="text-slate-400 hover:text-slate-600 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-slate-800 font-mono">{count.count_number}</h1>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${PC_STATUS_COLORS[count.status].bg} ${PC_STATUS_COLORS[count.status].text} ${PC_STATUS_COLORS[count.status].border}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${PC_STATUS_COLORS[count.status].dot}`} />
                {PC_STATUS_LABELS[count.status]}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {loc ? `[${loc.code}] ${loc.name}` : '—'} &middot; {formatDate(count.count_date)}
              {poster && ` &middot; Posted by ${poster.name} on ${formatDate(count.posted_at)}`}
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>

        {/* Print title */}
        <div className="print-show mb-6">
          <h2 className="text-lg font-bold">Variance Report — {count.count_number}</h2>
          <p className="text-sm mt-1">Location: {loc ? `[${loc.code}] ${loc.name}` : '—'} &nbsp;|&nbsp; Date: {formatDate(count.count_date)}</p>
          {poster && <p className="text-sm mt-1">Posted by: {poster.name} on {formatDate(count.posted_at)}</p>}
        </div>

        {/* Not yet posted notice */}
        {!isPosted && (
          <div className="mb-6 flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl no-print">
            <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <p className="text-sm text-amber-700">
              This count has not been posted yet. Variance data is preliminary and may change.
            </p>
            <Link
              to={`/inventory/physical-counts/${count.id}/sheet`}
              className="ml-auto text-sm font-medium text-amber-700 underline"
            >
              Go to Count Sheet
            </Link>
          </div>
        )}

        {/* Summary stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Products Counted</p>
              <CheckCircle2 className="w-5 h-5 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-slate-800">{stats.counted}</p>
            <p className="text-xs text-slate-400 mt-1">of {items.length} total</p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">With Variance</p>
              <BarChart3 className="w-5 h-5 text-slate-400" />
            </div>
            <p className={`text-2xl font-bold ${stats.withVar > 0 ? 'text-red-600' : 'text-slate-800'}`}>{stats.withVar}</p>
            <p className="text-xs text-slate-400 mt-1">{stats.overages} over &middot; {stats.shortages} short</p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Overage</p>
              <TrendingUp className="w-5 h-5 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold text-emerald-700">+{formatQty(stats.totalOverageQty)}</p>
            {stats.totalOverageValue > 0 && (
              <p className="text-xs text-emerald-600 mt-1">≈ {formatCurrency(stats.totalOverageValue)}</p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Shortage</p>
              <TrendingDown className="w-5 h-5 text-red-500" />
            </div>
            <p className="text-2xl font-bold text-red-700">{formatQty(stats.totalShortageQty)}</p>
            {stats.totalShortageValue > 0 && (
              <p className="text-xs text-red-600 mt-1">≈ {formatCurrency(stats.totalShortageValue)}</p>
            )}
          </div>
        </div>

        {/* Net variance value */}
        {stats.netVarianceValue !== 0 && (
          <div className={`mb-5 flex items-center gap-4 p-4 rounded-xl border ${
            stats.netVarianceValue > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
          }`}>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Net Variance Value</p>
              <p className={`text-2xl font-bold mt-0.5 ${stats.netVarianceValue > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {stats.netVarianceValue > 0 ? '+' : ''}{formatCurrency(stats.netVarianceValue)}
              </p>
            </div>
            <p className="text-sm text-slate-500 ml-4">
              {stats.netVarianceValue > 0
                ? 'More stock found than expected'
                : 'Less stock found than expected'}
            </p>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-4 mb-3 no-print">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setShowVarianceOnly(v => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${showVarianceOnly ? 'bg-blue-600' : 'bg-slate-200'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showVarianceOnly ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm text-slate-600 font-medium">Show variances only</span>
          </label>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-8">#</th>
                  <th
                    className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-600 select-none"
                    onClick={() => toggleSort('name')}
                  >
                    Product {sortBy === 'name' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">Category</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">System Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Counted Qty</th>
                  <th
                    className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-600 select-none"
                    onClick={() => toggleSort('variance')}
                  >
                    Variance {sortBy === 'variance' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-600 select-none"
                    onClick={() => toggleSort('value')}
                  >
                    Variance Value {sortBy === 'value' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider no-print">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((item, idx) => {
                  const isOver = item.variance > 0;
                  const isShort = item.variance < 0;
                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        isOver ? 'bg-emerald-50/40 hover:bg-emerald-50' :
                        isShort ? 'bg-red-50/40 hover:bg-red-50' :
                        'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-4 py-2.5 text-xs text-slate-400">{idx + 1}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-800 leading-tight">{item.product_name}</p>
                        <p className="text-xs text-slate-400 font-mono">{item.product_sku}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500 hidden md:table-cell">{item.product_category || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-700">
                        {formatQty(item.system_qty)}
                        <span className="text-xs text-slate-400 ml-1">{item.product_unit}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-700">
                        {item.counted_qty != null ? formatQty(item.counted_qty) : <span className="text-slate-300">—</span>}
                        {item.counted_qty != null && <span className="text-xs text-slate-400 ml-1">{item.product_unit}</span>}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono ${varianceClass(item.variance)}`}>
                        <div className="flex items-center justify-end gap-1">
                          {isOver ? <TrendingUp className="w-3.5 h-3.5 text-emerald-500" /> :
                           isShort ? <TrendingDown className="w-3.5 h-3.5 text-red-500" /> :
                           <Minus className="w-3.5 h-3.5 text-slate-300" />}
                          {varianceSign(item.variance)}{formatQty(item.variance)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-600 text-xs">
                        {item.variance_value > 0 ? formatCurrency(item.variance_value) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500 no-print">{item.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400 no-print">
            {sorted.length} row{sorted.length !== 1 ? 's' : ''} shown
          </div>
        </div>
      </div>
    </>
  );
}
