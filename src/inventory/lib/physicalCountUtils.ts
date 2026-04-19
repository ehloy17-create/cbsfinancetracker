import { PhysicalCountStatus, PhysicalCountFilterType } from '../../lib/types';

export const PC_STATUS_LABELS: Record<PhysicalCountStatus, string> = {
  draft: 'Draft',
  counted: 'Counted',
  posted: 'Posted',
  cancelled: 'Cancelled',
};

export const PC_STATUS_COLORS: Record<PhysicalCountStatus, { bg: string; text: string; border: string; dot: string }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400' },
  counted: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
  posted: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  cancelled: { bg: 'bg-slate-100', text: 'text-slate-400', border: 'border-slate-200', dot: 'bg-slate-300' },
};

export const FILTER_TYPE_LABELS: Record<PhysicalCountFilterType, string> = {
  all: 'All Products',
  category: 'By Category',
  brand: 'By Brand',
};

export function canCount(status: PhysicalCountStatus) {
  return status === 'draft' || status === 'counted';
}

export function canPost(status: PhysicalCountStatus) {
  return status === 'counted';
}

export function canCancel(status: PhysicalCountStatus) {
  return status === 'draft' || status === 'counted';
}

export function canMarkCounted(status: PhysicalCountStatus) {
  return status === 'draft';
}

export function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatQty(val: number | null | undefined) {
  if (val == null) return '—';
  return val % 1 === 0 ? val.toString() : val.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

export function formatCurrency(val: number) {
  return val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function varianceClass(variance: number | null) {
  if (variance == null) return 'text-slate-400';
  if (variance === 0) return 'text-slate-600';
  if (variance > 0) return 'text-emerald-700 font-semibold';
  return 'text-red-700 font-semibold';
}

export function varianceSign(variance: number | null) {
  if (variance == null || variance === 0) return '';
  return variance > 0 ? '+' : '';
}
