import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calendar, ClipboardList } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { ADJUSTMENT_REASON_LABELS, formatDate, formatQty } from '../lib/adjustmentUtils';

interface AdjustmentRow {
  id: string;
  adjustment_number: string;
  adjustment_date: string;
  reason: keyof typeof ADJUSTMENT_REASON_LABELS;
  direction: 'add' | 'deduct';
  remarks: string;
  created_at: string;
  inv_locations?: { name?: string; code?: string } | null;
  creator?: { name?: string } | null;
}

interface AdjustmentItemRow {
  id: string;
  adjustment_id: string;
  qty?: number;
  notes?: string;
  movement_id?: string | null;
  inv_products?: { name?: string; sku_code?: string } | null;
}

interface MovementRow {
  id: string;
  qty_before: number;
  qty_change: number;
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
        .select(`
          id,
          adjustment_number,
          adjustment_date,
          reason,
          direction,
          remarks,
          created_at,
          inv_locations(name, code),
          creator:created_by(name)
        `)
        .eq('status', 'posted')
        .order('adjustment_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (dateFrom) adjustmentsQuery = adjustmentsQuery.gte('adjustment_date', dateFrom);
      if (dateTo) adjustmentsQuery = adjustmentsQuery.lte('adjustment_date', dateTo);

      const { data: adjustmentRows, error: adjustmentError } = await adjustmentsQuery;
      if (adjustmentError) throw adjustmentError;

      const adjustments = (adjustmentRows ?? []) as unknown as AdjustmentRow[];
      if (adjustments.length === 0) {
        setLines([]);
        setLoading(false);
        return;
      }

      const adjustmentIds = adjustments.map(row => row.id);
      const { data: itemRows, error: itemError } = await supabase
        .from('adjustment_items')
        .select('id, adjustment_id, qty, notes, movement_id, inv_products(name, sku_code)')
        .in('adjustment_id', adjustmentIds)
        .order('created_at', { ascending: false });

      if (itemError) throw itemError;

      const items = (itemRows ?? []) as unknown as AdjustmentItemRow[];
      const movementIds = items.map(item => item.movement_id).filter(Boolean) as string[];

      let movementMap = new Map<string, MovementRow>();
      if (movementIds.length > 0) {
        const { data: movementRows, error: movementError } = await supabase
          .from('inventory_movements')
          .select('id, qty_before, qty_change, qty_after')
          .in('id', movementIds);

        if (movementError) throw movementError;

        movementMap = new Map(
          ((movementRows ?? []) as MovementRow[]).map(row => [row.id, row])
        );
      }

      const adjustmentMap = new Map(adjustments.map(row => [row.id, row]));
      const builtLines: SummaryLine[] = items.map(item => {
        const adjustment = adjustmentMap.get(item.adjustment_id);
        const movement = item.movement_id ? movementMap.get(item.movement_id) : undefined;
        const fallbackChange = Number(item.qty ?? 0) * (adjustment?.direction === 'deduct' ? -1 : 1);
        const qtyBefore = Number(movement?.qty_before ?? 0);
        const qtyChange = Number(movement?.qty_change ?? fallbackChange);
        const qtyAfter = Number(movement?.qty_after ?? (qtyBefore + qtyChange));

        return {
          id: item.id,
          adjustmentId: adjustment?.id ?? '',
          adjustmentNumber: adjustment?.adjustment_number ?? '—',
          adjustmentDate: adjustment?.adjustment_date ?? '',
          reasonLabel: ADJUSTMENT_REASON_LABELS[(adjustment?.reason ?? 'system_correction') as keyof typeof ADJUSTMENT_REASON_LABELS] ?? 'System Correction',
          locationName: adjustment?.inv_locations?.name ?? '—',
          createdBy: adjustment?.creator?.name ?? 'System',
          productName: item.inv_products?.name ?? '—',
          skuCode: item.inv_products?.sku_code ?? '',
          qtyBefore,
          qtyChange,
          qtyAfter,
          remarks: adjustment?.remarks || item.notes || '—',
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
