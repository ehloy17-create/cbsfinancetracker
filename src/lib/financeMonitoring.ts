import { supabase } from './supabase';
import {
  Account,
  BankAccount,
  BankDeposit,
  BankReconciliation,
  BankTransaction,
  BankTxDirection,
  BankTxType,
  CashTransaction,
  CheckIssued,
  CheckStatus,
  FinanceOwner,
  FinanceOwnerMovement,
  OwnerLedgerEntry,
  Payable,
  RecurringObligation,
  Transaction,
} from './types';
import { calculateCashFundRunningBalance } from './cashTransactions';
import { calculateGcashRunningBalance } from './gcashBalances';
import { computeOwnerBalance, ensureLegacyOwnerMovementLedgerSync, normalizeFinanceOwner, normalizeOwnerLedgerEntry } from './ownerLedger';
import { getTodayDateString, parseMoneyInput, round2 } from './utils';

type RawRow = Record<string, unknown>;

export interface BankAccountMonitoringSummary {
  account: BankAccount;
  actual_balance: number;
  due_today: number;
  due_tomorrow: number;
  overdue_amount: number;
  pdc_amount: number;
  outstanding_amount: number;
  projected_available_balance: number;
  projected_after_tomorrow: number;
  deposits_in_transit_total: number;
  latest_reconciliation_status: BankReconciliation['status'] | null;
  latest_reconciliation_date: string | null;
  latest_reconciliation_variance: number;
  checks_count: number;
}

export interface FinanceDueItem {
  id: string;
  kind: 'check' | 'payable' | 'recurring';
  label: string;
  date: string;
  amount: number;
  status: string;
  source_module: string;
  bank_account_id?: string | null;
}

export interface FinanceActivityItem {
  id: string;
  date: string;
  label: string;
  module: string;
  amount: number;
  direction: 'inflow' | 'outflow';
  status?: string;
  reference?: string;
}

export interface LiquiditySnapshot {
  total_bank_balance: number;
  total_gcash_balance: number;
  total_cash_fund_balance: number;
  total_liquid_funds: number;
  checks_due_today: number;
  checks_due_tomorrow: number;
  overdue_checks: number;
  payable_due_today: number;
  payable_due_within_7_days: number;
  recurring_due_within_7_days: number;
  projected_available_liquidity: number;
  projected_after_tomorrow_liquidity: number;
}

export interface OwnerBalanceSummary {
  owner: FinanceOwner;
  current_balance: number;
  total_increases: number;
  total_decreases: number;
}

export interface FinanceMonitoringSnapshot {
  finance_owners: FinanceOwner[];
  owner_ledger: OwnerLedgerEntry[];
  owner_balances: OwnerBalanceSummary[];
  bank_accounts: BankAccount[];
  bank_transactions: BankTransaction[];
  checks: CheckIssued[];
  bank_deposits: BankDeposit[];
  recurring_obligations: RecurringObligation[];
  reconciliations: BankReconciliation[];
  owner_movements: FinanceOwnerMovement[];
  bank_summaries: BankAccountMonitoringSummary[];
  total_bank_balance: number;
  total_due_today: number;
  total_due_tomorrow: number;
  total_overdue: number;
  total_pdc: number;
  total_checks_outstanding: number;
  total_projected_balance: number;
  total_gcash_balance: number;
  total_cash_fund_balance: number;
  total_liquid_funds: number;
  total_payable_outstanding: number;
  total_payable_due_today: number;
  total_payable_due_within_7_days: number;
  total_recurring_due_today: number;
  total_recurring_due_tomorrow: number;
  total_recurring_due_within_7_days: number;
  total_pending_deposits: number;
  total_deposits_in_transit: number;
  total_verified_deposits: number;
  total_due_to_owner: number;
  total_owner_funding: number;
  total_owner_withdrawals: number;
  total_owner_funding_month: number;
  total_owner_paid_expenses_month: number;
  total_owner_repayments_month: number;
  projected_available_liquidity: number;
  projected_after_tomorrow_liquidity: number;
  projected_cashflow_next_7_days: Array<{ date: string; amount: number }>;
  upcoming_due_items: FinanceDueItem[];
  recent_finance_activity: FinanceActivityItem[];
  recent_owner_ledger: OwnerLedgerEntry[];
  recent_verified_deposits: BankDeposit[];
  latest_reconciliation_statuses: Array<{
    bank_account_id: string;
    bank_name: string;
    statement_date: string;
    status: BankReconciliation['status'];
    variance: number;
  }>;
  liquidity_snapshot: LiquiditySnapshot;
}

export interface DashboardFinanceSnapshot {
  bank_accounts: BankAccount[];
  checks: CheckIssued[];
  total_bank_balance: number;
  total_gcash_balance: number;
  total_cash_fund_balance: number;
  total_liquid_funds: number;
  total_due_today: number;
  total_due_tomorrow: number;
  total_overdue: number;
  total_checks_outstanding: number;
}

const BANK_TX_DIRECTIONS: Partial<Record<BankTxType, BankTxDirection>> = {
  deposit: 'credit',
  interest_income: 'credit',
  transfer_in: 'credit',
  owner_funding: 'credit',
  bank_fee: 'debit',
  check_payment: 'debit',
  disbursement: 'debit',
  withdrawal: 'debit',
  transfer_out: 'debit',
  owner_withdrawal: 'debit',
};

