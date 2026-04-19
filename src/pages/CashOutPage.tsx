import { useState, useEffect, FormEvent, useCallback } from 'react';
import { ArrowUpCircle, Save, RotateCcw, CreditCard as Edit2, Trash2, TrendingDown, X, Banknote, Wallet, Building2, ArrowRightLeft } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { linkTransactionToDisbursement, processCashTransaction, upsertLinkedBankDepositRequest } from '../lib/cashTransactions';
import { archiveSourceDisbursement, upsertSourceDisbursement } from '../lib/disbursements';
import { Account, Transaction, CashOutType, BankAccount } from '../lib/types';
import { getTodayDateString, formatCurrency, formatDateTime, round2 } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import ConfirmDialog from '../components/ConfirmDialog';
import { mapGcashRunningBalances } from '../lib/gcashBalances';
import { archiveBankTransactions, syncBankAccountBalances } from '../lib/financeMonitoring';

const emptyForm = {
  date: getTodayDateString(),
  account_id: '',
  amount: '',
  transaction_fee: '',
  cash_out_type: 'add_to_cash_fund' as CashOutType,
  bank_account_id: '',
  notes: '',
};

const VISIBLE_TYPES: CashOutType[] = ['add_to_cash_fund', 'move_to_bank', 'disbursement'];

const TYPE_CONFIG: Record<CashOutType, { label: string; sub: string; color: string; activeColor: string; icon: React.ReactNode }> = {
  disbursement: {
    label: 'Disbursement',
    sub: 'Cash leaves the business',
    color: 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white',
    activeColor: 'border-red-500 bg-red-50 text-red-700',
    icon: <Wallet className="w-4 h-4" />,
  },
  add_to_cash_fund: {
    label: 'Add to Cash Fund',
    sub: 'GCash out → physical cash fund',
    color: 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white',
    activeColor: 'border-teal-500 bg-teal-50 text-teal-700',
    icon: <Banknote className="w-4 h-4" />,
  },
  pos_remittance: {
    label: 'POS Remittance',
    sub: 'POS register cash → cash fund',
    color: 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white',
    activeColor: 'border-amber-500 bg-amber-50 text-amber-700',
    icon: <Banknote className="w-4 h-4" />,
  },
  void_reversal: {
    label: 'Void Reversal',
    sub: 'POS void reversal entry',
    color: 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white',
    activeColor: 'border-rose-500 bg-rose-50 text-rose-700',
    icon: <ArrowRightLeft className="w-4 h-4" />,
  },
  move_to_bank: {
    label: 'Move to Bank',
    sub: 'GCash out → bank deposit',
    color: 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white',
    activeColor: 'border-blue-500 bg-blue-50 text-blue-700',
    icon: <Building2 className="w-4 h-4" />,
  },
};

