import { supabase } from './supabase';
import { BankDeposit, CashOutType, FeeType, Transaction } from './types';
import { getTodayDateString, parseMoneyInput, round2 } from './utils';

export type CashProcessType = 'CASH_IN' | 'CASH_OUT';
export type CashInProcessType = 'regular' | 'product_payment';
export type CashOutProcessType = 'regular' | 'disbursement' | 'move_to_bank' | 'void_reversal';
export type CashTransactionMode = 'standard' | 'fee_included';
export type CounterpartAccountType = 'cash_fund' | 'pos_register' | 'bank';

type GcashTxnLike = Pick<
  Transaction,
  'transaction_type' | 'amount' | 'transaction_fee' | 'fee_type' | 'cash_source' | 'cash_out_type' | 'cash_in_mode' | 'amount_received'
>;

type CashLedgerLike = {
  transaction_type: string;
  amount: number | string | null | undefined;
};

export interface ProcessCashTransactionInput {
  date: string;
  account_id: string;
  type: CashProcessType;
  cashin_type?: CashInProcessType;
  cashout_type?: CashOutProcessType;
  transaction_mode?: CashTransactionMode;
  amount: number | string;
  fee?: number | string;
  total_amount?: number | string;
  delivery_fee?: number | string;
  source_account_type?: CounterpartAccountType;
  source_account_id?: string | null;
  bank_account_id?: string | null;
  pos_reference_id?: string | null;
  source_sale_id?: string | null;
  reversal_of_transaction_id?: string | null;
  reference_number?: string;
  description?: string;
  notes?: string;
  created_by?: string | null;
  source_module?: string | null;
}

export interface ProcessCashTransactionResult {
  transaction: Record<string, unknown>;
  linkedDepositId: string | null;
}

function ensurePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero`);
  }
}

function ensureNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} cannot be negative`);
  }
}

function normalizeFeeType(mode: CashTransactionMode | undefined): FeeType {
  return mode === 'fee_included' ? 'gcash' : 'cash';
}

function appendPosReference(notes: string, posReferenceId: string | null | undefined) {
  if (!posReferenceId) return notes.trim();
  const trimmed = notes.trim();
  const marker = `POS Ref: ${posReferenceId}`;
  if (!trimmed) return marker;
  if (trimmed.includes(marker)) return trimmed;
  return `${trimmed}\n${marker}`;
}

function getStoredCashOutType(input: ProcessCashTransactionInput): CashOutType | null {
  if (input.type !== 'CASH_OUT') return null;
  if (input.cashout_type === 'disbursement') return 'disbursement';
  if (input.cashout_type === 'move_to_bank') return 'move_to_bank';
  if (input.cashout_type === 'void_reversal') return 'void_reversal';
  if (input.source_account_type === 'pos_register') return 'pos_remittance';
  return 'add_to_cash_fund';
}

function getDepositSourceType(sourceAccountType: CounterpartAccountType | undefined) {
  return sourceAccountType === 'bank' ? 'other_deposit' : sourceAccountType === 'cash_fund' || sourceAccountType === 'pos_register'
    ? 'cash_remittance'
    : 'gcash_move';
}

function getTransactionCategory(input: ProcessCashTransactionInput): 'regular' | 'disbursement' | 'transfer' {
  if (input.type === 'CASH_OUT' && input.cashout_type === 'disbursement') return 'disbursement';
  if (
    (input.type === 'CASH_OUT' && (input.cashout_type === 'move_to_bank' || input.cashout_type === 'regular' || input.cashout_type === 'void_reversal'))
    || (input.type === 'CASH_IN' && input.cashin_type !== 'product_payment')
  ) {
    return 'transfer';
  }
  return 'regular';
}

export function getGcashFeeEffect(txn: Pick<Transaction, 'transaction_type' | 'transaction_fee' | 'fee_type'>) {
  const fee = Number(txn.transaction_fee ?? 0);
  if (fee <= 0 || txn.fee_type === 'cash') return 0;
  return txn.transaction_type === 'cash_in' ? round2(fee) : round2(-fee);
}

