import { Payable, PayablePaymentStatus } from '../../lib/types';

export const PAYABLE_STATUS_LABELS: Record<PayablePaymentStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Partial',
  paid: 'Paid',
  voided: 'Voided',
};

export const PAYABLE_STATUS_COLORS: Record<PayablePaymentStatus, { bg: string; text: string; border: string; dot: string }> = {
  unpaid: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500' },
  partial: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
  paid: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  voided: { bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200', dot: 'bg-slate-400' },
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  check: 'Check',
  bank_transfer: 'Bank Transfer',
  gcash: 'GCash',
  owner_personal_fund: 'Owner Personal Fund',
  other: 'Other',
};

export function getAgingBucket(dueDateStr: string): 'current' | '1-30' | '31-60' | '61+' {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'current';
  if (diffDays <= 30) return '1-30';
  if (diffDays <= 60) return '31-60';
  return '61+';
}

export function computeAgingSummary(payables: Payable[]) {
  const open = payables.filter(p => p.payment_status !== 'paid' && p.payment_status !== 'voided');
  const summary = {
    current: 0,
    '1-30': 0,
    '31-60': 0,
    '61+': 0,
    total: 0,
  };
  for (const p of open) {
    const bucket = getAgingBucket(p.due_date);
    summary[bucket] += Number(p.balance_due);
    summary.total += Number(p.balance_due);
  }
  return summary;
}

export function formatCurrency(val: number) {
  return val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function isOverdue(payable: Payable) {
  if (payable.payment_status === 'paid' || payable.payment_status === 'voided') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(payable.due_date);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

export function daysOverdue(dueDateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
}
