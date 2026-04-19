import { FormEvent, useEffect, useState } from 'react';
import { ArrowUpCircle, Save, X, Banknote, Building2, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { processCashTransaction, linkTransactionToDisbursement, upsertLinkedBankDepositRequest } from '../../lib/cashTransactions';
import { upsertSourceDisbursement } from '../../lib/disbursements';
import { Account, CashOutType, BankAccount } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { writeAuditLog } from '../../lib/audit';
import { getTodayDateString, round2 } from '../../lib/utils';
import { syncBankAccountBalances } from '../../lib/financeMonitoring';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

const VISIBLE_TYPES: CashOutType[] = ['add_to_cash_fund', 'move_to_bank', 'disbursement'];

const TYPE_CONFIG = {
  add_to_cash_fund: {
    label: 'Add to Cash Fund',
    sub: 'GCash out → physical cash',
    activeColor: 'border-teal-500 bg-teal-50 text-teal-700',
    icon: <Banknote className="w-4 h-4" />,
  },
  move_to_bank: {
    label: 'Move to Bank',
    sub: 'GCash out → bank deposit',
    activeColor: 'border-blue-500 bg-blue-50 text-blue-700',
    icon: <Building2 className="w-4 h-4" />,
  },
  disbursement: {
    label: 'Disbursement',
    sub: 'Cash leaves the business',
    activeColor: 'border-red-500 bg-red-50 text-red-700',
    icon: <Wallet className="w-4 h-4" />,
  },
};

const emptyForm = {
  date: getTodayDateString(),
  account_id: '',
  cash_out_type: 'add_to_cash_fund' as CashOutType,
  amount: '',
  transaction_fee: '',
  bank_account_id: '',
  notes: '',
};

export default function PosGcashOutModal({ onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
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
    supabase.from('bank_accounts').select('*').eq('is_active', true).order('name').then(({ data }) => {
      setBankAccounts((data ?? []) as BankAccount[]);
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

  function handleTypeChange(type: CashOutType) {
    setForm(f => ({ ...f, cash_out_type: type, transaction_fee: '', bank_account_id: '' }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.account_id) { showToast('Please select an account', 'warning'); return; }
    if (!form.amount) { showToast('Please enter an amount', 'warning'); return; }
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) { showToast('Amount must be greater than zero', 'warning'); return; }
    if (form.cash_out_type === 'move_to_bank' && !form.bank_account_id) {
      showToast('Please select a bank account', 'warning'); return;
    }

    const hasFee = form.cash_out_type === 'add_to_cash_fund' || form.cash_out_type === 'move_to_bank';
    const fee = hasFee ? (parseFloat(form.transaction_fee) || 0) : 0;

    setSubmitting(true);
    try {
      const { transaction } = await processCashTransaction({
        date: form.date,
        account_id: form.account_id,
        type: 'CASH_OUT',
        cashout_type: form.cash_out_type === 'move_to_bank'
          ? 'move_to_bank'
          : form.cash_out_type === 'disbursement'
            ? 'disbursement'
            : 'regular',
        transaction_mode: hasFee ? 'standard' : 'fee_included',
        amount: form.amount,
        fee: hasFee ? form.transaction_fee : '0',
        total_amount: hasFee ? round2(amount + fee) : amount,
        source_account_type: form.cash_out_type === 'move_to_bank' ? 'bank' : 'cash_fund',
        bank_account_id: form.cash_out_type === 'move_to_bank' ? form.bank_account_id || null : null,
        description: form.notes?.trim() || `GCash Out - ${form.cash_out_type}`,
        notes: form.notes,
        created_by: user?.id,
        source_module: 'pos_gcash_out_modal',
      });

      const transactionId = String((transaction as { id?: string } | null)?.id ?? '');

      if (form.cash_out_type === 'disbursement' && transactionId) {
        const accountName = accounts.find(a => a.id === form.account_id)?.name ?? 'GCash';
        const purpose = form.notes.trim() || `Direct disbursement from ${accountName}`;
        const disbursement = await upsertSourceDisbursement({
          source_module: 'cash_out',
          source_reference_id: transactionId,
          source_account_type: 'gcash',
          source_account_id: form.account_id,
          disbursement_type: 'cash_out_direct',
          date: form.date,
          payee: purpose,
          purpose,
          description: purpose,
          amount,
          payment_method: 'gcash',
          notes: form.notes.trim(),
          created_by: user?.id ?? null,
        });
        await linkTransactionToDisbursement(transactionId, disbursement.id);
      }

      if (form.cash_out_type === 'move_to_bank' && form.bank_account_id && transactionId) {
        const accountName = accounts.find(a => a.id === form.account_id)?.name || 'GCash';
        await upsertLinkedBankDepositRequest({
          bank_account_id: form.bank_account_id,
          date: form.date,
          amount,
          source_type: 'gcash_move',
          source_description: `GCash deposit from ${accountName}`,
          notes: form.notes,
          source_transaction_id: transactionId,
          source_module: 'gcash_cash_out',
          created_by: user?.id ?? null,
          status: 'deposited',
        });
        await syncBankAccountBalances(form.bank_account_id);
      }

      await writeAuditLog(user?.id ?? null, 'CREATE', 'Transactions', transactionId || undefined, {
        type: 'cash_out',
        cash_out_type: form.cash_out_type,
        amount,
        fee,
        account_id: form.account_id,
      });

      showToast('GCash Out recorded!', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save transaction', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const type = form.cash_out_type;
  const previewAmount = parseFloat(form.amount) || 0;
  const previewFee = (type === 'add_to_cash_fund' || type === 'move_to_bank') ? (parseFloat(form.transaction_fee) || 0) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-red-600" />
            <h2 className="font-semibold text-slate-800">GCash Out</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Date</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Account</label>
              <select value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Transaction Type</label>
            <div className="grid grid-cols-3 gap-2">
              {VISIBLE_TYPES.map(value => {
                const cfg = TYPE_CONFIG[value as keyof typeof TYPE_CONFIG];
                return (
                  <button key={value} type="button" onClick={() => handleTypeChange(value)}
                    className={`flex flex-col items-start gap-1 rounded-xl border-2 px-3 py-2.5 text-sm font-medium transition-all ${
                      type === value ? cfg.activeColor : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}>
                    <div className="flex items-center gap-1.5">{cfg.icon}<span>{cfg.label}</span></div>
                    <span className={`text-xs font-normal leading-tight ${type === value ? 'opacity-80' : 'text-slate-400'}`}>{cfg.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`grid gap-4 ${(type === 'add_to_cash_fund' || type === 'move_to_bank') ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                <input type="number" inputMode="decimal" min="0" step="0.01" value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            {(type === 'add_to_cash_fund' || type === 'move_to_bank') && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Transfer Fee</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={form.transaction_fee}
                    onChange={e => setForm({ ...form, transaction_fee: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            )}
          </div>

          {type === 'move_to_bank' && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Bank Account</label>
              <select value={form.bank_account_id} onChange={e => setForm({ ...form, bank_account_id: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required>
                <option value="">Select bank account...</option>
                {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name}</option>)}
              </select>
            </div>
          )}

          {previewAmount > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">GCash balance</span>
                <span className="font-semibold text-red-600">-₱{previewAmount.toFixed(2)}</span>
              </div>
              {type === 'add_to_cash_fund' && (
                <div className="flex justify-between border-t border-slate-200 pt-1.5">
                  <span className="text-slate-600 font-medium">Cash fund</span>
                  <span className="font-bold text-teal-600">+₱{(previewAmount + previewFee).toFixed(2)}</span>
                </div>
              )}
              {type === 'move_to_bank' && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Bank deposit</span>
                    <span className="font-bold text-blue-600">+₱{previewAmount.toFixed(2)}</span>
                  </div>
                  {previewFee > 0 && (
                    <div className="flex justify-between border-t border-slate-200 pt-1.5">
                      <span className="text-slate-600">Cash fund (fee)</span>
                      <span className="font-bold text-teal-600">+₱{previewFee.toFixed(2)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes</label>
            <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
            <button type="submit" disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              <Save className="h-4 w-4" />
              Save GCash Out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
