import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calendar, ClipboardList } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatDate, formatQty } from '../lib/adjustmentUtils';

interface AdjRow {
  id: string;
  adj_number: string;
  adj_date: string;
  adj_type: string;
  reason: string;
  location_id: string;
  created_by: string | null;
}

interface AdjItemRow {
  id: string;
  adjustment_id: string;
  product_id: string;
  qty_before: number;
  qty_adjusted: number;
  qty_after: number;
}

interface SummaryLine {
  id: string;
  adjustmentId: string;
  adjustmentNumber: string;
  adjustmentDate: string;
  reasonLabel: string;
  locationName: string;
  createdBy: string;
  productName: string;
  skuCode: string;
  qtyBefore: number;
  qtyChange: number;
  qtyAfter: number;
  remarks: string;
}

export default function AdjustmentDailySummaryPage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [lines, setLines] = useState<SummaryLine[]>([]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      let adjustmentsQuery = supabase
        .from('adjustments')
        .select('id, adj_number, adj_date, adj_type, reason, location_id, created_by')
        .eq('status', 'posted')
        .order('adj_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (dateFrom) adjustmentsQuery = adjustmentsQuery.gte('adj_date', dateFrom);
      if (dateTo) adjustmentsQuery = adjustmentsQuery.lte('adj_date', dateTo);

      const { data: adjustmentRows, error: adjustmentError } = await adjustmentsQuery;
      if (adjustmentError) throw adjustmentError;

      const adjustments = (adjustmentRows ?? []) as AdjRow[];
      if (adjustments.length === 0) {
        setLines([]);
        setLoading(false);
        return;
      }

      const adjustmentIds = adjustments.map(r => r.id);
      const locationIds = [...new Set(adjustments.map(r => r.location_id).filter(Boolean))];
      const userIds = [...new Set(adjustments.map(r => r.created_by).filter(Boolean))] as string[];

      const [
        { data: itemRows, error: itemError },
        { data: locationRows },
        { data: userRows },
      ] = await Promise.all([
        supabase.from('adjustment_items')
          .select('id, adjustment_id, product_id, qty_before, qty_adjusted, qty_after')
          .in('adjustment_id', adjustmentIds),
        locationIds.length
          ? supabase.from('inv_locations').select('id, name').in('id', locationIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        userIds.length
          ? supabase.from('profiles').select('id, name').in('id', userIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);

      if (itemError) throw itemError;

      const items = (itemRows ?? []) as AdjItemRow[];
      const productIds = [...new Set(items.map(i => i.product_id).filter(Boolean))];

      const { data: productRows } = productIds.length
        ? await supabase.from('inv_products').select('id, name, sku_code').in('id', productIds)
        : { data: [] as { id: string; name: string; sku_code: string }[] };

      const locationMap = new Map(((locationRows ?? []) as { id: string; name: string }[]).map(r => [r.id, r.name]));
      const userMap = new Map(((userRows ?? []) as { id: string; name: string }[]).map(r => [r.id, r.name]));
      const productMap = new Map(((productRows ?? []) as { id: string; name: string; sku_code: string }[]).map(r => [r.id, r]));
      const adjustmentMap = new Map(adjustments.map(r => [r.id, r]));

      const builtLines: SummaryLine[] = items.map(item => {
        const adj = adjustmentMap.get(item.adjustment_id);
        const product = productMap.get(item.product_id);
        const qtyChange = Number(item.qty_adjusted ?? 0);

        return {
          id: item.id,
          adjustmentId: adj?.id ?? '',
          adjustmentNumber: adj?.adj_number ?? '—',
          adjustmentDate: adj?.adj_date ?? '',
          reasonLabel: adj?.reason || adj?.adj_type?.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || '—',
          locationName: locationMap.get(adj?.location_id ?? '') ?? '—',
          createdBy: userMap.get(adj?.created_by ?? '') ?? 'System',
          productName: product?.name ?? '—',
          skuCode: product?.sku_code ?? '',
          qtyBefore: Number(item.qty_before ?? 0),
          qtyChange,
          qtyAfter: Number(item.qty_after ?? 0),
          remarks: adj?.reason || '—',
        };
      });

      setLines(builtLines);
    } catch (error) {
      const err = error as { message?: string };
      showToast(err.message ?? 'Failed to load adjustment summary', 'error');
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, showToast]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const filteredLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(line => (
      line.adjustmentNumber.toLowerCase().includes(q)
      || line.productName.toLowerCase().includes(q)
      || line.skuCode.toLowerCase().includes(q)
      || line.locationName.toLowerCase().includes(q)
      || line.remarks.toLowerCase().includes(q)
    ));
  }, [lines, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, {
      date: string;
      adjustments: Set<string>;
      itemsCount: number;
      totalIncrease: number;
      totalDecrease: number;
      rows: SummaryLine[];
    }>();

    for (const line of filteredLines) {
      const key = String(line.adjustmentDate || '').slice(0, 10);
      if (!map.has(key)) {
        map.set(key, {
          date: key,
          adjustments: new Set<string>(),
          itemsCount: 0,
          totalIncrease: 0,
          totalDecrease: 0,
          rows: [],
        });
      }

      const group = map.get(key)!;
      group.adjustments.add(line.adjustmentId);
      group.itemsCount += 1;
      if (line.qtyChange >= 0) group.totalIncrease += line.qtyChange;
      else group.totalDecrease += Math.abs(line.qtyChange);
      group.rows.push(line);
    }

    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredLines]);

  const totals = useMemo(() => ({
    days: grouped.length,
    adjustments: new Set(filteredLines.map(line => line.adjustmentId)).size,
    items: filteredLines.length,
  }), [filteredLines, grouped]);

  return (
    <div className="p-6 max-w-screen-2xl">
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <Link to="/inventory/adjustments" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors mb-2">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Adjustments
          </Link>
          <h1 className="text-xl font-bold text-slate-800">Daily Adjustment Summary</h1>
          <p className="text-sm text-slate-500 mt-0.5">Grouped by day with inventory before, change, and current balance</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Days</p>
          <p className="text-2xl font-bold text-slate-800 mt-2">{totals.days}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Adjustments</p>
          <p className="text-2xl font-bold text-slate-800 mt-2">{totals.adjustments}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Items Changed</p>
          <p className="text-2xl font-bold text-slate-800 mt-2">{totals.items}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-5">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-56">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Search</label>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Product, SKU, adjustment #, remarks..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
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
          {(dateFrom || dateTo || search) && (
            <button
              onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); }}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm py-16 text-center">
          <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading summary...</p>
        </div>
      ) : grouped.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm py-16 text-center">
          <ClipboardList className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">No posted adjustments found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(group => (
            <div key={group.date} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-500" />
                    {formatDate(group.date)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {group.adjustments.size} adjustment{group.adjustments.size !== 1 ? 's' : ''} • {group.itemsCount} item change{group.itemsCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Added: {formatQty(group.totalIncrease)}
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
                    Deducted: {formatQty(group.totalDecrease)}
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white border-b border-slate-100">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Adjustment</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Product</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Location</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Before</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Change</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">After</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {group.rows.map(line => (
                      <tr key={line.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 align-top">
                          <Link to={`/inventory/adjustments/${line.adjustmentId}`} className="font-mono font-semibold text-blue-700 hover:underline">
                            {line.adjustmentNumber}
                          </Link>
                          <p className="text-xs text-slate-400 mt-1">{line.reasonLabel}</p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <p className="font-medium text-slate-800">{line.productName}</p>
                          <p className="text-xs text-slate-400 font-mono">{line.skuCode || '—'}</p>
                        </td>
                        <td className="px-4 py-3 align-top text-slate-600">{line.locationName}</td>
                        <td className="px-4 py-3 align-top text-right font-mono text-slate-700">{formatQty(line.qtyBefore)}</td>
                        <td className={`px-4 py-3 align-top text-right font-mono font-semibold ${line.qtyChange >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {line.qtyChange >= 0 ? '+' : ''}{formatQty(line.qtyChange)}
                        </td>
                        <td className="px-4 py-3 align-top text-right font-mono text-slate-800 font-semibold">{formatQty(line.qtyAfter)}</td>
                        <td className="px-4 py-3 align-top">
                          <p className="text-slate-600 text-xs max-w-md">{line.remarks}</p>
                          <p className="text-[11px] text-slate-400 mt-1">by {line.createdBy}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
