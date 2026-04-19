import { getDisbursementSourceLabel, isRealDisbursement } from '../../lib/disbursements';
import { loadFinanceMonitoringSnapshot } from '../../lib/financeMonitoring';
import { supabase } from '../../lib/supabase';
import { CheckStatus, Disbursement } from '../../lib/types';

export interface DashboardStats {
  todaySales: number;
  todayTxnCount: number;
  mtdSales: number;
  mtdTxnCount: number;
  lowStockCount: number;
  nearExpiryCount: number;
  expiredCount: number;
  overduePayables: number;
  overduePayableCount: number;
}

export interface InventoryDashboardSummary {
  lowStockCount: number;
  totalInventoryValue: number;
}

export interface SalesSummary {
  todaySales: number;
  todayTxnCount: number;
  weekSales: number;
  weekTxnCount: number;
  monthSales: number;
  monthTxnCount: number;
  rangeSales: number;
  rangeTxnCount: number;
}

export interface SalesTrendPoint {
  key: string;
  label: string;
  sales: number;
  txnCount: number;
  returns: number;
}

export interface TopSellingItem {
  product_id: string;
  product_name: string;
  sku_code: string;
  total_qty: number;
  total_revenue: number;
}

export interface HourlySalesPoint {
  key: string;
  label: string;
  sales: number;
  txnCount: number;
}

export interface SalesByPaymentMethod {
  method: string;
  total: number;
  count: number;
}

export interface SalesByLocation {
  location_id: string;
  location_name: string;
  total: number;
  count: number;
}

export interface DailySalesRow {
  date: string;
  txn_count: number;
  total_sales: number;
  cost_of_sales: number;
  gross_profit: number;
  cash: number;
  gcash: number;
}

export interface CashierSalesRow {
  cashier_id: string;
  cashier_name: string;
  shift_count: number;
  txn_count: number;
  gross_sales: number;
  discounts: number;
  net_sales: number;
  voids: number;
  returns: number;
}

export interface SalesDetailSummaryRow {
  item_id: string;
  sale_id: string;
  created_at: string;
  receipt_no: string;
  customer_name: string;
  product_id: string;
  product_name: string;
  sku_code: string;
  quantity: number;
  unit: string;
  sales_amount: number;
  cost_of_sales: number;
  gross_profit: number;
  cashier_id: string;
  cashier_name: string;
  payment_method: string;
  sort_order: number;
}

export interface MonthlySalesItemSummaryRow {
  product_key: string;
  product_id: string;
  product_name: string;
  sku_code: string;
  unit: string;
  total_quantity: number;
  total_sales: number;
  total_cost_of_sales: number;
  gross_profit: number;
}

export interface ProfitAndLossExpenseRow {
  id: string;
  date: string;
  payee: string;
  purpose: string;
  payment_method: string;
  source_label: string;
  affects_cashflow: boolean;
  amount: number;
}

export interface ProfitAndLossExpenseSourceRow {
  source_label: string;
  entry_count: number;
  amount: number;
}

export interface ProfitAndLossSalesSourceRow {
  source_label: string;
  days_count: number;
  sales: number;
  cost_of_sales: number;
  gross_profit: number;
}

export interface ProfitAndLossReport {
  sales: number;
  cost_of_sales: number;
  gross_profit: number;
  overhead_expenses: number;
  net_profit: number;
  covered_days: number;
  expense_count: number;
  sales_sources: ProfitAndLossSalesSourceRow[];
  expense_rows: ProfitAndLossExpenseRow[];
  expense_sources: ProfitAndLossExpenseSourceRow[];
}

export interface InventoryOnHandRow {
  product_id: string;
  sku_code: string;
  product_name: string;
  category: string;
  brand: string;
  unit: string;
  location_name: string;
  qty_on_hand: number;
  qty_available: number;
  reorder_point: number;
  unit_cost: number;
  stock_value: number;
  status: 'ok' | 'low' | 'out';
}

export interface StockMovementRow {
  id: string;
  created_at: string;
  product_name: string;
  sku_code: string;
  location_name: string;
  movement_type: string;
  qty_change: number;
  qty_before: number;
  qty_after: number;
  ref_number: string;
  notes: string;
  created_by_name: string;
  display_qty?: number;
  display_unit_name?: string;
  base_unit_name?: string;
}

export interface LowStockRow {
  product_id: string;
  sku_code: string;
  product_name: string;
  category: string;
  location_name: string;
  qty_on_hand: number;
  qty_available: number;
  reorder_point: number;
  shortage: number;
}

export interface ExpiryRow {
  lot_id: string;
  product_name: string;
  sku_code: string;
  location_name: string;
  batch_number: string;
  expiry_date: string;
  qty_on_hand: number;
  days_to_expiry: number;
  status: 'expired' | 'critical' | 'near';
}

export interface PayableAgingRow {
  payable_number: string;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  payment_status: string;
  days_overdue: number;
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+';
}

export interface XZReadingRow {
  shift_id: string;
  business_date: string;
  cashier_name: string;
  terminal_name: string;
  location_name: string;
  status: string;
  opening_cash: number;
  cash_sales: number;
  gcash_sales: number;
  txn_count: number;
  gross_sales: number;
  discounts: number;
  net_sales: number;
  voids: number;
  returns: number;
  expected_cash: number;
  actual_cash: number | null;
  over_short: number | null;
}

export interface ProjectedBalanceReportRow {
  bank_name: string;
  current_balance: number;
  due_today: number;
  due_tomorrow: number;
  overdue_amount: number;
  pdc_amount: number;
  deposits_in_transit: number;
  projected_available_balance: number;
  projected_after_tomorrow: number;
  reconciliation_status: string;
}

export interface DepositInTransitReportRow {
  date: string;
  bank_name: string;
  source_type: string;
  source_description: string;
  status: string;
  amount: number;
  notes: string;
}

export interface OwnerMovementReportRow {
  date: string;
  movement_type: string;
  target_module: string;
  reference_number: string;
  remarks: string;
  amount: number;
  approval_status: string;
}

export interface RecurringObligationReportRow {
  name: string;
  category: string;
  frequency: string;
  next_due_date: string;
  default_amount: number;
  is_active: boolean;
  remarks: string;
}

export interface UpcomingDueReportRow {
  date: string;
  kind: string;
  label: string;
  amount: number;
  status: string;
}

export interface LiquiditySnapshotReportRow {
  metric: string;
  amount: number;
}

export interface BankReconciliationReportRow {
  bank_name: string;
  statement_date: string;
  statement_ending_balance: number;
  system_book_balance: number;
  deposits_in_transit_total: number;
  uncleared_checks_total: number;
  adjusted_balance: number;
  variance: number;
  status: string;
}

type SalesTrendGroupBy = 'day' | 'week' | 'month';

interface SaleRow {
  sale_id: string;
  shift_id: string;
  location_id: string;
  cashier_id: string;
  receipt_no: string;
  customer_id: string;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  sale_status: string;
  created_at: string;
}

interface ReturnRow {
  shift_id?: string | null;
  cashier_id?: string | null;
  total_return_amt: number;
  created_at: string;
}

function toNum(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function customerDisplayName(firstName: unknown, lastName: unknown): string {
  return `${String(firstName ?? '').trim()} ${String(lastName ?? '').trim()}`.trim() || 'Walk-in';
}

function paymentLabelFromBucket(bucket: Record<string, number> | undefined): string {
  if (!bucket) return '--';
  const methods = Object.entries(bucket)
    .filter(([, amount]) => toNum(amount) > 0)
    .map(([method]) => method);
  if (methods.length === 0) return '--';
  if (methods.includes('cash') && methods.includes('gcash')) return 'Cash + GCash';
  return methods[0] === 'gcash' ? 'GCash' : 'Cash';
}

function disbursementPaymentMethodLabel(value: unknown): string {
  const method = String(value ?? '').trim().toLowerCase();
  switch (method) {
    case 'cash':
      return 'Cash';
    case 'gcash':
      return 'GCash';
    case 'check':
      return 'Check';
    case 'creditcard':
      return 'Credit Card';
    case 'advances_to_owner':
      return 'Owner Personal Fund';
    default:
      return String(value ?? '').trim() || '--';
  }
}

function parseCheckStatus(value: unknown): CheckStatus | null {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'draft':
    case 'pdc':
    case 'outstanding':
    case 'cleared':
    case 'cancelled':
    case 'bounced':
      return String(value).trim().toLowerCase() as CheckStatus;
    default:
      return null;
  }
}