function addDays(base: string, days: number) {
  const date = new Date(`${base}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeDateOnly(value: unknown) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (normalized.includes('T')) return normalized.slice(0, 10);
  if (normalized.includes(' ')) return normalized.split(' ')[0];
  return normalized;
}

export function getBankPassbookKey(bank: Partial<Pick<BankAccount, 'name' | 'bank_name' | 'account_number'>> | null | undefined) {
  return [
    String(bank?.bank_name ?? '').trim().toLowerCase(),
    String(bank?.name ?? '').trim().toLowerCase(),
    String(bank?.account_number ?? '').trim().toLowerCase(),
  ].join('|');
}

function isBetweenInclusive(value: string, start: string, end: string) {
  return value.localeCompare(start) >= 0 && value.localeCompare(end) <= 0;
}

function isApprovedStatus(status: unknown) {
  const normalized = String(status ?? 'approved').toLowerCase();
  return normalized !== 'rejected';
}

export function getCheckLifecycleStatus(
  checkDate: string | null | undefined,
  manuallySet: boolean | number | null | undefined,
  currentStatus: string | null | undefined,
  clearedDate?: string | null
): CheckStatus {
  const normalized = String(currentStatus ?? '').toLowerCase();
  if (normalized === 'cleared' || Boolean(clearedDate)) return 'cleared';
  if (normalized === 'cancelled' || normalized === 'voided') return 'cancelled';
  if (normalized === 'bounced') return 'bounced';
  if (normalized === 'draft') return 'draft';
  if (manuallySet && (normalized === 'outstanding' || normalized === 'pdc')) {
    return normalized as CheckStatus;
  }
  if (!checkDate) return 'draft';
  return checkDate > getTodayDateString() ? 'pdc' : 'outstanding';
}

export function deriveBankTransactionDirection(
  txType: string | null | undefined,
  explicitDirection?: string | null
): BankTxDirection {
  if (explicitDirection === 'credit' || explicitDirection === 'debit') return explicitDirection;
  const normalizedType = String(txType ?? '').toLowerCase() as BankTxType;
  return BANK_TX_DIRECTIONS[normalizedType] ?? 'debit';
}

export function normalizeBankTransaction(raw: RawRow): BankTransaction {
  const txType = String(raw.tx_type ?? raw.transaction_type ?? raw.type ?? 'adjustment') as BankTxType;
  const referenceNumber = String(raw.ref_number ?? raw.reference_number ?? '');
  const notes = String(raw.notes ?? '');
  return {
    id: String(raw.id ?? ''),
    bank_account_id: String(raw.bank_account_id ?? ''),
    date: normalizeDateOnly(raw.date ?? ''),
    tx_type: txType,
    description: String(raw.description ?? notes ?? 'Bank transaction'),
    ref_number: referenceNumber,
    amount: Number(raw.amount ?? 0),
    direction: deriveBankTransactionDirection(txType, raw.direction as string | undefined),
    disbursement_id: raw.disbursement_id ? String(raw.disbursement_id) : null,
    check_id: raw.check_id ? String(raw.check_id) : null,
    payable_id: raw.payable_id ? String(raw.payable_id) : null,
    balance_after: raw.balance_after == null ? null : Number(raw.balance_after),
    module_source: raw.module_source ? String(raw.module_source) : null,
    attachment_reference: raw.attachment_reference ? String(raw.attachment_reference) : null,
    approval_required: Boolean(raw.approval_required),
    approval_status: String(raw.approval_status ?? 'approved') as BankTransaction['approval_status'],
    approved_by: raw.approved_by ? String(raw.approved_by) : null,
    approved_at: raw.approved_at ? String(raw.approved_at) : null,
    source_transaction_id: raw.source_transaction_id ? String(raw.source_transaction_id) : null,
    notes,
    created_by: raw.created_by ? String(raw.created_by) : null,
    is_deleted: Boolean(raw.is_deleted),
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? raw.created_at ?? ''),
    bank_accounts: raw.bank_accounts as BankTransaction['bank_accounts'],
    profiles: raw.profiles as BankTransaction['profiles'],
    source_tx: raw.source_tx as BankTransaction['source_tx'],
  };
}

export function normalizeCheckIssued(raw: RawRow): CheckIssued {
  return {
    id: String(raw.id ?? ''),
    check_number: String(raw.check_number ?? ''),
    bank_account_id: raw.bank_account_id ? String(raw.bank_account_id) : null,
    supplier_id: raw.supplier_id ? String(raw.supplier_id) : null,
    payable_id: raw.payable_id ? String(raw.payable_id) : null,
    issued_date: normalizeDateOnly(raw.issued_date ?? raw.check_date ?? ''),
    check_date: normalizeDateOnly(raw.check_date ?? ''),
    cleared_date: raw.cleared_date ? normalizeDateOnly(raw.cleared_date) : null,
    amount: Number(raw.amount ?? 0),
    payee: String(raw.payee ?? ''),
    description: String(raw.description ?? ''),
    notes: String(raw.notes ?? ''),
    status: getCheckLifecycleStatus(
      raw.check_date as string | undefined,
      raw.manually_set_status as boolean | number | undefined,
      raw.status as string | undefined,
      raw.cleared_date as string | undefined
    ),
    manually_set_status: Boolean(raw.manually_set_status),
    approval_required: Boolean(raw.approval_required),
    approval_status: String(raw.approval_status ?? 'approved') as CheckIssued['approval_status'],
    approved_by: raw.approved_by ? String(raw.approved_by) : null,
    approved_at: raw.approved_at ? String(raw.approved_at) : null,
    rejected_reason: raw.rejected_reason ? String(raw.rejected_reason) : null,
    disbursement_id: raw.disbursement_id ? String(raw.disbursement_id) : null,
    attachment_reference: raw.attachment_reference ? String(raw.attachment_reference) : null,
    created_by: raw.created_by ? String(raw.created_by) : null,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? raw.created_at ?? ''),
    is_deleted: Boolean(raw.is_deleted),
    bank_accounts: raw.bank_accounts as CheckIssued['bank_accounts'],
    suppliers: raw.suppliers as CheckIssued['suppliers'],
    profiles: raw.profiles as CheckIssued['profiles'],
  };
}

function normalizeBankAccount(raw: RawRow): BankAccount {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    account_number: String(raw.account_number ?? ''),
    bank_name: String(raw.bank_name ?? ''),
    beginning_balance: Number(raw.beginning_balance ?? raw.opening_balance ?? raw.current_balance ?? 0),
    current_balance: Number(raw.current_balance ?? 0),
    is_active: raw.is_active == null ? true : Boolean(raw.is_active),
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  };
}

function normalizePayable(raw: RawRow): Payable {
  const totalAmount = Number(raw.total_amount ?? raw.amount ?? 0);
  const balanceDue = Number(raw.balance_due ?? raw.balance ?? totalAmount);
  const amountPaid = Number(raw.amount_paid ?? round2(totalAmount - balanceDue));
  const paymentStatus = String(raw.payment_status ?? raw.status ?? (balanceDue <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'));
  return {
    id: String(raw.id ?? ''),
    payable_number: String(raw.payable_number ?? ''),
    supplier_id: String(raw.supplier_id ?? ''),
    po_id: raw.po_id ? String(raw.po_id) : null,
    receiving_id: raw.receiving_id ? String(raw.receiving_id) : null,
    invoice_number: String(raw.invoice_number ?? ''),
    invoice_date: String(raw.invoice_date ?? raw.created_at ?? ''),
    due_date: String(raw.due_date ?? raw.invoice_date ?? raw.created_at ?? ''),
    total_amount: totalAmount,
    amount_paid: amountPaid,
    balance_due: balanceDue,
    payment_status: paymentStatus as Payable['payment_status'],
    remarks: String(raw.remarks ?? raw.notes ?? ''),
    created_by: raw.created_by ? String(raw.created_by) : null,
    updated_by: raw.updated_by ? String(raw.updated_by) : null,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? raw.created_at ?? ''),
    inv_suppliers: raw.inv_suppliers as Payable['inv_suppliers'],
    purchase_orders: raw.purchase_orders as Payable['purchase_orders'],
    receivings: raw.receivings as Payable['receivings'],
    creator: raw.creator as Payable['creator'],
  };
}

function normalizeBankDeposit(raw: RawRow): BankDeposit {
  return {
    id: String(raw.id ?? ''),
    bank_account_id: String(raw.bank_account_id ?? ''),
    date: normalizeDateOnly(raw.date ?? raw.created_at ?? ''),
    amount: Number(raw.amount ?? 0),
    source_type: String(raw.source_type ?? ''),
    source_description: String(raw.source_description ?? ''),
    notes: String(raw.notes ?? ''),
    source_transaction_id: raw.source_transaction_id ? String(raw.source_transaction_id) : null,
    status: String(raw.status ?? 'verified') as BankDeposit['status'],
    deposited_at: raw.deposited_at ? String(raw.deposited_at) : null,
    verified_at: raw.verified_at ? String(raw.verified_at) : null,
    verified_by: raw.verified_by ? String(raw.verified_by) : null,
    cancelled_at: raw.cancelled_at ? String(raw.cancelled_at) : null,
    cashier_remittance_id: raw.cashier_remittance_id ? String(raw.cashier_remittance_id) : null,
    source_module: raw.source_module ? String(raw.source_module) : null,
    attachment_reference: raw.attachment_reference ? String(raw.attachment_reference) : null,
    created_by: raw.created_by ? String(raw.created_by) : null,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? raw.created_at ?? ''),
    is_deleted: Boolean(raw.is_deleted),
    bank_accounts: raw.bank_accounts as BankDeposit['bank_accounts'],
    profiles: raw.profiles as BankDeposit['profiles'],
  };
}

function normalizeRecurringObligation(raw: RawRow): RecurringObligation {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    category: String(raw.category ?? 'general'),
    default_amount: Number(raw.default_amount ?? 0),
    frequency: String(raw.frequency ?? 'monthly') as RecurringObligation['frequency'],
    due_date_rule: String(raw.due_date_rule ?? ''),
    next_due_date: String(raw.next_due_date ?? ''),
    is_active: raw.is_active == null ? true : Boolean(raw.is_active),
    remarks: String(raw.remarks ?? ''),
    paid_transaction_id: raw.paid_transaction_id ? String(raw.paid_transaction_id) : null,
    paid_disbursement_id: raw.paid_disbursement_id ? String(raw.paid_disbursement_id) : null,
    last_paid_date: raw.last_paid_date ? String(raw.last_paid_date) : null,
    last_paid_amount: raw.last_paid_amount == null ? null : Number(raw.last_paid_amount),
    created_by: raw.created_by ? String(raw.created_by) : null,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? raw.created_at ?? ''),
  };
}

function normalizeBankReconciliation(raw: RawRow): BankReconciliation {
  return {
    id: String(raw.id ?? ''),
    bank_account_id: String(raw.bank_account_id ?? ''),
    statement_date: normalizeDateOnly(raw.statement_date ?? ''),
    statement_ending_balance: Number(raw.statement_ending_balance ?? 0),
    system_book_balance: Number(raw.system_book_balance ?? 0),
    uncleared_checks_total: Number(raw.uncleared_checks_total ?? 0),
    deposits_in_transit_total: Number(raw.deposits_in_transit_total ?? 0),
    adjusted_balance: Number(raw.adjusted_balance ?? 0),
    variance: Number(raw.variance ?? 0),
    remarks: String(raw.remarks ?? ''),
    status: String(raw.status ?? 'draft') as BankReconciliation['status'],
    created_by: raw.created_by ? String(raw.created_by) : null,
    reviewed_by: raw.reviewed_by ? String(raw.reviewed_by) : null,
    reviewed_at: raw.reviewed_at ? String(raw.reviewed_at) : null,
    finalized_by: raw.finalized_by ? String(raw.finalized_by) : null,
    finalized_at: raw.finalized_at ? String(raw.finalized_at) : null,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? raw.created_at ?? ''),
    bank_accounts: raw.bank_accounts as BankReconciliation['bank_accounts'],
  };
}

function normalizeOwnerMovement(raw: RawRow): FinanceOwnerMovement {
  return {
    id: String(raw.id ?? ''),
    date: String(raw.date ?? ''),
    movement_type: String(raw.movement_type ?? 'funding') as FinanceOwnerMovement['movement_type'],
    target_module: String(raw.target_module ?? 'bank') as FinanceOwnerMovement['target_module'],
    owner_id: raw.owner_id ? String(raw.owner_id) : null,
    bank_account_id: raw.bank_account_id ? String(raw.bank_account_id) : null,
    account_id: raw.account_id ? String(raw.account_id) : null,
    amount: Number(raw.amount ?? 0),
    reference_number: String(raw.reference_number ?? ''),
    remarks: String(raw.remarks ?? ''),
    attachment_reference: raw.attachment_reference ? String(raw.attachment_reference) : null,
    approval_required: Boolean(raw.approval_required),
    approval_status: String(raw.approval_status ?? 'approved') as FinanceOwnerMovement['approval_status'],
    approved_by: raw.approved_by ? String(raw.approved_by) : null,
    approved_at: raw.approved_at ? String(raw.approved_at) : null,
    posted_bank_transaction_id: raw.posted_bank_transaction_id ? String(raw.posted_bank_transaction_id) : null,
    posted_transaction_id: raw.posted_transaction_id ? String(raw.posted_transaction_id) : null,
    posted_cash_transaction_id: raw.posted_cash_transaction_id ? String(raw.posted_cash_transaction_id) : null,
    owner_ledger_id: raw.owner_ledger_id ? String(raw.owner_ledger_id) : null,
    created_by: raw.created_by ? String(raw.created_by) : null,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? raw.created_at ?? ''),
    bank_accounts: raw.bank_accounts as FinanceOwnerMovement['bank_accounts'],
    accounts: raw.accounts as FinanceOwnerMovement['accounts'],
    profiles: raw.profiles as FinanceOwnerMovement['profiles'],
  };
}

export function calculateBankLedgerBalance(account: Pick<BankAccount, 'beginning_balance' | 'current_balance'>, transactions: BankTransaction[]): number {
  const opening = Number(account.beginning_balance ?? account.current_balance ?? 0);
  return round2(
    transactions.reduce((running, tx) => {
      const delta = Number(tx.amount ?? 0);
      return tx.direction === 'credit'
        ? round2(running + delta)
        : round2(running - delta);
    }, opening)
  );
}

export function buildBankAccountMonitoringSummary(
  accounts: BankAccount[],
  transactions: BankTransaction[],
  checks: CheckIssued[],
  deposits: BankDeposit[] = [],
  reconciliations: BankReconciliation[] = []
): BankAccountMonitoringSummary[] {
  const today = getTodayDateString();
  const tomorrow = addDays(today, 1);

  return accounts.map(account => {
    const accountTxs = transactions
      .filter(tx => tx.bank_account_id === account.id && !tx.is_deleted)
      .sort((a, b) => `${a.date} ${a.created_at}`.localeCompare(`${b.date} ${b.created_at}`));
    const accountChecks = checks.filter(
      check =>
        check.bank_account_id === account.id
        && !check.is_deleted
        && isApprovedStatus(check.approval_status)
    );
    const calculatedBalance = calculateBankLedgerBalance(account, accountTxs);
    const actualBalance = Number.isFinite(Number(account.current_balance))
      ? round2(Number(account.current_balance))
      : calculatedBalance;
    const dueToday = round2(accountChecks.filter(check => check.status === 'outstanding' && check.check_date === today).reduce((sum, check) => sum + Number(check.amount), 0));
    const dueTomorrow = round2(accountChecks.filter(check => check.status === 'outstanding' && check.check_date === tomorrow).reduce((sum, check) => sum + Number(check.amount), 0));
    const overdue = round2(accountChecks.filter(check => check.status === 'outstanding' && check.check_date < today).reduce((sum, check) => sum + Number(check.amount), 0));
    const pdcAmount = round2(accountChecks.filter(check => check.status === 'pdc').reduce((sum, check) => sum + Number(check.amount), 0));
    const outstandingAmount = round2(accountChecks.filter(check => check.status === 'outstanding').reduce((sum, check) => sum + Number(check.amount), 0));
    const depositsInTransitTotal = round2(
      deposits
        .filter(
          deposit =>
            deposit.bank_account_id === account.id
            && !deposit.is_deleted
            && (deposit.status === 'pending' || deposit.status === 'deposited')
        )
        .reduce((sum, deposit) => sum + Number(deposit.amount), 0)
    );
    const latestReconciliation = reconciliations
      .filter(reconciliation => reconciliation.bank_account_id === account.id)
      .sort((a, b) => `${b.statement_date} ${b.created_at}`.localeCompare(`${a.statement_date} ${a.created_at}`))[0];
    const projectedAvailableBalance = round2(actualBalance - dueToday - overdue);
    const projectedAfterTomorrow = round2(projectedAvailableBalance - dueTomorrow);

    return {
      account: {
        ...account,
        current_balance: actualBalance,
        actual_balance: actualBalance,
        due_today: dueToday,
        due_tomorrow: dueTomorrow,
        overdue_amount: overdue,
        pdc_amount: pdcAmount,
        projected_available_balance: projectedAvailableBalance,
      },
      actual_balance: actualBalance,
      due_today: dueToday,
      due_tomorrow: dueTomorrow,
      overdue_amount: overdue,
      pdc_amount: pdcAmount,
      outstanding_amount: outstandingAmount,
      projected_available_balance: projectedAvailableBalance,
      projected_after_tomorrow: projectedAfterTomorrow,
      deposits_in_transit_total: depositsInTransitTotal,
      latest_reconciliation_status: latestReconciliation?.status ?? null,
      latest_reconciliation_date: latestReconciliation?.statement_date ?? null,
      latest_reconciliation_variance: Number(latestReconciliation?.variance ?? 0),
      checks_count: accountChecks.filter(check => check.status === 'outstanding' || check.status === 'pdc').length,
    };
  });
}

export async function calculateCashFundBalance(): Promise<number> {
  const { data: latestHistory } = await supabase
    .from('cash_daily_history')
    .select('date, ending_balance')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const baselineDate = latestHistory?.date ? String(latestHistory.date) : null;
  const baselineBalance = Number(latestHistory?.ending_balance ?? 0);

  let query = supabase
    .from('cash_transactions')
    .select('transaction_type, amount')
    .eq('is_deleted', false);

  if (baselineDate) {
    query = query.gt('date', baselineDate);
  }

  let gcashQuery = supabase
    .from('transactions')
    .select('transaction_type, amount, transaction_fee, fee_type, cash_source, cash_out_type, cash_in_mode, amount_received')
    .eq('is_deleted', false);

  if (baselineDate) {
    gcashQuery = gcashQuery.gt('date', baselineDate);
  }

  const [{ data: cashTransactions }, { data: gcashTransactions }] = await Promise.all([query, gcashQuery]);

  return calculateCashFundRunningBalance(
    baselineBalance,
    (cashTransactions || []) as Pick<CashTransaction, 'transaction_type' | 'amount'>[],
    (gcashTransactions || []) as Array<Pick<Transaction, 'transaction_type' | 'amount' | 'transaction_fee' | 'fee_type' | 'cash_source' | 'cash_out_type' | 'cash_in_mode' | 'amount_received'>>
  );
}

export interface CashLedgerEntryInput {
  date: string;
  transaction_type: string;
  amount: number | string;
  description?: string;
  reference_number?: string;
  notes?: string;
  source_module?: string | null;
  source_reference_id?: string | null;
  transaction_category?: 'regular' | 'disbursement' | 'transfer';
  disbursement_id?: string | null;
  created_by?: string | null;
}

export async function createCashLedgerEntry(entry: CashLedgerEntryInput) {
  const amount = parseMoneyInput(entry.amount, 'Amount');
  if (amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }

  const deductionTypes = new Set(['bank_deposit', 'cash_fund_disbursement', 'cash_out']);
  if (deductionTypes.has(entry.transaction_type)) {
    const availableBalance = await calculateCashFundBalance();
    if (amount > availableBalance) {
      throw new Error(`Insufficient cash fund balance. Available: ${availableBalance.toFixed(2)}`);
    }
  }

  const payload = {
    date: entry.date,
    transaction_type: entry.transaction_type,
    transaction_category: entry.transaction_category ?? (
      entry.transaction_type === 'cash_fund_disbursement'
        ? 'disbursement'
        : entry.transaction_type === 'bank_deposit' || entry.transaction_type === 'pos_remittance'
        ? 'transfer'
        : 'regular'
    ),
    amount,
    description: entry.description?.trim() || entry.notes?.trim() || `Cash transaction (${entry.transaction_type})`,
    reference_number: entry.reference_number?.trim() || '',
    notes: entry.notes?.trim() || '',
    source_module: entry.source_module ?? null,
    source_reference_id: entry.source_reference_id ?? null,
    disbursement_id: entry.disbursement_id ?? null,
    created_by: entry.created_by ?? null,
  };

  const { data, error } = await supabase.from('cash_transactions').insert(payload).select().maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadDashboardFinanceSnapshot(): Promise<DashboardFinanceSnapshot> {
  const [
    { data: bankAccountRows },
    { data: bankTransactionRows },
    { data: checkRows },
    { data: gcashAccountRows },
    { data: todayGcashRows },
  ] = await Promise.all([
    supabase.from('bank_accounts').select('*').eq('is_active', true).order('name'),
    supabase.from('bank_transactions').select('*').eq('is_deleted', false).order('date', { ascending: true }).order('created_at', { ascending: true }),
    supabase.from('checks_issued').select('*').eq('is_deleted', false).order('check_date', { ascending: true }),
    supabase.from('accounts').select('id, name, current_beginning_balance').eq('is_active', true).order('name'),
    supabase
      .from('transactions')
      .select('account_id, transaction_type, amount, transaction_fee, fee_type, cash_out_type')
      .eq('date', getTodayDateString())
      .eq('is_deleted', false)
      .eq('is_closed', false),
  ]);

  const bankAccounts = ((bankAccountRows || []) as RawRow[]).map(normalizeBankAccount);
  const bankTransactions = ((bankTransactionRows || []) as RawRow[]).map(normalizeBankTransaction);
  const checks = ((checkRows || []) as RawRow[]).map(normalizeCheckIssued);
  const bankSummaries = buildBankAccountMonitoringSummary(bankAccounts, bankTransactions, checks);

  const totalBankBalance = round2(bankSummaries.reduce((sum, summary) => sum + summary.actual_balance, 0));
  const totalDueToday = round2(bankSummaries.reduce((sum, summary) => sum + summary.due_today, 0));
  const totalDueTomorrow = round2(bankSummaries.reduce((sum, summary) => sum + summary.due_tomorrow, 0));
  const totalOverdue = round2(bankSummaries.reduce((sum, summary) => sum + summary.overdue_amount, 0));
  const totalOutstandingChecks = round2(bankSummaries.reduce((sum, summary) => sum + summary.outstanding_amount, 0));

  const gcashAccounts = (gcashAccountRows || []) as Account[];
  const gcashTransactions = (todayGcashRows || []) as Array<{
    account_id: string;
    transaction_type: 'cash_in' | 'cash_out';
    amount: number;
    transaction_fee: number;
    fee_type: 'cash' | 'gcash';
    cash_out_type: 'disbursement' | 'add_to_cash_fund' | 'pos_remittance' | 'move_to_bank' | null;
  }>;
  const totalGcashBalance = round2(
    gcashAccounts.reduce(
      (sum, account) =>
        sum +
        calculateGcashRunningBalance(
          account,
          gcashTransactions.filter(tx => tx.account_id === account.id)
        ),
      0
    )
  );

  const totalCashFundBalance = await calculateCashFundBalance();
  const totalLiquidFunds = round2(totalBankBalance + totalGcashBalance + totalCashFundBalance);

  return {
    bank_accounts: bankSummaries.map(summary => summary.account),
    checks,
    total_bank_balance: totalBankBalance,
    total_gcash_balance: totalGcashBalance,
    total_cash_fund_balance: totalCashFundBalance,
    total_liquid_funds: totalLiquidFunds,
    total_due_today: totalDueToday,
    total_due_tomorrow: totalDueTomorrow,
    total_overdue: totalOverdue,
    total_checks_outstanding: totalOutstandingChecks,
  };
}

export async function syncBankAccountBalances(bankAccountIds?: string[] | string): Promise<void> {
  const ids = Array.isArray(bankAccountIds)
    ? bankAccountIds.filter(Boolean)
    : bankAccountIds
    ? [bankAccountIds]
    : [];

  let accountsQuery = supabase.from('bank_accounts').select('id, beginning_balance, current_balance').eq('is_active', true);
  if (ids.length === 1) accountsQuery = accountsQuery.eq('id', ids[0]);
  else if (ids.length > 1) accountsQuery = accountsQuery.in('id', ids);

  const { data: accountsRows } = await accountsQuery;
  const accounts = ((accountsRows || []) as RawRow[]).map(normalizeBankAccount);
  if (accounts.length === 0) return;

  let txQuery = supabase
    .from('bank_transactions')
    .select('id, bank_account_id, transaction_type, amount, date, created_at, direction, is_deleted')
    .eq('is_deleted', false);
  if (accounts.length === 1) txQuery = txQuery.eq('bank_account_id', accounts[0].id);
  else txQuery = txQuery.in('bank_account_id', accounts.map(account => account.id));

  const { data: transactionRows } = await txQuery;
  const transactions = ((transactionRows || []) as RawRow[]).map(normalizeBankTransaction);

  await Promise.all(
    accounts.map(async account => {
      const actualBalance = calculateBankLedgerBalance(
        account,
        transactions
          .filter(tx => tx.bank_account_id === account.id)
          .sort((a, b) => `${a.date} ${a.created_at}`.localeCompare(`${b.date} ${b.created_at}`))
      );
      if (round2(Number(account.current_balance)) === actualBalance) return;
      await supabase
        .from('bank_accounts')
        .update({ current_balance: actualBalance, updated_at: new Date().toISOString() })
        .eq('id', account.id);
    })
  );
}

export interface BankLedgerEntryInput {
  bank_account_id: string;
  date: string;
  tx_type: BankTxType;
  amount: number | string;
  description: string;
  ref_number?: string;
  direction?: BankTxDirection;
  notes?: string;
  source_transaction_id?: string | null;
  check_id?: string | null;
  disbursement_id?: string | null;
  payable_id?: string | null;
  module_source?: string | null;
  attachment_reference?: string | null;
  created_by?: string | null;
}

export async function createBankLedgerEntry(entry: BankLedgerEntryInput) {
  const amount = parseMoneyInput(entry.amount, 'Amount');
  if (amount <= 0) {
    throw new Error('Amount must be greater than zero');
  }

  const direction = entry.direction ?? deriveBankTransactionDirection(entry.tx_type);
  // Skip balance validation for system-reconciliation entries — check clearances are already
  // counted as outstanding (pre-committed), and deposit postings are pre-verified by finance staff.
  const skipBalanceCheck = entry.module_source === 'check_clearance' || entry.module_source === 'finance_deposit';
  if (direction === 'debit' && !skipBalanceCheck) {
    const { data: accountRow } = await supabase
      .from('bank_accounts')
      .select('id, beginning_balance, current_balance')
      .eq('id', entry.bank_account_id)
      .maybeSingle();
    if (!accountRow) {
      throw new Error('Bank account not found');
    }
    const { data: txRows } = await supabase
      .from('bank_transactions')
      .select('*')
      .eq('bank_account_id', entry.bank_account_id)
      .eq('is_deleted', false)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true });

    const availableBalance = calculateBankLedgerBalance(
      normalizeBankAccount(accountRow as RawRow),
      ((txRows || []) as RawRow[]).map(normalizeBankTransaction)
    );
    if (amount > availableBalance) {
      throw new Error(`Insufficient bank balance. Available: ${availableBalance.toFixed(2)}`);
    }
  }

  const payload = {
    bank_account_id: entry.bank_account_id,
    date: entry.date,
    transaction_type: entry.tx_type,
    description: entry.description,
    reference_number: entry.ref_number ?? '',
    amount,
    direction,
    notes: entry.notes ?? '',
    source_transaction_id: entry.source_transaction_id ?? null,
    check_id: entry.check_id ?? null,
    disbursement_id: entry.disbursement_id ?? null,
    payable_id: entry.payable_id ?? null,
    module_source: entry.module_source ?? null,
    attachment_reference: entry.attachment_reference ?? null,
    created_by: entry.created_by ?? null,
  };

  const { data, error } = await supabase.from('bank_transactions').insert(payload).select().maybeSingle();
  if (error) throw error;
  await syncBankAccountBalances(entry.bank_account_id);
  return data;
}

export async function archiveBankTransactions(filters: {
  check_id?: string;
  source_transaction_id?: string;
  payable_id?: string;
  bank_account_id?: string;
}) {
  let query = supabase.from('bank_transactions').select('id, bank_account_id').eq('is_deleted', false);
  if (filters.check_id) query = query.eq('check_id', filters.check_id);
  if (filters.source_transaction_id) query = query.eq('source_transaction_id', filters.source_transaction_id);
  if (filters.payable_id) query = query.eq('payable_id', filters.payable_id);
  if (filters.bank_account_id) query = query.eq('bank_account_id', filters.bank_account_id);

  const { data } = await query;
  const rows = (data || []) as Array<{ id: string; bank_account_id: string }>;
  if (rows.length === 0) return;

  await Promise.all(
    rows.map(row =>
      supabase
        .from('bank_transactions')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('id', row.id)
    )
  );

  await syncBankAccountBalances([...new Set(rows.map(row => row.bank_account_id))]);
}

export async function ensureCheckClearingLedger(check: CheckIssued, clearedDate: string, userId?: string | null) {
  if (!check.bank_account_id) return;
  const ledgerDate = normalizeDateOnly(clearedDate || check.cleared_date || check.check_date || check.issued_date || getTodayDateString());
  const description = check.payee || check.notes || `Check #${check.check_number}`;
  const { data: existing } = await supabase
    .from('bank_transactions')
    .select('id, date, transaction_type, amount, reference_number')
    .eq('check_id', check.id)
    .eq('is_deleted', false)
    .maybeSingle();

  if (!existing) {
    await createBankLedgerEntry({
      bank_account_id: check.bank_account_id,
      date: ledgerDate,
      tx_type: 'check_payment',
      amount: Number(check.amount),
      description,
      ref_number: check.check_number,
      direction: 'debit',
      notes: check.notes || '',
      check_id: check.id,
      disbursement_id: check.disbursement_id,
      payable_id: check.payable_id ?? null,
      module_source: 'check_clearance',
      created_by: userId ?? null,
    });
    return;
  }

  const needsUpdate = normalizeDateOnly(existing.date) !== ledgerDate
    || String(existing.transaction_type ?? '') !== 'check_payment'
    || round2(Number(existing.amount ?? 0)) !== round2(Number(check.amount ?? 0))
    || String(existing.reference_number ?? '') !== String(check.check_number ?? '');

  if (needsUpdate) {
    const { error } = await supabase
      .from('bank_transactions')
      .update({
        date: ledgerDate,
        transaction_type: 'check_payment',
        description,
        reference_number: check.check_number,
        amount: Number(check.amount),
        direction: 'debit',
        notes: check.notes || '',
        updated_at: new Date().toISOString(),
      })
      .eq('id', String(existing.id));
    if (error) throw error;
  }

  await syncBankAccountBalances(check.bank_account_id);
}

export async function loadFinanceMonitoringSnapshot(): Promise<FinanceMonitoringSnapshot> {
  try {
    await ensureLegacyOwnerMovementLedgerSync();
  } catch (err) {
    console.warn('[loadFinanceMonitoringSnapshot] legacy sync failed, continuing:', err);
  }
  const [
    { data: ownerRows },
    { data: ownerLedgerRows },
    { data: bankAccountRows },
    { data: bankTransactionRows },
    { data: checkRows },
    { data: bankDepositRows },
    { data: reconciliationRows },
    { data: obligationRows },
    { data: ownerMovementRows },
    { data: gcashAccountRows },
    { data: todayGcashRows },
    { data: payableRows },
  ] = await Promise.all([
    supabase.from('finance_owners').select('*').eq('is_active', true).order('name'),
    supabase.from('owner_ledger').select('*').eq('is_deleted', false).order('transaction_date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('bank_accounts').select('*').eq('is_active', true).order('name'),
    supabase.from('bank_transactions').select('*').eq('is_deleted', false).order('date', { ascending: true }).order('created_at', { ascending: true }),
    supabase.from('checks_issued').select('*').eq('is_deleted', false).order('check_date', { ascending: true }),
    supabase.from('bank_deposits').select('*').eq('is_deleted', false).order('date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('bank_reconciliations').select('*').order('statement_date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('recurring_obligations').select('*').order('next_due_date', { ascending: true }),
    supabase.from('finance_owner_movements').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('accounts').select('id, name, current_beginning_balance').eq('is_active', true).order('name'),
    supabase
      .from('transactions')
      .select('account_id, transaction_type, amount, transaction_fee, fee_type, cash_out_type')
      .eq('date', getTodayDateString())
      .eq('is_deleted', false)
      .eq('is_closed', false),
    supabase.from('payables').select('*'),
  ]);

  const financeOwners = ((ownerRows || []) as RawRow[]).map(normalizeFinanceOwner);
  const ownerLedger = ((ownerLedgerRows || []) as RawRow[]).map(normalizeOwnerLedgerEntry);
  const bankAccounts = ((bankAccountRows || []) as RawRow[]).map(normalizeBankAccount);
  let bankTransactions = ((bankTransactionRows || []) as RawRow[]).map(normalizeBankTransaction);
  const checks = ((checkRows || []) as RawRow[]).map(normalizeCheckIssued);
  for (const check of checks) {
    if (check.status === 'cleared' && check.bank_account_id) {
      try {
        await ensureCheckClearingLedger(check, check.cleared_date || check.check_date || check.issued_date || getTodayDateString());
      } catch (err) {
        console.warn('[loadFinanceMonitoringSnapshot] check clearing ledger sync skipped for check', check.id, err);
      }
    }
  }
  const [{ data: refreshedBankTransactionRows }, { data: refreshedBankAccountRows }] = await Promise.all([
    supabase
      .from('bank_transactions')
      .select('*, bank_accounts(id, name, bank_name, account_number)')
      .eq('is_deleted', false)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase.from('bank_accounts').select('*').eq('is_active', true).order('name'),
  ]);
  bankTransactions = ((refreshedBankTransactionRows || []) as RawRow[]).map(normalizeBankTransaction);
  const refreshedBankAccounts = ((refreshedBankAccountRows || []) as RawRow[]).map(normalizeBankAccount);
  if (refreshedBankAccounts.length > 0) {
    bankAccounts.splice(0, bankAccounts.length, ...refreshedBankAccounts);
  }
  const bankDeposits = ((bankDepositRows || []) as RawRow[]).map(normalizeBankDeposit);
  const reconciliations = ((reconciliationRows || []) as RawRow[]).map(normalizeBankReconciliation);
  const recurringObligations = ((obligationRows || []) as RawRow[]).map(normalizeRecurringObligation);
  const ownerMovements = ((ownerMovementRows || []) as RawRow[]).map(normalizeOwnerMovement);
  const bankSummaries = buildBankAccountMonitoringSummary(bankAccounts, bankTransactions, checks, bankDeposits, reconciliations);

  const totalBankBalance = round2(bankSummaries.reduce((sum, summary) => sum + summary.actual_balance, 0));
  const totalDueToday = round2(bankSummaries.reduce((sum, summary) => sum + summary.due_today, 0));
  const totalDueTomorrow = round2(bankSummaries.reduce((sum, summary) => sum + summary.due_tomorrow, 0));
  const totalOverdue = round2(bankSummaries.reduce((sum, summary) => sum + summary.overdue_amount, 0));
  const totalPdc = round2(bankSummaries.reduce((sum, summary) => sum + summary.pdc_amount, 0));
  const totalOutstandingChecks = round2(bankSummaries.reduce((sum, summary) => sum + summary.outstanding_amount, 0));
  const totalProjectedBalance = round2(bankSummaries.reduce((sum, summary) => sum + summary.projected_available_balance, 0));
  const totalDepositsInTransit = round2(bankSummaries.reduce((sum, summary) => sum + summary.deposits_in_transit_total, 0));

  const gcashAccounts = (gcashAccountRows || []) as Account[];
  const gcashTransactions = (todayGcashRows || []) as Array<{
    account_id: string;
    transaction_type: 'cash_in' | 'cash_out';
    amount: number;
    transaction_fee: number;
    fee_type: 'cash' | 'gcash';
    cash_out_type: 'disbursement' | 'add_to_cash_fund' | 'pos_remittance' | 'move_to_bank' | null;
  }>;
  const totalGcashBalance = round2(
    gcashAccounts.reduce(
      (sum, account) =>
        sum +
        calculateGcashRunningBalance(
          account,
          gcashTransactions.filter(tx => tx.account_id === account.id)
        ),
      0
    )
  );

  const totalCashFundBalance = await calculateCashFundBalance();
  const totalLiquidFunds = round2(totalBankBalance + totalGcashBalance + totalCashFundBalance);
  const payables = ((payableRows || []) as RawRow[]).map(normalizePayable);
  const totalPayableOutstanding = round2(
    payables
      .filter(payable => payable.payment_status !== 'paid' && payable.payment_status !== 'voided')
      .reduce((sum, payable) => sum + Number(payable.balance_due), 0)
  );
  const today = getTodayDateString();
  const tomorrow = addDays(today, 1);
  const sevenDaysOut = addDays(today, 7);
  const payablesOpen = payables.filter(
    payable => payable.payment_status !== 'paid' && payable.payment_status !== 'voided' && Number(payable.balance_due) > 0
  );
  const totalPayableDueToday = round2(payablesOpen.filter(payable => payable.due_date === today).reduce((sum, payable) => sum + Number(payable.balance_due), 0));
  const totalPayableDueWithin7Days = round2(
    payablesOpen
      .filter(payable => isBetweenInclusive(payable.due_date, today, sevenDaysOut))
      .reduce((sum, payable) => sum + Number(payable.balance_due), 0)
  );

  const activeRecurring = recurringObligations.filter(obligation => obligation.is_active && obligation.next_due_date);
  const totalRecurringDueToday = round2(activeRecurring.filter(obligation => obligation.next_due_date === today).reduce((sum, obligation) => sum + Number(obligation.default_amount), 0));
  const totalRecurringDueTomorrow = round2(activeRecurring.filter(obligation => obligation.next_due_date === tomorrow).reduce((sum, obligation) => sum + Number(obligation.default_amount), 0));
  const totalRecurringDueWithin7Days = round2(
    activeRecurring
      .filter(obligation => isBetweenInclusive(obligation.next_due_date, today, sevenDaysOut))
      .reduce((sum, obligation) => sum + Number(obligation.default_amount), 0)
  );

  const totalPendingDeposits = round2(
    bankDeposits
      .filter(deposit => !deposit.is_deleted && deposit.status === 'pending')
      .reduce((sum, deposit) => sum + Number(deposit.amount), 0)
  );
  const totalVerifiedDeposits = round2(
    bankDeposits
      .filter(deposit => !deposit.is_deleted && deposit.status === 'verified')
      .reduce((sum, deposit) => sum + Number(deposit.amount), 0)
  );

  const ownerBalances = financeOwners.map(owner => {
    const entries = ownerLedger.filter(entry => entry.owner_id === owner.id && !entry.is_deleted);
    return {
      owner,
      current_balance: computeOwnerBalance(entries),
      total_increases: round2(entries.reduce((sum, entry) => sum + Number(entry.increase_amount), 0)),
      total_decreases: round2(entries.reduce((sum, entry) => sum + Number(entry.decrease_amount), 0)),
    };
  });
  const totalDueToOwner = round2(ownerBalances.reduce((sum, item) => sum + item.current_balance, 0));
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEntries = ownerLedger.filter(entry => !entry.is_deleted && isBetweenInclusive(entry.transaction_date, monthStart, today));
  const totalOwnerFunding = round2(
    ownerLedger
      .filter(entry => entry.transaction_type === 'owner_funding_to_bank' || entry.transaction_type === 'owner_funding_to_gcash' || entry.transaction_type === 'owner_funding_to_cash_fund')
      .reduce((sum, entry) => sum + Number(entry.increase_amount), 0)
  );
  const totalOwnerWithdrawals = round2(
    ownerLedger
      .filter(entry => entry.transaction_type === 'payment_to_owner_from_bank' || entry.transaction_type === 'payment_to_owner_from_gcash' || entry.transaction_type === 'payment_to_owner_from_cash_fund' || entry.transaction_type === 'owner_settlement')
      .reduce((sum, entry) => sum + Number(entry.decrease_amount), 0)
  );
  const totalOwnerFundingMonth = round2(
    monthEntries
      .filter(entry => entry.transaction_type === 'owner_funding_to_bank' || entry.transaction_type === 'owner_funding_to_gcash' || entry.transaction_type === 'owner_funding_to_cash_fund')
      .reduce((sum, entry) => sum + Number(entry.increase_amount), 0)
  );
  const totalOwnerPaidExpensesMonth = round2(
    monthEntries
      .filter(entry => entry.transaction_type === 'owner_paid_expense' || entry.transaction_type === 'owner_paid_purchase' || entry.transaction_type === 'owner_paid_supplier_bill' || entry.transaction_type === 'owner_paid_shopee_purchase')
      .reduce((sum, entry) => sum + Number(entry.increase_amount), 0)
  );
  const totalOwnerRepaymentsMonth = round2(
    monthEntries
      .filter(entry => entry.transaction_type === 'payment_to_owner_from_bank' || entry.transaction_type === 'payment_to_owner_from_gcash' || entry.transaction_type === 'payment_to_owner_from_cash_fund' || entry.transaction_type === 'owner_settlement')
      .reduce((sum, entry) => sum + Number(entry.decrease_amount), 0)
  );

  const projectedByDate = new Map<string, number>();
  const upcomingDueItems: FinanceDueItem[] = [];
  const approvedChecks = checks.filter(check => !check.is_deleted && check.approval_status !== 'rejected');
  approvedChecks
    .filter(check => (check.status === 'outstanding' || check.status === 'pdc') && isBetweenInclusive(check.check_date, today, sevenDaysOut))
    .forEach(check => {
      projectedByDate.set(check.check_date, round2((projectedByDate.get(check.check_date) ?? 0) + Number(check.amount)));
      upcomingDueItems.push({
        id: check.id,
        kind: 'check',
        label: `Check #${check.check_number}`,
        date: check.check_date,
        amount: Number(check.amount),
        status: check.status,
        source_module: 'checks',
        bank_account_id: check.bank_account_id ?? null,
      });
    });

  payablesOpen
    .filter(payable => isBetweenInclusive(payable.due_date, today, sevenDaysOut))
    .forEach(payable => {
      projectedByDate.set(payable.due_date, round2((projectedByDate.get(payable.due_date) ?? 0) + Number(payable.balance_due)));
      upcomingDueItems.push({
        id: payable.id,
        kind: 'payable',
        label: payable.payable_number || payable.invoice_number || 'Payable',
        date: payable.due_date,
        amount: Number(payable.balance_due),
        status: payable.payment_status,
        source_module: 'payables',
      });
    });

  activeRecurring
    .filter(obligation => isBetweenInclusive(obligation.next_due_date, today, sevenDaysOut))
    .forEach(obligation => {
      projectedByDate.set(obligation.next_due_date, round2((projectedByDate.get(obligation.next_due_date) ?? 0) + Number(obligation.default_amount)));
      upcomingDueItems.push({
        id: obligation.id,
        kind: 'recurring',
        label: obligation.name,
        date: obligation.next_due_date,
        amount: Number(obligation.default_amount),
        status: obligation.frequency,
        source_module: 'recurring_obligations',
      });
    });

  const latestReconciliationStatuses = bankSummaries
    .filter(summary => summary.latest_reconciliation_status && summary.latest_reconciliation_date)
    .map(summary => ({
      bank_account_id: summary.account.id,
      bank_name: summary.account.name,
      statement_date: summary.latest_reconciliation_date!,
      status: summary.latest_reconciliation_status!,
      variance: summary.latest_reconciliation_variance,
    }));

  const recentVerifiedDeposits = bankDeposits
    .filter(deposit => !deposit.is_deleted && deposit.status === 'verified')
    .sort((a, b) => `${b.verified_at ?? b.date} ${b.created_at}`.localeCompare(`${a.verified_at ?? a.date} ${a.created_at}`))
    .slice(0, 5);

  const projectedAvailableLiquidity = round2(
    totalLiquidFunds
    - totalDueToday
    - totalOverdue
    - totalPayableDueToday
  );
  const projectedAfterTomorrowLiquidity = round2(
    projectedAvailableLiquidity
    - totalDueTomorrow
    - round2(activeRecurring.filter(obligation => obligation.next_due_date === tomorrow).reduce((sum, obligation) => sum + Number(obligation.default_amount), 0))
  );

  const recentFinanceActivity: FinanceActivityItem[] = [
    ...bankTransactions.slice(-6).map(tx => ({
      id: tx.id,
      date: tx.date,
      label: tx.description,
      module: 'Bank Ledger',
      amount: Number(tx.amount),
      direction: (tx.direction === 'credit' ? 'inflow' : 'outflow') as FinanceActivityItem['direction'],
      status: tx.tx_type,
      reference: tx.ref_number || undefined,
    })),
    ...recentVerifiedDeposits.slice(0, 4).map(deposit => ({
      id: deposit.id,
      date: deposit.verified_at ?? deposit.date,
      label: deposit.source_description || 'Verified deposit',
      module: 'Deposits',
      amount: Number(deposit.amount),
      direction: 'inflow' as const,
      status: deposit.status,
      reference: deposit.source_type || undefined,
    })),
    ...ownerLedger.slice(0, 4).map(entry => ({
      id: entry.id,
      date: entry.transaction_date,
      label: entry.description,
      module: 'Owner Ledger',
      amount: Number(entry.increase_amount || entry.decrease_amount),
      direction: (Number(entry.increase_amount) > 0 ? 'inflow' : 'outflow') as FinanceActivityItem['direction'],
      status: entry.transaction_type,
      reference: entry.reference_number || undefined,
    })),
  ]
    .sort((a, b) => `${b.date}`.localeCompare(`${a.date}`))
    .slice(0, 10);

  return {
    finance_owners: financeOwners,
    owner_ledger: ownerLedger,
    owner_balances: ownerBalances,
    bank_accounts: bankSummaries.map(summary => summary.account),
    bank_transactions: bankTransactions,
    checks,
    bank_deposits: bankDeposits,
    recurring_obligations: recurringObligations,
    reconciliations,
    owner_movements: ownerMovements,
    bank_summaries: bankSummaries,
    total_bank_balance: totalBankBalance,
    total_due_today: totalDueToday,
    total_due_tomorrow: totalDueTomorrow,
    total_overdue: totalOverdue,
    total_pdc: totalPdc,
    total_checks_outstanding: totalOutstandingChecks,
    total_projected_balance: totalProjectedBalance,
    total_gcash_balance: totalGcashBalance,
    total_cash_fund_balance: totalCashFundBalance,
    total_liquid_funds: totalLiquidFunds,
    total_payable_outstanding: totalPayableOutstanding,
    total_payable_due_today: totalPayableDueToday,
    total_payable_due_within_7_days: totalPayableDueWithin7Days,
    total_recurring_due_today: totalRecurringDueToday,
    total_recurring_due_tomorrow: totalRecurringDueTomorrow,
    total_recurring_due_within_7_days: totalRecurringDueWithin7Days,
    total_pending_deposits: totalPendingDeposits,
    total_deposits_in_transit: totalDepositsInTransit,
    total_verified_deposits: totalVerifiedDeposits,
    total_due_to_owner: totalDueToOwner,
    total_owner_funding: totalOwnerFunding,
    total_owner_withdrawals: totalOwnerWithdrawals,
    total_owner_funding_month: totalOwnerFundingMonth,
    total_owner_paid_expenses_month: totalOwnerPaidExpensesMonth,
    total_owner_repayments_month: totalOwnerRepaymentsMonth,
    projected_available_liquidity: projectedAvailableLiquidity,
    projected_after_tomorrow_liquidity: projectedAfterTomorrowLiquidity,
    projected_cashflow_next_7_days: Array.from(projectedByDate.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, amount]) => ({ date, amount })),
    upcoming_due_items: upcomingDueItems.sort((a, b) => `${a.date} ${a.kind}`.localeCompare(`${b.date} ${b.kind}`)),
    recent_finance_activity: recentFinanceActivity,
    recent_owner_ledger: ownerLedger.slice(0, 8),
    recent_verified_deposits: recentVerifiedDeposits,
    latest_reconciliation_statuses: latestReconciliationStatuses,
    liquidity_snapshot: {
      total_bank_balance: totalBankBalance,
      total_gcash_balance: totalGcashBalance,
      total_cash_fund_balance: totalCashFundBalance,
      total_liquid_funds: totalLiquidFunds,
      checks_due_today: totalDueToday,
      checks_due_tomorrow: totalDueTomorrow,
      overdue_checks: totalOverdue,
      payable_due_today: totalPayableDueToday,
      payable_due_within_7_days: totalPayableDueWithin7Days,
      recurring_due_within_7_days: totalRecurringDueWithin7Days,
      projected_available_liquidity: projectedAvailableLiquidity,
      projected_after_tomorrow_liquidity: projectedAfterTomorrowLiquidity,
    },
  };
}
