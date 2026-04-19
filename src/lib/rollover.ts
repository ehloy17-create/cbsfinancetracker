import { supabase } from './supabase';
import { writeAuditLog } from './audit';
import {
  calculateCashFundRunningBalance,
  calculateGcashNetChange,
  getCashFundDeltaFromGcash,
  getGcashFeeEffect,
} from './cashTransactions';
import { getTodayDateString, round2 } from './utils';
import type { CashTransaction, Transaction, TransactionCategory } from './types';

type GcashTxnRow = Pick<
  Transaction,
  | 'id'
  | 'transaction_type'
  | 'amount'
  | 'transaction_fee'
  | 'delivery_fee'
  | 'fee_type'
  | 'cash_out_type'
  | 'cash_in_mode'
  | 'cash_source'
  | 'amount_received'
  | 'transaction_category'
  | 'disbursement_id'
> & {
  date?: string;
};

type CashFundTxnRow = Pick<
  CashTransaction,
  | 'id'
  | 'transaction_type'
  | 'amount'
  | 'transaction_category'
  | 'disbursement_id'
> & {
  date?: string;
};

type CashFundDaySummary = {
  beginning_balance: number;
  total_cash_in: number;
  total_cash_out: number;
  transaction_count: number;
  cash_fees_collected: number;
  cash_given_out: number;
  cash_out_to_fund: number;
  bank_deposits: number;
  cash_fund_disbursements: number;
  ending_balance: number;
};

function isDisbursementCategory(category: string | null | undefined) {
  return String(category ?? '').toLowerCase() === 'disbursement';
}

function isGcashDisbursementTxn(txn: GcashTxnRow) {
  return (
    isDisbursementCategory(txn.transaction_category)
    || txn.cash_out_type === 'disbursement'
    || Boolean(txn.disbursement_id)
  );
}

function isCashFundDisbursementTxn(txn: CashFundTxnRow) {
  return (
    isDisbursementCategory(txn.transaction_category)
    || txn.transaction_type === 'cash_fund_disbursement'
    || Boolean(txn.disbursement_id)
  );
}

async function updateRowsById(
  table: 'transactions' | 'cash_transactions',
  ids: string[],
  payload: Record<string, unknown>
) {
  await Promise.all(
    ids.map(id =>
      supabase
        .from(table)
        .update(payload)
        .eq('id', id)
    )
  );
}

async function loadDailyTransactions(accountId: string, date: string): Promise<GcashTxnRow[]> {
  const { data: txns } = await supabase
    .from('transactions')
    .select('id, date, transaction_type, amount, transaction_fee, delivery_fee, fee_type, cash_out_type, cash_in_mode, cash_source, amount_received, transaction_category, disbursement_id')
    .eq('account_id', accountId)
    .eq('date', date)
    .eq('is_deleted', false);

  return (txns ?? []) as GcashTxnRow[];
}

function calculateNetGcashDelta(txns: GcashTxnRow[]) {
  return round2(
    txns.reduce(
      (sum, txn) => round2(sum + calculateGcashNetChange({
        transaction_type: txn.transaction_type as 'cash_in' | 'cash_out',
        amount: Number(txn.amount),
        transaction_fee: Number(txn.transaction_fee || 0),
        fee_type: (txn.fee_type as 'cash' | 'gcash') || 'gcash',
      })),
      0
    )
  );
}

export async function calculateDailyTotals(accountId: string, date: string) {
  const txns = await loadDailyTransactions(accountId, date);
  if (!txns) return null;

  const totals = txns.reduce(
    (acc, txn) => {
      if (txn.transaction_type === 'cash_in') {
        acc.total_cash_in = round2(acc.total_cash_in + Number(txn.amount));
      } else {
        acc.total_cash_out = round2(acc.total_cash_out + Number(txn.amount));
      }

      const fee = Number(txn.transaction_fee || 0);
      if (txn.fee_type === 'cash') {
        const cashSideFee = txn.transaction_type === 'cash_in'
          ? -fee
          : (txn.cash_out_type === 'move_to_bank' ? 0 : fee);
        if (cashSideFee > 0) {
          acc.total_cash_fees = round2(acc.total_cash_fees + cashSideFee);
        }
      } else {
        acc.total_transaction_fee = round2(acc.total_transaction_fee + getGcashFeeEffect({
          transaction_type: txn.transaction_type as 'cash_in' | 'cash_out',
          transaction_fee: fee,
          fee_type: 'gcash',
        }));
      }

      acc.total_delivery_fee = round2(acc.total_delivery_fee + Number(txn.delivery_fee || 0));
      return acc;
    },
    { total_cash_in: 0, total_cash_out: 0, total_transaction_fee: 0, total_delivery_fee: 0, total_cash_fees: 0, transaction_count: txns.length }
  );

  return totals;
}

