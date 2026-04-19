import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, Save, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { processCashTransaction } from '../../lib/cashTransactions';
import { Account } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { writeAuditLog } from '../../lib/audit';
import { getTodayDateString } from '../../lib/utils';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

const emptyForm = {
  date: getTodayDateString(),
  account_id: '',
  cash_in_mode: 'regular' as 'regular' | 'payment',
  fee_type: 'gcash' as 'cash' | 'gcash',
  cash_source: 'pos_register' as 'pos_register' | 'cash_fund',
  amount: '',
  transaction_fee: '',
  product_payment: '',
  delivery_fee: '',
  notes: '',
};

export default function PosCashInModal({ onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.from('accounts').select('*').eq('is_active', true).order('name').then(({ data }) => {
      const rows = (data ?? []) as Account[];
      setAccounts(rows);
      if (rows.length > 0) {
        setForm(current => ({ ...current, account_id: rows[0].id }));
      }
    });
  }, []);

  useEffect(() => {
    if (submitting) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [submitting, onClose]);

  const isPayment = form.cash_in_mode === 'payment';
  const computedAmount = useMemo(() => {
    if (isPayment) {
      return (parseFloat(form.product_payment) || 0) + (parseFloat(form.delivery_fee) || 0);
    }
    return parseFloat(form.amount) || 0;
  }, [form.amount, form.delivery_fee, form.product_payment, isPayment]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.account_id) {
      showToast('Please select an account', 'warning');
      return;
    }
    if (isPayment) {
      showToast('Product payment cash-ins must come from the POS checkout flow', 'warning');
      return;
    }
    if (isPayment && !form.product_payment) {
      showToast('Please enter the product payment amount', 'warning');
      return;
    }
    if (!isPayment && !form.amount) {
      showToast('Please enter an amount', 'warning');
      return;
    }
    if (computedAmount <= 0) {
      showToast('Amount must be greater than zero', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const { transaction } = await processCashTransaction({
        date: form.date,
        account_id: form.account_id,
        type: 'CASH_IN',
        cashin_type: 'regular',
        transaction_mode: form.fee_type === 'gcash' ? 'fee_included' : 'standard',
        amount: form.amount,
        fee: form.transaction_fee,
        source_account_type: form.cash_source,
        description: form.notes?.trim() || 'Cash in transaction',
        notes: form.notes,
        created_by: user?.id,
        source_module: 'pos_cash_in_modal',
      });

      await writeAuditLog(user?.id ?? null, 'CREATE', 'Transactions', transaction.id as string | undefined, {
        type: 'cash_in',
        mode: form.cash_in_mode,
        amount: computedAmount,
        account_id: form.account_id,
      });

      showToast('Cash In recorded!', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save transaction', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <ArrowDownCircle className="h-5 w-5 text-emerald-600" />
            <h2 className="font-semibold text-slate-800">Cash In</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Date</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Account</label>
              <select value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Mode</label>
            <div className="grid grid-cols-2 gap-3">
              {(['regular'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setForm({ ...form, cash_in_mode: mode, amount: '', product_payment: '', delivery_fee: '', cash_source: 'pos_register', transaction_fee: '' })}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${form.cash_in_mode === mode ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}
                >
                  {mode === 'regular' ? 'Regular' : 'Payment'}
                </button>
              ))}
            </div>
          </div>

          {isPayment ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Product Payment</label>
                <input type="number" min="0" step="0.01" value={form.product_payment} onChange={e => setForm({ ...form, product_payment: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Delivery Fee</label>
                <input type="number" min="0" step="0.01" value={form.delivery_fee} onChange={e => setForm({ ...form, delivery_fee: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Amount</label>
                  <input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Transaction Fee</label>
                  <input type="number" min="0" step="0.01" value={form.transaction_fee} onChange={e => setForm({ ...form, transaction_fee: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Source</label>
                  <select value={form.cash_source} onChange={e => setForm({ ...form, cash_source: e.target.value as 'pos_register' | 'cash_fund' })} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="pos_register">POS Register</option>
                    <option value="cash_fund">Cash Fund</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Fee Type</label>
                  <select value={form.fee_type} onChange={e => setForm({ ...form, fee_type: e.target.value as 'cash' | 'gcash' })} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="gcash">GCash</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
              </div>
            </>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes</label>
            <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Total: <span className="font-mono font-semibold">₱{computedAmount.toFixed(2)}</span>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
            <button type="submit" disabled={submitting} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              <Save className="h-4 w-4" />
              Save Cash In
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