export default function CashOutPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [runningBalances, setRunningBalances] = useState<Record<string, number>>({});
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [recentTxns, setRecentTxns] = useState<Record<string, Transaction[]>>({});
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Transaction | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editFee, setEditFee] = useState('');
  const [editCashOutType, setEditCashOutType] = useState<CashOutType>('disbursement');
  const [editBankAccountId, setEditBankAccountId] = useState('');

  const computeRunningBalances = useCallback(async (accs: Account[]) => {
    const today = getTodayDateString();
    const { data: openTxns } = await supabase
      .from('transactions')
      .select('account_id, transaction_type, amount, transaction_fee, fee_type, cash_out_type')
      .eq('date', today)
      .eq('is_deleted', false)
      .eq('is_closed', false);
    setRunningBalances(
      mapGcashRunningBalances(
        accs,
        (openTxns ?? []) as Array<Pick<Transaction, 'account_id' | 'transaction_type' | 'amount' | 'transaction_fee' | 'fee_type' | 'cash_out_type'>>
      )
    );
  }, []);

  const loadRecent = useCallback(async (accs: Account[]) => {
    const result: Record<string, Transaction[]> = {};
    await Promise.all(
      accs.map(async (acc) => {
        const { data } = await supabase
          .from('transactions')
          .select('*, profiles(name), bank_accounts(name, bank_name)')
          .eq('account_id', acc.id)
          .eq('transaction_type', 'cash_out')
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
        if (data.length > 0) {
          const gcash2 = data.find((a: Account) => a.name.toLowerCase().includes('2')) || data[data.length - 1];
          setForm(f => ({ ...f, account_id: gcash2.id }));
        }
        loadRecent(data);
        computeRunningBalances(data);
      }
    });
    supabase.from('bank_accounts').select('*').eq('is_active', true).order('name').then(({ data }) => {
      if (data) {
        setBankAccounts(data);
      }
    });
  }, [loadRecent, computeRunningBalances]);

  useEffect(() => {
    const channel = supabase
      .channel('cashout-txns')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        supabase.from('accounts').select('*').eq('is_active', true).order('name').then(({ data }) => {
          if (data) loadRecent(data);
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadRecent]);

  function reset() {
    const gcash2 = accounts.find((a: Account) => a.name.toLowerCase().includes('2')) || accounts[accounts.length - 1];
    setForm({ ...emptyForm, account_id: gcash2?.id || accounts[0]?.id || '', date: getTodayDateString() });
  }

  function handleTypeChange(type: CashOutType) {
    setForm(f => ({ ...f, cash_out_type: type, transaction_fee: '', bank_account_id: '' }));
  }

  async function handleSubmit(e: FormEvent, addAnother = false) {
    e.preventDefault();
    if (!form.account_id || !form.amount) {
      showToast('Please fill in all required fields', 'warning');
      return;
    }
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) {
      showToast('Amount must be a positive number', 'warning');
      return;
    }
    if (form.cash_out_type === 'move_to_bank' && !form.bank_account_id) {
      showToast('Please select a bank account', 'warning');
      return;
    }

    if (form.cash_out_type === 'move_to_bank') {
      const availableBalance = runningBalances[form.account_id] ?? 0;
      const totalDeduct = round2(amount);
      if (totalDeduct > availableBalance) {
        showToast(`Insufficient GCash balance. Available: ${formatCurrency(availableBalance)}, Required: ${formatCurrency(totalDeduct)}`, 'error');
        return;
      }
    }

    const hasFee = form.cash_out_type === 'add_to_cash_fund' || form.cash_out_type === 'move_to_bank';
    const fee = hasFee ? (parseFloat(form.transaction_fee) || 0) : 0;

    const feeType: 'cash' | 'gcash' = hasFee ? 'cash' : 'gcash';

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
        transaction_mode: feeType === 'gcash' ? 'fee_included' : 'standard',
        amount: form.amount,
        fee: hasFee ? form.transaction_fee : '0',
        total_amount: feeType === 'gcash' ? round2(amount + fee) : form.amount,
        source_account_type: form.cash_out_type === 'move_to_bank'
          ? 'bank'
          : form.cash_out_type === 'pos_remittance'
            ? 'pos_register'
            : 'cash_fund',
        bank_account_id: form.cash_out_type === 'move_to_bank' ? form.bank_account_id || null : null,
        description: form.notes?.trim() || `Cash out - ${form.cash_out_type}`,
        notes: form.notes,
        created_by: user?.id,
        source_module: 'cash_out_page',
      });

      await writeAuditLog(user?.id ?? null, 'CREATE', 'Transactions', transaction.id as string | undefined, {
        type: 'cash_out',
        cash_out_type: form.cash_out_type,
        amount,
        fee,
        account_id: form.account_id,
        bank_account_id: form.cash_out_type === 'move_to_bank' ? form.bank_account_id : null,
      });

      const transactionId = String((transaction as { id?: string } | null)?.id ?? '');
      if (form.cash_out_type === 'disbursement' && transactionId) {
        const accountName = accounts.find(account => account.id === form.account_id)?.name ?? 'GCash';
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

      showToast('Cash Out recorded!', 'success');
      computeRunningBalances(accounts);
      if (addAnother) {
        setForm(f => ({ ...emptyForm, account_id: f.account_id, date: f.date }));
      } else {
        reset();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save transaction', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    const { data: tx } = await supabase.from('transactions').select('*').eq('id', id).maybeSingle();

    await supabase.from('transactions').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', id);
    if (tx?.cash_out_type === 'disbursement') {
      await archiveSourceDisbursement('cash_out', id);
    }

    if (tx?.cash_out_type === 'move_to_bank' && tx?.bank_account_id) {
      await archiveBankTransactions({ source_transaction_id: id, bank_account_id: tx.bank_account_id });
      await supabase.from('bank_deposits').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('source_transaction_id', id);
      await syncBankAccountBalances(tx.bank_account_id);
    }

    await writeAuditLog(user?.id ?? null, 'DELETE', 'Transactions', id, {});
    showToast('Transaction deleted', 'success');
    setDeleteTarget(null);
    computeRunningBalances(accounts);
  }

  async function handleEdit() {
    if (!editTarget) return;
    const hasFee = editCashOutType === 'add_to_cash_fund' || editCashOutType === 'move_to_bank';
    const fee = hasFee ? (parseFloat(editFee) || 0) : 0;
    const feeType: 'cash' | 'gcash' = hasFee ? 'cash' : 'gcash';
    const previousBankAccountId = editTarget.cash_out_type === 'move_to_bank' ? editTarget.bank_account_id : null;
    await supabase.from('transactions').update({
      notes: editNotes,
      transaction_fee: fee,
      fee_type: feeType,
      cash_out_type: editCashOutType,
      bank_account_id: editCashOutType === 'move_to_bank' ? editBankAccountId || null : null,
      updated_at: new Date().toISOString(),
    }).eq('id', editTarget.id);
    if (editCashOutType === 'disbursement') {
      const accountName = accounts.find(account => account.id === editTarget.account_id)?.name ?? 'GCash';
      const purpose = editNotes.trim() || `Direct disbursement from ${accountName}`;
      const disbursement = await upsertSourceDisbursement({
        source_module: 'cash_out',
        source_reference_id: editTarget.id,
        source_account_type: 'gcash',
        source_account_id: editTarget.account_id,
        disbursement_type: 'cash_out_direct',
        date: editTarget.date,
        payee: purpose,
        purpose,
        description: purpose,
        amount: Number(editTarget.amount),
        payment_method: 'gcash',
        notes: editNotes.trim(),
        created_by: user?.id ?? null,
      });
      await linkTransactionToDisbursement(editTarget.id, disbursement.id);
    } else {
      await archiveSourceDisbursement('cash_out', editTarget.id);
    }
    await archiveBankTransactions({ source_transaction_id: editTarget.id });
    await supabase.from('bank_deposits').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('source_transaction_id', editTarget.id);
    if (editCashOutType === 'move_to_bank' && editBankAccountId) {
      const accountName = accounts.find(a => a.id === editTarget.account_id)?.name || 'GCash';
      const description = `GCash deposit from ${accountName}`;
      await upsertLinkedBankDepositRequest({
        bank_account_id: editBankAccountId,
        date: editTarget.date,
        amount: Number(editTarget.amount),
        source_type: 'gcash_move',
        source_description: description,
        notes: editNotes,
        source_transaction_id: editTarget.id,
        source_module: 'gcash_cash_out',
        created_by: user?.id ?? null,
        status: 'deposited',
      });
    }
    if (previousBankAccountId) {
      await syncBankAccountBalances(previousBankAccountId);
    }
    if (editBankAccountId) {
      await syncBankAccountBalances(editBankAccountId);
    }
    await writeAuditLog(user?.id ?? null, 'UPDATE', 'Transactions', editTarget.id, {
      notes: editNotes,
      cash_out_type: editCashOutType,
      fee,
    });
    showToast('Transaction updated', 'success');
    setEditTarget(null);
  }

  const inputClass = "w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition";
  const labelClass = "block text-sm font-medium text-slate-700 mb-1.5";

  const type = form.cash_out_type;
  const previewAmount = parseFloat(form.amount) || 0;
  const previewFee = (type === 'add_to_cash_fund' || type === 'move_to_bank') ? (parseFloat(form.transaction_fee) || 0) : 0;

  function getBadgeForType(t: Transaction) {
    const cfg = TYPE_CONFIG[t.cash_out_type || 'disbursement'];
    const colors: Record<CashOutType, string> = {
      disbursement: 'text-slate-500 bg-slate-100',
      add_to_cash_fund: 'text-teal-700 bg-teal-50 border border-teal-200',
      pos_remittance: 'text-amber-700 bg-amber-50 border border-amber-200',
      void_reversal: 'text-rose-700 bg-rose-50 border border-rose-200',
      move_to_bank: 'text-blue-700 bg-blue-50 border border-blue-200',
    };
    return (
      <span className={`text-xs px-1.5 py-0.5 rounded-full ${colors[t.cash_out_type || 'disbursement']}`}>
        {cfg?.label || t.cash_out_type}
      </span>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
          <ArrowUpCircle className="w-5 h-5 text-red-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Cash Out</h1>
          <p className="text-slate-500 text-sm">Record outgoing GCash transaction</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
          <form onSubmit={e => handleSubmit(e, false)} className="space-y-4">
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

            <div>
              <label className={labelClass}>Transaction Type *</label>
              <div className="grid grid-cols-2 gap-2.5">
                {(Object.entries(TYPE_CONFIG) as [CashOutType, typeof TYPE_CONFIG[CashOutType]][]).filter(([value]) => VISIBLE_TYPES.includes(value)).map(([value, cfg]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleTypeChange(value)}
                    className={`flex flex-col items-start gap-1 py-3 px-3.5 rounded-xl border-2 text-sm font-medium transition-all ${
                      type === value ? cfg.activeColor : cfg.color
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {cfg.icon}
                      <span>{cfg.label}</span>
                    </div>
                    <span className={`text-xs font-normal leading-tight ${type === value ? 'opacity-80' : 'text-slate-400'}`}>
                      {cfg.sub}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className={`grid gap-4 ${(type === 'add_to_cash_fund' || type === 'move_to_bank') ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
              <div>
                <label className={labelClass}>Amount *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                  <input type="number" inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
                    placeholder="0.00" step="0.01" min="0" className={`${inputClass} pl-7`} required />
                </div>
              </div>
              {(type === 'add_to_cash_fund' || type === 'move_to_bank') && (
                <div>
                  <label className={labelClass}>
                    Bank/Transfer Fee
                    {type === 'add_to_cash_fund' && <span className="ml-1.5 text-xs font-normal text-teal-600">(added to cash fund)</span>}
                    {type === 'move_to_bank' && <span className="ml-1.5 text-xs font-normal text-blue-600">(added to cash fund)</span>}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                    <input type="number" inputMode="decimal" value={form.transaction_fee} onChange={e => setForm({ ...form, transaction_fee: e.target.value })}
                      placeholder="0.00" step="0.01" min="0" className={`${inputClass} pl-7`} />
                  </div>
                </div>
              )}
            </div>

            {type === 'move_to_bank' && (
              <div>
                <label className={labelClass}>Bank Account *</label>
                <select value={form.bank_account_id} onChange={e => setForm({ ...form, bank_account_id: e.target.value })}
                  className={inputClass} required>
                  <option value="">Select bank account...</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>{b.name} — {b.bank_name}</option>
                  ))}
                </select>
              </div>
            )}

            {type === 'add_to_cash_fund' && (
              <div className="flex items-start gap-2 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2.5">
                <Banknote className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-teal-700">
                  GCash balance decreases by the full amount. Both the amount and any fee are added to the physical cash fund.
                </p>
              </div>
            )}
            {type === 'pos_remittance' && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <ArrowRightLeft className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  POS register cash is remitted to the physical cash fund. GCash balance decreases; cash fund increases by the same amount.
                </p>
              </div>
            )}
            {type === 'move_to_bank' && (
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
                <Building2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  GCash decreases by amount only. Bank account increases by the amount only. Any fee is added to the physical cash fund.
                  {runningBalances[form.account_id] !== undefined && (
                    <span className="block mt-1 font-semibold">Available GCash balance: {formatCurrency(runningBalances[form.account_id])}</span>
                  )}
                </p>
              </div>
            )}

            {previewAmount > 0 && (
              <div className="bg-slate-50 rounded-lg px-4 py-3 space-y-1.5 text-sm border border-slate-200">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Preview</p>
                <div className="flex justify-between">
                  <span className="text-slate-600">GCash balance</span>
                  <span className="font-semibold text-red-600">-{formatCurrency(previewAmount)}</span>
                </div>
                {type === 'add_to_cash_fund' && (
                  <>
                    {previewFee > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">Transfer fee</span>
                        <span className="font-semibold text-teal-600">+{formatCurrency(previewFee)} to cash fund</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 mt-0.5">
                      <span className="text-slate-600 font-medium">Cash fund</span>
                      <span className="font-bold text-teal-600">+{formatCurrency(previewAmount + previewFee)}</span>
                    </div>
                  </>
                )}
                {type === 'pos_remittance' && (
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 mt-0.5">
                    <span className="text-slate-600 font-medium">Cash fund</span>
                    <span className="font-bold text-amber-600">+{formatCurrency(previewAmount)}</span>
                  </div>
                )}
                {type === 'move_to_bank' && (
                  <>
                    {previewFee > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">Transfer fee</span>
                        <span className="font-semibold text-teal-600">+{formatCurrency(previewFee)} to cash fund</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 mt-0.5">
                      <span className="text-slate-600 font-medium">Bank deposit</span>
                      <span className="font-bold text-blue-600">+{formatCurrency(previewAmount)}</span>
                    </div>
                    {previewFee > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">Cash fund</span>
                        <span className="font-bold text-teal-600">+{formatCurrency(previewFee)}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div>
              <label className={labelClass}>Notes</label>
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional notes..." rows={2} className={`${inputClass} resize-none`} />
            </div>

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
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60 text-sm">
                {submitting
                  ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <Save className="w-4 h-4" />}
                Save Cash Out
              </button>
            </div>
          </form>
        </div>

        <div className="space-y-4">
          {accounts.map(acc => (
            <div key={acc.id} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                  <span className="text-sm font-semibold text-slate-700">{acc.name}</span>
                  <span className="text-xs text-slate-400">— Cash Out</span>
                </div>
                <span className="text-xs text-slate-500">{recentTxns[acc.id]?.length || 0} recent</span>
              </div>
              {!recentTxns[acc.id] || recentTxns[acc.id].length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <p className="text-xs">No cash out transactions yet</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {recentTxns[acc.id].map(t => (
                    <div key={t.id} className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-slate-50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-red-600">-{formatCurrency(Number(t.amount))}</span>
                          {getBadgeForType(t)}
                          {Number(t.transaction_fee) > 0 && (
                            <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full border border-slate-200">
                              Fee: {formatCurrency(Number(t.transaction_fee))}
                            </span>
                          )}
                        </div>
                        {t.notes && <p className="text-xs text-slate-400 mt-0.5 truncate">{t.notes}</p>}
                        <p className="text-xs text-slate-400 mt-0.5">{formatDateTime(t.created_at)}</p>
                      </div>
                      {profile?.role === 'admin' && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => {
                            setEditTarget(t);
                            setEditNotes(t.notes || '');
                            setEditFee(String(t.transaction_fee || ''));
                            setEditCashOutType(t.cash_out_type || 'disbursement');
                            setEditBankAccountId(t.bank_account_id || '');
                          }}
                            className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setDeleteTarget(t.id)}
                            className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Transaction"
        message="Are you sure you want to delete this transaction?"
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditTarget(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">Edit Transaction</h3>
              <button onClick={() => setEditTarget(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Transaction Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(TYPE_CONFIG) as [CashOutType, typeof TYPE_CONFIG[CashOutType]][]).filter(([value]) => VISIBLE_TYPES.includes(value)).map(([value, cfg]) => (
                    <button key={value} type="button"
                      onClick={() => setEditCashOutType(value)}
                      className={`py-2 px-3 rounded-lg border text-sm font-medium transition-all ${
                        editCashOutType === value ? cfg.activeColor : 'border-slate-300 text-slate-600 hover:border-slate-400'
                      }`}>
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>
              {(editCashOutType === 'add_to_cash_fund' || editCashOutType === 'move_to_bank') && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Bank/Transfer Fee (₱)
                    {editCashOutType === 'add_to_cash_fund' && <span className="ml-1.5 text-xs font-normal text-teal-600">(added to cash fund)</span>}
                    {editCashOutType === 'move_to_bank' && <span className="ml-1.5 text-xs font-normal text-blue-600">(added to cash fund)</span>}
                  </label>
                  <input type="number" inputMode="decimal" value={editFee} onChange={e => setEditFee(e.target.value)} step="0.01" min="0"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              {editCashOutType === 'move_to_bank' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Bank Account</label>
                  <select value={editBankAccountId} onChange={e => setEditBankAccountId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Select bank account...</option>
                    {bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>{b.name} — {b.bank_name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditTarget(null)}
                  className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">Cancel</button>
                <button onClick={handleEdit}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
