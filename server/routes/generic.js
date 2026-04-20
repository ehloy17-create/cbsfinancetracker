/**
 * Generic REST handler that mimics the Supabase PostgREST interface.
 *
 * Supported patterns used by the frontend:
 *
 *   GET    /rest/v1/:table          — select with filters/order/limit
 *   POST   /rest/v1/:table          — insert (single object or array)
 *   PATCH  /rest/v1/:table          — update rows matching filter
 *   DELETE /rest/v1/:table          — delete rows matching filter
 *
 * Filter format  (query string):
 *   column=eq.value       → column = value
 *   column=neq.value      → column != value
 *   column=gt.value       → column > value
 *   column=gte.value      → column >= value
 *   column=lt.value       → column < value
 *   column=lte.value      → column <= value
 *   column=is.null        → column IS NULL
 *   column=not.is.null    → column IS NOT NULL
 *   column=in.(a,b,c)     → column IN (a,b,c)
 *   column=ilike.*val*    → column LIKE '%val%'
 *
 * PostgREST-style special params:
 *   select=col1,col2,...
 *   order=col.asc / col.desc
 *   limit=N
 *   offset=N
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isAdminRole, isAccountingRole, isKnownUserRole } from '../lib/accessControl.js';
import { syncSupplierTable } from '../lib/supplierMirror.js';

const router = Router();

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const AUTO_AUDIT_EXCLUDED_TABLES = new Set([
  'audit_logs',
  'transactions',
  'bank_transactions',
  'bank_deposits',
  'cash_transactions',
  'checks_issued',
  'disbursements',
  'cashier_remittances',
  'recurring_obligations',
  'bank_reconciliations',
  'suppliers',
  'purchase_orders',
  'payables',
  'payable_payments',
]);

function extractAuditRecordId(row) {
  if (!row || typeof row !== 'object') return '';
  return String(
    row.id
    ?? row.shift_id
    ?? row.terminal_id
    ?? row.sale_id
    ?? row.item_id
    ?? row.payment_id
    ?? row.customer_id
    ?? row.return_id
    ?? ''
  );
}

function buildAuditPreview(row) {
  if (!row || typeof row !== 'object') return null;
  const keys = Object.keys(row).filter(key => !['password', 'password_hash'].includes(key)).slice(0, 12);
  return Object.fromEntries(keys.map(key => [key, row[key]]));
}

async function createAutoAuditLog(req, action, table, rowsBefore = [], rowsAfter = [], extraDetails = {}) {
  if (AUTO_AUDIT_EXCLUDED_TABLES.has(table)) return;

  try {
    const availableColumns = await getTableColumns('audit_logs');
    if (availableColumns.size === 0) return;

    const beforeList = Array.isArray(rowsBefore) ? rowsBefore : [rowsBefore].filter(Boolean);
    const afterList = Array.isArray(rowsAfter) ? rowsAfter : [rowsAfter].filter(Boolean);
    const firstRow = afterList[0] ?? beforeList[0] ?? null;

    const payload = {
      id: uuidv4(),
      user_id: req.user?.id ?? null,
      action,
      module: table,
      table_name: table,
      record_id: extractAuditRecordId(firstRow),
      changes: JSON.stringify({
        before: beforeList.slice(0, 1).map(buildAuditPreview),
        after: afterList.slice(0, 1).map(buildAuditPreview),
      }),
      details: JSON.stringify({
        route: req.originalUrl.split('?')[0],
        count: afterList.length || beforeList.length || 0,
        ...extraDetails,
      }),
      created_at: new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ''),
    };

    const filteredPayload = filterObjectToKnownColumns(payload, availableColumns);
    const cols = Object.keys(filteredPayload);
    if (cols.length === 0) return;

    await pool.query(
      `INSERT INTO \`audit_logs\` (${cols.map(col => `\`${col}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map(col => filteredPayload[col])
    );
  } catch (error) {
    console.error('AUTO AUDIT LOG FAILED:', error.message);
  }
}

// ── Helper: Convert ISO 8601 datetime to MySQL format ──────────
function convertDatetime(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    // Convert ISO format (2026-04-09T10:31:07.342Z) to MySQL format (2026-04-09 10:31:07)
    return value.replace('T', ' ').replace(/\.\d{3}Z?$/, '');
  }
  return value;
}

function normalizePriceLevel(value) {
  if (value === 'Wholesale' || value === 'Special') return value;
  return 'Retail';
}

function normalizeSalePaymentMethod(value) {
  const method = String(value ?? '').trim().toLowerCase();
  if (method === 'cash') return 'cash';
  if (method === 'gcash' || method === 'card' || method === 'bank') return 'gcash';
  return '';
}

async function generatePurchaseOrderNumber() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
       FROM \`purchase_orders\`
      WHERE \`order_date\` = ?`,
    [`${yyyy}-${mm}-${dd}`]
  );
  const nextNumber = Number(rows[0]?.count ?? 0) + 1;
  return `PO-${yyyy}${mm}${dd}-${String(nextNumber).padStart(4, '0')}`;
}

async function generatePayableNumber() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = `PAY-${yyyy}${mm}${dd}-`;
  const [rows] = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(\`payable_number\`, ?) AS UNSIGNED)) AS max_suffix
       FROM \`payables\`
      WHERE \`payable_number\` LIKE ?`,
    [prefix.length + 1, `${prefix}%`]
  );
  const nextNumber = Number(rows[0]?.max_suffix ?? 0) + 1;
  return `${prefix}${String(nextNumber).padStart(4, '0')}`;
}

async function syncPayableBalance(payableId) {
  const normalizedId = String(payableId ?? '').trim();
  if (!normalizedId) return;

  const [[payableRow]] = await pool.query(
    'SELECT id, amount FROM `payables` WHERE `id` = ? LIMIT 1',
    [normalizedId]
  );
  if (!payableRow) return;

  const [[paymentRow]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_paid
       FROM \`payable_payments\`
      WHERE \`payable_id\` = ?`,
    [normalizedId]
  );

  const totalAmount = Number(payableRow.amount ?? 0);
  const totalPaid = Number(paymentRow?.total_paid ?? 0);
  const balance = Math.max(0, totalAmount - totalPaid);
  const status = balance <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'open';

  await pool.query(
    `UPDATE \`payables\`
        SET \`balance\` = ?,
            \`status\` = ?,
            \`updated_at\` = CURRENT_TIMESTAMP
      WHERE \`id\` = ?`,
    [balance, status, normalizedId]
  );
}

function normalizeRowForTable(table, row) {
  if (table === 'inv_products') {
    const hasRetail = Object.prototype.hasOwnProperty.call(row, 'retail_price');
    const hasSelling = Object.prototype.hasOwnProperty.call(row, 'selling_price');
    const hasWholesale = Object.prototype.hasOwnProperty.call(row, 'wholesale_price');
    const hasSpecial = Object.prototype.hasOwnProperty.call(row, 'special_price');

    if (hasRetail || hasSelling) {
      const retailPrice = Number(row.retail_price ?? row.selling_price ?? 0);
      const normalizedRetail = Number.isFinite(retailPrice) ? retailPrice : 0;
      row.retail_price = normalizedRetail;
      row.selling_price = normalizedRetail;
    }
    if (hasWholesale) {
      row.wholesale_price = Number.isFinite(Number(row.wholesale_price)) ? Number(row.wholesale_price) : 0;
    }
    if (hasSpecial) {
      row.special_price = Number.isFinite(Number(row.special_price)) ? Number(row.special_price) : 0;
    }
  }

  if (table === 'inv_product_selling_units') {
    const retailPrice = Number(row.retail_price ?? row.selling_price ?? 0);
    const normalizedRetail = Number.isFinite(retailPrice) ? retailPrice : 0;
    row.retail_price = normalizedRetail;
    row.selling_price = normalizedRetail;
    row.wholesale_price = Number.isFinite(Number(row.wholesale_price)) ? Number(row.wholesale_price) : 0;
    row.special_price = Number.isFinite(Number(row.special_price)) ? Number(row.special_price) : 0;
    row.wholesale_enabled = Number(row.wholesale_enabled) ? 1 : 0;
    row.wholesale_break_qty_in_base_unit = Number.isFinite(Number(row.wholesale_break_qty_in_base_unit))
      ? Number(row.wholesale_break_qty_in_base_unit)
      : 0;
    row.wholesale_block_price = Number.isFinite(Number(row.wholesale_block_price))
      ? Number(row.wholesale_block_price)
      : 0;
    row.qty_in_base_unit = Number.isFinite(Number(row.qty_in_base_unit)) ? Number(row.qty_in_base_unit) : 1;
  }

  if (table === 'pos_customers' && Object.prototype.hasOwnProperty.call(row, 'price_level')) {
    row.price_level = normalizePriceLevel(row.price_level);
  }

  if (table === 'held_sales' && Object.prototype.hasOwnProperty.call(row, 'customer_price_level_snapshot')) {
    row.customer_price_level_snapshot = normalizePriceLevel(row.customer_price_level_snapshot);
  }

  if (table === 'held_sale_items' || table === 'sale_items') {
    const hasRetail = Object.prototype.hasOwnProperty.call(row, 'retail_unit_price');
    const hasUnit = Object.prototype.hasOwnProperty.call(row, 'unit_price');
    const hasSelected = Object.prototype.hasOwnProperty.call(row, 'selected_price_level');
    const hasApplied = Object.prototype.hasOwnProperty.call(row, 'applied_price_level');
    const hasSource = Object.prototype.hasOwnProperty.call(row, 'price_source');

    if (hasRetail || hasUnit) {
      const retailUnitPrice = Number(row.retail_unit_price ?? row.unit_price ?? 0);
      row.retail_unit_price = Number.isFinite(retailUnitPrice) ? retailUnitPrice : 0;
    }
    row.wholesale_enabled = Number(row.wholesale_enabled) ? 1 : 0;
    row.wholesale_break_qty_in_base_unit = Number.isFinite(Number(row.wholesale_break_qty_in_base_unit))
      ? Number(row.wholesale_break_qty_in_base_unit)
      : 0;
    row.wholesale_block_price = Number.isFinite(Number(row.wholesale_block_price))
      ? Number(row.wholesale_block_price)
      : 0;
    row.wholesale_blocks_applied = Number.isFinite(Number(row.wholesale_blocks_applied))
      ? Number(row.wholesale_blocks_applied)
      : 0;
    row.wholesale_base_qty_applied = Number.isFinite(Number(row.wholesale_base_qty_applied))
      ? Number(row.wholesale_base_qty_applied)
      : 0;
    row.retail_remainder_base_qty = Number.isFinite(Number(row.retail_remainder_base_qty))
      ? Number(row.retail_remainder_base_qty)
      : 0;
    row.pricing_breakdown = typeof row.pricing_breakdown === 'string' ? row.pricing_breakdown.trim() : '';
    if (hasSelected) {
      row.selected_price_level = normalizePriceLevel(row.selected_price_level);
    }
    if (hasApplied) {
      row.applied_price_level = normalizePriceLevel(row.applied_price_level);
    }
    if (hasSource) {
      row.price_source = typeof row.price_source === 'string' && row.price_source.trim()
        ? row.price_source.trim()
        : normalizePriceLevel(row.applied_price_level);
    }
  }

  if (table === 'sale_payments' && Object.prototype.hasOwnProperty.call(row, 'payment_method')) {
    const normalizedMethod = normalizeSalePaymentMethod(row.payment_method);
    if (!normalizedMethod) {
      throw new Error('Sale payment method must be Cash or GCash');
    }
    row.payment_method = normalizedMethod;
  }
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function parseMoneyValue(value, fieldName) {
  if (value === null || value === undefined || value === '') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${fieldName} must be a valid amount`);
    return roundMoney(value);
  }
  if (typeof value !== 'string') return value;

  const normalized = value.replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d{0,2})?$/.test(normalized)) {
    throw new Error(`${fieldName} must have at most 2 decimal places`);
  }

  const sign = normalized.startsWith('-') ? -1 : 1;
  const unsigned = normalized.replace(/^-/, '');
  const [wholePart, decimalPart = ''] = unsigned.split('.');
  const cents = (Number(wholePart) * 100) + Number(decimalPart.padEnd(2, '0'));
  return sign * (cents / 100);
}

const MONEY_FIELD_PATTERN = /(^|_)(amount|balance|fee|price|cost|subtotal|total|discount|cash|paid|payment|received|change|beginning|ending|opening)(_|$)/;

function normalizeFinancialValues(row) {
  for (const [key, value] of Object.entries(row)) {
    if (!MONEY_FIELD_PATTERN.test(key)) continue;
    if (typeof value !== 'number' && !(typeof value === 'string' && /^-?\d[\d,]*(\.\d{0,2})?$/.test(value.replace(/,/g, '').trim()))) {
      continue;
    }
    const normalized = parseMoneyValue(value, key);
    if (normalized === null || normalized === undefined || normalized === '') continue;
    if (typeof normalized === 'number' && normalized < 0) {
      throw new Error(`${key} cannot be negative`);
    }
    row[key] = normalized;
  }
}

function calculateGcashNetChange(txn) {
  const amount = Number(txn.amount || 0);
  const fee = Number(txn.transaction_fee || 0);
  const feeEffect = txn.fee_type === 'gcash'
    ? (txn.transaction_type === 'cash_in' ? fee : -fee)
    : 0;
  return roundMoney((txn.transaction_type === 'cash_in' ? amount : -amount) + feeEffect);
}

function getCashFundDeltaFromGcash(txn) {
  const amount = Number(txn.amount || 0);
  const fee = Number(txn.transaction_fee || 0);
  if (txn.transaction_type === 'cash_in' && txn.cash_in_mode !== 'payment' && txn.cash_source === 'cash_fund') {
    return roundMoney(-(amount + (txn.fee_type === 'cash' ? fee : 0)));
  }
  if (txn.transaction_type === 'cash_out' && txn.cash_out_type === 'add_to_cash_fund') {
    return roundMoney(amount + fee);
  }
  return 0;
}

function calculateCashFundBalance(baselineBalance, cashEntries, gcashTransactions) {
  const ledgerDelta = cashEntries.reduce((running, entry) => {
    const amount = Number(entry.amount || 0);
    switch (entry.transaction_type) {
      case 'beginning_balance':
      case 'pos_remittance':
      case 'cash_in':
        return roundMoney(running + amount);
      case 'bank_deposit':
      case 'cash_fund_disbursement':
      case 'cash_out':
        return roundMoney(running - amount);
      default:
        return running;
    }
  }, roundMoney(Number(baselineBalance || 0)));

  return gcashTransactions.reduce(
    (running, txn) => roundMoney(running + getCashFundDeltaFromGcash(txn)),
    ledgerDelta
  );
}

async function getGcashOpeningBalance(accountId, date) {
  const today = new Date().toISOString().split('T')[0];
  if (date === today) {
    const [rows] = await pool.query('SELECT current_beginning_balance FROM `accounts` WHERE `id` = ? LIMIT 1', [accountId]);
    return roundMoney(Number(rows[0]?.current_beginning_balance || 0));
  }

  const [exactHistory] = await pool.query(
    'SELECT beginning_balance FROM `daily_history` WHERE `account_id` = ? AND `date` = ? LIMIT 1',
    [accountId, date]
  );
  if (exactHistory[0]) return roundMoney(Number(exactHistory[0].beginning_balance || 0));

  const [priorHistory] = await pool.query(
    'SELECT ending_balance FROM `daily_history` WHERE `account_id` = ? AND `date` < ? ORDER BY `date` DESC LIMIT 1',
    [accountId, date]
  );
  if (priorHistory[0]) return roundMoney(Number(priorHistory[0].ending_balance || 0));

  const [rows] = await pool.query('SELECT current_beginning_balance FROM `accounts` WHERE `id` = ? LIMIT 1', [accountId]);
  return roundMoney(Number(rows[0]?.current_beginning_balance || 0));
}

async function getAvailableGcashBalance(accountId, date, excludeId = null) {
  const openingBalance = await getGcashOpeningBalance(accountId, date);
  let sql = 'SELECT transaction_type, amount, transaction_fee, fee_type FROM `transactions` WHERE `account_id` = ? AND `date` = ? AND `is_deleted` = 0';
  const params = [accountId, date];
  if (excludeId) {
    sql += ' AND `id` != ?';
    params.push(excludeId);
  }
  const [rows] = await pool.query(sql, params);
  return rows.reduce((running, row) => roundMoney(running + calculateGcashNetChange(row)), openingBalance);
}

async function getAvailableCashFundBalance(date, excludeCashEntryId = null, excludeGcashTransactionId = null) {
  const [historyRows] = await pool.query(
    'SELECT `date`, `ending_balance` FROM `cash_daily_history` WHERE `date` <= ? ORDER BY `date` DESC LIMIT 1',
    [date]
  );
  const baselineDate = historyRows[0]?.date || null;
  const baselineBalance = Number(historyRows[0]?.ending_balance || 0);

  let cashSql = 'SELECT transaction_type, amount FROM `cash_transactions` WHERE `is_deleted` = 0 AND `date` <= ?';
  const cashParams = [date];
  if (baselineDate) {
    cashSql += ' AND `date` > ?';
    cashParams.push(baselineDate);
  }
  if (excludeCashEntryId) {
    cashSql += ' AND `id` != ?';
    cashParams.push(excludeCashEntryId);
  }

  let gcashSql = 'SELECT transaction_type, amount, transaction_fee, fee_type, cash_source, cash_out_type, cash_in_mode FROM `transactions` WHERE `is_deleted` = 0 AND `date` <= ?';
  const gcashParams = [date];
  if (baselineDate) {
    gcashSql += ' AND `date` > ?';
    gcashParams.push(baselineDate);
  }
  if (excludeGcashTransactionId) {
    gcashSql += ' AND `id` != ?';
    gcashParams.push(excludeGcashTransactionId);
  }

  const [[cashRows], [gcashRows]] = await Promise.all([
    pool.query(cashSql, cashParams),
    pool.query(gcashSql, gcashParams),
  ]);

  return calculateCashFundBalance(baselineBalance, cashRows, gcashRows);
}

async function getAvailableBankBalance(bankAccountId, excludeId = null) {
  const [accountRows] = await pool.query(
    'SELECT beginning_balance, current_balance FROM `bank_accounts` WHERE `id` = ? LIMIT 1',
    [bankAccountId]
  );
  const openingBalance = roundMoney(Number(accountRows[0]?.beginning_balance ?? accountRows[0]?.current_balance ?? 0));
  let sql = 'SELECT amount, direction FROM `bank_transactions` WHERE `bank_account_id` = ? AND `is_deleted` = 0';
  const params = [bankAccountId];
  if (excludeId) {
    sql += ' AND `id` != ?';
    params.push(excludeId);
  }
  const [rows] = await pool.query(sql, params);
  return rows.reduce((running, row) => roundMoney(running + (row.direction === 'credit' ? Number(row.amount || 0) : -Number(row.amount || 0))), openingBalance);
}

function isPosProtectedTransaction(row) {
  return (
    (row.transaction_type === 'cash_in' && row.cash_in_mode === 'payment')
    || row.cash_out_type === 'void_reversal'
    || !!row.reversal_of_transaction_id
  );
}

function validateProtectedTransactionMutation(existingRow, updates) {
  if (!isPosProtectedTransaction(existingRow)) return;

  const restrictedFields = [
    'is_deleted',
    'amount',
    'transaction_fee',
    'amount_received',
    'delivery_fee',
    'cash_in_mode',
    'cash_source',
    'cash_out_type',
    'account_id',
    'date',
    'notes',
    'reference_number',
    'description',
    'bank_account_id',
    'fee_type',
    'source_sale_id',
    'reversal_of_transaction_id',
  ];

  if (restrictedFields.some(field => Object.prototype.hasOwnProperty.call(updates, field))) {
    throw new Error(
      existingRow.transaction_type === 'cash_in' && existingRow.cash_in_mode === 'payment'
        ? 'POS product-payment transactions cannot be edited or deleted from the GCash module'
        : 'POS-created reversal transactions cannot be edited or deleted from the GCash module'
    );
  }
}

async function validateDeductionControl(table, row, excludeId = null) {
  if (table === 'transactions') {
    if (row.transaction_type === 'cash_out') {
      const available = await getAvailableGcashBalance(row.account_id, row.date, excludeId);
      const required = roundMoney(Number(row.amount || 0) + (row.fee_type === 'gcash' ? Number(row.transaction_fee || 0) : 0));
      if (required > available) {
        throw new Error(`Insufficient GCash balance. Available: ${available.toFixed(2)}`);
      }
    }
    if (row.transaction_type === 'cash_in' && row.cash_source === 'cash_fund' && row.cash_in_mode !== 'payment') {
      const available = await getAvailableCashFundBalance(row.date, null, excludeId);
      const required = roundMoney(Number(row.amount || 0) + (row.fee_type === 'cash' ? Number(row.transaction_fee || 0) : 0));
      if (required > available) {
        throw new Error(`Insufficient cash fund balance. Available: ${available.toFixed(2)}`);
      }
    }
  }

  if (table === 'cash_transactions' && ['bank_deposit', 'cash_fund_disbursement', 'cash_out'].includes(String(row.transaction_type || ''))) {
    const available = await getAvailableCashFundBalance(row.date, excludeId, null);
    const required = roundMoney(Number(row.amount || 0));
    if (required > available) {
      throw new Error(`Insufficient cash fund balance. Available: ${available.toFixed(2)}`);
    }
  }

  if (table === 'bank_transactions' && row.direction === 'debit') {
    const available = await getAvailableBankBalance(row.bank_account_id, excludeId);
    const required = roundMoney(Number(row.amount || 0));
    if (required > available) {
      throw new Error(`Insufficient bank balance. Available: ${available.toFixed(2)}`);
    }
  }
}

// ── Allowed tables (whitelist) ────────────────────────────────
const ALLOWED_TABLES = new Set([
  'profiles', 'accounts', 'transactions', 'daily_history',
  'system_state', 'audit_logs', 'cash_transactions',
  'bank_accounts', 'bank_deposits', 'bank_transactions',
  'suppliers', 'checks_issued', 'disbursements', 'daily_sales',
  'cash_daily_history', 'cashier_remittances',
  'inv_roles', 'inv_locations', 'inv_categories', 'inv_brands',
  'inv_units', 'inv_products',
  'inv_product_unit_conversions', 'inv_product_selling_units', 'inv_product_pricing_history',
  'inventory_balances', 'inventory_movements',
  'purchase_orders', 'purchase_order_items',
  'receivings', 'receiving_items', 'product_lots',
  'payables', 'payable_payments',
  'recurring_obligations', 'bank_reconciliations', 'finance_owner_movements',
  'finance_owners', 'owner_ledger',
  'stock_transfers', 'stock_transfer_items',
  'adjustments', 'adjustment_items',
  'physical_counts', 'physical_count_items',
  'pos_terminals', 'pos_shifts', 'sales', 'sale_items',
  'sale_payments', 'held_sales', 'held_sale_items',
  'pos_zreading_resets', 'pos_cash_pickups', 'pos_cash_pickup_links',
  'pos_permissions', 'pos_customers', 'pos_recent_items', 'pos_audit_log', 'customer_credit_ledger',
  'sale_returns', 'sale_return_items',
  'hr_departments', 'hr_positions', 'hr_employees', 'hr_rate_history',
  'employee_time_logs',
  'payroll_cutoffs', 'payroll_attendance', 'payroll_biometrics_batches',
  'payroll_holidays', 'sss_table', 'philhealth_table', 'pagibig_table',
  'payroll_earnings_types', 'payroll_deduction_types',
  'payroll_cash_advances', 'payroll_runs', 'payroll_run_items', 'payroll_run_item_lines',
  'company_settings',
]);

// ── Parse PostgREST-style filter params ───────────────────────
const TABLE_COLUMN_CACHE = new Map();

async function getTableColumns(table) {
  if (TABLE_COLUMN_CACHE.has(table)) {
    return TABLE_COLUMN_CACHE.get(table);
  }

  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [table]
  );

  const columnSet = new Set(rows.map((row) => String(row.column_name ?? '')));
  TABLE_COLUMN_CACHE.set(table, columnSet);
  return columnSet;
}

function filterObjectToKnownColumns(row, columnSet) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => columnSet.has(key))
  );
}

function parseFilters(query, reservedKeys, allowedColumns = null) {
  const coerceFilterValue = (input) => {
    if (input === 'true') return true;
    if (input === 'false') return false;
    if (input === 'null') return null;

    // Keep strings with leading zeros (except decimals) as text to avoid id/code mangling.
    const isDecimal = /^-?\d+\.\d+$/.test(input);
    const isInteger = /^-?\d+$/.test(input);
    if (isDecimal || (isInteger && !/^0\d+$/.test(input) && !/^-0\d+$/.test(input))) {
      const n = Number(input);
      if (!Number.isNaN(n)) return n;
    }

    return input;
  };

  const conditions = [];
  const params     = [];

  for (const [key, raw] of Object.entries(query)) {
    if (reservedKeys.has(key)) continue;
    if (allowedColumns && !allowedColumns.has(key)) continue;

    const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;

    // not.is.null
    if (value === 'not.is.null') {
      conditions.push(`\`${key}\` IS NOT NULL`);
      continue;
    }
    // is.null
    if (value === 'is.null') {
      conditions.push(`\`${key}\` IS NULL`);
      continue;
    }

    const match = value.match(/^(eq|neq|gt|gte|lt|lte|in|ilike|like|is|not)\.(.*)$/s);
    if (!match) continue;
    const [, op, val] = match;

    switch (op) {
      case 'eq':    conditions.push(`\`${key}\` = ?`);    params.push(coerceFilterValue(val)); break;
      case 'neq':   conditions.push(`\`${key}\` != ?`);   params.push(coerceFilterValue(val)); break;
      case 'gt':    conditions.push(`\`${key}\` > ?`);    params.push(coerceFilterValue(val)); break;
      case 'gte':   conditions.push(`\`${key}\` >= ?`);   params.push(coerceFilterValue(val)); break;
      case 'lt':    conditions.push(`\`${key}\` < ?`);    params.push(coerceFilterValue(val)); break;
      case 'lte':   conditions.push(`\`${key}\` <= ?`);   params.push(coerceFilterValue(val)); break;
      case 'is':    conditions.push(`\`${key}\` IS ${val === 'null' ? 'NULL' : '?'}`);
                    if (val !== 'null') params.push(coerceFilterValue(val)); break;
      case 'ilike':
      case 'like': {
        const like = val.replace(/\*/g, '%');
        conditions.push(`\`${key}\` LIKE ?`);
        params.push(like);
        break;
      }
      case 'in': {
        const vals = val.replace(/^\(|\)$/g, '').split(',').map(v => coerceFilterValue(v.trim()));
        const placeholders = vals.map(() => '?').join(',');
        conditions.push(`\`${key}\` IN (${placeholders})`);
        params.push(...vals);
        break;
      }
      default: break;
    }
  }

  return { conditions, params };
}

