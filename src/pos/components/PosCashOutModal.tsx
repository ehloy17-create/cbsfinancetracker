import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowUpCircle, Bike, Save, X } from 'lucide-react';
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

interface OutstandingDeliveryFeeRow {
  transactionId: string;
  saleId: string;
  receiptNo: string;
  customerName: string;
  deliveryFee: number;
  outstandingAmount: number;
  createdAt: string;
}

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
  const [loading, setLoading] = useState(true);
  const [outstandingFees, setOutstandingFees] = useState<OutstandingDeliveryFeeRow[]>([]);
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);
  const [selectedRiderDeliveryId, setSelectedRiderDeliveryId] = useState<string>('');

  useEffect(() => {
    if (saving) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saving, onClose]);

  useEffect(() => {
    async function loadOutstandingDeliveryFees() {
      setLoading(true);
      try {
        const [
          { data: saleRows },
          { data: customerRows },
          { data: transactionRows },
          { data: pickupRows },
          { data: linkRows },
        ] = await Promise.all([
          supabase
            .from('sales')
            .select('sale_id, receipt_no, customer_id, created_at')
            .eq('shift_id', shift.shift_id),
          supabase
            .from('pos_customers')
            .select('customer_id, first_name, last_name')
            .eq('is_active', true),
          supabase
            .from('transactions')
            .select('id, source_sale_id, delivery_fee, created_at')
            .eq('date', shift.business_date)
            .eq('transaction_type', 'cash_in')
            .eq('cash_in_mode', 'payment')
            .eq('is_deleted', false),
          supabase
            .from('pos_cash_pickups')
            .select('id')
            .eq('terminal_id', shift.terminal_id)
            .eq('business_date', shift.business_date)
            .eq('is_deleted', false),
          supabase
            .from('pos_cash_pickup_links')
            .select('pickup_id, source_transaction_id, linked_amount'),
        ]);

        const customerMap = new Map(
          ((customerRows ?? []) as Array<Record<string, unknown>>).map(row => {
            const firstName = String(row.first_name ?? '').trim();
            const lastName = String(row.last_name ?? '').trim();
            return [String(row.customer_id ?? ''), `${firstName} ${lastName}`.trim() || 'Walk-in'];
          })
        );

        const sales = (saleRows ?? []) as Array<Record<string, unknown>>;
        const saleMap = new Map(
          sales.map(row => [
            String(row.sale_id ?? ''),
            {
              receiptNo: String(row.receipt_no ?? ''),
              customerName: customerMap.get(String(row.customer_id ?? '')) ?? 'Walk-in',
            },
          ])
        );
        const saleIds = new Set(sales.map(row => String(row.sale_id ?? '')).filter(Boolean));
        const pickupIds = new Set(((pickupRows ?? []) as Array<Record<string, unknown>>).map(row => String(row.id ?? '')).filter(Boolean));
        const pickedByTransaction = new Map<string, number>();

        for (const row of (linkRows ?? []) as Array<Record<string, unknown>>) {
          const pickupId = String(row.pickup_id ?? '');
          if (!pickupIds.has(pickupId)) continue;
          const transactionId = String(row.source_transaction_id ?? '');
          if (!transactionId) continue;
          pickedByTransaction.set(
            transactionId,
            (pickedByTransaction.get(transactionId) ?? 0) + Number(row.linked_amount ?? 0)
          );
        }

        const nextRows = ((transactionRows ?? []) as Array<Record<string, unknown>>)
          .filter(row => {
            const saleId = String(row.source_sale_id ?? '');
            return saleIds.has(saleId) && Number(row.delivery_fee ?? 0) > 0;
          })
          .map(row => {
            const saleId = String(row.source_sale_id ?? '');
            const deliveryFee = Number(row.delivery_fee ?? 0);
            const alreadyPicked = pickedByTransaction.get(String(row.id ?? '')) ?? 0;
            return {
              transactionId: String(row.id ?? ''),
              saleId,
              receiptNo: saleMap.get(saleId)?.receiptNo ?? '—',
              customerName: saleMap.get(saleId)?.customerName ?? 'Walk-in',
              deliveryFee,
              outstandingAmount: Math.max(0, deliveryFee - alreadyPicked),
              createdAt: String(row.created_at ?? ''),
            } satisfies OutstandingDeliveryFeeRow;
          })
          .filter(row => row.outstandingAmount > 0)
          .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

        setOutstandingFees(nextRows);
      } finally {
        setLoading(false);
      }
    }

    void loadOutstandingDeliveryFees();
  }, [shift.business_date, shift.terminal_id]);

  useEffect(() => {
    if (category !== 'delivery_fee_payout') setSelectedDeliveryIds([]);
    if (category !== 'rider_payment') setSelectedRiderDeliveryId('');
  }, [category]);

  // Auto-fill amount when rider selects a delivery
  useEffect(() => {
    if (category === 'rider_payment' && selectedRiderDeliveryId) {
      const row = outstandingFees.find(r => r.transactionId === selectedRiderDeliveryId);
      if (row) setAmount(String(row.outstandingAmount));
    }
  }, [selectedRiderDeliveryId, category, outstandingFees]);

  const selectedDeliveryRows = outstandingFees.filter(row => selectedDeliveryIds.includes(row.transactionId));
  const selectedDeliveryTotal = useMemo(
    () => selectedDeliveryRows.reduce((sum, row) => sum + row.outstandingAmount, 0),
    [selectedDeliveryRows]
  );
  const outstandingDeliveryTotal = useMemo(
    () => outstandingFees.reduce((sum, row) => sum + row.outstandingAmount, 0),
    [outstandingFees]
  );
  const pickupAmount = category === 'delivery_fee_payout' ? selectedDeliveryTotal : Number(amount || 0);

  function toggleDeliverySelection(transactionId: string) {
    setSelectedDeliveryIds(current => (
      current.includes(transactionId)
        ? current.filter(id => id !== transactionId)
        : [...current, transactionId]
    ));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!reason.trim()) {
      showToast('Reason is required', 'warning');
      return;
    }
    if (category === 'rider_payment' && !selectedRiderDeliveryId) {
      showToast('Select a GCash delivery transaction for rider payment', 'warning');
      return;
    }
    if (category === 'delivery_fee_payout' && selectedDeliveryIds.length === 0) {
      showToast('Select at least one outstanding delivery fee to pick up', 'warning');
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
        p_delivery_transaction_ids: category === 'delivery_fee_payout'
          ? selectedDeliveryIds
          : category === 'rider_payment' && selectedRiderDeliveryId
            ? [selectedRiderDeliveryId]
            : [],
      });
      if (error) throw error;

      await writeAuditLog(user?.id ?? null, 'CREATE', 'PosCashPickups', String(data?.pickup_id ?? ''), {
        shift_id: shift.shift_id,
        category,
        amount: pickupAmount,
        related_reference: relatedReference.trim(),
        delivery_transaction_ids: category === 'delivery_fee_payout'
          ? selectedDeliveryIds
          : category === 'rider_payment' && selectedRiderDeliveryId
            ? [selectedRiderDeliveryId]
            : [],
      });

      showToast('Cash pickup recorded', 'success');
      onSaved();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to save cash pickup', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-red-600" />
            <div>
              <h2 className="font-semibold text-slate-800">Cash Pickup</h2>
              <p className="text-xs text-slate-500">Register cash withdrawal for this shift</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Outstanding GCash delivery fee payout available: <span className="font-mono font-semibold">₱{formatCurrency(outstandingDeliveryTotal)}</span>
          </div>

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

          {category === 'rider_payment' && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Select GCash Delivery Transaction
              </label>
              {loading ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
                  Loading delivery transactions...
                </div>
              ) : outstandingFees.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                  No outstanding GCash deliveries for this register/day.
                </div>
              ) : (
                <select
                  value={selectedRiderDeliveryId}
                  onChange={e => setSelectedRiderDeliveryId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Select customer delivery —</option>
                  {outstandingFees.map(row => (
                    <option key={row.transactionId} value={row.transactionId}>
                      {row.customerName} · {row.receiptNo} · ₱{formatCurrency(row.outstandingAmount)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {category === 'delivery_fee_payout' ? (
            <div className="rounded-xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <Bike className="h-4 w-4 text-amber-600" />
                  Outstanding delivery fees
                </div>
                <span className="text-xs text-slate-500">
                  Selected: <span className="font-mono font-semibold text-slate-700">₱{formatCurrency(selectedDeliveryTotal)}</span>
                </span>
              </div>
              {loading ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">Loading delivery fees...</div>
              ) : outstandingFees.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">No outstanding delivery fees for this register/day.</div>
              ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                  {outstandingFees.map(row => {
                    const checked = selectedDeliveryIds.includes(row.transactionId);
                    return (
                      <label key={row.transactionId} className={`flex cursor-pointer items-start gap-3 px-4 py-3 ${checked ? 'bg-amber-50' : 'bg-white hover:bg-slate-50'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDeliverySelection(row.transactionId)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-mono text-sm font-semibold text-slate-800">{row.receiptNo}</p>
                              <p className="text-xs text-slate-500">{row.customerName}</p>
                            </div>
                            <p className="font-mono text-sm font-semibold text-amber-700">₱{formatCurrency(row.outstandingAmount)}</p>
                          </div>
                          <p className="mt-1 text-xs text-slate-400">{new Date(row.createdAt).toLocaleString('en-PH')}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Amount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Reason</label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={category === 'delivery_fee_payout' ? 'e.g. Rider payout for GCash deliveries' : 'Why is cash being picked up?'}
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
              rows={3}
              placeholder="Optional notes"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Pickup Amount: <span className="font-mono font-semibold">₱{formatCurrency(pickupAmount)}</span>
            <span className="ml-2 text-xs text-slate-500">
              This reduces the POS register balance for the shift.
            </span>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              <Save className="h-4 w-4" />
              Save Cash Pickup
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
