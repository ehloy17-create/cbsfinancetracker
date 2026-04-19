import { supabase } from '../../lib/supabase';
import { CartLine } from '../hooks/useCart';
import { CustomerPriceLevel, SalePaymentMethod, PosPermission, PosPermissionRow, PosCustomer, PaymentSplit } from '../../lib/types';

export interface StockWarning {
  productId: string;
  productName: string;
  requested: number;
  available: number;
  baseUnitName?: string;
}

export interface CheckoutPayload {
  shiftId: string;
  terminalId: string;
  locationId: string;
  cashierId: string;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  amountTendered: number;
  changeAmount: number;
  paymentMethod: SalePaymentMethod;
  referenceNo: string;
  lines: CartLine[];
  customerId?: string | null;
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  payments?: PaymentSplit[];
}

export interface CheckoutResult {
  saleId: string;
  receiptNo: string;
}

export interface RecentSaleLookup {
  saleId: string;
  receiptNo: string;
  totalAmount: number;
  createdAt: string | null;
}

export interface RecentVoidLookup {
  saleId: string;
  receiptNo: string;
  totalAmount: number;
  voidedAt: string | null;
  voidReason: string;
}

export interface RecentReturnLookup {
  returnId: string;
  returnNo: string;
  originalSaleId: string;
  originalReceiptNo: string;
  totalReturnAmt: number;
  refundMethod: string;
  createdAt: string | null;
}

function normalizeSalePaymentMethod(value: unknown): SalePaymentMethod | null {
  const method = String(value ?? '').trim().toLowerCase();
  if (method === 'cash') return 'cash';
  if (method === 'gcash' || method === 'card' || method === 'bank') return 'gcash';
  if (method === 'charge' || method === 'credit' || method === 'account') return 'charge';
  return null;
}

export async function checkStock(
  lines: CartLine[],
  locationId: string
): Promise<StockWarning[]> {
  const activeLines = lines.filter(l => !l.voided);
  const productIds = activeLines.filter(l => l.productId).map(l => l.productId);
  if (productIds.length === 0) return [];

  const { data } = await supabase
    .from('inventory_balances')
    .select('product_id, qty_on_hand')
    .eq('location_id', locationId)
    .in('product_id', productIds);

  const balMap = new Map<string, number>(
    (data ?? []).map((r: Record<string, unknown>) => [r.product_id as string, Number(r.qty_on_hand)])
  );

  const warnings: StockWarning[] = [];
  for (const line of activeLines) {
    if (!line.productId) continue;
    const avail = balMap.get(line.productId) ?? 0;
    const required = Number(line.totalBaseQtyDeducted ?? line.qty * line.qtyInBaseUnitPerUnit);
    if (avail < required) {
      warnings.push({
        productId: line.productId,
        productName: line.productName,
        requested: required,
        available: avail,
        baseUnitName: line.baseUnitName,
      });
    }
  }
  return warnings;
}