function isOverheadDisbursement(disbursement: Disbursement, checkStatus?: CheckStatus | null): boolean {
  if (disbursement.is_deleted) return false;
  if (!isRealDisbursement(disbursement, checkStatus ?? null)) return false;

  const sourceModule = String(disbursement.source_module ?? '').trim().toLowerCase();
  if (sourceModule === 'payable_payment' || sourceModule === 'check_issuance') {
    return false;
  }

  return true;
}

function computeSaleLineCost(row: Record<string, unknown>): number {
  const qty = toNum(row.qty);
  const qtyInBaseUnitPerUnit = toNum(row.qty_in_base_unit_per_unit);
  const baseQty = toNum(row.total_base_qty_deducted);
  const effectiveBaseQty = baseQty > 0
    ? baseQty
    : qtyInBaseUnitPerUnit > 0
      ? qty * qtyInBaseUnitPerUnit
      : qty;
  const costPerBaseUnit = toNum(row.cost_per_base_unit);
  if (costPerBaseUnit > 0) return round2(effectiveBaseQty * costPerBaseUnit);
  return round2(qty * toNum(row.cost_at_sale));
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfDay(date: string): string {
  return `${date} 00:00:00`;
}

function endOfDay(date: string): string {
  return `${date} 23:59:59`;
}

function dateOnly(value: string | null | undefined): string {
  return String(value ?? '').slice(0, 10);
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

function formatHourLabel(hour: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const normalized = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalized}:00 ${suffix}`;
}

function monthKey(value: string): string {
  return value.slice(0, 7);
}

function addDays(value: string, days: number): string {
  const next = new Date(`${value}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function startOfWeek(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}

function startOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function chunk<T>(rows: T[], size = 100): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

async function selectByIds<T extends Record<string, unknown>>(
  table: string,
  key: string,
  ids: string[],
  select: string,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const allRows: T[] = [];
  for (const idsChunk of chunk(ids)) {
    const { data } = await supabase.from(table).select(select).in(key, idsChunk);
    allRows.push(...((data ?? []) as T[]));
  }
  return allRows;
}

async function fetchSalesRows(dateFrom: string, dateTo: string): Promise<SaleRow[]> {
  const { data } = await supabase
    .from('sales')
    .select('sale_id, shift_id, location_id, cashier_id, receipt_no, customer_id, subtotal, discount_amount, total_amount, sale_status, created_at')
    .gte('created_at', startOfDay(dateFrom))
    .lte('created_at', endOfDay(dateTo))
    .order('created_at', { ascending: true });

  return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    sale_id: String(row.sale_id ?? ''),
    shift_id: String(row.shift_id ?? ''),
    location_id: String(row.location_id ?? ''),
    cashier_id: String(row.cashier_id ?? ''),
    receipt_no: String(row.receipt_no ?? ''),
    customer_id: String(row.customer_id ?? ''),
    subtotal: toNum(row.subtotal),
    discount_amount: toNum(row.discount_amount),
    total_amount: toNum(row.total_amount),
    sale_status: String(row.sale_status ?? ''),
    created_at: String(row.created_at ?? ''),
  }));
}

async function fetchCompletedSales(dateFrom: string, dateTo: string): Promise<SaleRow[]> {
  const rows = await fetchSalesRows(dateFrom, dateTo);
  return rows.filter(row => row.sale_status === 'completed');
}

async function fetchSalesWithStatuses(dateFrom: string, dateTo: string): Promise<SaleRow[]> {
  return fetchSalesRows(dateFrom, dateTo);
}

async function fetchReturns(dateFrom: string, dateTo: string): Promise<ReturnRow[]> {
  const { data } = await supabase
    .from('sale_returns')
    .select('shift_id, cashier_id, total_return_amt, created_at')
    .gte('created_at', startOfDay(dateFrom))
    .lte('created_at', endOfDay(dateTo))
    .order('created_at', { ascending: true });

  return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    shift_id: row.shift_id ? String(row.shift_id) : null,
    cashier_id: row.cashier_id ? String(row.cashier_id) : null,
    total_return_amt: toNum(row.total_return_amt),
    created_at: String(row.created_at ?? ''),
  }));
}

async function fetchSalePaymentsMap(saleIds: string[]): Promise<Map<string, Record<string, number>>> {
  const paymentRows = await selectByIds<Record<string, unknown>>(
    'sale_payments',
    'sale_id',
    saleIds,
    'sale_id, payment_method, amount',
  );

  const paymentMap = new Map<string, Record<string, number>>();
  for (const row of paymentRows) {
    const saleId = String(row.sale_id ?? '');
    if (!saleId) continue;
    const bucket = paymentMap.get(saleId) ?? {};
    const method = normalizeSalePaymentMethod(row.payment_method);
    if (!method) continue;
    bucket[method] = round2((bucket[method] ?? 0) + toNum(row.amount));
    paymentMap.set(saleId, bucket);
  }
  return paymentMap;
}

function normalizeSalePaymentMethod(value: unknown): 'cash' | 'gcash' | null {
  const method = String(value ?? '').trim().toLowerCase();
  if (method === 'cash') return 'cash';
  if (method === 'gcash' || method === 'card' || method === 'bank') return 'gcash';
  return null;
}

async function fetchSaleCostMap(saleIds: string[]): Promise<Map<string, number>> {
  if (saleIds.length === 0) return new Map();
  const rows = await selectByIds<Record<string, unknown>>(
    'sale_items',
    'sale_id',
    saleIds,
    '*',
  );

  const costMap = new Map<string, number>();
  for (const row of rows) {
    const saleId = String(row.sale_id ?? '');
    if (!saleId) continue;
    costMap.set(saleId, round2((costMap.get(saleId) ?? 0) + computeSaleLineCost(row)));
  }
  return costMap;
}

interface ProfitAndLossDailySummaryRow {
  date: string;
  sales: number;
  cost_of_sales: number;
  total_pos_sales: number;
  cash_pos_sales: number;
  gcash_pos_sales: number;
  card_pos_sales: number;
}

interface ProfitAndLossSalesDayRow {
  date: string;
  source_label: string;
  sales: number;
  cost_of_sales: number;
}

