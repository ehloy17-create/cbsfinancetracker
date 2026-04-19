import { supabase } from './supabase';
import {
  FinanceOwner,
  FinanceOwnerMovement,
  OwnerLedgerEntry,
  OwnerLedgerSourceAccountType,
  OwnerLedgerTransactionType,
} from './types';
import { round2 } from './utils';

type RawRow = Record<string, unknown>;

export interface OwnerLedgerEntryInput {
  owner_id: string;
  transaction_date: string;
  transaction_type: OwnerLedgerTransactionType;
  reference_type: string;
  reference_id?: string | null;
  source_module: string;
  description: string;
  increase_amount?: number;
  decrease_amount?: number;
  source_account_type?: OwnerLedgerSourceAccountType | null;
  source_account_id?: string | null;
  reference_number?: string;
  remarks?: string;
  created_by?: string | null;
}

export const OWNER_LEDGER_TRANSACTION_LABELS: Record<OwnerLedgerTransactionType, string> = {
  owner_paid_expense: 'Owner Paid Expense',
  owner_paid_purchase: 'Owner Paid Purchase',
  owner_paid_supplier_bill: 'Owner Paid Supplier Bill',
  owner_paid_shopee_purchase: 'Owner Paid Shopee Purchase',
  owner_funding_to_bank: 'Owner Funding to Bank',
  owner_funding_to_gcash: 'Owner Funding to GCash',
  owner_funding_to_cash_fund: 'Owner Funding to Cash Fund',
  owner_advance_adjustment: 'Owner Advance Adjustment',
  payment_to_owner_from_bank: 'Payment to Owner from Bank',
  payment_to_owner_from_gcash: 'Payment to Owner from GCash',
  payment_to_owner_from_cash_fund: 'Payment to Owner from Cash Fund',
  owner_settlement: 'Owner Settlement',
  owner_balance_adjustment: 'Owner Balance Adjustment',
};

export function normalizeFinanceOwner(raw: RawRow): FinanceOwner {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    remarks: String(raw.remarks ?? ''),
    is_active: raw.is_active == null ? true : Boolean(raw.is_active),
    created_by: raw.created_by ? String(raw.created_by) : null,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? raw.created_at ?? ''),
  };
}

export function normalizeOwnerLedgerEntry(raw: RawRow): OwnerLedgerEntry {
  return {
    id: String(raw.id ?? ''),
    owner_id: String(raw.owner_id ?? ''),
    transaction_date: String(raw.transaction_date ?? raw.date ?? ''),
    transaction_type: String(raw.transaction_type ?? 'owner_advance_adjustment') as OwnerLedgerTransactionType,
    reference_type: String(raw.reference_type ?? ''),
    reference_id: raw.reference_id ? String(raw.reference_id) : null,
    source_module: String(raw.source_module ?? ''),
    description: String(raw.description ?? ''),
    increase_amount: Number(raw.increase_amount ?? 0),
    decrease_amount: Number(raw.decrease_amount ?? 0),
    running_balance: Number(raw.running_balance ?? 0),
    source_account_type: raw.source_account_type ? String(raw.source_account_type) as OwnerLedgerSourceAccountType : null,
    source_account_id: raw.source_account_id ? String(raw.source_account_id) : null,
    reference_number: String(raw.reference_number ?? ''),
    remarks: String(raw.remarks ?? ''),
    is_deleted: Boolean(raw.is_deleted),
    created_by: raw.created_by ? String(raw.created_by) : null,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? raw.created_at ?? ''),
    owners: raw.owners as FinanceOwner | undefined,
  };
}

export async function rebuildOwnerLedgerRunningBalances(ownerId: string) {
  const { data } = await supabase
    .from('owner_ledger')
    .select('id, owner_id, transaction_date, increase_amount, decrease_amount, created_at')
    .eq('owner_id', ownerId)
    .eq('is_deleted', false)
    .order('transaction_date', { ascending: true })
    .order('created_at', { ascending: true });

  const rows = ((data || []) as RawRow[]).map(normalizeOwnerLedgerEntry);
  let running = 0;
  for (const row of rows) {
    running = round2(running + Number(row.increase_amount) - Number(row.decrease_amount));
    await supabase
      .from('owner_ledger')
      .update({ running_balance: running, updated_at: new Date().toISOString() })
      .eq('id', row.id);
  }
}

