import { useState, useEffect, FormEvent, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownCircle, Save, RotateCcw, CreditCard as Edit2, Trash2, TrendingUp, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { processCashTransaction } from '../lib/cashTransactions';
import { Account, Transaction } from '../lib/types';
import { getTodayDateString, formatCurrency, formatDateTime } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import ConfirmDialog from '../components/ConfirmDialog';

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

function isPosManagedProductPayment(txn: Pick<Transaction, 'transaction_type' | 'cash_in_mode'>) {
  return txn.transaction_type === 'cash_in' && txn.cash_in_mode === 'payment';
}

function isPosProtectedTransaction(txn: Pick<Transaction, 'transaction_type' | 'cash_in_mode' | 'cash_out_type' | 'reversal_of_transaction_id'>) {
  return isPosManagedProductPayment(txn) || txn.cash_out_type === 'void_reversal' || Boolean(txn.reversal_of_transaction_id);
}

export default function CashInPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [recentTxns, setRecentTxns] = useState<Record<string, Transaction[]>>({});
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Transaction | null>(null);
  const [editForm, setEditForm] = useState({
    cash_in_mode: 'regular' as 'regular' | 'payment',
    cash_source: 'pos_register' as 'pos_register' | 'cash_fund',
    amount: '',
    product_payment: '',
    delivery_fee: '',
    transaction_fee: '',
    fee_type: 'gcash' as 'cash' | 'gcash',
    notes: '',
  });

  const isPayment = form.cash_in_mode === 'payment';
  const productPaymentAmount = isPayment ? parseFloat(form.product_payment) || 0 : 0;
  const deliveryFeeAmount = isPayment ? parseFloat(form.delivery_fee) || 0 : 0;
  const computedAmount = isPayment
    ? productPaymentAmount + deliveryFeeAmount
    : parseFloat(form.amount) || 0;

  const loadRecent = useCallback(async (accs: Account[]) => {
    const result: Record<string, Transaction[]> = {};
    await Promise.all(
      accs.map(async (acc) => {
        const { data } = await supabase
          .from('transactions')
          .select('*, profiles(name)')
          .eq('account_id', acc.id)
          .eq('transaction_type', 'cash_in')
          .eq('is_deleted', false)
          .order('created_at', { ascending: false })
          .limit(8);
        result[acc.id] = (data as unknown as Transaction[]) || [];
      })
    );
    setRecentTxns(result);
  }, []);

  useEffect(() => {
    supabase.from('accounts').select('*').eq('is_active', true).order('name').then(({ data }) => {
      if (data) {
        setAccounts(data);
        if (data.length > 0) setForm(f => ({ ...f, account_id: data[0].id }));
        loadRecent(data);
      }
    });
  }, [loadRecent]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('cashin-txns')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        supabase.from('accounts').select('*').eq('is_active', true).order('name').then(({ data }) => {
          if (data) loadRecent(data);
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadRecent]);

  function reset() {
    setForm({ ...emptyForm, account_id: accounts[0]?.id || '', date: getTodayDateString() });
  }

  async function handleSubmit(e: FormEvent, addAnother = false) {
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
        cashin_type: isPayment ? 'product_payment' : 'regular',
        transaction_mode: form.fee_type === 'gcash' ? 'fee_included' : 'standard',
        amount: isPayment ? form.product_payment : form.amount,
        fee: isPayment ? '0' : form.transaction_fee,
        total_amount: isPayment ? computedAmount : undefined,
        delivery_fee: isPayment ? form.delivery_fee : '0',
        source_account_type: isPayment ? 'pos_register' : form.cash_source,
        pos_reference_id: isPayment ? (form.notes?.trim() || form.date) : null,
        description: form.notes?.trim() || (form.cash_in_mode === 'payment' ? 'Cash in payment transaction' : 'Cash in transaction'),
        notes: form.notes,
        created_by: user?.id,
        source_module: 'cash_in_page',
      });

      await writeAuditLog(user?.id ?? null, 'CREATE', 'Transactions', transaction.id as string | undefined, {
        type: 'cash_in',
        mode: form.cash_in_mode,
        amount: computedAmount,
        account_id: form.account_id,
      });

      showToast('Cash In recorded!', 'success');
      if (addAnother) {
        setForm(f => ({ ...emptyForm, account_id: f.account_id, date: f.date, cash_in_mode: f.cash_in_mode, fee_type: f.fee_type }));
      } else {
        navigate('/gcash');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save transaction', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    const tx = Object.values(recentTxns).flat().find(item => item.id === id) ?? null;
    if (tx && isPosProtectedTransaction(tx)) {
      showToast('This POS-linked transaction can only be reversed by voiding the sale in POS', 'warning');
      setDeleteTarget(null);
      return;
    }
    await supabase.from('transactions').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', id);
    await writeAuditLog(user?.id ?? null, 'DELETE', 'Transactions', id, {});
    showToast('Transaction deleted', 'success');
    setDeleteTarget(null);
  }

  async function handleEdit() {
    if (!editTarget) return;
    const isEditPayment = editForm.cash_in_mode === 'payment';
    const editProductPayment = isEditPayment ? parseFloat(editForm.product_payment) || 0 : 0;
    const editDeliveryFee = isEditPayment ? parseFloat(editForm.delivery_fee) || 0 : 0;
    const computedEditAmount = isEditPayment
      ? editProductPayment + editDeliveryFee
      : parseFloat(editForm.amount) || 0;

    const payload: Record<string, unknown> = {
      cash_in_mode: editForm.cash_in_mode,
      amount: computedEditAmount,
      transaction_fee: isEditPayment ? 0 : (parseFloat(editForm.transaction_fee) || 0),
      fee_type: editForm.fee_type,
      notes: editForm.notes,
      updated_at: new Date().toISOString(),
    };

    if (!isEditPayment) {
      payload.cash_source = editForm.cash_source;
      payload.amount_received = null;
      payload.delivery_fee = null;
    } else {
      payload.cash_source = null;
      payload.amount_received = editProductPayment;
      payload.delivery_fee = editDeliveryFee;
    }

    await supabase.from('transactions').update(payload).eq('id', editTarget.id);
    await writeAuditLog(user?.id ?? null, 'UPDATE', 'Transactions', editTarget.id, { amount: computedEditAmount, notes: editForm.notes });
    showToast('Transaction updated', 'success');
    setEditTarget(null);
  }

  function openEdit(t: Transaction) {
    const isPaymentMode = t.cash_in_mode === 'payment';
    setEditTarget(t);
    setEditForm({
      cash_in_mode: t.cash_in_mode || 'regular',
      cash_source: (t.cash_source as 'pos_register' | 'cash_fund') || 'pos_register',
      amount: isPaymentMode ? '' : String(t.amount),
      product_payment: isPaymentMode ? String(t.amount_received ?? t.amount) : '',
      delivery_fee: isPaymentMode ? String(t.delivery_fee ?? '') : '',
      transaction_fee: String(t.transaction_fee || ''),
      fee_type: (t.fee_type as 'cash' | 'gcash') || 'gcash',
      notes: t.notes || '',
    });
  }

  const inputClass = "w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition";
  const labelClass = "block text-sm font-medium text-slate-700 mb-1.5";

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
          <ArrowDownCircle className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Cash In</h1>
          <p className="text-slate-500 text-sm">Record incoming GCash transaction</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Form */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
          <form onSubmit={e => handleSubmit(e, false)} className="space-y-4">
            {/* Row 1: Date + Account */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Date *</label>
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                  className={inputClass} required />
              </div>
              <div>
                <label className={labelClass}>Account *</label>
                <select value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })}
                  className={inputClass} required>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>

            {/* Row 2: Mode toggle */}
            <div>
              <label className={labelClass}>Cash In Mode *</label>
              <div className="grid grid-cols-2 gap-3">
                {(['regular'] as const).map(mode => (
                  <button key={mode} type="button"
                    onClick={() => setForm({ ...form, cash_in_mode: mode, amount: '', product_payment: '', delivery_fee: '', cash_source: 'pos_register', transaction_fee: '' })}
                    className={`py-2.5 px-4 rounded-lg border text-sm font-medium transition-all ${
                      form.cash_in_mode === mode
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                        : 'border-slate-300 text-slate-600 hover:border-slate-400'
                    }`}>
                    {mode === 'regular' ? 'Regular' : 'Payment Transaction'}
                  </button>
                ))}
              </div>
            </div>

            {/* Cash Source (regular mode only) */}
            {!isPayment && (
              <div>
                <label className={labelClass}>Cash Source *</label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { value: 'pos_register', label: 'POS Cash Register' },
                    { value: 'cash_fund', label: 'Cash Fund' },
                  ] as const).map(opt => (
                    <button key={opt.value} type="button"
                      onClick={() => setForm({ ...form, cash_source: opt.value })}
                      className={`py-2.5 px-4 rounded-lg border text-sm font-medium transition-all ${
                        form.cash_source === opt.value
                          ? 'border-teal-600 bg-teal-50 text-teal-700'
                          : 'border-slate-300 text-slate-600 hover:border-slate-400'
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Row 3 (payment only): Payment details */}
            {isPayment && (
              <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100 space-y-3">
                <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">Payment Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Product Payment *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                      <input type="number" inputMode="decimal" value={form.product_payment}
                        onChange={e => setForm({ ...form, product_payment: e.target.value })}
                        placeholder="0.00" step="0.01" min="0"
                        className={`${inputClass} pl-7 bg-white`} required={isPayment} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Delivery Fee</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                      <input type="number" inputMode="decimal" value={form.delivery_fee}
                        onChange={e => setForm({ ...form, delivery_fee: e.target.value })}
                        placeholder="0.00" step="0.01" min="0"
                        className={`${inputClass} pl-7 bg-white`} />
                    </div>
                  </div>
                </div>
                <div className="pt-1 border-t border-emerald-200 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-emerald-600">Product Payment</span>
                    <span className="text-sm font-semibold text-emerald-700">{formatCurrency(productPaymentAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-emerald-600">Delivery Fee</span>
                    <span className="text-sm font-semibold text-blue-600">{formatCurrency(deliveryFeeAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-emerald-100 pt-1">
                    <span className="text-sm font-semibold text-emerald-700">Total Amount</span>
                    <span className="text-lg font-bold text-emerald-700">{formatCurrency(computedAmount)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Row 4: Amount (regular) + Transaction Fee */}
            <div className={`grid gap-4 ${isPayment ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {!isPayment ? (
                <div>
                  <label className={labelClass}>Amount *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                    <input type="number" inputMode="decimal" value={form.amount}
                      onChange={e => setForm({ ...form, amount: e.target.value })}
                      placeholder="0.00" step="0.01" min="0"
                      className={`${inputClass} pl-7`} required={!isPayment} />
                  </div>
                </div>
              ) : (
                <div>
                  <label className={labelClass}>Total Amount (auto)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                    <input type="text" value={computedAmount.toFixed(2)} readOnly
                      className={`${inputClass} pl-7 bg-slate-50 text-slate-500 cursor-not-allowed`} />
                  </div>
                </div>
              )}
              {!isPayment && (
                <div>
                  <label className={labelClass}>Transaction Fee</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                    <input type="number" inputMode="decimal" value={form.transaction_fee}
                      onChange={e => setForm({ ...form, transaction_fee: e.target.value })}
                      placeholder="0.00" step="0.01" min="0" className={`${inputClass} pl-7`} />
                  </div>
                </div>
              )}
            </div>

            {/* Fee Type */}
            {!isPayment && parseFloat(form.transaction_fee) > 0 && (
              <div>
                <label className={labelClass}>Fee Payment Method</label>
                <div className="grid grid-cols-2 gap-3">
                  {(['gcash', 'cash'] as const).map(ft => (
                    <button key={ft} type="button"
                      onClick={() => setForm({ ...form, fee_type: ft })}
                      className={`py-2 px-4 rounded-lg border text-sm font-medium transition-all ${
                        form.fee_type === ft
                          ? ft === 'gcash'
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-amber-500 bg-amber-50 text-amber-700'
                          : 'border-slate-300 text-slate-600 hover:border-slate-400'
                      }`}>
                      {ft === 'gcash' ? 'GCash (add to balance)' : 'Cash (physical)'}
                    </button>
                  ))}
                </div>
                {form.fee_type === 'cash' && (
                  <p className="text-xs text-amber-600 mt-1.5">Fee collected as physical cash — tracked in Cash Balance</p>
                )}
              </div>
            )}

            {/* Notes */}
            <div>
              <label className={labelClass}>Notes</label>
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional notes..." rows={2} className={`${inputClass} resize-none`} />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={reset}
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
              <button type="button" disabled={submitting}
                onClick={e => handleSubmit(e as unknown as FormEvent, true)}
                className="flex items-center gap-2 px-4 py-2.5 border border-blue-300 text-blue-700 bg-blue-50 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors disabled:opacity-60">
                <Save className="w-4 h-4" />
                Save & Add
              </button>
              <button type="submit" disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60 text-sm">
                {submitting
                  ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <Save className="w-4 h-4" />}
                Save Cash In
              </button>
            </div>
          </form>
        </div>

        {/* Recent Transactions per account */}
        <div className="space-y-4">
          {accounts.map(acc => (
            <div key={acc.id} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-semibold text-slate-700">{acc.name}</span>
                  <span className="text-xs text-slate-400">— Cash In</span>
                </div>
                <span className="text-xs text-slate-500">{recentTxns[acc.id]?.length || 0} recent</span>
              </div>
              {!recentTxns[acc.id] || recentTxns[acc.id].length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <p className="text-xs">No cash in transactions yet</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {recentTxns[acc.id].map(t => {
                    const deleteDisabled = isPosProtectedTransaction(t);
                    return (
                    <div key={t.id} className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-slate-50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-emerald-600">+{formatCurrency(Number(t.amount))}</span>
                          {t.cash_in_mode === 'payment' && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Payment</span>
                          )}
                          {t.cash_out_type === 'void_reversal' && (
                            <span className="text-xs bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-medium">Void Reversal</span>
                          )}
                          {t.cash_in_mode === 'regular' && t.cash_source && (
                            <span className="text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded font-medium">
                              {t.cash_source === 'pos_register' ? 'POS' : 'Cash Fund'}
                            </span>
                          )}
                          {Number(t.transaction_fee) > 0 && (
                            <span className={`text-xs ${t.fee_type === 'cash' ? 'text-amber-700 bg-amber-50 px-1 rounded' : 'text-amber-600'}`}>
                              Fee: {formatCurrency(Number(t.transaction_fee))}{t.fee_type === 'cash' ? ' (cash)' : ''}
                            </span>
                          )}
                          {Number(t.delivery_fee) > 0 && (
                            <span className="text-xs text-blue-600">Del: {formatCurrency(Number(t.delivery_fee))}</span>
                          )}
                        </div>
                        {t.notes && <p className="text-xs text-slate-400 mt-0.5 truncate">{t.notes}</p>}
                        <p className="text-xs text-slate-400 mt-0.5">{formatDateTime(t.created_at)}</p>
                      </div>
                      {profile?.role === 'admin' && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => openEdit(t)}
                            title={isPosProtectedTransaction(t) ? 'View POS-linked transaction details' : 'Edit transaction'}
                            className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setDeleteTarget(t.id)}
                            disabled={deleteDisabled}
                            title={deleteDisabled ? 'Reverse this transaction by voiding the related POS sale' : 'Delete transaction'}
                            className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-400 disabled:hover:bg-transparent">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )})}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Transaction"
        message="Are you sure you want to delete this transaction?"
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Edit Modal */}
      {editTarget && (() => {
        const isEditPayment = editForm.cash_in_mode === 'payment';
        const isViewOnlyPayment = isPosProtectedTransaction(editTarget);
        const editProductPaymentDisplay = isEditPayment ? parseFloat(editForm.product_payment) || 0 : 0;
        const editDeliveryFeeDisplay = isEditPayment ? parseFloat(editForm.delivery_fee) || 0 : 0;
        const computedEditAmount = isEditPayment
          ? editProductPaymentDisplay + editDeliveryFeeDisplay
          : parseFloat(editForm.amount) || 0;
        const editHasFee = parseFloat(editForm.transaction_fee) > 0;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setEditTarget(null)} />
            <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold text-slate-800">{isViewOnlyPayment ? 'Payment Details' : 'Edit Cash In Transaction'}</h3>
                <button onClick={() => setEditTarget(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>
              <div className="space-y-4">
                {isViewOnlyPayment && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                    This transaction came from the POS module. Details are view-only here.
                  </div>
                )}
                {/* Mode */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Cash In Mode</label>
                  <div className="grid grid-cols-2 gap-3">
                    {(['regular'] as const).map(mode => (
                      <button key={mode} type="button"
                        disabled={isViewOnlyPayment}
                        onClick={() => setEditForm(f => ({ ...f, cash_in_mode: mode, amount: '', product_payment: '', delivery_fee: '', transaction_fee: '' }))}
                        className={`py-2 px-4 rounded-lg border text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                          editForm.cash_in_mode === mode
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                            : 'border-slate-300 text-slate-600 hover:border-slate-400'
                        }`}>
                        {mode === 'regular' ? 'Regular' : 'Payment Transaction'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cash Source (regular only) */}
                {!isEditPayment && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Cash Source</label>
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        { value: 'pos_register', label: 'POS Cash Register' },
                        { value: 'cash_fund', label: 'Cash Fund' },
                      ] as const).map(opt => (
                        <button key={opt.value} type="button"
                          disabled={isViewOnlyPayment}
                          onClick={() => setEditForm(f => ({ ...f, cash_source: opt.value }))}
                          className={`py-2 px-4 rounded-lg border text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                            editForm.cash_source === opt.value
                              ? 'border-teal-600 bg-teal-50 text-teal-700'
                              : 'border-slate-300 text-slate-600 hover:border-slate-400'
                          }`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Payment details */}
                {isEditPayment && (
                  <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100 space-y-3">
                    <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">Payment Details</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Product Payment *</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                          <input type="number" inputMode="decimal" value={editForm.product_payment}
                            readOnly={isViewOnlyPayment}
                            onChange={e => setEditForm(f => ({ ...f, product_payment: e.target.value }))}
                            placeholder="0.00" step="0.01" min="0"
                            className={`w-full pl-7 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isViewOnlyPayment ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'bg-white'}`} />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Delivery Fee</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                          <input type="number" inputMode="decimal" value={editForm.delivery_fee}
                            readOnly={isViewOnlyPayment}
                            onChange={e => setEditForm(f => ({ ...f, delivery_fee: e.target.value }))}
                            placeholder="0.00" step="0.01" min="0"
                            className={`w-full pl-7 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isViewOnlyPayment ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'bg-white'}`} />
                        </div>
                      </div>
                    </div>
                    <div className="pt-1 border-t border-emerald-200 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-emerald-600">Product Payment</span>
                        <span className="text-sm font-semibold text-emerald-700">{formatCurrency(editProductPaymentDisplay)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-emerald-600">Delivery Fee</span>
                        <span className="text-sm font-semibold text-blue-600">{formatCurrency(editDeliveryFeeDisplay)}</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-emerald-100 pt-1">
                        <span className="text-sm font-semibold text-emerald-700">Total Amount</span>
                        <span className="text-lg font-bold text-emerald-700">{formatCurrency(computedEditAmount)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Amount / Fee row */}
                <div className={`grid gap-4 ${isEditPayment ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {!isEditPayment ? (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount *</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                        <input type="number" inputMode="decimal" value={editForm.amount}
                          readOnly={isViewOnlyPayment}
                          onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))}
                          placeholder="0.00" step="0.01" min="0"
                          className={`w-full pl-7 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isViewOnlyPayment ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Total Amount (auto)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                        <input type="text" value={computedEditAmount.toFixed(2)} readOnly
                          className="w-full pl-7 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-500 cursor-not-allowed" />
                      </div>
                    </div>
                  )}
                  {!isEditPayment && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Transaction Fee</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                        <input type="number" inputMode="decimal" value={editForm.transaction_fee}
                          readOnly={isViewOnlyPayment}
                          onChange={e => setEditForm(f => ({ ...f, transaction_fee: e.target.value }))}
                          placeholder="0.00" step="0.01" min="0"
                          className={`w-full pl-7 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isViewOnlyPayment ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Fee type */}
                {!isEditPayment && editHasFee && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Fee Payment Method</label>
                    <div className="grid grid-cols-2 gap-3">
                      {(['gcash', 'cash'] as const).map(ft => (
                        <button key={ft} type="button"
                          disabled={isViewOnlyPayment}
                          onClick={() => setEditForm(f => ({ ...f, fee_type: ft }))}
                          className={`py-2 px-4 rounded-lg border text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                            editForm.fee_type === ft
                              ? ft === 'gcash'
                                ? 'border-blue-600 bg-blue-50 text-blue-700'
                                : 'border-amber-500 bg-amber-50 text-amber-700'
                              : 'border-slate-300 text-slate-600 hover:border-slate-400'
                          }`}>
                          {ft === 'gcash' ? 'GCash (add to balance)' : 'Cash (cash fund)'}
                        </button>
                      ))}
                    </div>
                    {editForm.fee_type === 'cash' && (
                      <p className="text-xs text-amber-600 mt-1.5">Fee collected as physical cash — added to Cash Fund</p>
                    )}
                  </div>
                )}

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
                  <textarea value={editForm.notes} readOnly={isViewOnlyPayment} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                    className={`w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${isViewOnlyPayment ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`} />
                </div>

                <div className="flex gap-3 pt-2">
                  <button onClick={() => setEditTarget(null)}
                    className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">{isViewOnlyPayment ? 'Close' : 'Cancel'}</button>
                  {!isViewOnlyPayment && (
                    <button onClick={handleEdit}
                      className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Save Changes</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