async function fetchProfitAndLossSalesDays(dateFrom: string, dateTo: string): Promise<ProfitAndLossSalesDayRow[]> {
  const [dailySalesResult, completedSales] = await Promise.all([
    supabase
      .from('daily_sales')
      .select('date, sales, cost_of_sales, total_pos_sales, cash_pos_sales, gcash_pos_sales, card_pos_sales, is_deleted')
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .eq('is_deleted', false)
      .order('date', { ascending: true }),
    fetchCompletedSales(dateFrom, dateTo),
  ]);

  const dailySummaryMap = new Map<string, ProfitAndLossDailySummaryRow>();
  for (const row of (dailySalesResult.data ?? []) as Array<Record<string, unknown>>) {
    const date = dateOnly(String(row.date ?? ''));
    if (!date) continue;
    dailySummaryMap.set(date, {
      date,
      sales: round2(toNum(row.sales)),
      cost_of_sales: round2(toNum(row.cost_of_sales)),
      total_pos_sales: round2(toNum(row.total_pos_sales)),
      cash_pos_sales: round2(toNum(row.cash_pos_sales)),
      gcash_pos_sales: round2(toNum(row.gcash_pos_sales)),
      card_pos_sales: round2(toNum(row.card_pos_sales)),
    });
  }

  const saleIds = unique(completedSales.map(row => row.sale_id));
  const costMap = await fetchSaleCostMap(saleIds);
  const posDailyMap = new Map<string, { sales: number; cost_of_sales: number }>();
  for (const sale of completedSales) {
    const date = dateOnly(sale.created_at);
    if (!date) continue;
    const bucket = posDailyMap.get(date) ?? { sales: 0, cost_of_sales: 0 };
    bucket.sales = round2(bucket.sales + round2(toNum(sale.total_amount)));
    bucket.cost_of_sales = round2(bucket.cost_of_sales + round2(costMap.get(sale.sale_id) ?? 0));
    posDailyMap.set(date, bucket);
  }

  const allDates = Array.from(new Set([...dailySummaryMap.keys(), ...posDailyMap.keys()])).sort();
  return allDates.map<ProfitAndLossSalesDayRow>(date => {
    const dailySummary = dailySummaryMap.get(date);
    const posDaily = posDailyMap.get(date) ?? { sales: 0, cost_of_sales: 0 };
    const hasImportedSummary = Boolean(dailySummary) && (dailySummary!.sales > 0 || dailySummary!.cost_of_sales > 0);
    const hasSyncedDailySummary = Boolean(dailySummary) && (
      dailySummary!.total_pos_sales > 0
      || dailySummary!.cash_pos_sales > 0
      || dailySummary!.gcash_pos_sales > 0
      || dailySummary!.card_pos_sales > 0
    );

    if (hasImportedSummary && dailySummary) {
      return {
        date,
        source_label: 'Imported Daily Sales',
        sales: dailySummary.sales,
        cost_of_sales: dailySummary.cost_of_sales,
      };
    }

    if (hasSyncedDailySummary && dailySummary) {
      return {
        date,
        source_label: 'Daily Sales POS Summary',
        sales: dailySummary.total_pos_sales > 0
          ? dailySummary.total_pos_sales
          : round2(dailySummary.cash_pos_sales + dailySummary.gcash_pos_sales + dailySummary.card_pos_sales),
        cost_of_sales: posDaily.cost_of_sales,
      };
    }

    return {
      date,
      source_label: 'POS Sales',
      sales: posDaily.sales,
      cost_of_sales: posDaily.cost_of_sales,
    };
  }).filter(row => row.sales > 0 || row.cost_of_sales > 0);
}

async function fetchCustomersMap(ids: string[]): Promise<Map<string, string>> {
  const rows = await selectByIds<Record<string, unknown>>(
    'pos_customers',
    'customer_id',
    ids,
    'customer_id, first_name, last_name',
  );
  return new Map(rows.map(row => [
    String(row.customer_id ?? ''),
    customerDisplayName(row.first_name, row.last_name),
  ]));
}

async function fetchProfilesMap(ids: string[]): Promise<Map<string, string>> {
  const rows = await selectByIds<Record<string, unknown>>('profiles', 'id', ids, 'id, name');
  return new Map(rows.map(row => [String(row.id ?? ''), String(row.name ?? '')]));
}

async function fetchLocationsMap(ids: string[]): Promise<Map<string, { name: string; code?: string }>> {
  const rows = await selectByIds<Record<string, unknown>>('inv_locations', 'id', ids, 'id, name, code');
  return new Map(
    rows.map(row => [String(row.id ?? ''), { name: String(row.name ?? ''), code: row.code ? String(row.code) : undefined }]),
  );
}

async function fetchSuppliersMap(ids: string[]): Promise<Map<string, string>> {
  const rows = await selectByIds<Record<string, unknown>>('inv_suppliers', 'id', ids, 'id, name');
  return new Map(rows.map(row => [String(row.id ?? ''), String(row.name ?? '')]));
}

async function fetchTerminalsMap(ids: string[]): Promise<Map<string, string>> {
  const rows = await selectByIds<Record<string, unknown>>('pos_terminals', 'terminal_id', ids, 'terminal_id, terminal_name');
  return new Map(rows.map(row => [String(row.terminal_id ?? ''), String(row.terminal_name ?? '')]));
}

async function fetchProductsMeta(productIds: string[]): Promise<Map<string, {
  sku_code: string;
  name: string;
  reorder_point: number;
  cost_price: number;
  category_id: string | null;
  brand_id: string | null;
  base_unit_id: string | null;
  unit_id: string | null;
}>> {
  const rows = await selectByIds<Record<string, unknown>>(
    'inv_products',
    'id',
    productIds,
    'id, sku_code, name, reorder_point, cost_price, category_id, brand_id, base_unit_id, unit_id',
  );

  return new Map(rows.map(row => [
    String(row.id ?? ''),
    {
      sku_code: String(row.sku_code ?? ''),
      name: String(row.name ?? ''),
      reorder_point: toNum(row.reorder_point),
      cost_price: toNum(row.cost_price),
      category_id: row.category_id ? String(row.category_id) : null,
      brand_id: row.brand_id ? String(row.brand_id) : null,
      base_unit_id: row.base_unit_id ? String(row.base_unit_id) : null,
      unit_id: row.unit_id ? String(row.unit_id) : null,
    },
  ]));
}

async function fetchCategoriesMap(ids: string[]): Promise<Map<string, string>> {
  const rows = await selectByIds<Record<string, unknown>>('inv_categories', 'id', ids, 'id, name');
  return new Map(rows.map(row => [String(row.id ?? ''), String(row.name ?? '')]));
}

async function fetchBrandsMap(ids: string[]): Promise<Map<string, string>> {
  const rows = await selectByIds<Record<string, unknown>>('inv_brands', 'id', ids, 'id, name');
  return new Map(rows.map(row => [String(row.id ?? ''), String(row.name ?? '')]));
}

async function fetchUnitsMap(ids: string[]): Promise<Map<string, string>> {
  const rows = await selectByIds<Record<string, unknown>>('inv_units', 'id', ids, 'id, code, name, short_name');
  return new Map(
    rows.map(row => [
      String(row.id ?? ''),
      String(row.code ?? row.short_name ?? row.name ?? ''),
    ]),
  );
}

function buildDayBuckets(dateFrom: string, dateTo: string): string[] {
  const buckets: string[] = [];
  let current = dateFrom;
  while (current <= dateTo) {
    buckets.push(current);
    current = addDays(current, 1);
  }
  return buckets;
}

function buildWeekBuckets(dateFrom: string, dateTo: string): string[] {
  const buckets: string[] = [];
  let current = startOfWeek(dateFrom);
  const end = startOfWeek(dateTo);
  while (current <= end) {
    buckets.push(current);
    current = addDays(current, 7);
  }
  return buckets;
}

function buildMonthBuckets(dateFrom: string, dateTo: string): string[] {
  const buckets: string[] = [];
  const current = new Date(`${startOfMonth(dateFrom)}T00:00:00`);
  const end = new Date(`${startOfMonth(dateTo)}T00:00:00`);
  while (current <= end) {
    buckets.push(current.toISOString().slice(0, 7));
    current.setMonth(current.getMonth() + 1);
  }
  return buckets;
}

function bucketKey(value: string, groupBy: SalesTrendGroupBy): string {
  if (groupBy === 'week') return startOfWeek(value);
  if (groupBy === 'month') return monthKey(value);
  return value;
}