export function calculateGcashNetChange(txn: Pick<Transaction, 'transaction_type' | 'amount' | 'transaction_fee' | 'fee_type'>) {
  const amount = Number(txn.amount ?? 0);
  if (!Number.isFinite(amount)) return 0;
  const amountDelta = txn.transaction_type === 'cash_in' ? amount : -amount;
  return round2(amountDelta + getGcashFeeEffect(txn));
}

export function getCashFundDeltaFromGcash(txn: GcashTxnLike) {
  const amount = Number(txn.amount ?? 0);
  const fee = Number(txn.transaction_fee ?? 0);
  if (txn.transaction_type === 'cash_in' && txn.cash_in_mode !== 'payment' && txn.cash_source === 'cash_fund') {
    return round2(-(amount + (txn.fee_type === 'cash' ? fee : 0)));
  }
  if (txn.transaction_type === 'cash_out' && txn.cash_out_type === 'add_to_cash_fund') {
    return round2(amount + fee);
  }
  return 0;
}

export function getPosRegisterDeltaFromGcash(txn: GcashTxnLike) {
  const amount = Number(txn.amount ?? 0);
  const fee = Number(txn.transaction_fee ?? 0);
  if (txn.transaction_type === 'cash_in' && txn.cash_in_mode === 'payment') {
    return round2(Number(txn.amount_received ?? 0));
  }
  if (txn.transaction_type === 'cash_in' && txn.cash_in_mode !== 'payment' && txn.cash_source === 'pos_register') {
    return round2(-(amount + (txn.fee_type === 'cash' ? fee : 0)));
  }
  if (txn.transaction_type === 'cash_out' && txn.cash_out_type === 'pos_remittance') {
    return round2(amount + fee);
  }
  if (txn.transaction_type === 'cash_out' && txn.cash_out_type === 'void_reversal') {
    return round2(-Number(txn.amount_received ?? 0));
  }
  return 0;
}

export function calculateCashFundRunningBalance(
  baselineBalance: number,
  cashEntries: CashLedgerLike[],
  gcashTransactions: GcashTxnLike[]
) {
  const ledgerDelta = cashEntries.reduce((running, entry) => {
    const amount = Number(entry.amount ?? 0);
    switch (entry.transaction_type) {
      case 'beginning_balance':
      case 'pos_remittance':
      case 'cash_in':
        return round2(running + amount);
      case 'bank_deposit':
      case 'cash_fund_disbursement':
      case 'cash_out':
        return round2(running - amount);
      default:
        return running;
    }
  }, round2(Number(baselineBalance ?? 0)));

  return round2(
    gcashTransactions.reduce(
      (running, txn) => round2(running + getCashFundDeltaFromGcash(txn)),
      ledgerDelta
    )
  );
}

async function getGcashOpeningBalance(accountId: string, date: string) {
  const today = getTodayDateString();
  if (date === today) {
    const { data: account } = await supabase
      .from('accounts')
      .select('current_beginning_balance')
      .eq('id', accountId)
      .maybeSingle();
    return round2(Number(account?.current_beginning_balance ?? 0));
  }

  const { data: exactHistory } = await supabase
    .from('daily_history')
    .select('beginning_balance')
    .eq('account_id', accountId)
    .eq('date', date)
    .maybeSingle();
  if (exactHistory) {
    return round2(Number(exactHistory.beginning_balance ?? 0));
  }

  const { data: priorHistory } = await supabase
    .from('daily_history')
    .select('ending_balance')
    .eq('account_id', accountId)
    .lt('date', date)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priorHistory) {
    return round2(Number(priorHistory.ending_balance ?? 0));
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('current_beginning_balance')
    .eq('id', accountId)
    .maybeSingle();
  return round2(Number(account?.current_beginning_balance ?? 0));
}

export async function getAvailableGcashBalance(accountId: string, date: string, excludeTransactionId?: string | null) {
  let query = supabase
    .from('transactions')
    .select('transaction_type, amount, transaction_fee, fee_type')
    .eq('account_id', accountId)
    .eq('date', date)
    .eq('is_deleted', false);

  if (excludeTransactionId) {
    query = query.neq('id', excludeTransactionId);
  }

  const [{ data: txns }, openingBalance] = await Promise.all([
    query,
    getGcashOpeningBalance(accountId, date),
  ]);

  return round2(
    ((txns || []) as Array<Pick<Transaction, 'transaction_type' | 'amount' | 'transaction_fee' | 'fee_type'>>).reduce(
      (running: number, txn) => round2(running + calculateGcashNetChange(txn)),
      openingBalance
    )
  );
}