export async function postSale(payload: CheckoutPayload): Promise<CheckoutResult> {
  const activeLines = payload.lines.filter(l => !l.voided);

  const rpc_payload = {
    shift_id: payload.shiftId,
    terminal_id: payload.terminalId,
    location_id: payload.locationId,
    cashier_id: payload.cashierId,
    subtotal: payload.subtotal,
    discount_amount: payload.discountAmount,
    total_amount: payload.totalAmount,
    amount_tendered: payload.amountTendered,
    change_amount: payload.changeAmount,
    payment_method: payload.paymentMethod,
    reference_no: payload.referenceNo,
    items: activeLines.map((l, i) => ({
      product_id: l.productId || '',
      selected_unit_id: l.selectedUnitId,
      selected_unit_name: l.selectedUnitName,
      qty_in_base_unit_per_unit: l.qtyInBaseUnitPerUnit,
      total_base_qty_deducted: l.totalBaseQtyDeducted,
      base_unit_name: l.baseUnitName,
      barcode: l.barcode || '',
      sku_code: l.sku || '',
      product_name_snapshot: l.productName,
      qty: l.qty,
      retail_unit_price: l.retailUnitPrice,
      unit_price: l.unitPrice,
      wholesale_enabled: l.wholesaleEnabled,
      wholesale_break_qty_in_base_unit: l.wholesaleBreakQtyInBaseUnit,
      wholesale_block_price: l.wholesaleBlockPrice,
      wholesale_blocks_applied: l.wholesaleBlocksApplied,
      wholesale_base_qty_applied: l.wholesaleBaseQtyApplied,
      retail_remainder_base_qty: l.retailRemainderBaseQty,
      pricing_breakdown: l.pricingBreakdown,
      selected_price_level: l.selectedPriceLevel,
      applied_price_level: l.appliedPriceLevel,
      price_source: l.priceSource,
      discount_amount: l.discountAmount,
      subtotal: l.subtotal,
      sort_order: i,
      price_overridden: l.priceOverridden,
      original_unit_price: l.originalUnitPrice,
      discount_pct: l.discountPct,
    })),
    customer_id: payload.customerId ?? null,
    payments: payload.payments?.map(payment => ({
      method: normalizeSalePaymentMethod(payment.method) ?? payment.method,
      amount: Number(payment.amount ?? 0),
      referenceNo: payment.referenceNo || '',
    })) ?? [],
  };

  const { data, error } = await supabase.rpc('post_sale', { payload: rpc_payload });

  if (error) throw new Error(error.message);

  const result = data as { sale_id?: string; receipt_no?: string; error?: string };
  if (result.error) throw new Error(result.error);
  if (!result.sale_id || !result.receipt_no) throw new Error('Invalid response from server');

  const saleId = result.sale_id;

  const extraUpdates: Record<string, unknown> = {};
  if (payload.customerId) extraUpdates.customer_id = payload.customerId;
  if ((payload.loyaltyPointsEarned ?? 0) > 0) extraUpdates.loyalty_points_earned = payload.loyaltyPointsEarned;
  if ((payload.loyaltyPointsRedeemed ?? 0) > 0) extraUpdates.loyalty_points_redeemed = payload.loyaltyPointsRedeemed;

  if (Object.keys(extraUpdates).length > 0) {
    await supabase.from('sales').update(extraUpdates).eq('sale_id', saleId);
  }

  return { saleId, receiptNo: result.receipt_no };
}

export async function voidSale(
  saleId: string,
  reason: string,
  supervisorId: string,
  shiftId: string | undefined,
  terminalId: string | undefined,
  actorId: string | undefined
): Promise<void> {
  const { data, error } = await supabase.rpc('void_sale', {
    payload: {
      sale_id: saleId,
      reason,
      supervisor_id: supervisorId,
      actor_id: actorId,
    },
  });
  if (error) throw new Error(error.message);
  const result = data as { error?: string };
  if (result?.error) throw new Error(result.error);

  await writeAuditLog({
    shiftId,
    terminalId,
    saleId,
    action: 'void_transaction',
    actorId,
    supervisorId,
    details: { reason },
  });
}

export interface PostReturnPayload {
  originalSaleId: string;
  shiftId: string;
  terminalId: string;
  locationId: string;
  cashierId: string;
  supervisorId?: string;
  reason: string;
  refundMethod: 'cash' | 'store_credit' | 'original_method';
  items: {
    original_sale_item_id: string;
    product_id: string | null;
    product_name_snapshot: string;
    sku_code: string;
    qty_returned: number;
    unit_price: number;
    subtotal: number;
  }[];
  totalReturnAmt: number;
  notes?: string;
}

export async function postReturn(payload: PostReturnPayload): Promise<string> {
  const { data, error } = await supabase.rpc('post_return', {
    payload: {
      original_sale_id: payload.originalSaleId,
      shift_id: payload.shiftId,
      terminal_id: payload.terminalId,
      location_id: payload.locationId,
      cashier_id: payload.cashierId,
      supervisor_id: payload.supervisorId ?? null,
      reason: payload.reason,
      refund_method: payload.refundMethod,
      total_return_amt: payload.totalReturnAmt,
      notes: payload.notes ?? '',
      items: payload.items,
    },
  });

  if (error) throw new Error(error.message);
  const ret = data as { return_id?: string; return_no?: string; error?: string };
  if (ret?.error) throw new Error(ret.error);
  if (!ret?.return_no) throw new Error('Failed to create return');

  await writeAuditLog({
    shiftId: payload.shiftId,
    terminalId: payload.terminalId,
    action: 'sale_return',
    actorId: payload.cashierId,
    supervisorId: payload.supervisorId,
    details: {
      return_no: ret.return_no,
      original_sale_id: payload.originalSaleId,
      total: payload.totalReturnAmt,
    },
  });

  return ret.return_no;
}

