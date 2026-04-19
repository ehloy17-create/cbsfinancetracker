import { InvMovementType } from '../../lib/types';

export const MOVEMENT_LABELS: Record<InvMovementType, string> = {
  opening_balance: 'Opening Balance',
  receiving: 'Receiving',
  sale: 'Sale',
  transfer_out: 'Transfer Out',
  transfer_in: 'Transfer In',
  adjustment_add: 'Adjustment (Add)',
  adjustment_deduct: 'Adjustment (Deduct)',
  physical_count: 'Physical Count Variance',
  expired: 'Expired',
  damaged: 'Damaged',
  loss: 'Loss',
};

export const MOVEMENT_COLORS: Record<InvMovementType, { bg: string; text: string; border: string }> = {
  opening_balance: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  receiving: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  sale: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' },
  transfer_out: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  transfer_in: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200' },
  adjustment_add: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
  adjustment_deduct: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  physical_count: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  expired: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  damaged: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
  loss: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
};

export function isInflow(type: InvMovementType): boolean {
  return ['opening_balance', 'receiving', 'transfer_in', 'adjustment_add'].includes(type);
}

export function isOutflow(type: InvMovementType): boolean {
  return ['sale', 'transfer_out', 'adjustment_deduct', 'expired', 'damaged', 'loss'].includes(type);
}

export const ALL_MOVEMENT_TYPES: InvMovementType[] = [
  'opening_balance',
  'receiving',
  'sale',
  'transfer_out',
  'transfer_in',
  'adjustment_add',
  'adjustment_deduct',
  'physical_count',
  'expired',
  'damaged',
  'loss',
];