async function clearClosedGcashTransactions(accountId: string, date: string, now: string) {
  const txns = await loadDailyTransactions(accountId, date);
  const retainedIds = txns.filter(isGcashDisbursementTxn).map(txn => txn.id);
  const clearableIds = txns.filter(txn => !isGcashDisbursementTxn(txn)).map(txn => txn.id);

  if (clearableIds.length > 0) {
    await updateRowsById('transactions', clearableIds, {
      is_closed: true,
      is_deleted: true,
      cleared_at: now,
      updated_at: now,
    });
  }

  if (retainedIds.length > 0) {
    await updateRowsById('transactions', retainedIds, {
      is_closed: true,
      updated_at: now,
    });
  }
}

export async function postDailyHistory(
  accountId: string,
  date: string,
  userId: string | null
): Promise<boolean> {
  const { data: account } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .maybeSingle();

  if (!account) return false;

  const totals = await calculateDailyTotals(accountId, date);
  if (!totals) return false;

  const txns = await loadDailyTransactions(accountId, date);
  const { data: existing } = await supabase
    .from('daily_history')
    .select('id, beginning_balance')
    .eq('account_id', accountId)
    .eq('date', date)
    .maybeSingle();

  const beginningBalance = existing
    ? round2(Number(existing.beginning_balance))
    : round2(Number(account.current_beginning_balance));
  const endingBalance = round2(beginningBalance + calculateNetGcashDelta(txns));
  const now = new Date().toISOString();

  const historyPayload = {
    total_cash_in: totals.total_cash_in,
    total_cash_out: totals.total_cash_out,
    total_transaction_fee: totals.total_transaction_fee,
    total_cash_fees: totals.total_cash_fees,
    total_delivery_fee: totals.total_delivery_fee,
    transaction_count: totals.transaction_count,
    ending_balance: endingBalance,
    posted_at: now,
    posted_by: userId,
  };

  if (existing?.id) {
    await supabase
      .from('daily_history')
      .update(historyPayload)
      .eq('id', existing.id);
  } else {
    const { error: histError } = await supabase.from('daily_history').insert({
      date,
      account_id: accountId,
      beginning_balance: beginningBalance,
      ...historyPayload,
    });
    if (histError) return false;
  }

  await supabase
    .from('accounts')
    .update({
      current_beginning_balance: endingBalance,
      current_running_balance: endingBalance,
      last_closed_date: date,
      updated_at: now,
    })
    .eq('id', accountId);

  await clearClosedGcashTransactions(accountId, date, now);

  await writeAuditLog(userId, 'DAILY_CLOSE', 'DailyHistory', accountId, {
    date,
    transaction_count: totals.transaction_count,
    ending_balance: endingBalance,
  });

  return true;
}

async function loadCashFundTransactions(date: string): Promise<CashFundTxnRow[]> {
  const { data } = await supabase
    .from('cash_transactions')
    .select('id, date, transaction_type, amount, transaction_category, disbursement_id')
    .eq('date', date)
    .eq('is_deleted', false);

  return (data ?? []) as CashFundTxnRow[];
}

async function loadCashFundGcashTransactions(date: string): Promise<GcashTxnRow[]> {
  const { data } = await supabase
    .from('transactions')
    .select('id, date, transaction_type, amount, transaction_fee, delivery_fee, fee_type, cash_out_type, cash_in_mode, cash_source, amount_received, transaction_category, disbursement_id')
    .eq('date', date)
    .eq('is_deleted', false);

  return ((data ?? []) as GcashTxnRow[]).filter(txn => getCashFundDeltaFromGcash(txn) !== 0);
}

export async function getCashFundOpeningBalance(date: string): Promise<number> {
  const { data: exactHistory } = await supabase
    .from('cash_daily_history')
    .select('beginning_balance')
    .eq('date', date)
    .maybeSingle();

  if (exactHistory) {
    return round2(Number((exactHistory as { beginning_balance?: number }).beginning_balance ?? 0));
  }

  const { data: priorHistory } = await supabase
    .from('cash_daily_history')
    .select('ending_balance')
    .lt('date', date)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (priorHistory) {
    return round2(Number((priorHistory as { ending_balance?: number }).ending_balance ?? 0));
  }

  const { data: sameDaySetup } = await supabase
    .from('cash_transactions')
    .select('amount')
    .eq('transaction_type', 'beginning_balance')
    .eq('date', date)
    .eq('is_deleted', false);

  if ((sameDaySetup ?? []).length > 0) {
    return round2(
      (sameDaySetup as Array<{ amount?: number }>).reduce(
        (sum, row) => round2(sum + Number(row.amount ?? 0)),
        0
      )
    );
  }

  return 0;
}