export async function fetchRecentSales(shiftId?: string, limit = 8): Promise<RecentSaleLookup[]> {
  let query = supabase
    .from('sales')
    .select('sale_id, receipt_no, total_amount, created_at, sale_status')
    .eq('sale_status', 'completed')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (shiftId) {
    query = query.eq('shift_id', shiftId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message || 'Failed to load recent sales');

  return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    saleId: String(row.sale_id ?? ''),
    receiptNo: String(row.receipt_no ?? ''),
    totalAmount: Number(row.total_amount ?? 0),
    createdAt: row.created_at ? String(row.created_at) : null,
  }));
}

export async function fetchRecentVoidedSales(shiftId?: string, limit = 8): Promise<RecentVoidLookup[]> {
  let query = supabase
    .from('sales')
    .select('sale_id, receipt_no, total_amount, voided_at, void_reason, sale_status')
    .eq('sale_status', 'voided')
    .order('voided_at', { ascending: false })
    .limit(limit);

  if (shiftId) {
    query = query.eq('shift_id', shiftId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message || 'Failed to load voided sales');

  return ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    saleId: String(row.sale_id ?? ''),
    receiptNo: String(row.receipt_no ?? ''),
    totalAmount: Number(row.total_amount ?? 0),
    voidedAt: row.voided_at ? String(row.voided_at) : null,
    voidReason: String(row.void_reason ?? ''),
  }));
}

export async function fetchRecentReturns(shiftId?: string, limit = 8): Promise<RecentReturnLookup[]> {
  const { data: returns, error } = await supabase
    .from('sale_returns')
    .select('return_id, return_no, original_sale_id, total_return_amt, refund_method, created_at')
    .eq('shift_id', shiftId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message || 'Failed to load returns');

  const rows = (returns ?? []) as Array<Record<string, unknown>>;
  const originalSaleIds = rows.map(row => String(row.original_sale_id ?? '')).filter(Boolean);
  const receiptMap = new Map<string, string>();

  if (originalSaleIds.length > 0) {
    const { data: sales } = await supabase
      .from('sales')
      .select('sale_id, receipt_no')
      .in('sale_id', originalSaleIds);

    for (const sale of (sales ?? []) as Array<Record<string, unknown>>) {
      receiptMap.set(String(sale.sale_id ?? ''), String(sale.receipt_no ?? ''));
    }
  }

  return rows.map(row => ({
    returnId: String(row.return_id ?? ''),
    returnNo: String(row.return_no ?? ''),
    originalSaleId: String(row.original_sale_id ?? ''),
    originalReceiptNo: receiptMap.get(String(row.original_sale_id ?? '')) ?? '—',
    totalReturnAmt: Number(row.total_return_amt ?? 0),
    refundMethod: String(row.refund_method ?? ''),
    createdAt: row.created_at ? String(row.created_at) : null,
  }));
}

