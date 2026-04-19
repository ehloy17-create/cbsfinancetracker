import { TransferStatus } from '../../lib/types';

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  issued: 'In Transit',
  partially_received: 'Partially Received',
  fully_received: 'Fully Received',
  cancelled: 'Cancelled',
};

export const TRANSFER_STATUS_COLORS: Record<TransferStatus, { bg: string; text: string; border: string; dot: string }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400' },
  approved: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  issued: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
  partially_received: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
  fully_received: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  cancelled: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', dot: 'bg-red-400' },
};

export function formatCurrency(val: number) {
  return val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatQty(val: number) {
  return val % 1 === 0 ? val.toString() : val.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

export function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function canApprove(status: TransferStatus) {
  return status === 'draft';
}

export function canIssue(status: TransferStatus) {
  return status === 'approved';
}

export function canReceive(status: TransferStatus) {
  return status === 'issued' || status === 'partially_received';
}

export function canCancel(status: TransferStatus) {
  return status === 'draft' || status === 'approved';
}

export function canEdit(status: TransferStatus) {
  return status === 'draft';
}