export async function hasCashFundBeginningBalanceSet(): Promise<boolean> {
  const [{ data: historyRow }, { data: openingRow }] = await Promise.all([
    supabase.from('cash_daily_history').select('id').limit(1).maybeSingle(),
    supabase
      .from('cash_transactions')
      .select('id')
      .eq('transaction_type', 'beginning_balance')
      .eq('is_deleted', false)
      .limit(1)
      .maybeSingle(),
  ]);

  return Boolean(historyRow || openingRow);
}

async function summarizeCashFundDay(date: string): Promise<CashFundDaySummary> {
  const [cashEntries, gcashTransactions, beginningBalance] = await Promise.all([
    loadCashFundTransactions(date),
    loadCashFundGcashTransactions(date),
    getCashFundOpeningBalance(date),
  ]);

  let manualCashIn = 0;
  let manualCashOut = 0;
  let bankDeposits = 0;
  let cashFundDisbursements = 0;

  for (const entry of cashEntries) {
    const amount = Number(entry.amount || 0);
    switch (entry.transaction_type) {
      case 'pos_remittance':
      case 'cash_in':
        manualCashIn = round2(manualCashIn + amount);
        break;
      case 'bank_deposit':
        bankDeposits = round2(bankDeposits + amount);
        manualCashOut = round2(manualCashOut + amount);
        break;
      case 'cash_fund_disbursement':
        cashFundDisbursements = round2(cashFundDisbursements + amount);
        manualCashOut = round2(manualCashOut + amount);
        break;
      case 'cash_out':
        manualCashOut = round2(manualCashOut + amount);
        break;
      default:
        break;
    }
  }

  let cashFeesCollected = 0;
  let cashGivenOut = 0;
  let cashOutToFund = 0;
  let gcashCashIn = 0;
  let gcashCashOut = 0;
  let gcashLinkedTxnCount = 0;

  for (const txn of gcashTransactions) {
    const delta = getCashFundDeltaFromGcash(txn);
    if (delta !== 0) {
      gcashLinkedTxnCount += 1;
    }

    if (delta < 0) {
      const absolute = Math.abs(delta);
      cashGivenOut = round2(cashGivenOut + absolute);
      gcashCashOut = round2(gcashCashOut + absolute);
    }

    if (delta > 0) {
      cashOutToFund = round2(cashOutToFund + delta);
      gcashCashIn = round2(gcashCashIn + delta);
    }

    if (txn.fee_type === 'cash') {
      const cashSideFee = txn.transaction_type === 'cash_in'
        ? -Number(txn.transaction_fee || 0)
        : (txn.cash_out_type === 'move_to_bank' ? 0 : Number(txn.transaction_fee || 0));
      if (cashSideFee > 0) {
        cashFeesCollected = round2(cashFeesCollected + cashSideFee);
      } else if (cashSideFee < 0) {
        cashGivenOut = round2(cashGivenOut + Math.abs(cashSideFee));
      }
    }
  }

  const endingBalance = calculateCashFundRunningBalance(
    beginningBalance,
    cashEntries.map(entry => ({ transaction_type: entry.transaction_type, amount: entry.amount })),
    gcashTransactions
  );

  return {
    beginning_balance: beginningBalance,
    total_cash_in: round2(manualCashIn + gcashCashIn),
    total_cash_out: round2(manualCashOut + gcashCashOut),
    transaction_count: cashEntries.filter(entry => entry.transaction_type !== 'beginning_balance').length + gcashLinkedTxnCount,
    cash_fees_collected: cashFeesCollected,
    cash_given_out: cashGivenOut,
    cash_out_to_fund: round2(cashOutToFund + manualCashIn),
    bank_deposits: bankDeposits,
    cash_fund_disbursements: cashFundDisbursements,
    ending_balance: endingBalance,
  };
}

async function clearClosedCashFundTransactions(date: string, now: string) {
  const txns = await loadCashFundTransactions(date);
  const retainedIds = txns.filter(isCashFundDisbursementTxn).map(txn => txn.id);
  const clearableIds = txns.filter(txn => !isCashFundDisbursementTxn(txn)).map(txn => txn.id);

  if (clearableIds.length > 0) {
    await updateRowsById('cash_transactions', clearableIds, {
      is_closed: true,
      is_deleted: true,
      cleared_at: now,
      updated_at: now,
    });
  }

  if (retainedIds.length > 0) {
    await updateRowsById('cash_transactions', retainedIds, {
      is_closed: true,
      updated_at: now,
    });
  }
}

