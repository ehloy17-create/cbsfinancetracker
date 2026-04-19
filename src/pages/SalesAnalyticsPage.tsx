import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Database, RefreshCw, TableProperties } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SalesAnalyticsChart from '../components/SalesAnalyticsChart';
import { supabase } from '../lib/supabase';
import { DailySales } from '../lib/types';
import { formatCurrency, getTodayDateString } from '../lib/utils';
import { getSalesAnalytics, normalizeDailySalesRow, SalesAnalyticsPeriod, shiftSalesAnalyticsReference } from '../lib/salesAnalytics';
import { useToast } from '../contexts/ToastContext';

const SALES_TABS: Array<{ id: SalesAnalyticsPeriod; label: string }> = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'annually', label: 'Annually' },
];

interface SalesAnalyticsPageProps {
  embedded?: boolean;
  title?: string;
  subtitle?: string;
  actionLabel?: string;
  actionTo?: string;
  hideAction?: boolean;
}

export default function SalesAnalyticsPage({
  embedded = false,
  title,
  subtitle,
  actionLabel,
  actionTo,
  hideAction = false,
}: SalesAnalyticsPageProps) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const today = getTodayDateString();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<DailySales[]>([]);
  const [period, setPeriod] = useState<SalesAnalyticsPeriod>('daily');
  const [referenceDate, setReferenceDate] = useState(today);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const { data, error } = await supabase
        .from('daily_sales')
        .select('*')
        .eq('is_deleted', false)
        .order('date', { ascending: true });
      if (error) throw new Error(error.message);
      setRows(((data || []) as DailySales[]).map(normalizeDailySalesRow));
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load sales analytics', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => { void load(false); }, [load]);

  const analytics = useMemo(
    () => getSalesAnalytics(period, referenceDate, rows),
    [period, referenceDate, rows]
  );

  const canShift = period !== 'annually';
  const averageLabel = {
    daily: 'Average per day',
    weekly: 'Average per week',
    monthly: 'Average per month',
    annually: 'Average per year',
  }[period];

  const resolvedTitle = title ?? 'Sales Analytics';
  const resolvedSubtitle = subtitle ?? 'Decision-focused sales view derived only from the Daily Sales table.';
  const resolvedActionLabel = actionLabel ?? (embedded ? 'Open Sales Analytics' : 'Open Daily Sales');
  const resolvedActionTo = actionTo ?? (embedded ? '/sales' : '/sales/manage');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {embedded ? (
            <h2 className="text-lg font-bold text-slate-800">{resolvedTitle}</h2>
          ) : (
            <h1 className="text-2xl font-bold text-slate-800">{resolvedTitle}</h1>
          )}
          <p className="text-sm text-slate-500 mt-1">{resolvedSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {!hideAction && (
            <button
              onClick={() => navigate(resolvedActionTo)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Database className="w-4 h-4" />
              {resolvedActionLabel}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {SALES_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setPeriod(tab.id);
                    setReferenceDate(today);
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    period === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {canShift && (
                <>
                  <button
                    onClick={() => setReferenceDate(current => shiftSalesAnalyticsReference(period, current, -1))}
                    className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                    title="Previous period"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setReferenceDate(today)}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Current
                  </button>
                  <button
                    onClick={() => setReferenceDate(current => shiftSalesAnalyticsReference(period, current, 1))}
                    className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                    title="Next period"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}
              <span className="text-sm font-medium text-slate-600">{analytics.scopeLabel}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Sales</p>
              <p className="mt-2 text-2xl font-black text-slate-800">{formatCurrency(analytics.totalSales)}</p>
              <p className="mt-1 text-xs text-slate-400">{analytics.scopeLabel}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cost of Sales</p>
              <p className="mt-2 text-2xl font-black text-amber-700">{formatCurrency(analytics.totalCostOfSales)}</p>
              <p className="mt-1 text-xs text-slate-400">Filtered from Daily Sales only</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gross Profit</p>
              <p className={`mt-2 text-2xl font-black ${analytics.totalGrossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {formatCurrency(analytics.totalGrossProfit)}
              </p>
              <p className="mt-1 text-xs text-slate-400">Sales minus cost within the visible scope</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Records in Scope</p>
              <p className="mt-2 text-2xl font-black text-blue-700">{analytics.filteredRows.length}</p>
              <p className="mt-1 text-xs text-slate-400">{averageLabel}: {formatCurrency(analytics.averageSales)}</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 border-b border-slate-100">
          <SalesAnalyticsChart rows={analytics.rows} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Period</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Sales</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Cost</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Gross Profit</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Average</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Records</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {analytics.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-14 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-3">
                      <TableProperties className="w-10 h-10 opacity-20" />
                      <span className="text-sm font-medium">No daily sales records for the selected scope.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                analytics.rows.map(row => (
                  <tr key={row.key} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-slate-800">{row.label}</p>
                      <p className="text-xs text-slate-400">{row.rangeLabel}</p>
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold text-slate-800">{formatCurrency(row.totalSales)}</td>
                    <td className="px-4 py-3.5 text-right text-amber-700">{formatCurrency(row.costOfSales)}</td>
                    <td className={`px-4 py-3.5 text-right font-semibold ${row.grossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {formatCurrency(row.grossProfit)}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-600">{formatCurrency(row.averageSales)}</td>
                    <td className="px-4 py-3.5 text-right text-slate-500">{row.entryCount}</td>
                  </tr>
                ))
              )}
            </tbody>
            {analytics.rows.length > 0 && (
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr>
                  <td className="px-5 py-3 font-bold text-slate-800">Total</td>
                  <td className="px-4 py-3 text-right font-black text-slate-800">{formatCurrency(analytics.totalSales)}</td>
                  <td className="px-4 py-3 text-right font-black text-amber-700">{formatCurrency(analytics.totalCostOfSales)}</td>
                  <td className={`px-4 py-3 text-right font-black ${analytics.totalGrossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {formatCurrency(analytics.totalGrossProfit)}
                  </td>
                  <td className="px-4 py-3 text-right font-black text-blue-700">{formatCurrency(analytics.averageSales)}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-600">{analytics.filteredRows.length}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