const RESERVED = new Set(['select','order','limit','offset']);

function appendAccessConditions(table, req, conditions, params) {
  // Admin and accounting see all rows without restriction
  if (isAccountingRole(req.user?.role)) return;

  if (table === 'profiles') {
    conditions.push('`id` = ?');
    params.push(req.user.id);
  }

  if (table === 'pos_shifts') {
    conditions.push('`cashier_id` = ?');
    params.push(req.user.id);
  }
}

function ensureMutationAllowed(table, req, updates = null) {
  if (table === 'audit_logs' && !isAdminRole(req.user?.role)) {
    throw httpError(403, 'Admin access is required');
  }

  if (table === 'pos_terminals' || table === 'pos_shifts' || table === 'employee_time_logs') {
    if (!isAdminRole(req.user?.role)) {
      throw httpError(403, 'Admin access is required');
    }
  }

  if (table === 'profiles') {
    if (isAdminRole(req.user?.role)) {
      if (updates && Object.prototype.hasOwnProperty.call(updates, 'role') && !isKnownUserRole(updates.role)) {
        throw httpError(400, 'Invalid role');
      }
      return;
    }

    const keys = Object.keys(updates ?? {});
    if (keys.length !== 1 || keys[0] !== 'last_login') {
      throw httpError(403, 'You cannot update this profile');
    }
  }
}