export async function postCashDailyHistory(
  date: string,
  userId: string | null
): Promise<boolean> {
  const summary = await summarizeCashFundDay(date);
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from('cash_daily_history')
    .select('id')
    .eq('date', date)
    .maybeSingle();

  const payload = {
    beginning_balance: summary.beginning_balance,
    total_cash_in: summary.total_cash_in,
    total_cash_out: summary.total_cash_out,
    transaction_count: summary.transaction_count,
    cash_fees_collected: summary.cash_fees_collected,
    cash_given_out: summary.cash_given_out,
    cash_out_to_fund: summary.cash_out_to_fund,
    bank_deposits: summary.bank_deposits,
    cash_fund_disbursements: summary.cash_fund_disbursements,
    ending_balance: summary.ending_balance,
    posted_at: now,
    posted_by: userId,
  };

  if (existing?.id) {
    await supabase
      .from('cash_daily_history')
      .update(payload)
      .eq('id', existing.id);
  } else {
    const { error } = await supabase
      .from('cash_daily_history')
      .insert({ date, ...payload });
    if (error) return false;
  }

  await clearClosedCashFundTransactions(date, now);

  await writeAuditLog(userId, 'DAILY_CLOSE', 'CashDailyHistory', undefined, {
    date,
    transaction_count: summary.transaction_count,
    ending_balance: summary.ending_balance,
  });

  return true;
}

async function processMissedCashFundRollovers(userId: string | null): Promise<void> {
  const today = getTodayDateString();
  const [{ data: cashRows }, { data: gcashRows }] = await Promise.all([
    supabase
      .from('cash_transactions')
      .select('date, transaction_type, amount, transaction_category, disbursement_id')
      .eq('is_deleted', false)
      .order('date', { ascending: true }),
    supabase
      .from('transactions')
      .select('date, transaction_type, amount, transaction_fee, fee_type, cash_source, cash_out_type, amount_received, transaction_category, disbursement_id')
      .eq('is_deleted', false)
      .order('date', { ascending: true }),
  ]);

  const candidateDates = new Set<string>();

  for (const row of (cashRows ?? []) as CashFundTxnRow[]) {
    if (row.date && row.date < today) candidateDates.add(String(row.date));
  }

  for (const row of (gcashRows ?? []) as GcashTxnRow[]) {
    if (row.date && row.date < today && getCashFundDeltaFromGcash(row) !== 0) {
      candidateDates.add(String(row.date));
    }
  }

  for (const date of Array.from(candidateDates).sort((left, right) => left.localeCompare(right))) {
    await postCashDailyHistory(date, userId);
  }
}

export async function processMissedRollovers(userId: string | null): Promise<void> {
  const { data: accounts } = await supabase.from('accounts').select('*').eq('is_active', true);
  if (accounts) {
    const today = getTodayDateString();

    for (const account of accounts) {
      const lastClosed = account.last_closed_date;
      if (!lastClosed) continue;

      const lastClosedDate = new Date(`${lastClosed}T00:00:00`);
      const todayDate = new Date(`${today}T00:00:00`);
      const current = new Date(lastClosedDate);
      current.setDate(current.getDate() + 1);

      while (current < todayDate) {
        const dateStr = current.toISOString().split('T')[0];
        await postDailyHistory(account.id, dateStr, userId);
        current.setDate(current.getDate() + 1);
      }
    }
  }

  await processMissedCashFundRollovers(userId);
}

export async function closeFinanceDay(userId: string | null, date = getTodayDateString()): Promise<void> {
  const { data: accounts } = await supabase.from('accounts').select('id').eq('is_active', true);
  for (const account of (accounts ?? []) as Array<{ id: string }>) {
    await postDailyHistory(account.id, date, userId);
  }
  await postCashDailyHistory(date, userId);
}

export async function calculateRunningBalance(accountId: string, date: string): Promise<number> {
  const { data: account } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .maybeSingle();

  if (!account) return 0;

  const totals = await calculateDailyTotals(accountId, date);
  if (!totals) return Number(account.current_beginning_balance);
  const txns = await loadDailyTransactions(accountId, date);

  return round2(
    round2(Number(account.current_beginning_balance)) + calculateNetGcashDelta(txns)
  );
}

export function inferTransactionCategory(input: {
  type: 'cash_in' | 'cash_out';
  cashInMode?: string | null;
  cashOutType?: string | null;
}): TransactionCategory {
  if (input.type === 'cash_out' && input.cashOutType === 'disbursement') return 'disbursement';
  if (
    (input.type === 'cash_out' && (input.cashOutType === 'move_to_bank' || input.cashOutType === 'add_to_cash_fund' || input.cashOutType === 'pos_remittance'))
    || (input.type === 'cash_in' && input.cashInMode === 'regular')
  ) {
    return 'transfer';
  }
  return 'regular';
}

export function inferCashLedgerTransactionCategory(transactionType: string): TransactionCategory {
  if (transactionType === 'cash_fund_disbursement') return 'disbursement';
  if (transactionType === 'bank_deposit' || transactionType === 'pos_remittance') return 'transfer';
  return 'regular';
}
