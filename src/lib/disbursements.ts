import { supabase } from './supabase';
import { CheckStatus, Disbursement, PaymentMethod } from './types';

export type DisbursementSourceKey =
  | 'manual_entry'
  | 'historical_report_entry'
  | 'cash_out_direct'
  | 'check_issuance_pending'
  | 'check_issuance_cleared'
  | 'cash_fund_direct'
  | 'owner_credit_card'
  | 'owner_personal_fund';

export const DISBURSEMENT_SOURCE_LABELS: Record<DisbursementSourceKey, string> = {
  manual_entry: 'Manual Entry',
  historical_report_entry: 'Historical / Report Only',
  cash_out_direct: 'Cash Out - Direct Disbursement',
  check_issuance_pending: 'Check Issuance - Pending',
  check_issuance_cleared: 'Check Issuance - Cleared',
  cash_fund_direct: 'Cash Fund - Direct Disbursement',
  owner_credit_card: 'Owner Credit Card',
  owner_personal_fund: 'Owner Personal Fund',
};

export interface SourceDisbursementInput {
  source_module: string;
  source_reference_id: string;
  date: string;
  payee: string;
  purpose: string;
  amount: number;
  payment_method: PaymentMethod;
  disbursement_type: string;
  description?: string;
  reference_number?: string;
  supplier_id?: string | null;
  owner_id?: string | null;
  owner_ledger_id?: string | null;
  check_id?: string | null;
  check_number?: string;
  notes?: string;
  source_account_type?: string | null;
  source_account_id?: string | null;
  affects_cashflow?: boolean;
  created_by?: string | null;
}

function normalizeText(value: string | null | undefined, fallback: string) {
  const trimmed = String(value ?? '').trim();
  return trimmed || fallback;
}

export function getDisbursementSourceKey(
  disbursement: Pick<Disbursement, 'payment_method' | 'disbursement_type' | 'check_id' | 'affects_cashflow'>,
  checkStatus?: CheckStatus | null
): DisbursementSourceKey {
  if (disbursement.affects_cashflow === false) return 'historical_report_entry';
  switch (disbursement.disbursement_type) {
    case 'cash_out_direct':
      return 'cash_out_direct';
    case 'cash_fund_direct':
      return 'cash_fund_direct';
    case 'check_issuance_cleared':
      return 'check_issuance_cleared';
    case 'check_issuance_pending':
      return 'check_issuance_pending';
    case 'owner_credit_card':
      return 'owner_credit_card';
    case 'owner_personal_fund':
      return 'owner_personal_fund';
    default:
      break;
  }

  if (disbursement.payment_method === 'creditcard') return 'owner_credit_card';
  if (disbursement.payment_method === 'advances_to_owner') return 'owner_personal_fund';
  if (disbursement.check_id) {
    return checkStatus === 'cleared' ? 'check_issuance_cleared' : 'check_issuance_pending';
  }

  return 'manual_entry';
}

export function getDisbursementSourceLabel(
  disbursement: Pick<Disbursement, 'payment_method' | 'disbursement_type' | 'check_id' | 'affects_cashflow'>,
  checkStatus?: CheckStatus | null
) {
  return DISBURSEMENT_SOURCE_LABELS[getDisbursementSourceKey(disbursement, checkStatus)];
}

export function isRealDisbursement(
  disbursement: Pick<Disbursement, 'payment_method' | 'disbursement_type' | 'check_id' | 'affects_cashflow'>,
  checkStatus?: CheckStatus | null
) {
  return getDisbursementSourceKey(disbursement, checkStatus) !== 'check_issuance_pending';
}

export async function upsertSourceDisbursement(input: SourceDisbursementInput) {
  const payload = {
    date: input.date,
    payee: normalizeText(input.payee, 'Disbursement'),
    purpose: normalizeText(input.purpose, 'Disbursement'),
    description: normalizeText(input.description, input.purpose || 'Disbursement'),
    amount: Number(input.amount ?? 0),
    payment_method: input.payment_method,
    supplier_id: input.supplier_id ?? null,
    owner_id: input.owner_id ?? null,
    owner_ledger_id: input.owner_ledger_id ?? null,
    check_id: input.check_id ?? null,
    check_number: input.check_number ?? '',
    reference_number: input.reference_number ?? '',
    disbursement_type: input.disbursement_type,
    notes: input.notes?.trim() ?? '',
    source_module: input.source_module,
    source_reference_id: input.source_reference_id,
    source_account_type: input.source_account_type ?? null,
    source_account_id: input.source_account_id ?? null,
    affects_cashflow: input.affects_cashflow ?? true,
    is_deleted: false,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from('disbursements')
    .select('id')
    .eq('source_module', input.source_module)
    .eq('source_reference_id', input.source_reference_id)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from('disbursements')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as Disbursement;
  }

  const { data, error } = await supabase
    .from('disbursements')
    .insert({
      ...payload,
      created_by: input.created_by ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Disbursement;
}

export async function archiveSourceDisbursement(sourceModule: string, sourceReferenceId: string) {
  if (!sourceModule || !sourceReferenceId) return;

  const { data } = await supabase
    .from('disbursements')
    .select('id')
    .eq('source_module', sourceModule)
    .eq('source_reference_id', sourceReferenceId)
    .eq('is_deleted', false);

  const rows = (data || []) as Array<{ id: string }>;
  if (rows.length === 0) return;

  await Promise.all(
    rows.map(row =>
      supabase
        .from('disbursements')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('id', row.id)
    )
  );
}