export async function createOwnerLedgerEntry(input: OwnerLedgerEntryInput) {
  const increaseAmount = round2(Math.max(0, Number(input.increase_amount ?? 0)));
  const decreaseAmount = round2(Math.max(0, Number(input.decrease_amount ?? 0)));
  if (!input.owner_id) throw new Error('Owner is required');
  if (!input.transaction_date) throw new Error('Transaction date is required');
  if (!input.description.trim()) throw new Error('Description is required');
  if (increaseAmount <= 0 && decreaseAmount <= 0) throw new Error('Owner ledger amount is required');

  if (input.reference_id) {
    const { data: existing } = await supabase
      .from('owner_ledger')
      .select('*')
      .eq('owner_id', input.owner_id)
      .eq('transaction_type', input.transaction_type)
      .eq('reference_type', input.reference_type)
      .eq('reference_id', input.reference_id)
      .eq('is_deleted', false)
      .maybeSingle();
    if (existing) {
      return normalizeOwnerLedgerEntry(existing as RawRow);
    }
  }

  const { data, error } = await supabase
    .from('owner_ledger')
    .insert({
      owner_id: input.owner_id,
      transaction_date: input.transaction_date,
      transaction_type: input.transaction_type,
      reference_type: input.reference_type,
      reference_id: input.reference_id ?? null,
      source_module: input.source_module,
      description: input.description.trim(),
      increase_amount: increaseAmount,
      decrease_amount: decreaseAmount,
      running_balance: 0,
      source_account_type: input.source_account_type ?? null,
      source_account_id: input.source_account_id ?? null,
      reference_number: input.reference_number?.trim() ?? '',
      remarks: input.remarks?.trim() ?? '',
      created_by: input.created_by ?? null,
    })
    .select('*')
    .single();

  if (error) throw error;
  await rebuildOwnerLedgerRunningBalances(input.owner_id);

  const { data: refreshed } = await supabase
    .from('owner_ledger')
    .select('*')
    .eq('id', data.id)
    .maybeSingle();

  return normalizeOwnerLedgerEntry((refreshed ?? data) as RawRow);
}

export async function archiveOwnerLedgerEntriesByReference(referenceType: string, referenceId: string) {
  if (!referenceType || !referenceId) return;
  const { data } = await supabase
    .from('owner_ledger')
    .select('id, owner_id')
    .eq('reference_type', referenceType)
    .eq('reference_id', referenceId)
    .eq('is_deleted', false);

  const rows = (data || []) as Array<{ id: string; owner_id: string }>;
  if (rows.length === 0) return;

  await Promise.all(
    rows.map(row =>
      supabase
        .from('owner_ledger')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('id', row.id)
    )
  );

  const ownerIds = [...new Set(rows.map(row => row.owner_id))];
  await Promise.all(ownerIds.map(ownerId => rebuildOwnerLedgerRunningBalances(ownerId)));
}

export async function ensureLegacyOwnerMovementLedgerSync() {
  let movementRows: FinanceOwnerMovement[] = [];
  try {
    const { data } = await supabase
      .from('finance_owner_movements')
      .select('*')
      .order('date', { ascending: true })
      .order('created_at', { ascending: true });
    movementRows = (data || []) as FinanceOwnerMovement[];
  } catch {
    return;
  }

  const pending = movementRows.filter(
    movement => Boolean(movement.owner_id) && !movement.owner_ledger_id
  );
  for (const movement of pending) {
    if (!movement.owner_id) continue;
    try {
      const isFunding = movement.movement_type === 'funding';
      const accountType = movement.target_module === 'bank'
        ? 'bank'
        : movement.target_module === 'gcash'
        ? 'gcash'
        : 'cash_fund';
      const transactionType = isFunding
        ? accountType === 'bank'
          ? 'owner_funding_to_bank'
          : accountType === 'gcash'
          ? 'owner_funding_to_gcash'
          : 'owner_funding_to_cash_fund'
        : accountType === 'bank'
        ? 'payment_to_owner_from_bank'
        : accountType === 'gcash'
        ? 'payment_to_owner_from_gcash'
        : 'payment_to_owner_from_cash_fund';

      const ledger = await createOwnerLedgerEntry({
        owner_id: movement.owner_id,
        transaction_date: movement.date,
        transaction_type: transactionType,
        reference_type: 'finance_owner_movement',
        reference_id: movement.id,
        source_module: 'owner_movement',
        description: movement.remarks?.trim() || OWNER_LEDGER_TRANSACTION_LABELS[transactionType],
        increase_amount: isFunding ? Number(movement.amount) : 0,
        decrease_amount: isFunding ? 0 : Number(movement.amount),
        source_account_type: accountType,
        source_account_id: movement.target_module === 'bank' ? movement.bank_account_id ?? null : movement.account_id ?? null,
        reference_number: movement.reference_number,
        remarks: movement.remarks,
        created_by: movement.created_by,
      });

      if (ledger?.id) {
        await supabase
          .from('finance_owner_movements')
          .update({ owner_ledger_id: ledger.id, updated_at: new Date().toISOString() })
          .eq('id', movement.id);
      }
    } catch (err) {
      console.warn('[ownerLedgerSync] skipped movement', movement.id, err);
    }
  }
}

export function computeOwnerBalance(entries: OwnerLedgerEntry[]) {
  return round2(entries.filter(entry => !entry.is_deleted).reduce(
    (sum, entry) => sum + Number(entry.increase_amount) - Number(entry.decrease_amount),
    0
  ));
}