function bucketLabel(value: string, groupBy: SalesTrendGroupBy): string {
  if (groupBy === 'week') {
    const start = new Date(`${value}T00:00:00`);
    const end = new Date(`${addDays(value, 6)}T00:00:00`);
    return `${start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`;
  }
  if (groupBy === 'month') {
    return new Date(`${value}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
  }
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function summarizeSalesRows(rows: SaleRow[]): { sales: number; txns: number } {
  return {
    sales: round2(rows.reduce((sum, row) => sum + row.total_amount, 0)),
    txns: rows.length,
  };
}

export async function fetchSalesSummary(dateFrom: string, dateTo: string): Promise<SalesSummary> {
  const today = todayDate();
  const weekStart = startOfWeek(today);
  const monthStart = startOfMonth(today);

  const [todayRows, weekRows, monthRows, rangeRows] = await Promise.all([
    fetchCompletedSales(today, today),
    fetchCompletedSales(weekStart, today),
    fetchCompletedSales(monthStart, today),
    fetchCompletedSales(dateFrom, dateTo),
  ]);

  const todaySummary = summarizeSalesRows(todayRows);
  const weekSummary = summarizeSalesRows(weekRows);
  const monthSummary = summarizeSalesRows(monthRows);
  const rangeSummary = summarizeSalesRows(rangeRows);

  return {
    todaySales: todaySummary.sales,
    todayTxnCount: todaySummary.txns,
    weekSales: weekSummary.sales,
    weekTxnCount: weekSummary.txns,
    monthSales: monthSummary.sales,
    monthTxnCount: monthSummary.txns,
    rangeSales: rangeSummary.sales,
    rangeTxnCount: rangeSummary.txns,
  };
}

export async function fetchSalesTrend(
  dateFrom: string,
  dateTo: string,
  groupBy: SalesTrendGroupBy,
): Promise<SalesTrendPoint[]> {
  const [sales, returns] = await Promise.all([
    fetchCompletedSales(dateFrom, dateTo),
    fetchReturns(dateFrom, dateTo),
  ]);

  const map = new Map<string, SalesTrendPoint>();
  const keys = groupBy === 'week'
    ? buildWeekBuckets(dateFrom, dateTo)
    : groupBy === 'month'
      ? buildMonthBuckets(dateFrom, dateTo)
      : buildDayBuckets(dateFrom, dateTo);

  for (const key of keys) {
    map.set(key, {
      key,
      label: bucketLabel(key, groupBy),
      sales: 0,
      txnCount: 0,
      returns: 0,
    });
  }

  for (const row of sales) {
    const key = bucketKey(dateOnly(row.created_at), groupBy);
    const bucket = map.get(key);
    if (!bucket) continue;
    bucket.sales = round2(bucket.sales + row.total_amount);
    bucket.txnCount += 1;
  }

  for (const row of returns) {
    const key = bucketKey(dateOnly(row.created_at), groupBy);
    const bucket = map.get(key);
    if (!bucket) continue;
    bucket.returns = round2(bucket.returns + row.total_return_amt);
  }

  return Array.from(map.values());
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const today = todayDate();
  const monthStart = startOfMonth(today);

  const [summary, balancesRes, productsRes, lotsRes, overdueRes] = await Promise.all([
    fetchSalesSummary(monthStart, today),
    supabase.from('inventory_balances').select('product_id, qty_on_hand'),
    supabase.from('inv_products').select('id, reorder_point').eq('is_active', true),
    supabase.from('product_lots').select('id, expiry_date, qty_on_hand').gt('qty_on_hand', 0),
    supabase.from('payables').select('balance, status, due_date').in('status', ['open', 'partial']),
  ]);

  const qtyByProduct = new Map<string, number>();
  for (const row of (balancesRes.data ?? []) as Array<Record<string, unknown>>) {
    const productId = String(row.product_id ?? '');
    if (!productId) continue;
    qtyByProduct.set(productId, roundQty((qtyByProduct.get(productId) ?? 0) + toNum(row.qty_on_hand)));
  }

  let lowStockCount = 0;
  for (const row of (productsRes.data ?? []) as Array<Record<string, unknown>>) {
    const reorderPoint = toNum(row.reorder_point);
    if (reorderPoint <= 0) continue;
    const available = qtyByProduct.get(String(row.id ?? '')) ?? 0;
    if (available <= reorderPoint) lowStockCount += 1;
  }

  const lots = (lotsRes.data ?? []) as Array<Record<string, unknown>>;
  const nearCutoff = addDays(today, 30);
  const nearExpiryCount = lots.filter(row => {
    const expiryDate = String(row.expiry_date ?? '');
    return expiryDate >= today && expiryDate <= nearCutoff;
  }).length;
  const expiredCount = lots.filter(row => String(row.expiry_date ?? '') < today).length;

  const overdueRows = ((overdueRes.data ?? []) as Array<Record<string, unknown>>).filter(row => {
    const dueDate = String(row.due_date ?? '');
    return Boolean(dueDate) && dueDate < today;
  });

  return {
    todaySales: summary.todaySales,
    todayTxnCount: summary.todayTxnCount,
    mtdSales: summary.monthSales,
    mtdTxnCount: summary.monthTxnCount,
    lowStockCount,
    nearExpiryCount,
    expiredCount,
    overduePayables: round2(overdueRows.reduce((sum, row) => sum + toNum(row.balance), 0)),
    overduePayableCount: overdueRows.length,
  };
}

export async function fetchInventoryDashboardSummary(): Promise<InventoryDashboardSummary> {
  const { data: balanceRows } = await supabase
    .from('inventory_balances')
    .select('product_id, qty_on_hand');

  const balances = (balanceRows ?? []) as Array<Record<string, unknown>>;
  const qtyByProduct = new Map<string, number>();
  for (const row of balances) {
    const productId = String(row.product_id ?? '');
    if (!productId) continue;
    qtyByProduct.set(productId, roundQty((qtyByProduct.get(productId) ?? 0) + toNum(row.qty_on_hand)));
  }

  const productMap = await fetchProductsMeta(unique(Array.from(qtyByProduct.keys())));

  let lowStockCount = 0;
  let totalInventoryValue = 0;

  for (const [productId, qtyOnHand] of qtyByProduct.entries()) {
    const product = productMap.get(productId);
    if (!product) continue;

    if (product.reorder_point > 0 && qtyOnHand <= product.reorder_point) {
      lowStockCount += 1;
    }

    totalInventoryValue = round2(totalInventoryValue + round2(qtyOnHand * product.cost_price));
  }

  return {
    lowStockCount,
    totalInventoryValue,
  };
}

export async function fetchTopSellingItems(
  dateFrom: string,
  dateTo: string,
  limit = 10,
  sortBy: 'amount' | 'quantity' = 'amount',
): Promise<TopSellingItem[]> {
  const sales = await fetchCompletedSales(dateFrom, dateTo);
  const saleIds = unique(sales.map(row => row.sale_id));
  if (saleIds.length === 0) return [];

  const rows = await selectByIds<Record<string, unknown>>(
    'sale_items',
    'sale_id',
    saleIds,
    'sale_id, product_id, product_name_snapshot, sku_code, qty, total_base_qty_deducted, subtotal',
  );

  const map = new Map<string, TopSellingItem>();
  for (const row of rows) {
    const productId = String(row.product_id ?? '');
    const key = productId || String(row.sku_code ?? '') || String(row.product_name_snapshot ?? '');
    if (!key) continue;
    const existing = map.get(key);
    const qty = toNum(row.total_base_qty_deducted ?? row.qty);
    const revenue = toNum(row.subtotal);
    if (existing) {
      existing.total_qty = roundQty(existing.total_qty + qty);
      existing.total_revenue = round2(existing.total_revenue + revenue);
    } else {
      map.set(key, {
        product_id: productId,
        product_name: String(row.product_name_snapshot ?? ''),
        sku_code: String(row.sku_code ?? ''),
        total_qty: roundQty(qty),
        total_revenue: round2(revenue),
      });
    }
  }

  return Array.from(map.values())
    .sort((left, right) => (
      sortBy === 'quantity'
        ? right.total_qty - left.total_qty || right.total_revenue - left.total_revenue
        : right.total_revenue - left.total_revenue || right.total_qty - left.total_qty
    ))
    .slice(0, limit);
}

export async function fetchHourlySales(date: string): Promise<HourlySalesPoint[]> {
  const sales = await fetchCompletedSales(date, date);
  const map = new Map<number, HourlySalesPoint>();

  for (let hour = 9; hour <= 18; hour += 1) {
    map.set(hour, {
      key: String(hour),
      label: formatHourLabel(hour),
      sales: 0,
      txnCount: 0,
    });
  }

  for (const row of sales) {
    const rawHour = parseDateTime(row.created_at)?.getHours();
    if (typeof rawHour !== 'number') continue;
    const hour = Math.min(18, Math.max(9, rawHour));
    const bucket = map.get(hour);
    if (!bucket) continue;
    bucket.sales = round2(bucket.sales + row.total_amount);
    bucket.txnCount += 1;
  }

  return Array.from(map.values());
}

export async function fetchSalesByPaymentMethod(dateFrom: string, dateTo: string): Promise<SalesByPaymentMethod[]> {
  const sales = await fetchCompletedSales(dateFrom, dateTo);
  const saleIds = unique(sales.map(row => row.sale_id));
  if (saleIds.length === 0) return [];

  const rows = await selectByIds<Record<string, unknown>>(
    'sale_payments',
    'sale_id',
    saleIds,
    'sale_id, payment_method, amount',
  );

  const map = new Map<string, SalesByPaymentMethod>();
  for (const row of rows) {
    const method = normalizeSalePaymentMethod(row.payment_method);
    if (!method) continue;
    const existing = map.get(method);
    if (existing) {
      existing.total = round2(existing.total + toNum(row.amount));
      existing.count += 1;
    } else {
      map.set(method, {
        method,
        total: round2(toNum(row.amount)),
        count: 1,
      });
    }
  }

  return Array.from(map.values()).sort((left, right) => right.total - left.total);
}

export async function fetchSalesByLocation(dateFrom: string, dateTo: string): Promise<SalesByLocation[]> {
  const sales = await fetchCompletedSales(dateFrom, dateTo);
  const locationMap = await fetchLocationsMap(unique(sales.map(row => row.location_id)));

  const map = new Map<string, SalesByLocation>();
  for (const row of sales) {
    const existing = map.get(row.location_id);
    if (existing) {
      existing.total = round2(existing.total + row.total_amount);
      existing.count += 1;
    } else {
      map.set(row.location_id, {
        location_id: row.location_id,
        location_name: locationMap.get(row.location_id)?.name ?? 'Unknown',
        total: round2(row.total_amount),
        count: 1,
      });
    }
  }

  return Array.from(map.values()).sort((left, right) => right.total - left.total);
}

async function fetchCompletedSaleLineDetails(dateFrom: string, dateTo: string): Promise<SalesDetailSummaryRow[]> {
  const sales = await fetchCompletedSales(dateFrom, dateTo);
  const saleIds = unique(sales.map(row => row.sale_id));
  if (saleIds.length === 0) return [];

  const saleMap = new Map(sales.map(row => [row.sale_id, row]));
  const [itemRows, paymentMap, customerMap, cashierMap] = await Promise.all([
    selectByIds<Record<string, unknown>>(
      'sale_items',
      'sale_id',
      saleIds,
      'item_id, sale_id, product_id, sku_code, product_name_snapshot, qty, selected_unit_name, base_unit_name, qty_in_base_unit_per_unit, total_base_qty_deducted, cost_at_sale, cost_per_base_unit, subtotal, sort_order',
    ),
    fetchSalePaymentsMap(saleIds),
    fetchCustomersMap(unique(sales.map(row => row.customer_id))),
    fetchProfilesMap(unique(sales.map(row => row.cashier_id))),
  ]);

  const productIds = unique(itemRows.map(row => String(row.product_id ?? '')));
  const productMetaMap = await fetchProductsMeta(productIds);
  const unitsMap = await fetchUnitsMap(unique(Array.from(productMetaMap.values()).flatMap(product => [
    product.unit_id,
    product.base_unit_id,
  ])));

  return itemRows
    .map<SalesDetailSummaryRow | null>(row => {
      const saleId = String(row.sale_id ?? '');
      const sale = saleMap.get(saleId);
      if (!sale) return null;

      const productId = String(row.product_id ?? '');
      const productMeta = productMetaMap.get(productId);
      const unit = String(row.selected_unit_name ?? '').trim()
        || String(row.base_unit_name ?? '').trim()
        || unitsMap.get(productMeta?.unit_id ?? '')
        || unitsMap.get(productMeta?.base_unit_id ?? '')
        || '--';
      const salesAmount = round2(toNum(row.subtotal));
      const costOfSales = computeSaleLineCost(row);

      return {
        item_id: String(row.item_id ?? ''),
        sale_id: saleId,
        created_at: sale.created_at,
        receipt_no: sale.receipt_no,
        customer_name: customerMap.get(sale.customer_id) ?? 'Walk-in',
        product_id: productId,
        product_name: String(row.product_name_snapshot ?? '').trim() || productMeta?.name || 'Unknown product',
        sku_code: String(row.sku_code ?? '').trim(),
        quantity: roundQty(toNum(row.qty)),
        unit,
        sales_amount: salesAmount,
        cost_of_sales: costOfSales,
        gross_profit: round2(salesAmount - costOfSales),
        cashier_id: sale.cashier_id,
        cashier_name: cashierMap.get(sale.cashier_id) ?? 'Unknown',
        payment_method: paymentLabelFromBucket(paymentMap.get(saleId)),
        sort_order: Math.trunc(toNum(row.sort_order)),
      };
    })
    .filter((row): row is SalesDetailSummaryRow => Boolean(row))
    .sort((left, right) => {
      if (left.created_at === right.created_at) {
        if (left.receipt_no === right.receipt_no) return left.sort_order - right.sort_order;
        return left.receipt_no.localeCompare(right.receipt_no);
      }
      return right.created_at.localeCompare(left.created_at);
    });
}

export async function fetchSalesDetailSummaryReport(dateFrom: string, dateTo: string): Promise<SalesDetailSummaryRow[]> {
  return fetchCompletedSaleLineDetails(dateFrom, dateTo);
}

export async function fetchMonthlySalesItemSummaryReport(dateFrom: string, dateTo: string): Promise<MonthlySalesItemSummaryRow[]> {
  const rows = await fetchCompletedSaleLineDetails(dateFrom, dateTo);
  const map = new Map<string, MonthlySalesItemSummaryRow>();

  for (const row of rows) {
    const key = [row.product_id || row.sku_code || row.product_name, row.unit].join('::');
    const existing = map.get(key);
    if (existing) {
      existing.total_quantity = roundQty(existing.total_quantity + row.quantity);
      existing.total_sales = round2(existing.total_sales + row.sales_amount);
      existing.total_cost_of_sales = round2(existing.total_cost_of_sales + row.cost_of_sales);
      existing.gross_profit = round2(existing.total_sales - existing.total_cost_of_sales);
    } else {
      map.set(key, {
        product_key: key,
        product_id: row.product_id,
        product_name: row.product_name,
        sku_code: row.sku_code,
        unit: row.unit,
        total_quantity: roundQty(row.quantity),
        total_sales: round2(row.sales_amount),
        total_cost_of_sales: round2(row.cost_of_sales),
        gross_profit: round2(row.gross_profit),
      });
    }
  }

  return Array.from(map.values()).sort((left, right) => {
    const nameCompare = left.product_name.localeCompare(right.product_name);
    if (nameCompare !== 0) return nameCompare;
    return left.unit.localeCompare(right.unit);
  });
}

export async function fetchDailySalesReport(dateFrom: string, dateTo: string): Promise<DailySalesRow[]> {
  const [sales, returns] = await Promise.all([
    fetchCompletedSales(dateFrom, dateTo),
    fetchReturns(dateFrom, dateTo),
  ]);
  const saleIds = unique(sales.map(row => row.sale_id));
  const [paymentMap, costMap] = await Promise.all([
    fetchSalePaymentsMap(saleIds),
    fetchSaleCostMap(saleIds),
  ]);

  const byDate = new Map<string, DailySalesRow>();
  const buckets = buildDayBuckets(dateFrom, dateTo);
  for (const bucket of buckets) {
    byDate.set(bucket, {
      date: bucket,
      txn_count: 0,
      total_sales: 0,
      cost_of_sales: 0,
      gross_profit: 0,
      cash: 0,
      gcash: 0,
    });
  }

  for (const row of sales) {
    const key = dateOnly(row.created_at);
    const bucket = byDate.get(key);
    if (!bucket) continue;
    bucket.txn_count += 1;
    bucket.total_sales = round2(bucket.total_sales + row.total_amount);
    bucket.cost_of_sales = round2(bucket.cost_of_sales + (costMap.get(row.sale_id) ?? 0));
    const payment = paymentMap.get(row.sale_id) ?? {};
    bucket.cash = round2(bucket.cash + toNum(payment.cash));
    bucket.gcash = round2(bucket.gcash + toNum(payment.gcash));
  }

  for (const row of returns) {
    const key = dateOnly(row.created_at);
    const bucket = byDate.get(key);
    if (!bucket) continue;
    bucket.total_sales = round2(bucket.total_sales - row.total_return_amt);
  }

  return Array.from(byDate.values()).map(row => ({
    ...row,
    gross_profit: round2(row.total_sales - row.cost_of_sales),
  }));
}

export async function fetchProfitAndLossReport(dateFrom: string, dateTo: string): Promise<ProfitAndLossReport> {
  const [salesDays, disbursementRows] = await Promise.all([
    fetchProfitAndLossSalesDays(dateFrom, dateTo),
    supabase
      .from('disbursements')
      .select('id, date, payee, purpose, amount, affects_cashflow, payment_method, check_id, owner_id, owner_ledger_id, check_number, supplier_id, description, reference_number, disbursement_type, source_module, source_reference_id, source_account_type, source_account_id, notes, created_by, created_at, updated_at, is_deleted')
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: false }),
  ]);

  const checkIds = unique(
    (((disbursementRows.data ?? []) as Array<Record<string, unknown>>)
      .map(row => String(row.check_id ?? ''))
      .filter(Boolean))
  );
  const checkStatusMap = new Map<string, CheckStatus>();
  if (checkIds.length > 0) {
    const checks = await selectByIds<Record<string, unknown>>('checks_issued', 'id', checkIds, 'id, status');
    for (const row of checks) {
      const checkId = String(row.id ?? '');
      if (!checkId) continue;
      const status = parseCheckStatus(row.status);
      if (status) {
        checkStatusMap.set(checkId, status);
      }
    }
  }

  const expenseRows = (((disbursementRows.data ?? []) as Disbursement[])
    .map(row => ({
      ...row,
      date: dateOnly(row.date),
    }))
    .filter(row => row.date >= dateFrom && row.date <= dateTo)
    .filter(row => isOverheadDisbursement(row, row.check_id ? checkStatusMap.get(row.check_id) ?? null : null))
    .map<ProfitAndLossExpenseRow>(row => ({
      id: row.id,
      date: row.date,
      payee: row.payee?.trim() || 'Disbursement',
      purpose: row.purpose?.trim() || row.description?.trim() || 'Operating expense',
      payment_method: disbursementPaymentMethodLabel(row.payment_method),
      source_label: getDisbursementSourceLabel(row, row.check_id ? checkStatusMap.get(row.check_id) ?? null : null),
      affects_cashflow: row.affects_cashflow !== false,
      amount: round2(toNum(row.amount)),
    }))
    .sort((left, right) => {
      if (left.date === right.date) return right.amount - left.amount;
      return right.date.localeCompare(left.date);
    }));

  const expenseSourceMap = new Map<string, ProfitAndLossExpenseSourceRow>();
  for (const row of expenseRows) {
    const existing = expenseSourceMap.get(row.source_label);
    if (existing) {
      existing.entry_count += 1;
      existing.amount = round2(existing.amount + row.amount);
    } else {
      expenseSourceMap.set(row.source_label, {
        source_label: row.source_label,
        entry_count: 1,
        amount: round2(row.amount),
      });
    }
  }

  const salesSourceMap = new Map<string, ProfitAndLossSalesSourceRow>();
  for (const row of salesDays) {
    const existing = salesSourceMap.get(row.source_label);
    if (existing) {
      existing.days_count += 1;
      existing.sales = round2(existing.sales + row.sales);
      existing.cost_of_sales = round2(existing.cost_of_sales + row.cost_of_sales);
      existing.gross_profit = round2(existing.sales - existing.cost_of_sales);
    } else {
      salesSourceMap.set(row.source_label, {
        source_label: row.source_label,
        days_count: 1,
        sales: round2(row.sales),
        cost_of_sales: round2(row.cost_of_sales),
        gross_profit: round2(row.sales - row.cost_of_sales),
      });
    }
  }

  const totalSales = round2(salesDays.reduce((sum, row) => sum + row.sales, 0));
  const totalCostOfSales = round2(salesDays.reduce((sum, row) => sum + row.cost_of_sales, 0));
  const totalOverheadExpenses = round2(expenseRows.reduce((sum, row) => sum + row.amount, 0));
  const grossProfit = round2(totalSales - totalCostOfSales);

  return {
    sales: totalSales,
    cost_of_sales: totalCostOfSales,
    gross_profit: grossProfit,
    overhead_expenses: totalOverheadExpenses,
    net_profit: round2(grossProfit - totalOverheadExpenses),
    covered_days: salesDays.length,
    expense_count: expenseRows.length,
    sales_sources: Array.from(salesSourceMap.values()).sort((left, right) => right.sales - left.sales),
    expense_rows: expenseRows,
    expense_sources: Array.from(expenseSourceMap.values()).sort((left, right) => right.amount - left.amount),
  };
}

export async function fetchCashierSalesReport(dateFrom: string, dateTo: string): Promise<CashierSalesRow[]> {
  const [sales, returns, shiftsRes] = await Promise.all([
    fetchSalesWithStatuses(dateFrom, dateTo),
    fetchReturns(dateFrom, dateTo),
    supabase.from('pos_shifts').select('shift_id, cashier_id').gte('shift_date', dateFrom).lte('shift_date', dateTo),
  ]);

  const cashierMap = await fetchProfilesMap(unique([
    ...sales.map(row => row.cashier_id),
    ...returns.map(row => row.cashier_id ?? ''),
    ...((shiftsRes.data ?? []) as Array<Record<string, unknown>>).map(row => String(row.cashier_id ?? '')),
  ]));

  const rows = new Map<string, CashierSalesRow>();
  const getOrCreate = (cashierId: string): CashierSalesRow => {
    const existing = rows.get(cashierId);
    if (existing) return existing;
    const next: CashierSalesRow = {
      cashier_id: cashierId,
      cashier_name: cashierMap.get(cashierId) ?? cashierId,
      shift_count: 0,
      txn_count: 0,
      gross_sales: 0,
      discounts: 0,
      net_sales: 0,
      voids: 0,
      returns: 0,
    };
    rows.set(cashierId, next);
    return next;
  };

  for (const row of sales) {
    const cashier = getOrCreate(row.cashier_id);
    if (row.sale_status === 'completed') {
      cashier.txn_count += 1;
      cashier.gross_sales = round2(cashier.gross_sales + row.subtotal);
      cashier.discounts = round2(cashier.discounts + row.discount_amount);
      cashier.net_sales = round2(cashier.net_sales + row.total_amount);
    } else if (row.sale_status === 'voided') {
      cashier.voids = round2(cashier.voids + row.total_amount);
    }
  }

  for (const row of returns) {
    if (!row.cashier_id) continue;
    const cashier = getOrCreate(row.cashier_id);
    cashier.returns = round2(cashier.returns + row.total_return_amt);
  }

  for (const row of (shiftsRes.data ?? []) as Array<Record<string, unknown>>) {
    const cashierId = String(row.cashier_id ?? '');
    if (!cashierId) continue;
    const cashier = getOrCreate(cashierId);
    cashier.shift_count += 1;
  }

  return Array.from(rows.values()).sort((left, right) => right.net_sales - left.net_sales);
}

export async function fetchInventoryOnHandReport(): Promise<InventoryOnHandRow[]> {
  const { data: balanceRows } = await supabase
    .from('inventory_balances')
    .select('product_id, location_id, qty_on_hand')
    .order('product_id');

  const balances = (balanceRows ?? []) as Array<Record<string, unknown>>;
  const productIds = unique(balances.map(row => String(row.product_id ?? '')));
  const locationIds = unique(balances.map(row => String(row.location_id ?? '')));
  const productMap = await fetchProductsMeta(productIds);
  const products = Array.from(productMap.values());
  const categoryMap = await fetchCategoriesMap(unique(products.map(row => row.category_id ?? '')));
  const brandMap = await fetchBrandsMap(unique(products.map(row => row.brand_id ?? '')));
  const unitMap = await fetchUnitsMap(unique(products.map(row => row.base_unit_id ?? row.unit_id ?? '')));
  const locationMap = await fetchLocationsMap(locationIds);

  return balances.map(row => {
    const product = productMap.get(String(row.product_id ?? ''));
    const qtyOnHand = roundQty(toNum(row.qty_on_hand));
    const qtyAvailable = qtyOnHand;
    const reorderPoint = roundQty(product?.reorder_point ?? 0);
    return {
      product_id: String(row.product_id ?? ''),
      sku_code: product?.sku_code ?? '',
      product_name: product?.name ?? '',
      category: product?.category_id ? (categoryMap.get(product.category_id) ?? '') : '',
      brand: product?.brand_id ? (brandMap.get(product.brand_id) ?? '') : '',
      unit: unitMap.get(product?.base_unit_id ?? product?.unit_id ?? '') ?? '',
      location_name: locationMap.get(String(row.location_id ?? ''))?.name ?? '',
      qty_on_hand: qtyOnHand,
      qty_available: qtyAvailable,
      reorder_point: reorderPoint,
      unit_cost: round2(product?.cost_price ?? 0),
      stock_value: round2(qtyAvailable * (product?.cost_price ?? 0)),
      status: qtyAvailable <= 0 ? 'out' as const : (reorderPoint > 0 && qtyAvailable <= reorderPoint ? 'low' as const : 'ok' as const),
    };
  }).sort((left, right) => (
    left.product_name.localeCompare(right.product_name) ||
    left.location_name.localeCompare(right.location_name)
  ));
}

export async function fetchStockMovementReport(dateFrom: string, dateTo: string, productId?: string): Promise<StockMovementRow[]> {
  let query = supabase
    .from('inventory_movements')
    .select('id, product_id, location_id, movement_type, qty_change, qty_before, qty_after, ref_number, notes, created_by, created_at, display_qty, display_unit_name, base_unit_name')
    .gte('created_at', startOfDay(dateFrom))
    .lte('created_at', endOfDay(dateTo))
    .order('created_at', { ascending: false });

  if (productId) query = query.eq('product_id', productId);

  const { data } = await query;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const productMap = await fetchProductsMeta(unique(rows.map(row => String(row.product_id ?? ''))));
  const locationMap = await fetchLocationsMap(unique(rows.map(row => String(row.location_id ?? ''))));
  const profileMap = await fetchProfilesMap(unique(rows.map(row => String(row.created_by ?? ''))));

  return rows.map(row => ({
    id: String(row.id ?? ''),
    created_at: String(row.created_at ?? ''),
    product_name: productMap.get(String(row.product_id ?? ''))?.name ?? '',
    sku_code: productMap.get(String(row.product_id ?? ''))?.sku_code ?? '',
    location_name: locationMap.get(String(row.location_id ?? ''))?.name ?? '',
    movement_type: String(row.movement_type ?? ''),
    qty_change: roundQty(toNum(row.qty_change)),
    qty_before: roundQty(toNum(row.qty_before)),
    qty_after: roundQty(toNum(row.qty_after)),
    ref_number: String(row.ref_number ?? ''),
    notes: String(row.notes ?? ''),
    created_by_name: profileMap.get(String(row.created_by ?? '')) ?? '',
    display_qty: row.display_qty != null ? roundQty(toNum(row.display_qty)) : undefined,
    display_unit_name: row.display_unit_name ? String(row.display_unit_name) : undefined,
    base_unit_name: row.base_unit_name ? String(row.base_unit_name) : undefined,
  }));
}

export async function fetchLowStockReport(): Promise<LowStockRow[]> {
  const rows = await fetchInventoryOnHandReport();
  return rows
    .filter(row => row.reorder_point > 0 && row.qty_available <= row.reorder_point)
    .map(row => ({
      product_id: row.product_id,
      sku_code: row.sku_code,
      product_name: row.product_name,
      category: row.category,
      location_name: row.location_name,
      qty_on_hand: row.qty_on_hand,
      qty_available: row.qty_available,
      reorder_point: row.reorder_point,
      shortage: roundQty(Math.max(0, row.reorder_point - row.qty_available)),
    }))
    .sort((left, right) => right.shortage - left.shortage);
}

export async function fetchExpiryReport(daysAhead = 30): Promise<ExpiryRow[]> {
  const today = todayDate();
  const cutoff = addDays(today, daysAhead);
  const { data } = await supabase
    .from('product_lots')
    .select('id, product_id, location_id, batch_number, expiry_date, qty_on_hand')
    .gt('qty_on_hand', 0)
    .lte('expiry_date', cutoff)
    .order('expiry_date', { ascending: true });

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const productMap = await fetchProductsMeta(unique(rows.map(row => String(row.product_id ?? ''))));
  const locationMap = await fetchLocationsMap(unique(rows.map(row => String(row.location_id ?? ''))));

  return rows.map(row => {
    const expiryDate = String(row.expiry_date ?? '');
    const daysToExpiry = Math.floor((new Date(`${expiryDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
    return {
      lot_id: String(row.id ?? ''),
      product_name: productMap.get(String(row.product_id ?? ''))?.name ?? '',
      sku_code: productMap.get(String(row.product_id ?? ''))?.sku_code ?? '',
      location_name: locationMap.get(String(row.location_id ?? ''))?.name ?? '',
      batch_number: String(row.batch_number ?? ''),
      expiry_date: expiryDate,
      qty_on_hand: roundQty(toNum(row.qty_on_hand)),
      days_to_expiry: daysToExpiry,
      status: daysToExpiry < 0 ? 'expired' : daysToExpiry <= 7 ? 'critical' : 'near',
    };
  });
}

export async function fetchPayableAgingReport(): Promise<PayableAgingRow[]> {
  const today = todayDate();
  const { data } = await supabase
    .from('payables')
    .select('id, payable_number, supplier_id, invoice_number, invoice_date, due_date, total_amount, amount_paid, balance_due, payment_status, created_at')
    .in('payment_status', ['unpaid', 'partial'])
    .order('due_date', { ascending: true });

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const supplierMap = await fetchSuppliersMap(unique(rows.map(row => String(row.supplier_id ?? ''))));

  return rows.map(row => {
    const dueDate = String(row.due_date ?? '');
    const invoiceDate = dateOnly(String(row.invoice_date ?? row.created_at ?? ''));
    const days = dueDate
      ? Math.floor((new Date(`${today}T00:00:00`).getTime() - new Date(`${dueDate}T00:00:00`).getTime()) / 86400000)
      : 0;
    const bucket: PayableAgingRow['bucket'] =
      days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
    const totalAmount = round2(toNum(row.total_amount));
    const amountPaid = round2(toNum(row.amount_paid));
    const balanceDue = round2(toNum(row.balance_due));
    return {
      payable_number: String(row.payable_number ?? ''),
      supplier_name: supplierMap.get(String(row.supplier_id ?? '')) ?? '',
      invoice_number: String(row.invoice_number ?? ''),
      invoice_date: invoiceDate,
      due_date: dueDate,
      total_amount: totalAmount,
      amount_paid: amountPaid,
      balance_due: balanceDue,
      payment_status: String(row.payment_status ?? ''),
      days_overdue: Math.max(0, days),
      bucket,
    };
  });
}

export async function fetchXZReadingReport(dateFrom: string, dateTo: string): Promise<XZReadingRow[]> {
  const [shiftsRes, sales, returns] = await Promise.all([
    supabase
      .from('pos_shifts')
      .select('shift_id, terminal_id, cashier_id, location_id, shift_date, status, opening_cash, expected_cash, actual_cash, over_short')
      .gte('shift_date', dateFrom)
      .lte('shift_date', dateTo)
      .order('shift_date', { ascending: false }),
    fetchSalesWithStatuses(dateFrom, dateTo),
    fetchReturns(dateFrom, dateTo),
  ]);

  const shifts = (shiftsRes.data ?? []) as Array<Record<string, unknown>>;
  if (shifts.length === 0) return [];

  const shiftIds = unique(shifts.map(row => String(row.shift_id ?? '')));
  const paymentMap = await fetchSalePaymentsMap(unique(sales.filter(row => row.sale_status === 'completed').map(row => row.sale_id)));
  const cashierMap = await fetchProfilesMap(unique(shifts.map(row => String(row.cashier_id ?? ''))));
  const terminalMap = await fetchTerminalsMap(unique(shifts.map(row => String(row.terminal_id ?? ''))));
  const locationMap = await fetchLocationsMap(unique(shifts.map(row => String(row.location_id ?? ''))));

  return shifts.map(shift => {
    const shiftId = String(shift.shift_id ?? '');
    const shiftSales = sales.filter(row => row.shift_id === shiftId);
    const completedSales = shiftSales.filter(row => row.sale_status === 'completed');
    const voidedSales = shiftSales.filter(row => row.sale_status === 'voided');
    const shiftReturns = returns.filter(row => row.shift_id === shiftId);

    let cashSales = 0;
    let gcashSales = 0;
    for (const sale of completedSales) {
      const payment = paymentMap.get(sale.sale_id) ?? {};
      cashSales = round2(cashSales + toNum(payment.cash));
      gcashSales = round2(gcashSales + toNum(payment.gcash));
    }

    const returnsTotal = round2(shiftReturns.reduce((sum, row) => sum + row.total_return_amt, 0));
    const computedExpectedCash = round2(toNum(shift.opening_cash) + cashSales - returnsTotal);
    const expectedCash = toNum(shift.expected_cash) > 0 ? toNum(shift.expected_cash) : computedExpectedCash;

    return {
      shift_id: shiftId,
      business_date: String(shift.shift_date ?? ''),
      cashier_name: cashierMap.get(String(shift.cashier_id ?? '')) ?? '',
      terminal_name: terminalMap.get(String(shift.terminal_id ?? '')) ?? '',
      location_name: locationMap.get(String(shift.location_id ?? ''))?.name ?? '',
      status: String(shift.status ?? ''),
      opening_cash: round2(toNum(shift.opening_cash)),
      cash_sales: cashSales,
      gcash_sales: gcashSales,
      txn_count: completedSales.length,
      gross_sales: round2(completedSales.reduce((sum, row) => sum + row.subtotal, 0)),
      discounts: round2(completedSales.reduce((sum, row) => sum + row.discount_amount, 0)),
      net_sales: round2(completedSales.reduce((sum, row) => sum + row.total_amount, 0)),
      voids: round2(voidedSales.reduce((sum, row) => sum + row.total_amount, 0)),
      returns: returnsTotal,
      expected_cash: expectedCash,
      actual_cash: shift.actual_cash != null ? round2(toNum(shift.actual_cash)) : null,
      over_short: shift.over_short != null ? round2(toNum(shift.over_short)) : null,
    };
  }).filter(row => shiftIds.includes(row.shift_id));
}

export async function fetchProjectedBalanceReport(): Promise<ProjectedBalanceReportRow[]> {
  const snapshot = await loadFinanceMonitoringSnapshot();
  const reconciliationMap = new Map(snapshot.latest_reconciliation_statuses.map(item => [item.bank_account_id, item]));
  return snapshot.bank_summaries.map(summary => ({
    bank_name: summary.account.name,
    current_balance: summary.actual_balance,
    due_today: summary.due_today,
    due_tomorrow: summary.due_tomorrow,
    overdue_amount: summary.overdue_amount,
    pdc_amount: summary.pdc_amount,
    deposits_in_transit: summary.deposits_in_transit_total,
    projected_available_balance: summary.projected_available_balance,
    projected_after_tomorrow: summary.projected_after_tomorrow,
    reconciliation_status: reconciliationMap.get(summary.account.id)?.status ?? 'unreconciled',
  }));
}

export async function fetchDepositsInTransitReport(): Promise<DepositInTransitReportRow[]> {
  const snapshot = await loadFinanceMonitoringSnapshot();
  const bankMap = new Map(snapshot.bank_accounts.map(account => [account.id, account.name]));
  return snapshot.bank_deposits.map(deposit => ({
    date: deposit.date,
    bank_name: bankMap.get(deposit.bank_account_id) ?? 'Bank',
    source_type: deposit.source_type,
    source_description: deposit.source_description,
    status: deposit.status ?? 'verified',
    amount: deposit.amount,
    notes: deposit.notes,
  }));
}

export async function fetchOwnerMovementReport(): Promise<OwnerMovementReportRow[]> {
  const snapshot = await loadFinanceMonitoringSnapshot();
  return snapshot.owner_movements.map(item => ({
    date: item.date,
    movement_type: item.movement_type,
    target_module: item.target_module,
    reference_number: item.reference_number,
    remarks: item.remarks,
    amount: item.amount,
    approval_status: item.approval_status,
  }));
}

export async function fetchRecurringObligationsReport(): Promise<RecurringObligationReportRow[]> {
  const snapshot = await loadFinanceMonitoringSnapshot();
  return snapshot.recurring_obligations.map(item => ({
    name: item.name,
    category: item.category,
    frequency: item.frequency,
    next_due_date: item.next_due_date,
    default_amount: item.default_amount,
    is_active: item.is_active,
    remarks: item.remarks,
  }));
}

export async function fetchUpcomingDuesReport(): Promise<UpcomingDueReportRow[]> {
  const snapshot = await loadFinanceMonitoringSnapshot();
  return snapshot.upcoming_due_items.map(item => ({
    date: item.date,
    kind: item.kind,
    label: item.label,
    amount: item.amount,
    status: item.status,
  }));
}

export async function fetchLiquiditySnapshotReport(): Promise<LiquiditySnapshotReportRow[]> {
  const snapshot = await loadFinanceMonitoringSnapshot();
  const liquidity = snapshot.liquidity_snapshot;
  return [
    { metric: 'Bank Balance', amount: liquidity.total_bank_balance },
    { metric: 'GCash Balance', amount: liquidity.total_gcash_balance },
    { metric: 'Cash Fund Balance', amount: liquidity.total_cash_fund_balance },
    { metric: 'Total Liquid Funds', amount: liquidity.total_liquid_funds },
    { metric: 'Checks Due Today', amount: liquidity.checks_due_today },
    { metric: 'Checks Due Tomorrow', amount: liquidity.checks_due_tomorrow },
    { metric: 'Overdue Checks', amount: liquidity.overdue_checks },
    { metric: 'Payables Due Today', amount: liquidity.payable_due_today },
    { metric: 'Payables Due Within 7 Days', amount: liquidity.payable_due_within_7_days },
    { metric: 'Recurring Due Within 7 Days', amount: liquidity.recurring_due_within_7_days },
    { metric: 'Projected Available Liquidity', amount: liquidity.projected_available_liquidity },
    { metric: 'Projected After Tomorrow', amount: liquidity.projected_after_tomorrow_liquidity },
  ];
}

export async function fetchBankReconciliationReport(): Promise<BankReconciliationReportRow[]> {
  const snapshot = await loadFinanceMonitoringSnapshot();
  const bankMap = new Map(snapshot.bank_accounts.map(account => [account.id, account.name]));
  return snapshot.reconciliations.map(item => ({
    bank_name: bankMap.get(item.bank_account_id) ?? 'Bank',
    statement_date: item.statement_date,
    statement_ending_balance: item.statement_ending_balance,
    system_book_balance: item.system_book_balance,
    deposits_in_transit_total: item.deposits_in_transit_total,
    uncleared_checks_total: item.uncleared_checks_total,
    adjusted_balance: item.adjusted_balance,
    variance: item.variance,
    status: item.status,
  }));
}