// ── GET /:table ───────────────────────────────────────────────
router.get('/rest/v1/:table', requireAuth, async (req, res) => {
  const table = req.params.table;
  if (!ALLOWED_TABLES.has(table))
    return res.status(400).json({ error: `Table "${table}" not allowed` });

  if (table === 'audit_logs' && !isAdminRole(req.user?.role)) {
    return res.status(403).json({ error: 'Admin access is required' });
  }

  try {
    const { select, order, limit, offset } = req.query;
    const availableColumns = await getTableColumns(table);
    const { conditions, params } = parseFilters(req.query, RESERVED, availableColumns);
    appendAccessConditions(table, req, conditions, params);

    // Columns — strip PostgREST join/alias syntax; keep only plain column names.
    // Must track parenthesis depth so that "*, rel(a, b, c)" splits correctly
    // and "a", "b", "c" inside the parens don't become standalone columns.
    let cols = '*';
    if (select && select !== '*') {
      const parts = [];
      let depth = 0;
      let token = '';
      for (const ch of select) {
        if (ch === '(') { depth++; token += ch; }
        else if (ch === ')') { depth--; token += ch; }
        else if (ch === ',' && depth === 0) {
          parts.push(token.trim());
          token = '';
        } else {
          token += ch;
        }
      }
      if (token.trim()) parts.push(token.trim());

      const cols_arr = parts.map(c => {
        // Skip join requests: "table(col,col)" or "alias:table(col,col)"
        if (c.includes('(')) return null;
        // Skip alias references: "alias:column"
        if (c.includes(':')) return null;
        if (c === '*') return '*';
        return availableColumns.has(c) ? `\`${c}\`` : null;
      }).filter(Boolean);
      cols = cols_arr.length ? cols_arr.join(', ') : '*';
    }

    let sql = `SELECT ${cols} FROM \`${table}\``;
    if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;

    // ORDER
    if (order) {
      const parts = (Array.isArray(order) ? order : [order]).map(o => {
        const [col, dir] = o.split('.');
        if (!availableColumns.has(col)) return null;
        const direction  = (dir || 'asc').toUpperCase();
        return `\`${col}\` ${direction === 'DESC' ? 'DESC' : 'ASC'}`;
      }).filter(Boolean);
      if (parts.length) {
        sql += ` ORDER BY ${parts.join(', ')}`;
      }
    }

    if (limit)  sql += ` LIMIT ${parseInt(limit)}`;
    if (offset) sql += ` OFFSET ${parseInt(offset)}`;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(`GET /${table}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:table ──────────────────────────────────────────────
router.post('/rest/v1/:table', requireAuth, async (req, res) => {
  const table = req.params.table;
  if (!ALLOWED_TABLES.has(table))
    return res.status(400).json({ error: `Table "${table}" not allowed` });

  try {
    ensureMutationAllowed(table, req, req.body);
    const rows = Array.isArray(req.body) ? req.body : [req.body];
    const inserted = [];

    for (const row of rows) {
      // Normalize payload shape from frontend models to local MySQL schema.
      if (table === 'transactions') {
        if (!row.description) {
          row.description = row.notes || (row.transaction_type === 'cash_out' ? 'Cash out transaction' : 'Cash in transaction');
        }
        if (!Object.prototype.hasOwnProperty.call(row, 'reference_number')) {
          row.reference_number = '';
        }
        if (!row.source) {
          row.source = row.cash_source === 'cash_fund' ? 'cash' : 'gcash';
        }
        if (!Object.prototype.hasOwnProperty.call(row, 'cash_balance')) {
          row.cash_balance = 0;
        }
      }

      if (table === 'cash_transactions') {
        if (!row.description) {
          row.description = row.notes || `Cash transaction (${row.transaction_type || 'entry'})`;
        }
        if (!Object.prototype.hasOwnProperty.call(row, 'reference_number')) {
          row.reference_number = '';
        }
      }

      if (table === 'bank_transactions') {
        if (!row.transaction_type && row.tx_type) {
          row.transaction_type = row.tx_type;
        }
        if (!row.description) {
          row.description = row.notes || 'Bank transaction';
        }
        if (!Object.prototype.hasOwnProperty.call(row, 'reference_number')) {
          row.reference_number = row.ref_number || '';
        }
        if (!Object.prototype.hasOwnProperty.call(row, 'direction')) {
          row.direction = ['deposit', 'interest_income', 'transfer_in'].includes(String(row.transaction_type || '').toLowerCase())
            ? 'credit'
            : 'debit';
        }
        if (!Object.prototype.hasOwnProperty.call(row, 'notes')) {
          row.notes = '';
        }
        delete row.tx_type;
        delete row.ref_number;
      }

      if (table === 'bank_deposits') {
        if (!row.description) {
          row.description = row.notes || row.source_description || 'Bank deposit';
        }
        if (!Object.prototype.hasOwnProperty.call(row, 'reference_number')) {
          row.reference_number = row.ref_number || '';
        }
        delete row.ref_number;
      }

      if (table === 'checks_issued') {
        if (!Object.prototype.hasOwnProperty.call(row, 'date')) {
          row.date = row.issued_date || row.check_date;
        }
        if (!Object.prototype.hasOwnProperty.call(row, 'payee') || !row.payee) {
          row.payee = row.payee_name || row.description || row.notes || `Check #${row.check_number || ''}`.trim();
        }
        if (!Object.prototype.hasOwnProperty.call(row, 'description') || !row.description) {
          row.description = row.notes || `Check #${row.check_number || ''}`.trim();
        }
      }

      if (table === 'disbursements') {
        if (!Object.prototype.hasOwnProperty.call(row, 'description') || !row.description) {
          row.description = row.purpose || row.notes || (row.payee ? `Disbursement to ${row.payee}` : 'Disbursement');
        }
        if (!Object.prototype.hasOwnProperty.call(row, 'reference_number')) {
          row.reference_number = row.ref_number || '';
        }
      }

      if (table === 'payable_payments') {
        if (!Object.prototype.hasOwnProperty.call(row, 'reference_number')) {
          row.reference_number = row.reference_no || '';
        }
        if (!Object.prototype.hasOwnProperty.call(row, 'remarks')) {
          row.remarks = row.notes || '';
        }
      }

      if (table === 'purchase_orders' && (!row.po_number || !String(row.po_number).trim())) {
        row.po_number = await generatePurchaseOrderNumber();
      }

      if (table === 'payables' && (!row.payable_number || !String(row.payable_number).trim())) {
        row.payable_number = await generatePayableNumber();
      }

      normalizeRowForTable(table, row);
      normalizeFinancialValues(row);
      if (table === 'profiles' && Object.prototype.hasOwnProperty.call(row, 'role') && !isKnownUserRole(row.role)) {
        throw httpError(400, 'Invalid role');
      }

      // Auto-assign primary key UUID.
      // For standard tables use `id`; for tables with non-standard PK column names
      // inject the UUID under the correct column so we can SELECT it back afterward.
      const NON_ID_PK_MAP = {
        'pos_terminals': 'terminal_id',
        'pos_shifts':    'shift_id',
        'held_sales':    'held_sale_id',
        'held_sale_items': 'item_id',
        'sales':         'sale_id',
        'sale_items':    'item_id',
        'sale_payments': 'payment_id',
        'sale_returns':  'return_id',
        'pos_customers': 'customer_id',
        // sales/sale_items/sale_payments go through RPC but include here for the pk lookup
      };
      const pkField = NON_ID_PK_MAP[table] ?? 'id';

      if (!row[pkField] && table !== 'system_state') {
        row[pkField] = uuidv4();
      }

      // Convert ISO 8601 datetimes to MySQL format
      for (const [k, v] of Object.entries(row)) {
        row[k] = convertDatetime(v);
      }

      // Serialise any JSON fields
      for (const [k, v] of Object.entries(row)) {
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          row[k] = JSON.stringify(v);
        }
      }

      const availableColumns = await getTableColumns(table);
      if (table === 'audit_logs') {
        if (availableColumns.has('user_id') && (row.user_id === null || row.user_id === undefined || row.user_id === '')) {
          row.user_id = req.user?.id ?? null;
        }
        if (availableColumns.has('record_id') && (row.record_id === null || row.record_id === undefined)) {
          row.record_id = '';
        }
        if (availableColumns.has('module') && (row.module === null || row.module === undefined)) {
          row.module = '';
        }
        if (availableColumns.has('created_at') && !row.created_at) {
          row.created_at = new Date().toISOString();
        }
      }

      const filteredRow = filterObjectToKnownColumns(row, availableColumns);
      await validateDeductionControl(table, filteredRow);

      const cols   = Object.keys(filteredRow).map(c => `\`${c}\``).join(', ');
      const placeh = Object.keys(filteredRow).map(() => '?').join(', ');
      const vals   = Object.values(filteredRow);

      if (!cols) {
        throw httpError(400, `No compatible columns available for ${table}`);
      }

      await pool.query(
        `INSERT INTO \`${table}\` (${cols}) VALUES (${placeh})`,
        vals
      );

      if (table === 'payable_payments') {
        await syncPayableBalance(row.payable_id);
      }

      // Fetch and return the inserted row using the pk we just assigned

      const pkVal = row[pkField] || row.id;
      if (pkVal) {
        const [fetched] = await pool.query(
          `SELECT * FROM \`${table}\` WHERE \`${pkField}\` = ?`, [pkVal]
        );
        if (fetched[0]) inserted.push(fetched[0]);
      }
    }

    await syncSupplierTable(table, inserted, 'upsert');
    await createAutoAuditLog(req, 'CREATE', table, [], inserted, { source: 'generic-rest' });
    res.status(201).json(Array.isArray(req.body) ? inserted : (inserted[0] || {}));
  } catch (err) {
    console.error(`POST /${table}:`, err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PATCH /:table ─────────────────────────────────────────────
router.patch('/rest/v1/:table', requireAuth, async (req, res) => {
  const table = req.params.table;
  if (!ALLOWED_TABLES.has(table))
    return res.status(400).json({ error: `Table "${table}" not allowed` });

  try {
    const availableColumns = await getTableColumns(table);
    const { conditions, params } = parseFilters(req.query, RESERVED, availableColumns);
    appendAccessConditions(table, req, conditions, params);
    if (conditions.length === 0)
      return res.status(400).json({ error: 'Update requires at least one filter' });

    const updates = req.body;
    ensureMutationAllowed(table, req, updates);
    const [existingRows] = await pool.query(
      `SELECT * FROM \`${table}\` WHERE ${conditions.join(' AND ')}`,
      params
    );
    normalizeRowForTable(table, updates);
    normalizeFinancialValues(updates);
    // Convert ISO 8601 datetimes to MySQL format
    for (const [k, v] of Object.entries(updates)) {
      updates[k] = convertDatetime(v);
    }
    // Serialise JSON fields
    for (const [k, v] of Object.entries(updates)) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        updates[k] = JSON.stringify(v);
      }
    }

    if (table === 'audit_logs') {
      if (availableColumns.has('record_id') && (updates.record_id === null || updates.record_id === undefined)) {
        updates.record_id = '';
      }
      if (availableColumns.has('module') && (updates.module === null || updates.module === undefined)) {
        updates.module = '';
      }
    }
    const filteredUpdates = filterObjectToKnownColumns(updates, availableColumns);

    for (const existingRow of existingRows) {
      validateProtectedTransactionMutation(existingRow, filteredUpdates);
      const mergedRow = { ...existingRow, ...filteredUpdates };
      await validateDeductionControl(table, mergedRow, existingRow.id || null);
    }

    const sets   = Object.keys(filteredUpdates).map(c => `\`${c}\` = ?`).join(', ');
    const vals   = Object.values(filteredUpdates);

    if (!sets) {
      return res.json(existingRows);
    }

    const sql = `UPDATE \`${table}\` SET ${sets} WHERE ${conditions.join(' AND ')}`;
    await pool.query(sql, [...vals, ...params]);

    // Return updated rows
    const [rows] = await pool.query(
      `SELECT * FROM \`${table}\` WHERE ${conditions.join(' AND ')}`,
      params
    );
    await syncSupplierTable(table, rows, 'upsert');
    await createAutoAuditLog(req, 'UPDATE', table, existingRows, rows, {
      source: 'generic-rest',
      updated_fields: Object.keys(filteredUpdates),
    });
    res.json(rows);
  } catch (err) {
    console.error(`PATCH /${table}:`, err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── DELETE /:table ────────────────────────────────────────────
router.delete('/rest/v1/:table', requireAuth, async (req, res) => {
  const table = req.params.table;
  if (!ALLOWED_TABLES.has(table))
    return res.status(400).json({ error: `Table "${table}" not allowed` });

  try {
    const availableColumns = await getTableColumns(table);
    const { conditions, params } = parseFilters(req.query, RESERVED, availableColumns);
    appendAccessConditions(table, req, conditions, params);
    if (conditions.length === 0)
      return res.status(400).json({ error: 'Delete requires at least one filter' });

    if ((table === 'profiles' || table === 'pos_terminals' || table === 'pos_shifts' || table === 'audit_logs') && !isAdminRole(req.user?.role)) {
      return res.status(403).json({ error: 'Admin access is required' });
    }

    if (table === 'transactions') {
      const [rows] = await pool.query(
        `SELECT * FROM \`${table}\` WHERE ${conditions.join(' AND ')}`,
        params
      );
      if (rows.some(isPosProtectedTransaction)) {
        return res.status(400).json({ error: 'POS product-payment transactions and their reversals cannot be deleted from the GCash module' });
      }
    }

    const [rowsToDelete] = await pool.query(
      `SELECT * FROM \`${table}\` WHERE ${conditions.join(' AND ')}`,
      params
    );

    await pool.query(
      `DELETE FROM \`${table}\` WHERE ${conditions.join(' AND ')}`,
      params
    );
    if (table === 'payable_payments') {
      const payableIds = [...new Set(rowsToDelete.map((row) => String(row?.payable_id ?? '').trim()).filter(Boolean))];
      for (const payableId of payableIds) {
        await syncPayableBalance(payableId);
      }
    }
    await syncSupplierTable(table, rowsToDelete, 'delete');
    await createAutoAuditLog(req, 'DELETE', table, rowsToDelete, [], { source: 'generic-rest' });
    res.json([]);
  } catch (err) {
    console.error(`DELETE /${table}:`, err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
