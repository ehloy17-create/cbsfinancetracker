import { FormEvent, useEffect, useState } from 'react';
import { ArrowUpCircle, Save, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PosShift } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { writeAuditLog } from '../../lib/audit';
import { formatCurrency } from '../../lib/utils';

interface Props {
  shift: PosShift;
  onClose: () => void;
  onSaved: () => void;
}

type PickupCategory = 'rider_payment' | 'petty_cash' | 'approved_withdrawal' | 'delivery_fee_payout' | 'other';

const CATEGORY_LABELS: Record<PickupCategory, string> = {
  rider_payment: 'Rider Payment',
  petty_cash: 'Petty Cash',
  approved_withdrawal: 'Approved Withdrawal',
  delivery_fee_payout: 'Delivery Fee Payout',
  other: 'Other',
};

function getDefaultPickupAt() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - (offset * 60 * 1000));
  return local.toISOString().slice(0, 16);
}

export default function PosCashOutModal({ shift, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [pickupAt, setPickupAt] = useState(getDefaultPickupAt());
  const [category, setCategory] = useState<PickupCategory>('rider_payment');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [relatedReference, setRelatedReference] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (saving) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saving, onClose]);

  const pickupAmount = Number(amount || 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!reason.trim()) {
      showToast('Reason is required', 'warning');
      return;
    }
    if (pickupAmount <= 0) {
      showToast('Pickup amount must be greater than zero', 'warning');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('post_pos_cash_pickup', {
        p_shift_id: shift.shift_id,
        p_pickup_at: new Date(pickupAt).toISOString(),
        p_amount: pickupAmount,
        p_reason: reason.trim(),
        p_category: category,
        p_notes: notes.trim(),
        p_related_reference: relatedReference.trim(),
        p_delivery_transaction_ids: [],
      });
      if (error) throw error;

      await writeAuditLog(user?.id ?? null, 'CREATE', 'PosCashPickups', String((data as any)?.pickup_id ?? ''), {
        shift_id: shift.shift_id,
        category,
        amount: pickupAmount,
      });

      showToast('Cash pickup recorded', 'success');
      onSaved();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as any)?.message ?? 'Failed to save cash pickup';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-red-600" />
            <div>
              <h2 className="font-semibold text-slate-800">Cash Pickup</h2>
              <p className="text-xs text-slate-500">Register cash withdrawal for this shift</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Date / Time</label>
              <input
                type="datetime-local"
                value={pickupAt}
                onChange={e => setPickupAt(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as PickupCategory)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Amount</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Reason</label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Why is cash being picked up?"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Related Reference</label>
              <input
                type="text"
                value={relatedReference}
                onChange={e => setRelatedReference(e.target.value)}
                placeholder="Optional reference no."
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Created By</label>
              <input
                type="text"
                value={user?.email ?? ''}
                disabled
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Pickup Amount: <span className="font-mono font-semibold">₱{formatCurrency(pickupAmount)}</span>
            <span className="ml-2 text-xs text-slate-500">This reduces the POS register balance for the shift.</span>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Cash Pickup'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
