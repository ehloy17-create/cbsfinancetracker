import { DailySales } from './types';
import { getTodayDateString, round2 } from './utils';

export type SalesAnalyticsPeriod = 'daily' | 'weekly' | 'monthly' | 'annually';

export interface SalesAnalyticsRow {
  key: string;
  label: string;
  rangeLabel: string;
  totalSales: number;
  costOfSales: number;
  grossProfit: number;
  averageSales: number;
  entryCount: number;
}

export interface SalesAnalyticsResult {
  periodType: SalesAnalyticsPeriod;
  scopeLabel: string;
  filteredRows: DailySales[];
  rows: SalesAnalyticsRow[];
  labels: string[];
  totals: number[];
  totalSales: number;
  totalCostOfSales: number;
  totalGrossProfit: number;
  averageSales: number;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toDateOnlyString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value: string) {
  const normalized = normalizeDailySalesDate(value);
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

function addYears(date: Date, amount: number) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + amount);
  return next;
}

function formatRangeLabel(start: Date, end: Date) {
  return `${MONTH_LABELS[start.getMonth()]} ${start.getDate()}-${end.getDate()}, ${end.getFullYear()}`;
}

function buildAggregateRow(key: string, label: string, rangeLabel: string, rows: DailySales[]): SalesAnalyticsRow {
  const totalSales = round2(rows.reduce((sum, row) => sum + Number(row.sales || 0), 0));
  const costOfSales = round2(rows.reduce((sum, row) => sum + Number(row.cost_of_sales || 0), 0));
  const grossProfit = round2(totalSales - costOfSales);
  const entryCount = rows.length;
  return {
    key,
    label,
    rangeLabel,
    totalSales,
    costOfSales,
    grossProfit,
    averageSales: entryCount > 0 ? round2(totalSales / entryCount) : 0,
    entryCount,
  };
}

export function normalizeDailySalesDate(value: unknown): string {
  if (typeof value !== 'string') return getTodayDateString();
  const trimmed = value.trim();
  if (!trimmed) return getTodayDateString();
  const match = trimmed.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : getTodayDateString();
}

export function normalizeDailySalesRow(row: DailySales): DailySales {
  const sales = round2(Number(row.sales) || 0);
  const costOfSales = round2(Number(row.cost_of_sales) || 0);
  return {
    ...row,
    date: normalizeDailySalesDate(row.date),
    sales,
    cost_of_sales: costOfSales,
    gross_profit: round2(sales - costOfSales),
    total_pos_sales: round2(Number(row.total_pos_sales) || 0),
    cash_pos_sales: round2(Number(row.cash_pos_sales) || 0),
    gcash_pos_sales: round2(Number(row.gcash_pos_sales) || 0),
    card_pos_sales: round2(Number(row.card_pos_sales) || 0),
    description: String(row.description ?? ''),
    notes: String(row.notes ?? ''),
  };
}

export function shiftSalesAnalyticsReference(period: SalesAnalyticsPeriod, referenceDate: string, direction: -1 | 1) {
  const base = parseDateOnly(referenceDate);
  if (period === 'daily') return toDateOnlyString(addDays(base, direction * 7));
  if (period === 'weekly') return toDateOnlyString(addMonths(base, direction));
  if (period === 'monthly') return toDateOnlyString(addYears(base, direction));
  return referenceDate;
}

export function getSalesAnalytics(periodType: SalesAnalyticsPeriod, referenceDate: string, rawRows: DailySales[]): SalesAnalyticsResult {
  const rows = rawRows.map(normalizeDailySalesRow);
  const reference = parseDateOnly(referenceDate);
  let groupedRows: SalesAnalyticsRow[] = [];
  let scopeLabel = '';
  let filteredRows: DailySales[] = [];

  if (periodType === 'daily') {
    const end = reference;
    const start = addDays(reference, -6);
    filteredRows = rows.filter(row => {
      const current = parseDateOnly(row.date);
      return current >= start && current <= end;
    });
    scopeLabel = `Last 7 days · ${formatRangeLabel(start, end)}`;
    groupedRows = Array.from({ length: 7 }, (_, index) => {
      const current = addDays(start, index);
      const dateKey = toDateOnlyString(current);
      const bucketRows = filteredRows.filter(row => row.date === dateKey);
      return buildAggregateRow(
        dateKey,
        DAY_LABELS[current.getDay()],
        `${DAY_LABELS[current.getDay()]} ${MONTH_LABELS[current.getMonth()]} ${current.getDate()}`,
        bucketRows
      );
    });
  } else if (periodType === 'weekly') {
    const year = reference.getFullYear();
    const month = reference.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weekCount = Math.ceil(daysInMonth / 7);
    scopeLabel = `${MONTH_LABELS[month]} ${year}`;
    filteredRows = rows.filter(row => {
      const current = parseDateOnly(row.date);
      return current.getFullYear() === year && current.getMonth() === month;
    });
    groupedRows = Array.from({ length: weekCount }, (_, index) => {
      const startDay = (index * 7) + 1;
      const endDay = Math.min(startDay + 6, daysInMonth);
      const bucketRows = filteredRows.filter(row => {
        const current = parseDateOnly(row.date);
        return current.getDate() >= startDay && current.getDate() <= endDay;
      });
      return buildAggregateRow(
        `${year}-${month + 1}-week-${index + 1}`,
        `Week ${index + 1}`,
        `${MONTH_LABELS[month]} ${startDay}-${endDay}, ${year}`,
        bucketRows
      );
    });
  } else if (periodType === 'monthly') {
    const year = reference.getFullYear();
    scopeLabel = String(year);
    filteredRows = rows.filter(row => parseDateOnly(row.date).getFullYear() === year);
    groupedRows = MONTH_LABELS.map((label, index) => {
      const bucketRows = filteredRows.filter(row => {
        const current = parseDateOnly(row.date);
        return current.getMonth() === index;
      });
      return buildAggregateRow(`${year}-${index + 1}`, label, `${label} ${year}`, bucketRows);
    });
  } else {
    const years = Array.from(new Set(rows.map(row => parseDateOnly(row.date).getFullYear()))).sort((left, right) => left - right);
    const activeYears = years.length > 0 ? years : [reference.getFullYear()];
    filteredRows = rows.filter(row => activeYears.includes(parseDateOnly(row.date).getFullYear()));
    scopeLabel = activeYears.length > 1
      ? `${activeYears[0]} - ${activeYears[activeYears.length - 1]}`
      : String(activeYears[0]);
    groupedRows = activeYears.map(year => {
      const bucketRows = filteredRows.filter(row => parseDateOnly(row.date).getFullYear() === year);
      return buildAggregateRow(String(year), String(year), String(year), bucketRows);
    });
  }

  const totalSales = round2(filteredRows.reduce((sum, row) => sum + Number(row.sales || 0), 0));
  const totalCostOfSales = round2(filteredRows.reduce((sum, row) => sum + Number(row.cost_of_sales || 0), 0));
  const totalGrossProfit = round2(totalSales - totalCostOfSales);
  const averageSales = groupedRows.length > 0 ? round2(totalSales / groupedRows.length) : 0;

  return {
    periodType,
    scopeLabel,
    filteredRows,
    rows: groupedRows,
    labels: groupedRows.map(row => row.label),
    totals: groupedRows.map(row => row.totalSales),
    totalSales,
    totalCostOfSales,
    totalGrossProfit,
    averageSales,
  };
}
