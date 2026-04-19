import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, BarChart2, Building2, Calendar, Clock, CreditCard, Landmark, Receipt,
  Package, ShoppingBag, TrendingUp, Wallet,
} from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency, getTodayDateString } from '../../lib/utils';
import { supabase } from '../../lib/supabase';
import { DailySales } from '../../lib/types';
import { normalizeDailySalesRow } from '../../lib/salesAnalytics';

type TopSellerMode = 'amount' | 'quantity';

interface HourlySalesPoint {
  key: string;
  label: string;
  sales: number;
  txnCount: number;
}

interface TopSellingItem {
  product_id: string;
  product_name: string;
  sku_code: string;
  total_qty: number;
  total_revenue: number;
}

interface BarDatum {
  key: string;
  label: string;
  value: number;
  meta?: string;
}

interface MonthlyRecapDatum {
  key: string;
  label: string;
  cash: number;
  gcash: number;
  total: number;
  meta?: string;
}

function getMonthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function WidgetCard({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function WidgetEmpty({ message }: { message: string }) {
  return (
    <div className="py-12 text-center text-slate-400">
      <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}

function WidgetLoading() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map(index => (
        <div key={index} className="animate-pulse">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="h-3 w-16 rounded bg-slate-200" />
          </div>
          <div className="h-4 rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQty(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function formatHourLabel(hour: number) {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const normalized = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalized}:00 ${suffix}`;
}

function parseDateTime(value: string | null | undefined): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const normalized = raw.includes(' ') && !raw.includes('T')
    ? raw.replace(' ', 'T')
    : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function chunk<T>(rows: T[], size = 100): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function GroupedColumnChart({
  rows,
  emptyMessage,
  valueFormatter,
}: {
  rows: MonthlyRecapDatum[];
  emptyMessage: string;
  valueFormatter: (value: number) => string;
}) {
  if (rows.length === 0) {
    return <WidgetEmpty message={emptyMessage} />;
  }

  const width = 760;
  const height = 240;
  const padding = 24;
  const chartHeight = height - padding * 2;
  const chartWidth = width - padding * 2;
  const maxValue = Math.max(...rows.map(row => row.total), 1);
  const groupWidth = chartWidth / rows.length;
  const barWidth = Math.min(26, Math.max(14, (groupWidth - 18) / 2));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span>Month</span>
        <span>Sales Amount</span>
      </div>
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-emerald-500" />
          <span>Cash</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-sky-400" />
          <span>GCash</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-violet-500" />
          <span>Total (no split)</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-64">
            {[0, 1, 2, 3].map(step => {
              const y = padding + (step / 3) * chartHeight;
              const value = maxValue - (step / 3) * maxValue;
              return (
                <g key={step}>
                  <line x1={padding} x2={width - padding} y1={y} y2={y} className="stroke-slate-200" strokeDasharray="4 4" />
                  <text x={width - padding} y={y - 6} textAnchor="end" className="fill-slate-400 text-[11px]">
                    {valueFormatter(value)}
                  </text>
                </g>
              );
            })}
            {rows.map((row, index) => {
              const baseX = padding + index * groupWidth + (groupWidth - (barWidth * 2 + 8)) / 2;
              const hasPaymentBreakdown = row.cash > 0 || row.gcash > 0;
              const totalOnly = !hasPaymentBreakdown && row.total > 0 ? row.total : 0;
              const cashHeight = maxValue > 0 ? (row.cash / maxValue) * chartHeight : 0;
              const gcashHeight = maxValue > 0 ? (row.gcash / maxValue) * chartHeight : 0;
              const totalHeight = maxValue > 0 ? (totalOnly / maxValue) * chartHeight : 0;
              const cashY = height - padding - cashHeight;
              const gcashY = height - padding - gcashHeight;
              const totalY = height - padding - totalHeight;

              return (
                <g key={row.key}>
                  {hasPaymentBreakdown ? (
                    <>
                      <rect
                        x={baseX}
                        y={cashY}
                        width={barWidth}
                        height={Math.max(cashHeight, row.cash > 0 ? 4 : 0)}
                        rx="8"
                        className="fill-emerald-500"
                      />
                      <rect
                        x={baseX + barWidth + 8}
                        y={gcashY}
                        width={barWidth}
                        height={Math.max(gcashHeight, row.gcash > 0 ? 4 : 0)}
                        rx="8"
                        className="fill-sky-500"
                      />
                    </>
                  ) : (
                    <rect
                      x={padding + index * groupWidth + (groupWidth - barWidth) / 2}
                      y={totalY}
                      width={barWidth}
                      height={Math.max(totalHeight, totalOnly > 0 ? 4 : 0)}
                      rx="8"
                      className="fill-violet-500"
                    />
                  )}
                  <text
                    x={padding + index * groupWidth + groupWidth / 2}
                    y={height - 6}
                    textAnchor="middle"
                    className="fill-slate-500 text-[11px] font-medium"
                  >
                    {row.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
        {rows.map(row => (
          <div key={row.key} className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold text-slate-500">{row.label}</p>
            <p className="text-sm font-bold text-slate-800 mt-1">{valueFormatter(row.total)}</p>
            <div className="mt-1 space-y-0.5 text-[11px] text-slate-500">
              <p>Cash: {valueFormatter(row.cash)}</p>
              <p>GCash: {valueFormatter(row.gcash)}</p>
            </div>
            {row.meta && <p className="text-[11px] text-slate-400 mt-1">{row.meta}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ColumnChart({
  rows,
  valueFormatter,
  emptyMessage,
}: {
  rows: BarDatum[];
  valueFormatter: (value: number) => string;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return <WidgetEmpty message={emptyMessage} />;
  }

  const width = 760;
  const height = 240;
  const padding = 24;
  const chartHeight = height - padding * 2;
  const chartWidth = width - padding * 2;
  const maxValue = Math.max(...rows.map(row => row.value), 1);
  const barWidth = Math.min(48, chartWidth / rows.length - 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span>Hour</span>
        <span>Sales Amount</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-64">
            {[0, 1, 2, 3].map(step => {
              const y = padding + (step / 3) * chartHeight;
              const value = maxValue - (step / 3) * maxValue;
              return (
                <g key={step}>
                  <line x1={padding} x2={width - padding} y1={y} y2={y} className="stroke-slate-200" strokeDasharray="4 4" />
                  <text x={width - padding} y={y - 6} textAnchor="end" className="fill-slate-400 text-[11px]">
                    {valueFormatter(value)}
                  </text>
                </g>
              );
            })}
            {rows.map((row, index) => {
              const x = padding + index * (chartWidth / rows.length) + ((chartWidth / rows.length) - barWidth) / 2;
              const barHeight = maxValue > 0 ? (row.value / maxValue) * chartHeight : 0;
              const y = height - padding - barHeight;
              return (
                <g key={row.key}>
                  <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, row.value > 0 ? 4 : 0)} rx="10" className="fill-blue-500" />
                  <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" className="fill-slate-500 text-[11px] font-medium">
                    {row.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {rows.map(row => (
          <div key={row.key} className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold text-slate-500">{row.label}</p>
            <p className="text-sm font-bold text-slate-800 mt-1">{valueFormatter(row.value)}</p>
            {row.meta && <p className="text-[11px] text-slate-400 mt-1">{row.meta}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function RankedBarChart({
  rows,
  valueFormatter,
  emptyMessage,
  rightAxisLabel,
}: {
  rows: BarDatum[];
  valueFormatter: (value: number) => string;
  emptyMessage: string;
  rightAxisLabel: string;
}) {
  if (rows.length === 0) {
    return <WidgetEmpty message={emptyMessage} />;
  }

  const maxValue = Math.max(...rows.map(row => row.value), 1);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span>Rank / Product</span>
        <span>{rightAxisLabel}</span>
      </div>
      {rows.map((row, index) => {
        const width = maxValue > 0 ? Math.max((row.value / maxValue) * 100, row.value > 0 ? 4 : 0) : 0;
        return (
          <div key={row.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 items-center">
            <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-black">
              {index + 1}
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-slate-700 truncate">{row.label}</p>
              {row.meta && <p className="text-xs text-slate-400 truncate">{row.meta}</p>}
              <div className="relative h-4 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-500 to-orange-400"
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
            <span className="w-24 text-right text-xs font-mono font-semibold text-slate-700">{valueFormatter(row.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function ReportsDashboardPage() {
  const { showToast } = useToast();
  const today = getTodayDateString();
  const currentYear = Number(today.slice(0, 4));
  const currentYearStart = `${currentYear}-01-01`;
  const currentYearEnd = `${currentYear}-12-31`;
  const monthStart = getMonthStart(today);

  const [monthlyLoading, setMonthlyLoading] = useState(true);
  const [hourlyLoading, setHourlyLoading] = useState(true);
  const [topLoading, setTopLoading] = useState(true);
  const [monthlyRecap, setMonthlyRecap] = useState<MonthlyRecapDatum[]>([]);
  const [hourlySales, setHourlySales] = useState<HourlySalesPoint[]>([]);
  const [topByAmount, setTopByAmount] = useState<TopSellingItem[]>([]);
  const [topByQuantity, setTopByQuantity] = useState<TopSellingItem[]>([]);
  const [topSellerMode, setTopSellerMode] = useState<TopSellerMode>('amount');

  const buildMonthlyRecap = useCallback((dailySalesRows: DailySales[]): MonthlyRecapDatum[] => {
    const monthlyMap = new Map<string, MonthlyRecapDatum>();
    for (let month = 1; month <= 12; month += 1) {
      const monthKey = `${currentYear}-${String(month).padStart(2, '0')}`;
      monthlyMap.set(monthKey, {
        key: monthKey,
        label: new Date(`${monthKey}-01T00:00:00`).toLocaleString('en-PH', { month: 'short' }),
        cash: 0,
        gcash: 0,
        total: 0,
      });
    }

    for (const row of dailySalesRows) {
      const monthKey = String(row.date ?? '').slice(0, 7);
      const bucket = monthlyMap.get(monthKey);
      if (!bucket) continue;
      const rowSales = Number(row.sales ?? 0);
      const rowTotalPosSales = Number(row.total_pos_sales ?? 0);
      const totalSales = rowSales > 0 ? rowSales : rowTotalPosSales;
      bucket.cash = round2(bucket.cash + Number(row.cash_pos_sales ?? 0));
      bucket.gcash = round2(bucket.gcash + Number(row.gcash_pos_sales ?? 0));
      bucket.total = round2(bucket.total + totalSales);
      bucket.meta = formatCurrency(bucket.total);
    }

    return Array.from(monthlyMap.values());
  }, [currentYear]);

  const buildTopSellingItems = useCallback((rows: TopSellingItem[], sortBy: TopSellerMode): TopSellingItem[] => (
    [...rows]
      .sort((left, right) => (
        sortBy === 'quantity'
          ? right.total_qty - left.total_qty || right.total_revenue - left.total_revenue
          : right.total_revenue - left.total_revenue || right.total_qty - left.total_qty
      ))
      .slice(0, 10)
  ), []);

  const fetchMonthlyRecapData = useCallback(async () => {
    setMonthlyLoading(true);
    try {
      const { data, error } = await supabase
        .from('daily_sales')
        .select('*')
        .eq('is_deleted', false)
        .gte('date', currentYearStart)
        .lte('date', currentYearEnd)
        .order('date', { ascending: true });

      if (error) {
        throw new Error(error.message || 'Failed to load monthly recap');
      }

      setMonthlyRecap(buildMonthlyRecap(((data ?? []) as DailySales[]).map(normalizeDailySalesRow)));
    } catch (error) {
      setMonthlyRecap([]);
      showToast(error instanceof Error ? error.message : 'Unable to load monthly recap widget data', 'error');
    } finally {
      setMonthlyLoading(false);
    }
  }, [buildMonthlyRecap, currentYearEnd, currentYearStart, showToast]);

  const fetchHourlySalesForDay = useCallback(async (date: string): Promise<HourlySalesPoint[]> => {
    const buckets = new Map<number, HourlySalesPoint>();
    for (let hour = 9; hour <= 18; hour += 1) {
      buckets.set(hour, {
        key: String(hour),
        label: formatHourLabel(hour),
        sales: 0,
        txnCount: 0,
      });
    }

    const { data, error } = await supabase
      .from('sales')
      .select('created_at, total_amount, sale_status')
      .eq('sale_status', 'completed')
      .gte('created_at', `${date} 00:00:00`)
      .lte('created_at', `${date} 23:59:59`)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(error.message || 'Failed to load hourly sales');
    }

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const rawHour = parseDateTime(String(row.created_at ?? ''))?.getHours();
      if (typeof rawHour !== 'number') continue;
      const hour = Math.min(18, Math.max(9, rawHour));
      const bucket = buckets.get(hour);
      if (!bucket) continue;
      bucket.sales += Number(row.total_amount ?? 0);
      bucket.txnCount += 1;
    }

    return Array.from(buckets.values()).map(row => ({
      ...row,
      sales: Math.round((row.sales + Number.EPSILON) * 100) / 100,
    }));
  }, []);

  const loadHourlySales = useCallback(async () => {
    setHourlyLoading(true);
    try {
      setHourlySales(await fetchHourlySalesForDay(today));
    } catch (error) {
      setHourlySales([]);
      showToast(error instanceof Error ? error.message : 'Unable to load hourly sales widget data', 'error');
    } finally {
      setHourlyLoading(false);
    }
  }, [fetchHourlySalesForDay, showToast, today]);

  const loadTopSellers = useCallback(async () => {
    setTopLoading(true);
    try {
      const { data: salesRows, error: salesError } = await supabase
        .from('sales')
        .select('sale_id')
        .eq('sale_status', 'completed')
        .gte('created_at', `${monthStart} 00:00:00`)
        .lte('created_at', `${today} 23:59:59`);

      if (salesError) {
        throw new Error(salesError.message || 'Failed to load top product sales');
      }

      const saleIds = Array.from(new Set(((salesRows ?? []) as Array<Record<string, unknown>>).map(row => String(row.sale_id ?? '')).filter(Boolean)));
      if (saleIds.length === 0) {
        setTopByAmount([]);
        setTopByQuantity([]);
        return;
      }

      const itemMap = new Map<string, TopSellingItem>();
      for (const idsChunk of chunk(saleIds)) {
        const { data: itemRows, error: itemError } = await supabase
          .from('sale_items')
          .select('product_id, product_name_snapshot, sku_code, qty, total_base_qty_deducted, subtotal')
          .in('sale_id', idsChunk);

        if (itemError) {
          throw new Error(itemError.message || 'Failed to load top product items');
        }

        for (const row of (itemRows ?? []) as Array<Record<string, unknown>>) {
          const productId = String(row.product_id ?? '');
          const key = productId || String(row.sku_code ?? '') || String(row.product_name_snapshot ?? '');
          if (!key) continue;
          const existing = itemMap.get(key);
          const qty = Number(row.total_base_qty_deducted ?? row.qty ?? 0);
          const revenue = Number(row.subtotal ?? 0);
          if (existing) {
            existing.total_qty = roundQty(existing.total_qty + qty);
            existing.total_revenue = round2(existing.total_revenue + revenue);
          } else {
            itemMap.set(key, {
              product_id: productId,
              product_name: String(row.product_name_snapshot ?? ''),
              sku_code: String(row.sku_code ?? ''),
              total_qty: roundQty(qty),
              total_revenue: round2(revenue),
            });
          }
        }
      }

      const topRows = Array.from(itemMap.values());
      setTopByAmount(buildTopSellingItems(topRows, 'amount'));
      setTopByQuantity(buildTopSellingItems(topRows, 'quantity'));
    } catch (error) {
      setTopByAmount([]);
      setTopByQuantity([]);
      showToast(error instanceof Error ? error.message : 'Unable to load top product widget data', 'error');
    } finally {
      setTopLoading(false);
    }
  }, [buildTopSellingItems, monthStart, showToast, today]);

  useEffect(() => {
    void fetchMonthlyRecapData();
    void loadHourlySales();
    void loadTopSellers();
  }, [fetchMonthlyRecapData, loadHourlySales, loadTopSellers]);

  const hourlyBars = useMemo<BarDatum[]>(
    () => hourlySales.map(row => ({
      key: row.key,
      label: row.label,
      value: row.sales,
      meta: `${row.txnCount} transaction${row.txnCount === 1 ? '' : 's'}`,
    })),
    [hourlySales]
  );

  const topSellerRows = topSellerMode === 'quantity' ? topByQuantity : topByAmount;
  const topSellerBars = useMemo<BarDatum[]>(
    () => topSellerRows.map(row => ({
      key: row.product_id || row.sku_code || row.product_name,
      label: row.product_name || row.sku_code || 'Unnamed product',
      value: topSellerMode === 'quantity' ? row.total_qty : row.total_revenue,
      meta: row.sku_code || undefined,
    })),
    [topSellerMode, topSellerRows]
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      <div className="px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Reports Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Quick recap widgets on top, full report shortcuts below.</p>
        </div>

        <WidgetCard
          title={`Monthly Sales for Year ${currentYear}`}
          subtitle="Current-year monthly sales totals based on daily sales summaries."
        >
          {monthlyLoading ? (
            <WidgetLoading />
          ) : (
            <GroupedColumnChart
              rows={monthlyRecap}
              emptyMessage="No monthly sales data for the current year yet."
              valueFormatter={value => formatCurrency(value)}
            />
          )}
        </WidgetCard>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <WidgetCard
            title="Hourly Sales"
            subtitle="Current day sales grouped by transaction hour."
          >
            {hourlyLoading ? (
              <WidgetLoading />
            ) : (
              <ColumnChart
                rows={hourlyBars}
                valueFormatter={value => formatCurrency(value)}
                emptyMessage="No completed sales for the current day yet."
              />
            )}
          </WidgetCard>

          <WidgetCard
            title="Best Top Seller"
            subtitle="Top-selling items for the current month."
            action={(
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  onClick={() => setTopSellerMode('quantity')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    topSellerMode === 'quantity'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Quantity
                </button>
                <button
                  onClick={() => setTopSellerMode('amount')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    topSellerMode === 'amount'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Amount
                </button>
              </div>
            )}
          >
            {topLoading ? (
              <WidgetLoading />
            ) : (
              <RankedBarChart
                rows={topSellerBars}
                valueFormatter={value => (
                  topSellerMode === 'quantity'
                    ? value.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
                    : formatCurrency(value)
                )}
                emptyMessage="No top-selling item data for the current month yet."
                rightAxisLabel={topSellerMode === 'quantity' ? 'Quantity' : 'Amount'}
              />
            )}
          </WidgetCard>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">All Reports</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {REPORT_LINKS.map(report => (
              <Link key={report.to} to={report.to} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all group">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${report.iconBg}`}>
                  <report.icon className={`w-4 h-4 ${report.iconColor}`} />
                </div>
                <p className="text-sm font-semibold text-slate-700 group-hover:text-blue-700 leading-tight">{report.label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{report.sub}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const REPORT_LINKS = [
  { to: '/reports/daily-sales', label: 'Daily Sales', sub: 'By date', icon: TrendingUp, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  { to: '/reports/sales-details-summary', label: 'Sales Details Summary', sub: 'Receipt line items', icon: Receipt, iconBg: 'bg-sky-50', iconColor: 'text-sky-600' },
  { to: '/reports/profit-loss', label: 'Profit and Loss', sub: 'Statement view', icon: TrendingUp, iconBg: 'bg-violet-50', iconColor: 'text-violet-600' },
  { to: '/reports/cashier-sales', label: 'Cashier Sales', sub: 'By cashier', icon: BarChart2, iconBg: 'bg-amber-50', iconColor: 'text-amber-600' },
  { to: '/reports/inventory', label: 'Inventory On Hand', sub: 'Stock levels', icon: Package, iconBg: 'bg-slate-50', iconColor: 'text-slate-600' },
  { to: '/reports/stock-movement', label: 'Stock Movement', sub: 'Ledger', icon: BarChart2, iconBg: 'bg-slate-50', iconColor: 'text-slate-600' },
  { to: '/reports/low-stock', label: 'Low Stock', sub: 'Reorder alerts', icon: AlertTriangle, iconBg: 'bg-amber-50', iconColor: 'text-amber-600' },
  { to: '/reports/near-expiry', label: 'Near Expiry / Expired', sub: 'Lot tracking', icon: Clock, iconBg: 'bg-orange-50', iconColor: 'text-orange-600' },
  { to: '/reports/po-status', label: 'PO Status', sub: 'Purchase orders', icon: ShoppingBag, iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
  { to: '/reports/receivings', label: 'Receiving History', sub: 'Goods received', icon: Package, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  { to: '/reports/payable-aging', label: 'Payable Aging', sub: 'AP schedule', icon: AlertTriangle, iconBg: 'bg-red-50', iconColor: 'text-red-600' },
  { to: '/reports/projected-balance', label: 'Projected Balance', sub: 'Per bank account', icon: Building2, iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
  { to: '/reports/deposits-in-transit', label: 'Deposits In Transit', sub: 'Pending to verified', icon: CreditCard, iconBg: 'bg-sky-50', iconColor: 'text-sky-600' },
  { to: '/reports/owner-movements', label: 'Owner Ledger', sub: 'Due to owner', icon: Wallet, iconBg: 'bg-violet-50', iconColor: 'text-violet-600' },
  { to: '/reports/recurring-obligations', label: 'Recurring Dues', sub: 'Fixed obligations', icon: Calendar, iconBg: 'bg-orange-50', iconColor: 'text-orange-600' },
  { to: '/reports/upcoming-dues', label: 'Upcoming Dues', sub: 'Next 7 days', icon: AlertTriangle, iconBg: 'bg-amber-50', iconColor: 'text-amber-600' },
  { to: '/reports/liquidity-snapshot', label: 'Liquidity Snapshot', sub: 'Daily liquidity', icon: TrendingUp, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  { to: '/reports/bank-reconciliations', label: 'Bank Reconciliation', sub: 'Statement vs book', icon: Landmark, iconBg: 'bg-indigo-50', iconColor: 'text-indigo-600' },
  { to: '/reports/transfers', label: 'Transfer History', sub: 'Stock transfers', icon: BarChart2, iconBg: 'bg-slate-50', iconColor: 'text-slate-600' },
  { to: '/reports/adjustments', label: 'Adjustment History', sub: 'Inv. adjustments', icon: BarChart2, iconBg: 'bg-slate-50', iconColor: 'text-slate-600' },
  { to: '/reports/physical-count-variance', label: 'Count Variance', sub: 'Physical count', icon: BarChart2, iconBg: 'bg-slate-50', iconColor: 'text-slate-600' },
  { to: '/reports/xz-reading', label: 'X/Z Reading Report', sub: 'POS shifts', icon: BarChart2, iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
];