export async function upsertLinkedBankDepositRequest(input: {
  bank_account_id: string;
  date: string;
  amount: number | string;
  source_transaction_id: string;
  source_type: string;
  source_description: string;
  notes?: string;
  created_by?: string | null;
  source_module?: string | null;
  cashier_remittance_id?: string | null;
  status?: NonNullable<BankDeposit['status']>;
}) {
  const { data: existing } = await supabase
    .from('bank_deposits')
    .select('id')
    .eq('bank_account_id', input.bank_account_id)
    .eq('source_transaction_id', input.source_transaction_id)
    .eq('is_deleted', false)
    .maybeSingle();

  const payload = {
    bank_account_id: input.bank_account_id,
    date: input.date,
    amount: parseMoneyInput(input.amount, 'Deposit amount'),
    source_type: input.source_type,
    source_description: input.source_description,
    notes: input.notes?.trim() || '',
    source_transaction_id: input.source_transaction_id,
    source_module: input.source_module ?? null,
    cashier_remittance_id: input.cashier_remittance_id ?? null,
    status: input.status ?? 'deposited',
    created_by: input.created_by ?? null,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    const { data, error } = await supabase
      .from('bank_deposits')
      .update(payload)
      .eq('id', existing.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    return data?.id ?? existing.id;
  }

  const { data, error } = await supabase
    .from('bank_deposits')
    .insert(payload)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function processCashTransaction(input: ProcessCashTransactionInput): Promise<ProcessCashTransactionResult> {
  const amount = parseMoneyInput(input.amount, 'Amount');
  const fee = input.fee == null || input.fee === '' ? 0 : parseMoneyInput(input.fee, 'Fee');
  const deliveryFee = input.delivery_fee == null || input.delivery_fee === '' ? 0 : parseMoneyInput(input.delivery_fee, 'Delivery fee');
  ensurePositive(amount, 'Amount');
  ensureNonNegative(fee, 'Fee');
  ensureNonNegative(deliveryFee, 'Delivery fee');

  if (!input.account_id) throw new Error('GCash account is required');

  if (input.type === 'CASH_IN') {
    if (input.cashin_type === 'product_payment') {
      if (!input.pos_reference_id?.trim()) throw new Error('POS reference is required for product payments');
      if (deliveryFee < 0) throw new Error('Delivery fee cannot be negative');
    } else if (input.source_account_type !== 'cash_fund' && input.source_account_type !== 'pos_register') {
      throw new Error('Cash in source must be Cash Fund or POS Register');
    }
  }

  if (input.type === 'CASH_OUT') {
    if (input.cashout_type === 'move_to_bank' && !input.bank_account_id) {
      throw new Error('Bank account is required for move-to-bank transactions');
    }
    if (input.cashout_type === 'regular' && input.source_account_type !== 'cash_fund' && input.source_account_type !== 'pos_register') {
      throw new Error('Regular cash out destination must be Cash Fund or POS Register');
    }
    if (input.transaction_mode === 'fee_included' && input.total_amount != null) {
      const expectedTotal = round2(amount + fee);
      if (parseMoneyInput(input.total_amount, 'Total amount') !== expectedTotal) {
        throw new Error('Fee-included cash out must have total amount equal to amount plus fee');
      }
    }
  }

  if (input.type === 'CASH_IN' && input.transaction_mode === 'fee_included' && input.total_amount != null) {
    const expectedTotal = input.cashin_type === 'product_payment'
      ? round2(amount + deliveryFee)
      : round2(amount + fee);
    if (parseMoneyInput(input.total_amount, 'Total amount') !== expectedTotal) {
      throw new Error(
        input.cashin_type === 'product_payment'
          ? 'Product payment total must equal product amount plus delivery fee'
          : 'Fee-included cash in must have total amount equal to amount plus fee'
      );
    }
  }

  if (input.type === 'CASH_OUT') {
    const availableBalance = await getAvailableGcashBalance(input.account_id, input.date);
    const requiredBalance = round2(-calculateGcashNetChange({
      transaction_type: 'cash_out',
      amount,
      transaction_fee: fee,
      fee_type: normalizeFeeType(input.transaction_mode),
    }));
    if (requiredBalance > availableBalance) {
      throw new Error(`Insufficient GCash balance. Available: ${availableBalance.toFixed(2)}`);
    }
  }

  const feeType = normalizeFeeType(input.transaction_mode);
  const storedCashOutType = getStoredCashOutType(input);
  const transactionPayload: Record<string, unknown> = {
    date: input.date,
    account_id: input.account_id,
    transaction_type: input.type === 'CASH_IN' ? 'cash_in' : 'cash_out',
    transaction_category: getTransactionCategory(input),
    amount: input.cashin_type === 'product_payment' ? round2(amount + deliveryFee) : amount,
    transaction_fee: input.cashin_type === 'product_payment' ? 0 : fee,
    fee_type: input.cashin_type === 'product_payment' ? 'gcash' : feeType,
    description: input.description?.trim() || '',
    reference_number: input.reference_number?.trim() || '',
    notes: appendPosReference(input.notes ?? '', input.cashin_type === 'product_payment' ? input.pos_reference_id : null),
    created_by: input.created_by ?? null,
    source: 'gcash',
    bank_account_id: storedCashOutType === 'move_to_bank' ? input.bank_account_id ?? null : null,
    source_module: input.source_module ?? null,
    source_reference_id: input.source_sale_id ?? null,
    source_sale_id: input.source_sale_id ?? null,
    reversal_of_transaction_id: input.reversal_of_transaction_id ?? null,
  };

  if (input.type === 'CASH_IN') {
    transactionPayload.cash_in_mode = input.cashin_type === 'product_payment' ? 'payment' : 'regular';
    if (input.cashin_type === 'product_payment') {
      transactionPayload.amount_received = amount;
      transactionPayload.delivery_fee = deliveryFee;
      transactionPayload.description = transactionPayload.description || `POS Sale - ${input.pos_reference_id}`;
      if (!transactionPayload.reference_number) {
        transactionPayload.reference_number = input.pos_reference_id ?? '';
      }
    } else {
      transactionPayload.cash_source = input.source_account_type;
      transactionPayload.description = transactionPayload.description || 'Cash in transaction';
    }
  } else {
    transactionPayload.cash_out_type = storedCashOutType;
    transactionPayload.description = transactionPayload.description || `Cash out - ${storedCashOutType}`;
  }

  const { data, error } = await supabase.from('transactions').insert(transactionPayload).select().maybeSingle();
  if (error || !data) throw error ?? new Error('Failed to save cash transaction');

  let linkedDepositId: string | null = null;
  if (storedCashOutType === 'move_to_bank' && input.bank_account_id) {
    linkedDepositId = await upsertLinkedBankDepositRequest({
      bank_account_id: input.bank_account_id,
      date: input.date,
      amount,
      source_transaction_id: String(data.id),
      source_type: getDepositSourceType(input.source_account_type),
      source_description: input.description?.trim() || 'GCash transfer to bank',
      notes: transactionPayload.notes as string,
      created_by: input.created_by ?? null,
      source_module: input.source_module ?? 'gcash_cash_out',
      status: 'deposited',
    });
  }

  return {
    transaction: data as Record<string, unknown>,
    linkedDepositId,
  };
}

export async function linkTransactionToDisbursement(transactionId: string, disbursementId: string | null) {
  if (!transactionId) return;
  await supabase
    .from('transactions')
    .update({
      transaction_category: 'disbursement',
      disbursement_id: disbursementId,
      source_module: 'disbursement',
      updated_at: new Date().toISOString(),
    })
    .eq('id', transactionId);
}

export async function linkCashFundTransactionToDisbursement(transactionId: string, disbursementId: string | null) {
  if (!transactionId) return;
  await supabase
    .from('cash_transactions')
    .update({
      transaction_category: 'disbursement',
      disbursement_id: disbursementId,
      source_module: 'disbursement',
      updated_at: new Date().toISOString(),
    })
    .eq('id', transactionId);
}