export async function writeAuditLog(params: {
  shiftId?: string;
  terminalId?: string;
  saleId?: string;
  action: string;
  actorId?: string;
  supervisorId?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await supabase.from('pos_audit_log').insert({
    shift_id: params.shiftId ?? null,
    terminal_id: params.terminalId ?? null,
    sale_id: params.saleId ?? null,
    action: params.action,
    actor_id: params.actorId ?? null,
    supervisor_id: params.supervisorId ?? null,
    details: params.details ?? {},
  });
}

export async function fetchSaleByReceiptNo(receiptNo: string) {
  const { data: sale } = await supabase
    .from('sales')
    .select('*')
    .eq('receipt_no', receiptNo)
    .neq('sale_status', 'voided')
    .maybeSingle();
  if (!sale) return null;

  const saleId = (sale as Record<string, unknown>).sale_id as string;
  const [{ data: saleItems }, { data: salePayments }] = await Promise.all([
    supabase
      .from('sale_items')
      .select('*')
      .eq('sale_id', saleId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('sale_payments')
      .select('*')
      .eq('sale_id', saleId),
  ]);

  return {
    ...sale,
    sale_items: saleItems ?? [],
    sale_payments: salePayments ?? [],
  };
}

export async function fetchSaleForReceipt(saleId: string) {
  const { data: sale } = await supabase
    .from('sales')
    .select('*')
    .eq('sale_id', saleId)
    .maybeSingle();
  if (!sale) return null;

  const saleRow = sale as Record<string, unknown>;
  const cashierId = saleRow.cashier_id as string | undefined;
  const terminalId = saleRow.terminal_id as string | undefined;
  const locationId = saleRow.location_id as string | undefined;
  const customerId = saleRow.customer_id as string | undefined;

  const [
    { data: saleItems },
    { data: salePayments },
    { data: cashier },
    { data: terminal },
    { data: location },
    { data: customer },
  ] = await Promise.all([
    supabase
      .from('sale_items')
      .select('*')
      .eq('sale_id', saleId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('sale_payments')
      .select('*')
      .eq('sale_id', saleId),
    cashierId
      ? supabase.from('profiles').select('id, name').eq('id', cashierId).maybeSingle()
      : Promise.resolve({ data: null }),
    terminalId
      ? supabase.from('pos_terminals').select('terminal_id, terminal_name').eq('terminal_id', terminalId).maybeSingle()
      : Promise.resolve({ data: null }),
    locationId
      ? supabase.from('inv_locations').select('id, name, code').eq('id', locationId).maybeSingle()
      : Promise.resolve({ data: null }),
    customerId
      ? supabase.from('pos_customers').select('customer_id, first_name, last_name, phone, email, address, price_level').eq('customer_id', customerId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    ...sale,
    sale_items: saleItems ?? [],
    sale_payments: salePayments ?? [],
    cashier,
    pos_terminals: terminal,
    inv_locations: location,
    customer,
  };
}

export async function fetchUserPermissions(
  userId: string,
  userRole: string
): Promise<Map<PosPermission, PosPermissionRow>> {
  const { data: roleRows } = await supabase
    .from('pos_permissions')
    .select('*')
    .eq('role', userRole);

  const { data: userRows } = await supabase
    .from('pos_permissions')
    .select('*')
    .eq('user_id', userId);

  const allRows = [...(roleRows ?? []), ...(userRows ?? [])];

  const map = new Map<PosPermission, PosPermissionRow>();
  for (const row of allRows) {
    const r = row as PosPermissionRow;
    if (!map.has(r.permission) || r.user_id === userId) {
      map.set(r.permission, r);
    }
  }
  return map;
}

export async function searchCustomers(q: string): Promise<PosCustomer[]> {
  const { data } = await supabase.rpc('search_customers', {
    search: q.trim(),
    page: 1,
    page_size: 15,
  });
  const { customers = [] } = (data ?? {}) as { customers: PosCustomer[] };
  return customers;
}

export async function createCustomer(
  firstName: string,
  lastName: string,
  phone?: string,
  priceLevel: CustomerPriceLevel = 'Retail',
  options?: {
    email?: string;
    address?: string;
  },
): Promise<PosCustomer> {
  const { data, error } = await supabase
    .from('pos_customers')
    .insert({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone?.trim() || '',
      email: options?.email?.trim() || '',
      address: options?.address?.trim() || '',
      price_level: priceLevel,
      loyalty_points: 0,
      is_active: true,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Failed to create customer');
  return data as PosCustomer;
}

export interface ShiftReport {
  shift: {
    shift_id: string;
    business_date: string;
    shift_open_time: string;
    shift_close_time: string | null;
    opening_cash: number;
    actual_cash_count: number | null;
    expected_cash_count: number | null;
    cash_over_short: number | null;
    status: string;
  };
  txnCount: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  voidCount: number;
  voidTotal: number;
  returnCount: number;
  returnTotal: number;
  cashReturnTotal: number;
  cashSales: number;
  gcashSales: number;
  nonCashSales: number;
  cashPickupTotal: number;
  expectedCash: number;
}

export interface DayShiftSummary {
  shift_id: string;
  business_date: string;
  shift_open_time: string;
  shift_close_time: string | null;
  opening_cash: number;
  status: string;
}

export interface ZReadingReport {
  businessDate: string;
  shiftCount: number;
  openShiftCount: number;
  closedShiftCount: number;
  openingCash: number;
  txnCount: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  voidCount: number;
  voidTotal: number;
  returnCount: number;
  returnTotal: number;
  cashReturnTotal: number;
  cashSales: number;
  gcashSales: number;
  nonCashSales: number;
  cashPickupTotal: number;
  expectedCash: number;
  shifts: DayShiftSummary[];
}

export async function fetchShiftReport(shiftId: string): Promise<ShiftReport | null> {
  const { data: shiftData } = await supabase
    .from('pos_shifts')
    .select('*')
    .eq('shift_id', shiftId)
    .maybeSingle();

  if (!shiftData) return null;

  const { data: sales } = await supabase
    .from('sales')
    .select('sale_id, sale_status, total_amount, discount_amount, subtotal')
    .eq('shift_id', shiftId);

  const { data: returns } = await supabase
    .from('sale_returns')
    .select('total_return_amt, refund_method, original_sale_id')
    .eq('shift_id', shiftId);

  const { data: cashPickups } = await supabase
    .from('pos_cash_pickups')
    .select('amount')
    .eq('shift_id', shiftId)
    .eq('is_deleted', false);

  const allSales = (sales ?? []) as Record<string, unknown>[];
  const allReturns = (returns ?? []) as Record<string, unknown>[];

  const completedSales = allSales.filter(s => s.sale_status === 'completed');
  const voidedSales    = allSales.filter(s => s.sale_status === 'voided');
  const completedSaleIds = completedSales.map(s => String(s.sale_id ?? '')).filter(Boolean);

  const { data: payments } = completedSaleIds.length > 0
    ? await supabase
      .from('sale_payments')
      .select('payment_method, amount, sale_id')
      .in('sale_id', completedSaleIds)
    : { data: [] };
  const allPayments = (payments ?? []) as Record<string, unknown>[];

  const grossSales   = completedSales.reduce((s, r) => s + Number(r.subtotal ?? 0), 0);
  const discounts    = completedSales.reduce((s, r) => s + Number(r.discount_amount ?? 0), 0);
  const netSales     = completedSales.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  const voidTotal    = voidedSales.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  const returnTotal  = allReturns.reduce((s, r) => s + Number(r.total_return_amt ?? 0), 0);

  const returnSaleIds = allReturns.map(r => String(r.original_sale_id ?? '')).filter(Boolean);
  const { data: returnSalePayments } = returnSaleIds.length > 0
    ? await supabase
      .from('sale_payments')
      .select('sale_id, payment_method, amount')
      .in('sale_id', returnSaleIds)
    : { data: [] };

  const returnPaymentsBySaleId = new Map<string, Array<Record<string, unknown>>>();
  for (const payment of (returnSalePayments ?? []) as Array<Record<string, unknown>>) {
    const saleId = String(payment.sale_id ?? '');
    const bucket = returnPaymentsBySaleId.get(saleId) ?? [];
    bucket.push(payment);
    returnPaymentsBySaleId.set(saleId, bucket);
  }

  const cashReturnTotal = allReturns.reduce((sum, row) => {
    const refundMethod = String(row.refund_method ?? '');
    const amount = Number(row.total_return_amt ?? 0);
    if (refundMethod === 'cash') return sum + amount;
    if (refundMethod !== 'original_method') return sum;

    const salePayments = returnPaymentsBySaleId.get(String(row.original_sale_id ?? '')) ?? [];
    const cashOnlyOriginal = salePayments.length > 0 && salePayments.every(p => normalizeSalePaymentMethod(p.payment_method) === 'cash');
    return cashOnlyOriginal ? sum + amount : sum;
  }, 0);

  const cashPickupTotal = ((cashPickups ?? []) as Record<string, unknown>[])
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  const paymentsBySaleId = new Map<string, Record<string, number>>();
  for (const payment of allPayments) {
    const saleId = String(payment.sale_id ?? '');
    if (!saleId) continue;
    const method = normalizeSalePaymentMethod(payment.payment_method);
    if (!method) continue;
    const salePaymentTotals = paymentsBySaleId.get(saleId) ?? {};
    salePaymentTotals[method] = (salePaymentTotals[method] ?? 0) + Number(payment.amount ?? 0);
    paymentsBySaleId.set(saleId, salePaymentTotals);
  }

  let cashSales = 0;
  let gcashSales = 0;
  for (const sale of completedSales) {
    const saleId = String(sale.sale_id ?? '');
    const totalAmount = Number(sale.total_amount ?? 0);
    const salePaymentTotals = paymentsBySaleId.get(saleId) ?? {};
    const gcashAmount = salePaymentTotals['gcash'] ?? 0;
    const rawCashAmount = salePaymentTotals['cash'] ?? 0;
    const remainingForCash = Math.max(0, totalAmount - gcashAmount);
    const appliedCashAmount = Math.min(rawCashAmount, remainingForCash);

    cashSales += appliedCashAmount;
    gcashSales += gcashAmount;
  }

  const nonCashSales = gcashSales;

  const expectedCash = Number(shiftData.opening_cash ?? 0) + cashSales - cashReturnTotal - cashPickupTotal;

  return {
    shift: shiftData as ShiftReport['shift'],
    txnCount: completedSales.length,
    grossSales,
    discounts,
    netSales,
    voidCount: voidedSales.length,
    voidTotal,
    returnCount: (returns ?? []).length,
    returnTotal,
    cashReturnTotal,
    cashSales,
    gcashSales,
    nonCashSales,
    cashPickupTotal,
    expectedCash,
  };
}

export async function fetchZReadingReport(shiftId: string): Promise<ZReadingReport | null> {
  const { data: currentShift } = await supabase
    .from('pos_shifts')
    .select('*')
    .eq('shift_id', shiftId)
    .maybeSingle();

  if (!currentShift) return null;

  const businessDate = String(
    (currentShift as Record<string, unknown>).shift_date
    ?? (currentShift as Record<string, unknown>).business_date
    ?? ''
  );
  if (!businessDate) return null;

  let { data: sameDateShifts } = await supabase
    .from('pos_shifts')
    .select('*')
    .eq('shift_date', businessDate)
    .eq('terminal_id', String((currentShift as Record<string, unknown>).terminal_id ?? ''));

  if (!(sameDateShifts?.length)) {
    const { data: allShifts } = await supabase.from('pos_shifts').select('*');
    sameDateShifts = (allShifts ?? []).filter((row: Record<string, unknown>) => {
      const rowBusinessDate = String(row.shift_date ?? row.business_date ?? '');
      return rowBusinessDate === businessDate
        && String(row.terminal_id ?? '') === String((currentShift as Record<string, unknown>).terminal_id ?? '');
    });
  }

  const shiftRows = ((sameDateShifts ?? []) as Array<Record<string, unknown>>).map(row => ({
    shift_id: String(row.shift_id ?? ''),
    business_date: String(row.shift_date ?? row.business_date ?? businessDate),
    shift_open_time: String(row.opened_at ?? row.shift_open_time ?? ''),
    shift_close_time: row.closed_at ? String(row.closed_at) : row.shift_close_time ? String(row.shift_close_time) : null,
    opening_cash: Number(row.opening_cash ?? 0),
    status: String(row.status ?? ''),
  })).filter(row => row.shift_id);

  const shiftIds = shiftRows.map(row => row.shift_id);
  if (shiftIds.length === 0) return null;

  const { data: sales } = await supabase
    .from('sales')
    .select('shift_id, sale_id, sale_status, total_amount, discount_amount, subtotal')
    .in('shift_id', shiftIds);

  const { data: returns } = await supabase
    .from('sale_returns')
    .select('shift_id, total_return_amt, refund_method, original_sale_id')
    .in('shift_id', shiftIds);

  const { data: cashPickups } = await supabase
    .from('pos_cash_pickups')
    .select('amount')
    .eq('terminal_id', String((currentShift as Record<string, unknown>).terminal_id ?? ''))
    .eq('business_date', businessDate)
    .eq('is_deleted', false);

  const allSales = (sales ?? []) as Array<Record<string, unknown>>;
  const allReturns = (returns ?? []) as Array<Record<string, unknown>>;
  const completedSales = allSales.filter(row => row.sale_status === 'completed');
  const voidedSales = allSales.filter(row => row.sale_status === 'voided');
  const completedSaleIds = completedSales.map(row => String(row.sale_id ?? '')).filter(Boolean);

  const { data: payments } = completedSaleIds.length > 0
    ? await supabase
      .from('sale_payments')
      .select('sale_id, payment_method, amount')
      .in('sale_id', completedSaleIds)
    : { data: [] };

  const returnSaleIds = allReturns.map(row => String(row.original_sale_id ?? '')).filter(Boolean);
  const { data: returnSalePayments } = returnSaleIds.length > 0
    ? await supabase
      .from('sale_payments')
      .select('sale_id, payment_method, amount')
      .in('sale_id', returnSaleIds)
    : { data: [] };

  const returnPaymentsBySaleId = new Map<string, Array<Record<string, unknown>>>();
  for (const payment of (returnSalePayments ?? []) as Array<Record<string, unknown>>) {
    const saleId = String(payment.sale_id ?? '');
    const bucket = returnPaymentsBySaleId.get(saleId) ?? [];
    bucket.push(payment);
    returnPaymentsBySaleId.set(saleId, bucket);
  }

  const cashReturnTotal = allReturns.reduce((sum, row) => {
    const refundMethod = String(row.refund_method ?? '');
    const amount = Number(row.total_return_amt ?? 0);
    if (refundMethod === 'cash') return sum + amount;
    if (refundMethod !== 'original_method') return sum;

    const salePayments = returnPaymentsBySaleId.get(String(row.original_sale_id ?? '')) ?? [];
    const cashOnlyOriginal = salePayments.length > 0 && salePayments.every(payment => normalizeSalePaymentMethod(payment.payment_method) === 'cash');
    return cashOnlyOriginal ? sum + amount : sum;
  }, 0);

  const cashPickupTotal = ((cashPickups ?? []) as Array<Record<string, unknown>>)
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  const paymentsBySaleId = new Map<string, Record<string, number>>();
  for (const payment of (payments ?? []) as Array<Record<string, unknown>>) {
    const saleId = String(payment.sale_id ?? '');
    const method = normalizeSalePaymentMethod(payment.payment_method);
    if (!saleId || !method) continue;
    const totals = paymentsBySaleId.get(saleId) ?? {};
    totals[method] = (totals[method] ?? 0) + Number(payment.amount ?? 0);
    paymentsBySaleId.set(saleId, totals);
  }

  let cashSales = 0;
  let gcashSales = 0;
  for (const sale of completedSales) {
    const saleId = String(sale.sale_id ?? '');
    const totalAmount = Number(sale.total_amount ?? 0);
    const salePaymentTotals = paymentsBySaleId.get(saleId) ?? {};
    const gcashAmount = salePaymentTotals['gcash'] ?? 0;
    const rawCashAmount = salePaymentTotals['cash'] ?? 0;
    const remainingForCash = Math.max(0, totalAmount - gcashAmount);
    cashSales += Math.min(rawCashAmount, remainingForCash);
    gcashSales += gcashAmount;
  }

  const openingCash = shiftRows.reduce((sum, row) => sum + Number(row.opening_cash ?? 0), 0);
  const expectedCash = openingCash + cashSales - cashReturnTotal - cashPickupTotal;

  return {
    businessDate,
    shiftCount: shiftRows.length,
    openShiftCount: shiftRows.filter(row => row.status === 'open').length,
    closedShiftCount: shiftRows.filter(row => row.status === 'closed').length,
    openingCash,
    txnCount: completedSales.length,
    grossSales: completedSales.reduce((sum, row) => sum + Number(row.subtotal ?? 0), 0),
    discounts: completedSales.reduce((sum, row) => sum + Number(row.discount_amount ?? 0), 0),
    netSales: completedSales.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0),
    voidCount: voidedSales.length,
    voidTotal: voidedSales.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0),
    returnCount: allReturns.length,
    returnTotal: allReturns.reduce((sum, row) => sum + Number(row.total_return_amt ?? 0), 0),
    cashReturnTotal,
    cashSales,
    gcashSales,
    nonCashSales: gcashSales,
    cashPickupTotal,
    expectedCash,
    shifts: shiftRows,
  };
}

export async function updateLoyaltyPoints(
  customerId: string,
  pointsDelta: number,
  txnType: 'earn' | 'redeem' | 'adjustment' | 'expire',
  saleId: string | null,
  createdBy: string
): Promise<number> {
  const { data: customer } = await supabase
    .from('pos_customers')
    .select('loyalty_points')
    .eq('customer_id', customerId)
    .single();

  const current = (customer?.loyalty_points as number) ?? 0;
  const newBalance = Math.max(0, current + pointsDelta);

  await supabase
    .from('pos_customers')
    .update({ loyalty_points: newBalance, updated_at: new Date().toISOString() })
    .eq('customer_id', customerId);

  await supabase.from('pos_loyalty_transactions').insert({
    customer_id: customerId,
    txn_type: txnType,
    points: pointsDelta,
    sale_id: saleId,
    created_by: createdBy,
  });

  return newBalance;
}
