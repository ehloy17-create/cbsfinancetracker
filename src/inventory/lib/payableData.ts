import { round2 } from '../../lib/utils';
import { Payable, PayablePayment } from '../../lib/types';

type RawRow = Record<string, unknown>;

export function normalizePayable(raw: RawRow): Payable {
  const totalAmount = Number(raw.total_amount ?? raw.amount ?? 0);
  const balanceDue = Number(raw.balance_due ?? raw.balance ?? totalAmount);
  const amountPaid = Number(raw.amount_paid ?? round2(totalAmount - balanceDue));
  const paymentStatus = String(
    raw.payment_status ?? raw.status ?? (balanceDue <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid')
  );

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

export function normalizePayablePayment(raw: RawRow): PayablePayment {
  return {
    id: String(raw.id ?? ''),
    payable_id: String(raw.payable_id ?? ''),
    payment_date: String(raw.payment_date ?? raw.created_at ?? ''),
    amount: Number(raw.amount ?? 0),
    payment_method: String(raw.payment_method ?? 'cash') as PayablePayment['payment_method'],
    reference_number: String(raw.reference_number ?? raw.reference_no ?? ''),
    remarks: String(raw.remarks ?? raw.notes ?? ''),
    owner_id: raw.owner_id ? String(raw.owner_id) : null,
    bank_account_id: raw.bank_account_id ? String(raw.bank_account_id) : null,
    check_id: raw.check_id ? String(raw.check_id) : null,
    bank_transaction_id: raw.bank_transaction_id ? String(raw.bank_transaction_id) : null,
    owner_ledger_id: raw.owner_ledger_id ? String(raw.owner_ledger_id) : null,
    attachment_reference: raw.attachment_reference ? String(raw.attachment_reference) : null,
    approval_required: raw.approval_required == null ? undefined : Boolean(raw.approval_required),
    approval_status: raw.approval_status ? String(raw.approval_status) as PayablePayment['approval_status'] : undefined,
    approved_by: raw.approved_by ? String(raw.approved_by) : null,
    approved_at: raw.approved_at ? String(raw.approved_at) : null,
    created_by: raw.created_by ? String(raw.created_by) : null,
    created_at: String(raw.created_at ?? ''),
    payables: raw.payables as PayablePayment['payables'],
    bank_accounts: raw.bank_accounts as PayablePayment['bank_accounts'],
    checks_issued: raw.checks_issued as PayablePayment['checks_issued'],
    profiles: raw.profiles as PayablePayment['profiles'],
  };
}

export function getPayableSource(payable: Payable): 'manual' | 'receiving' {
  return payable.receiving_id ? 'receiving' : 'manual';
}

export function getPayableSourceLabel(payable: Payable): string {
  return getPayableSource(payable) === 'receiving' ? 'PO / Receiving' : 'Manual Entry';
}
