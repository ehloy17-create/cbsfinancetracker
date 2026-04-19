import { AdjustmentReason, AdjustmentDirection, AdjustmentStatus } from '../../lib/types';

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  damaged: 'Damaged',
  expired: 'Expired',
  loss: 'Loss / Theft',
  spoilage: 'Spoilage',
  found_stock: 'Found Stock',
  system_correction: 'System Correction',
};

export const ADJUSTMENT_REASON_DEFAULT_DIRECTION: Record<AdjustmentReason, AdjustmentDirection> = {
  damaged: 'deduct',
  expired: 'deduct',
  loss: 'deduct',
  spoilage: 'deduct',
  found_stock: 'add',
  system_correction: 'add',
};

export const ADJUSTMENT_STATUS_LABELS: Record<AdjustmentStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  posted: 'Posted',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const ADJUSTMENT_STATUS_COLORS: Record<AdjustmentStatus, { bg: string; text: string; border: string; dot: string }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400' },
  pending_approval: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
  approved: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  posted: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  rejected: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', dot: 'bg-red-400' },
  cancelled: { bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-200', dot: 'bg-slate-300' },
};

export const DIRECTION_LABELS: Record<AdjustmentDirection, string> = {
  add: 'Add Stock (+)',
  deduct: 'Deduct Stock (−)',
};

export function canSubmitForApproval(status: AdjustmentStatus) {
  return status === 'draft' || status === 'rejected';
}

export function canApprove(status: AdjustmentStatus) {
  return status === 'pending_approval';
}

export function canReject(status: AdjustmentStatus) {
  return status === 'pending_approval';
}

export function canPost(status: AdjustmentStatus) {
  return status === 'approved';
}

export function canCancel(status: AdjustmentStatus) {
  return status === 'draft' || status === 'pending_approval';
}

export function canEdit(status: AdjustmentStatus) {
  return status === 'draft' || status === 'rejected';
}

export function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatQty(val: number) {
  return val % 1 === 0 ? val.toString() : val.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

export function formatCurrency(val: number) {
  return val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
