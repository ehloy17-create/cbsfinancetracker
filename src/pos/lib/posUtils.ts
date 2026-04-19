import { PosShiftStatus, SaleStatus, SalePaymentMethod } from '../../lib/types';

export const SHIFT_STATUS_LABELS: Record<PosShiftStatus, string> = {
  open: 'Open',
  closed: 'Closed',
};

export const SHIFT_STATUS_COLORS: Record<PosShiftStatus, { bg: string; text: string; border: string; dot: string }> = {
  open: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  closed: { bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-200', dot: 'bg-slate-300' },
};

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  completed: 'Completed',
  held: 'Held',
  cancelled: 'Cancelled',
  voided: 'Voided',
};

export const PAYMENT_METHOD_LABELS: Record<SalePaymentMethod, string> = {
  cash: 'Cash',
  gcash: 'GCash',
  charge: 'Charge to Account',
};

export function formatCurrency(val: number) {
  return val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDateTime(dt: string) {
  return new Date(dt).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function formatDate(dt: string) {
  return new Date(dt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTime(dt: string) {
  return new Date(dt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true });
}
