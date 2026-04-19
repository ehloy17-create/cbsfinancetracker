import { useState, useEffect, useCallback } from 'react';
import {
  Building2, Plus, Trash2, RefreshCw, ArrowDownCircle, ArrowUpCircle,
  X, TrendingUp, TrendingDown, FileText, Settings2,
  Pencil, Check, AlertCircle, Calendar, Layers
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { BankAccount, BankTransaction, BankTxType, BankTxDirection, BankDeposit } from '../lib/types';
import { formatCurrency, formatDate, getTodayDateString, round2 } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import ConfirmDialog from '../components/ConfirmDialog';
import CheckIssuanceModal from '../components/CheckIssuanceModal';
import {
  createBankLedgerEntry,
  getBankPassbookKey,
  loadFinanceMonitoringSnapshot,
  normalizeBankTransaction,
  syncBankAccountBalances,
} from '../lib/financeMonitoring';

const TX_CONFIG: Record<BankTxType, {
  label: string;
  direction: BankTxDirection;
  icon: React.ReactNode;
  color: string;
  bg: string;
  border: string;
}> = {
  deposit: {
    label: 'Deposit',
    direction: 'credit',
    icon: <ArrowDownCircle className="w-4 h-4" />,
    color: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
  },
  interest_income: {
    label: 'Interest Income',
    direction: 'credit',
    icon: <TrendingUp className="w-4 h-4" />,
    color: 'text-teal-700',
    bg: 'bg-teal-50',
    border: 'border-teal-200',
  },
  bank_fee: {
    label: 'Bank Fee / Charge',
    direction: 'debit',
    icon: <TrendingDown className="w-4 h-4" />,
    color: 'text-rose-700',
    bg: 'bg-rose-50',
    border: 'border-rose-200',
  },
  check_payment: {
    label: 'Check Payment',
    direction: 'debit',
    icon: <FileText className="w-4 h-4" />,
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
  disbursement: {
    label: 'Disbursement',
    direction: 'debit',
    icon: <ArrowUpCircle className="w-4 h-4" />,
    color: 'text-orange-700',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
  },
  adjustment: {
    label: 'Adjustment',
    direction: 'credit',
    icon: <Settings2 className="w-4 h-4" />,
    color: 'text-slate-700',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
  },
  withdrawal: {
    label: 'Withdrawal',
    direction: 'debit',
    icon: <ArrowUpCircle className="w-4 h-4" />,
    color: 'text-rose-700',
    bg: 'bg-rose-50',
    border: 'border-rose-200',
  },
  transfer_in: {
    label: 'Transfer In',
    direction: 'credit',
    icon: <ArrowDownCircle className="w-4 h-4" />,
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  transfer_out: {
    label: 'Transfer Out',
    direction: 'debit',
    icon: <ArrowUpCircle className="w-4 h-4" />,
    color: 'text-violet-700',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
  },
  owner_funding: {
    label: 'Owner Funding',
    direction: 'credit',
    icon: <ArrowDownCircle className="w-4 h-4" />,
    color: 'text-fuchsia-700',
    bg: 'bg-fuchsia-50',
    border: 'border-fuchsia-200',
  },
  owner_withdrawal: {
    label: 'Owner Withdrawal',
    direction: 'debit',
    icon: <ArrowUpCircle className="w-4 h-4" />,
    color: 'text-fuchsia-700',
    bg: 'bg-fuchsia-50',
    border: 'border-fuchsia-200',
  },
};

const EMPTY_FORM = {
  tx_type: 'deposit' as BankTxType,
  date: getTodayDateString(),
  description: '',
  ref_number: '',
  amount: '',
  direction: 'credit' as BankTxDirection,
  notes: '',
};

const EMPTY_ACCOUNT = {
  name: '',
  account_number: '',
  bank_name: '',
  beginning_balance: '',
};

export default function BankPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allBankAccounts, setAllBankAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  const [showAddTx, setShowAddTx] = useState(false);
  const [showCheckIssuance, setShowCheckIssuance] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState(EMPTY_ACCOUNT);
  const [savingAccount, setSavingAccount] = useState(false);

  const [activeTab, setActiveTab] = useState<'ledger' | 'deposits'>('ledger');
  const [deposits, setDeposits] = useState<BankDeposit[]>([]);

  const [deleteTarget, setDeleteTarget] = useState<{ type: 'account' | 'transaction' | 'deposit'; id: string } | null>(null);

  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const [editBalances, setEditBalances] = useState<Record<string, string>>({});
  const [savingBalance, setSavingBalance] = useState<string | null>(null);

  const initRange = (() => {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const to = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { from, to };
  })();
  const [dateFrom, setDateFrom] = useState('2000-01-01');
  const [dateTo, setDateTo] = useState('2099-12-31');

  const [outstandingByAccount, setOutstandingByAccount] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [snapshot, { data: deps }, { data: allAccountsRows }] = await Promise.all([
      loadFinanceMonitoringSnapshot(),
      supabase.from('bank_deposits').select('*, bank_accounts(name, bank_name), profiles(name)').eq('is_deleted', false).gte('date', dateFrom).lte('date', dateTo).order('date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('bank_accounts').select('*').order('name'),
    ]);
    const accounts = snapshot.bank_accounts;
    const allAccounts = (((allAccountsRows || []) as BankAccount[]) || []);
    const txs = snapshot.bank_transactions
      .map(tx => normalizeBankTransaction(tx as unknown as Record<string, unknown>));
    setBankAccounts(accounts);
    setAllBankAccounts(allAccounts);
    setTransactions(txs);
    setDeposits((deps as unknown as BankDeposit[]) || []);
    const edits: Record<string, string> = {};
    accounts.forEach((a: BankAccount) => { edits[a.id] = String(Number(a.current_balance)); });
    setEditBalances(edits);
    const outMap: Record<string, number> = {};
    snapshot.bank_summaries.forEach(summary => {
      outMap[summary.account.id] = summary.outstanding_amount;
    });
    setOutstandingByAccount(outMap);
    if (accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
    setLoading(false);
  }, [selectedAccountId, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const selectedAccount = bankAccounts.find(a => a.id === selectedAccountId);
  const selectedPassbookKey = getBankPassbookKey(selectedAccount);
  const matchesSelectedPassbook = (item: { bank_account_id?: string | null; bank_accounts?: Partial<BankAccount> | null }) => {
    if (!selectedAccount) return false;
    if (item.bank_account_id === selectedAccountId) return true;
    const linkedAccount = allBankAccounts.find(account => account.id === item.bank_account_id);
    return Boolean(selectedPassbookKey) && (
      getBankPassbookKey(item.bank_accounts ?? undefined) === selectedPassbookKey
      || getBankPassbookKey(linkedAccount) === selectedPassbookKey
    );
  };

  const allAccountTxs = transactions
    .filter(t => matchesSelectedPassbook({ bank_account_id: t.bank_account_id, bank_accounts: t.bank_accounts as Partial<BankAccount> | undefined }))
    .sort((left, right) => `${left.date ?? ''} ${left.created_at ?? ''} ${left.id}`.localeCompare(`${right.date ?? ''} ${right.created_at ?? ''} ${right.id}`));
  const accountTxs = allAccountTxs.filter(tx => tx.date >= dateFrom && tx.date <= dateTo);

  const openingBalance = round2(
    allAccountTxs
      .filter(tx => tx.date >= dateFrom)
      .reduce((balance, tx) => (
        tx.direction === 'credit'
          ? round2(balance - Number(tx.amount))
          : round2(balance + Number(tx.amount))
      ), Number(selectedAccount?.current_balance ?? 0))
  );

  const ledgerRows: (BankTransaction & { running_balance: number })[] = [];
  let running = openingBalance;
  for (const tx of accountTxs) {
    if (tx.direction === 'credit') {
      running = round2(running + Number(tx.amount));
    } else {
      running = round2(running - Number(tx.amount));
    }
    ledgerRows.push({ ...tx, running_balance: running });
  }

  const currentLedgerBalance = ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].running_balance : openingBalance;

  function getAffectedPassbookAccounts(bankAccountId: string | null | undefined) {
    if (!bankAccountId) return [] as BankAccount[];
    const sourceAccount = allBankAccounts.find(account => account.id === bankAccountId)
      ?? bankAccounts.find(account => account.id === bankAccountId);
    const affectedPassbookKey = getBankPassbookKey(sourceAccount);
    return allBankAccounts.filter(account => (
      account.id === bankAccountId
      || (affectedPassbookKey && getBankPassbookKey(account) === affectedPassbookKey)
    ));
  }

  function applyImmediateBalanceDelta(bankAccountId: string | null | undefined, delta: number) {
    if (!bankAccountId || !Number.isFinite(delta) || delta === 0) return;
    const affectedPassbookKey = getBankPassbookKey(
      allBankAccounts.find(account => account.id === bankAccountId)
      ?? bankAccounts.find(account => account.id === bankAccountId)
    );

    setBankAccounts(prev => prev.map(account => {
      const matches = account.id === bankAccountId || (affectedPassbookKey && getBankPassbookKey(account) === affectedPassbookKey);
      return matches
        ? { ...account, current_balance: round2(Number(account.current_balance) + delta) }
        : account;
    }));

    setAllBankAccounts(prev => prev.map(account => {
      const matches = account.id === bankAccountId || (affectedPassbookKey && getBankPassbookKey(account) === affectedPassbookKey);
      return matches
        ? { ...account, current_balance: round2(Number(account.current_balance) + delta) }
        : account;
    }));
  }

  async function persistImmediateBalanceDelta(bankAccountId: string | null | undefined, delta: number) {
    if (!bankAccountId || !Number.isFinite(delta) || delta === 0) return;
    const affectedAccounts = getAffectedPassbookAccounts(bankAccountId);
    await Promise.all(
      affectedAccounts.map(account => supabase
        .from('bank_accounts')
        .update({
          current_balance: round2(Number(account.current_balance) + delta),
          updated_at: new Date().toISOString(),
        })
        .eq('id', account.id))
    );
  }

  const totalBalance = round2(bankAccounts.reduce((s, a) => round2(s + Number(a.current_balance)), 0));
  const totalOutstanding = round2(Object.values(outstandingByAccount).reduce((s, v) => round2(s + v), 0));
  const totalAvailable = round2(totalBalance - totalOutstanding);

  function handleTxTypeChange(type: BankTxType) {
    if (type === 'check_payment') {
      setShowAddTx(false);
      setShowCheckIssuance(true);
      return;
    }
    const cfg = TX_CONFIG[type];
    setForm(f => ({
      ...f,
      tx_type: type,
      direction: cfg.direction,
      description: cfg.label,
    }));
  }

  async function handleCheckIssuanceSaved() {
    setShowCheckIssuance(false);
    showToast('Check issued — bank balance will update when cleared', 'success');
    load();
  }

  async function saveTransaction() {
    if (!selectedAccountId || !form.amount || !form.date) return;
    setSaving(true);
    try {
      const amount = parseFloat(form.amount);
      if (isNaN(amount) || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }

      await createBankLedgerEntry({
        bank_account_id: selectedAccountId,
        date: form.date,
        tx_type: form.tx_type,
        description: form.description.trim() || TX_CONFIG[form.tx_type].label,
        ref_number: form.ref_number.trim(),
        amount,
        direction: form.direction,
        notes: form.notes.trim(),
        created_by: user?.id,
      });

      await writeAuditLog(user?.id ?? null, 'INSERT', 'BankTransactions', undefined, {
        type: form.tx_type, amount, date: form.date,
      });
      showToast('Transaction recorded', 'success');
      setShowAddTx(false);
      setForm(EMPTY_FORM);
      load();
    } catch {
      showToast('Failed to record transaction', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function addAccount() {
    if (!newAccount.name.trim()) return;
    setSavingAccount(true);
    try {
      const bal = parseFloat(newAccount.beginning_balance) || 0;
      const { error } = await supabase.from('bank_accounts').insert({
        name: newAccount.name.trim(),
        account_number: newAccount.account_number.trim(),
        bank_name: newAccount.bank_name.trim(),
        beginning_balance: bal,
        current_balance: bal,
      });
      if (error) throw error;
      await writeAuditLog(user?.id ?? null, 'INSERT', 'BankAccounts', undefined, { name: newAccount.name });
      showToast('Bank account added', 'success');
      setNewAccount(EMPTY_ACCOUNT);
      setShowAddAccount(false);
      load();
    } catch {
      showToast('Failed to add bank account', 'error');
    } finally {
      setSavingAccount(false);
    }
  }

  async function saveBalance(id: string) {
    setSavingBalance(id);
    try {
      const desiredActual = parseFloat(editBalances[id]) || 0;
      const accountTxs = transactions.filter(tx => tx.bank_account_id === id);
      const txNet = round2(
        accountTxs.reduce(
          (sum, tx) => tx.direction === 'credit' ? round2(sum + Number(tx.amount)) : round2(sum - Number(tx.amount)),
          0
        )
      );
      const beginningBalance = round2(desiredActual - txNet);
      await supabase.from('bank_accounts').update({
        beginning_balance: beginningBalance,
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      await syncBankAccountBalances(id);
      await writeAuditLog(user?.id ?? null, 'UPDATE', 'BankAccounts', id, {
        beginning_balance: beginningBalance,
        actual_balance: desiredActual,
      });
      showToast('Balance baseline updated', 'success');
      setEditAccountId(null);
      load();
    } catch {
      showToast('Failed to update balance', 'error');
    } finally {
      setSavingBalance(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'transaction') {
      const tx = transactions.find(t => t.id === deleteTarget.id);
      await supabase.from('bank_transactions').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', deleteTarget.id);
      if (tx) {
        const delta = tx.direction === 'credit' ? -Number(tx.amount) : Number(tx.amount);
        setTransactions(prev => prev.filter(item => item.id !== deleteTarget.id));
        applyImmediateBalanceDelta(tx.bank_account_id, delta);
        await persistImmediateBalanceDelta(tx.bank_account_id, delta);
        if (tx.check_id) {
          // Revert to 'pending' — DB constraint only allows pending|cleared|cancelled|stale.
          // With cleared_date=null and manually_set_status=false, getCheckLifecycleStatus
          // will compute 'outstanding' or 'pdc' from check_date, so it won't be re-cleared on next load.
          const { data: revertedCheck } = await supabase
            .from('checks_issued')
            .select('disbursement_id, issued_date, check_date, bank_account_id')
            .eq('id', tx.check_id)
            .maybeSingle();
          await supabase.from('checks_issued').update({
            cleared_date: null,
            manually_set_status: false,
            status: 'pending',
            updated_at: new Date().toISOString(),
          }).eq('id', tx.check_id);
          if (revertedCheck?.disbursement_id) {
            await supabase.from('disbursements').update({
              date: revertedCheck.issued_date || revertedCheck.check_date,
              disbursement_type: 'check_issuance_pending',
              source_module: 'check_issuance',
              source_reference_id: tx.check_id,
              source_account_type: 'bank',
              source_account_id: revertedCheck.bank_account_id,
              updated_at: new Date().toISOString(),
            }).eq('id', revertedCheck.disbursement_id);
          }
        } else if (tx.source_transaction_id) {
          // Revert deposit back to pending — preserve the source GCash transaction, just un-verify the deposit
          const { data: linkedDeposit } = await supabase
            .from('bank_deposits')
            .select('id')
            .eq('source_transaction_id', tx.source_transaction_id)
            .eq('is_deleted', false)
            .maybeSingle();
          if (linkedDeposit) {
            await supabase.from('bank_deposits').update({
              status: 'pending',
              verified_at: null,
              verified_by: null,
              updated_at: new Date().toISOString(),
            }).eq('id', linkedDeposit.id);
            setDeposits(prev => prev.map(d =>
              d.source_transaction_id === tx.source_transaction_id
                ? { ...d, status: 'pending' as const, verified_at: null, verified_by: null }
                : d
            ));
          }
        }
        await syncBankAccountBalances(tx.bank_account_id);
      }
      showToast('Transaction deleted — balance recalculated and source reverted', 'success');
    } else if (deleteTarget.type === 'deposit') {
      const dep = deposits.find(d => d.id === deleteTarget.id);
      await supabase.from('bank_deposits').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', deleteTarget.id);
      if (dep) {
        setDeposits(prev => prev.filter(item => item.id !== deleteTarget.id));
        applyImmediateBalanceDelta(dep.bank_account_id, -Number(dep.amount));
        await persistImmediateBalanceDelta(dep.bank_account_id, -Number(dep.amount));
        const { data: linkedBankTx } = await supabase
          .from('bank_transactions')
          .select('id, amount, bank_account_id, direction')
          .eq('source_transaction_id', dep.source_transaction_id ?? '')
          .eq('is_deleted', false)
          .maybeSingle();
        if (linkedBankTx) {
          await supabase.from('bank_transactions').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', linkedBankTx.id);
          setTransactions(prev => prev.filter(item => item.id !== linkedBankTx.id));
        }
        // Do NOT delete the source GCash transaction — it already happened and belongs to cashier history
        await syncBankAccountBalances(dep.bank_account_id);
      }
      showToast('Deposit deleted — balance recalculated', 'success');
    } else {
      await supabase.from('bank_accounts').update({ is_active: false }).eq('id', deleteTarget.id);
      showToast('Bank account removed', 'success');
    }
    setDeleteTarget(null);
    load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Bank</h1>
          <p className="text-slate-500 text-sm mt-0.5">Passbook-style bank ledger & reconciliation</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 shadow-sm">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowAddAccount(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Account
          </button>
          {selectedAccountId && (
            <>
              <button
                onClick={() => setShowCheckIssuance(true)}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
              >
                <FileText className="w-4 h-4" />
                Issue Check
              </button>
              <button
                onClick={() => { setForm(EMPTY_FORM); setShowAddTx(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                New Transaction
              </button>
            </>
          )}
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="flex flex-wrap items-center gap-3 bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-sm">
        <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="text-sm font-medium text-slate-600">Transaction Date:</span>
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          <input
            type="date"
            value={dateFrom === '2000-01-01' ? '' : dateFrom}
            onChange={e => setDateFrom(e.target.value || '2000-01-01')}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="From"
          />
          <span className="text-slate-400 text-sm">to</span>
          <input
            type="date"
            value={dateTo === '2099-12-31' ? '' : dateTo}
            onChange={e => setDateTo(e.target.value || '2099-12-31')}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="To"
          />
          <button
            onClick={() => { setDateFrom(initRange.from); setDateTo(initRange.to); }}
            className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50"
          >
            This Month
          </button>
          <button
            onClick={() => { setDateFrom('2000-01-01'); setDateTo('2099-12-31'); }}
            className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            All Time
          </button>
        </div>
      </div>

      {/* Total Balance Hero */}
      <div className="bg-gradient-to-br from-blue-700 to-blue-900 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-3 mb-2">
          <Building2 className="w-5 h-5 text-blue-300" />
          <p className="text-blue-200 text-sm font-medium uppercase tracking-wider">Total Bank Balance</p>
        </div>
        <p className="text-4xl font-black">{formatCurrency(totalBalance)}</p>
        <div className="flex items-center gap-3 mt-2">
          <p className={`text-sm font-semibold ${totalAvailable < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
            Available: {formatCurrency(totalAvailable)}
          </p>
          {totalOutstanding > 0 && (
            <p className="text-blue-300 text-xs">
              · Outstanding checks: {formatCurrency(totalOutstanding)}
            </p>
          )}
        </div>
        <p className="text-blue-400 text-xs mt-1">{bankAccounts.length} account{bankAccounts.length !== 1 ? 's' : ''}</p>
      </div>

      {bankAccounts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm py-16 text-center">
          <Building2 className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p className="text-slate-500 font-medium">No bank accounts yet</p>
          <button onClick={() => setShowAddAccount(true)} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            Add Bank Account
          </button>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
          {/* Account Sidebar */}
          <div className="w-full lg:w-64 lg:shrink-0 flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-1 lg:pb-0">
            {bankAccounts.map(acc => {
              const accOutstanding = outstandingByAccount[acc.id] || 0;
              const accAvailable = round2(Number(acc.current_balance) - accOutstanding);
              const isSelected = acc.id === selectedAccountId;
              return (
                <button
                  key={acc.id}
                  onClick={() => setSelectedAccountId(acc.id)}
                  className={`w-full lg:w-full shrink-0 lg:shrink text-left px-4 py-3 rounded-xl border transition-all min-w-[200px] lg:min-w-0 ${
                    isSelected
                      ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50 shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-sm font-semibold truncate">{acc.name}</span>
                    <Building2 className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-200' : 'text-slate-400'}`} />
                  </div>
                  <p className={`text-xs truncate ${isSelected ? 'text-blue-200' : 'text-slate-400'}`}>
                    {acc.bank_name || 'Bank'}{acc.account_number ? ` · ${acc.account_number}` : ''}
                  </p>
                  <p className={`text-base font-bold mt-1 ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                    {formatCurrency(Number(acc.current_balance))}
                  </p>
                  {accOutstanding > 0 && (
                    <p className={`text-xs mt-0.5 ${isSelected ? 'text-blue-200' : 'text-slate-400'}`}>
                      Avail: <span className={`font-semibold ${accAvailable < 0 ? (isSelected ? 'text-red-300' : 'text-red-500') : (isSelected ? 'text-emerald-200' : 'text-emerald-600')}`}>
                        {formatCurrency(accAvailable)}
                      </span>
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          {/* Passbook Ledger */}
          {selectedAccount && (
            <div className="flex-1 min-w-0 space-y-4">
              {/* Tabs */}
              <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
                <button
                  onClick={() => setActiveTab('ledger')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    activeTab === 'ledger'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  Transaction Ledger
                </button>
                <button
                  onClick={() => setActiveTab('deposits')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    activeTab === 'deposits'
                      ? 'bg-white text-emerald-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  Deposits
                  {deposits.filter(d => d.bank_account_id === selectedAccountId).length > 0 && (
                    <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
                      {deposits.filter(d => d.bank_account_id === selectedAccountId).length}
                    </span>
                  )}
                </button>
              </div>

              {/* Account Header */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">{selectedAccount.name}</h2>
                    <p className="text-sm text-slate-500">{selectedAccount.bank_name}{selectedAccount.account_number ? ` · ${selectedAccount.account_number}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {editAccountId === selectedAccount.id ? (
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">₱</span>
                          <input
                            type="number" inputMode="decimal"
                            value={editBalances[selectedAccount.id] || ''}
                            onChange={e => setEditBalances(p => ({ ...p, [selectedAccount.id]: e.target.value }))}
                            step="0.01"
                            className="w-40 pl-6 pr-3 py-2 border border-blue-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-right font-semibold"
                          />
                        </div>
                        <button
                          onClick={() => saveBalance(selectedAccount.id)}
                          disabled={savingBalance === selectedAccount.id}
                          className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-60"
                        >
                          {savingBalance === selectedAccount.id
                            ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            : <Check className="w-4 h-4" />}
                        </button>
                        <button onClick={() => setEditAccountId(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="text-right">
                          <p className="text-xs text-slate-400 mb-0.5">Current Balance</p>
                          <p className="text-2xl font-black text-blue-700">{formatCurrency(currentLedgerBalance)}</p>
                          {(outstandingByAccount[selectedAccount.id] || 0) > 0 && (() => {
                            const avail = round2(currentLedgerBalance - (outstandingByAccount[selectedAccount.id] || 0));
                            return (
                              <p className={`text-xs mt-0.5 font-medium ${avail < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                                Available: <span className={avail < 0 ? 'text-red-600 font-bold' : 'text-slate-500'}>{formatCurrency(avail)}</span>
                              </p>
                            );
                          })()}
                        </div>
                        <button
                          onClick={() => setEditAccountId(selectedAccount.id)}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit balance"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget({ type: 'account', id: selectedAccount.id })}
                          className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                  <span>Opening Balance: <strong className="text-slate-700">{formatCurrency(openingBalance)}</strong></span>
                  <span>·</span>
                  <span>{ledgerRows.length} transaction{ledgerRows.length !== 1 ? 's' : ''}</span>
                </div>
              </div>

              {/* Deposits Panel */}
              {activeTab === 'deposits' && (() => {
                const accDeposits = deposits.filter(d => matchesSelectedPassbook({ bank_account_id: d.bank_account_id, bank_accounts: d.bank_accounts as Partial<BankAccount> | undefined }));
                const totalDeposited = round2(accDeposits.reduce((s, d) => s + Number(d.amount), 0));
                return (
                  <div className="space-y-4">
                    {accDeposits.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                          <p className="text-xs font-medium text-emerald-600">Total Deposits</p>
                          <p className="text-xl font-bold text-emerald-700 mt-1">{formatCurrency(totalDeposited)}</p>
                        </div>
                        <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                          <p className="text-xs font-medium text-blue-600">GCash Move to Bank</p>
                          <p className="text-xl font-bold text-blue-700 mt-1">{formatCurrency(round2(accDeposits.filter(d => d.source_type === 'gcash_move').reduce((s, d) => s + Number(d.amount), 0)))}</p>
                        </div>
                        <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                          <p className="text-xs font-medium text-amber-600">Cash Remittance</p>
                          <p className="text-xl font-bold text-amber-700 mt-1">{formatCurrency(round2(accDeposits.filter(d => d.source_type === 'cash_remittance').reduce((s, d) => s + Number(d.amount), 0)))}</p>
                        </div>
                      </div>
                    )}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                      {accDeposits.length === 0 ? (
                        <div className="py-16 text-center">
                          <ArrowDownCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                          <p className="text-sm text-slate-400">No deposits recorded for this account</p>
                          <p className="text-xs text-slate-400 mt-1">Deposits appear when you use "Move to Bank" or cash remittances</p>
                        </div>
                      ) : (
                        <>
                          {/* Mobile */}
                          <div className="md:hidden divide-y divide-slate-100">
                            {accDeposits.map(dep => (
                              <div key={dep.id} className="px-4 py-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${dep.source_type === 'gcash_move' ? 'bg-blue-50 text-blue-700 border border-blue-200' : dep.source_type === 'cash_remittance' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-slate-50 text-slate-600 border border-slate-200'}`}>
                                        {dep.source_type === 'gcash_move' ? 'GCash Move' : dep.source_type === 'cash_remittance' ? 'Cash Remittance' : 'Manual'}
                                      </span>
                                    </div>
                                    <p className="text-sm font-medium text-slate-800 truncate">{dep.source_description || 'Deposit'}</p>
                                    <p className="text-xs text-slate-400 mt-0.5">{formatDate(dep.date)}</p>
                                    {dep.notes && <p className="text-xs text-slate-400 mt-0.5 truncate">{dep.notes}</p>}
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="text-sm font-bold text-emerald-600">+{formatCurrency(Number(dep.amount))}</span>
                                    <button
                                      onClick={() => setDeleteTarget({ type: 'deposit', id: dep.id })}
                                      className="p-1.5 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                      title="Delete deposit"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          {/* Desktop */}
                          <div className="hidden md:block">
                            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
                              <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                <div className="col-span-2">Date</div>
                                <div className="col-span-3">Description</div>
                                <div className="col-span-2">Source</div>
                                <div className="col-span-2">Notes</div>
                                <div className="col-span-2 text-right">Amount</div>
                                <div className="col-span-1"></div>
                              </div>
                            </div>
                            <div className="divide-y divide-slate-50">
                              {accDeposits.map((dep, i) => (
                                <div key={dep.id} className={`px-6 py-3 hover:bg-slate-50 transition-colors group ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                                  <div className="grid grid-cols-12 gap-2 items-center text-sm">
                                    <div className="col-span-2 text-xs text-slate-500">{formatDate(dep.date)}</div>
                                    <div className="col-span-3">
                                      <p className="font-medium text-slate-800 truncate">{dep.source_description || 'Deposit'}</p>
                                    </div>
                                    <div className="col-span-2">
                                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${dep.source_type === 'gcash_move' ? 'bg-blue-50 text-blue-700 border border-blue-200' : dep.source_type === 'cash_remittance' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-slate-50 text-slate-600 border border-slate-200'}`}>
                                        {dep.source_type === 'gcash_move' ? 'GCash Move' : dep.source_type === 'cash_remittance' ? 'Cash Remittance' : 'Manual'}
                                      </span>
                                    </div>
                                    <div className="col-span-2 text-xs text-slate-400 truncate">{dep.notes || '—'}</div>
                                    <div className="col-span-2 text-right font-bold text-emerald-600">+{formatCurrency(Number(dep.amount))}</div>
                                    <div className="col-span-1 flex justify-end">
                                      <button
                                        onClick={() => setDeleteTarget({ type: 'deposit', id: dep.id })}
                                        className="p-1.5 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-colors opacity-0 group-hover:opacity-100"
                                        title="Delete deposit"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="px-6 py-4 bg-emerald-700 text-white rounded-b-xl flex items-center justify-between">
                              <span className="text-sm font-bold">{accDeposits.length} Deposit{accDeposits.length !== 1 ? 's' : ''}</span>
                              <span className="text-lg font-black">+{formatCurrency(totalDeposited)}</span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Passbook Ledger */}
              {activeTab === 'ledger' && <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {ledgerRows.length === 0 ? (
                  <div className="py-16 text-center">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="text-sm text-slate-400">No transactions yet</p>
                    <button
                      onClick={() => { setForm(EMPTY_FORM); setShowAddTx(true); }}
                      className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                    >
                      Record First Transaction
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Mobile card view */}
                    <div className="md:hidden">
                      <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500">Opening Balance</span>
                        <span className="font-bold text-slate-700">{formatCurrency(openingBalance)}</span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {ledgerRows.map(row => {
                          const cfg = TX_CONFIG[row.tx_type];
                          return (
                            <div key={row.id} className="px-4 py-3 group">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
                                      {cfg.icon}
                                    </span>
                                    <p className="font-medium text-slate-800 text-sm truncate">{row.description || cfg.label}</p>
                                  </div>
                                  <p className="text-xs text-slate-400">{formatDate(row.date)}{row.ref_number ? ` · ${row.ref_number}` : ''}</p>
                                  {row.source_transaction_id && (
                                    <div className="mt-1 flex items-center gap-1.5 px-2 py-1 bg-blue-50 rounded-lg border border-blue-100">
                                      <ArrowUpCircle className="w-3 h-3 text-blue-500 shrink-0" />
                                      <span className="text-xs text-blue-700 font-medium truncate">GCash transfer</span>
                                    </div>
                                  )}
                                  {row.notes && <p className="text-xs text-slate-400 mt-0.5 truncate">{row.notes}</p>}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <div className="text-right">
                                    <p className={`text-sm font-semibold ${row.direction === 'debit' ? 'text-rose-600' : 'text-emerald-600'}`}>
                                      {row.direction === 'debit' ? '-' : '+'}{formatCurrency(Number(row.amount))}
                                    </p>
                                    <p className={`text-xs font-bold ${row.running_balance < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                                      {formatCurrency(row.running_balance)}
                                    </p>
                                  </div>
                                  <button
                                    onClick={() => setDeleteTarget({ type: 'transaction', id: row.id })}
                                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="px-4 py-3 bg-blue-700 text-white rounded-b-xl flex items-center justify-between">
                        <span className="text-sm font-bold">Current Balance</span>
                        <span className="text-lg font-black">{formatCurrency(ledgerRows[ledgerRows.length - 1].running_balance)}</span>
                      </div>
                    </div>
                    {/* Desktop passbook table */}
                    <div className="hidden md:block">
                      <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
                        <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          <div className="col-span-2">Date</div>
                          <div className="col-span-3">Description</div>
                          <div className="col-span-2">Ref / Check #</div>
                          <div className="col-span-1 text-center">Type</div>
                          <div className="col-span-1 text-right">Debit</div>
                          <div className="col-span-1 text-right">Credit</div>
                          <div className="col-span-2 text-right">Balance</div>
                        </div>
                      </div>
                      <div className="px-6 py-3 border-b border-slate-100 bg-blue-50/50">
                        <div className="grid grid-cols-12 gap-2 text-xs">
                          <div className="col-span-2 text-slate-500">—</div>
                          <div className="col-span-3 font-semibold text-slate-600">Opening Balance</div>
                          <div className="col-span-2 text-slate-400">—</div>
                          <div className="col-span-1" />
                          <div className="col-span-1" />
                          <div className="col-span-1" />
                          <div className="col-span-2 text-right font-bold text-slate-700">{formatCurrency(openingBalance)}</div>
                        </div>
                      </div>
                      <div className="divide-y divide-slate-50">
                        {ledgerRows.map((row, i) => {
                          const cfg = TX_CONFIG[row.tx_type];
                          return (
                            <div key={row.id} className={`px-6 group hover:bg-slate-50 transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                              <div className="grid grid-cols-12 gap-2 items-center text-sm py-3">
                                <div className="col-span-2 text-xs text-slate-500">{formatDate(row.date)}</div>
                                <div className="col-span-3">
                                  <p className="font-medium text-slate-800 truncate">{row.description || cfg.label}</p>
                                  {row.notes && <p className="text-xs text-slate-400 truncate mt-0.5">{row.notes}</p>}
                                  {row.source_transaction_id && (
                                    <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium mt-0.5">
                                      <ArrowUpCircle className="w-3 h-3" /> GCash transfer
                                    </span>
                                  )}
                                </div>
                                <div className="col-span-2 text-xs text-slate-500 truncate">{row.ref_number || '—'}</div>
                                <div className="col-span-1 flex justify-center">
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
                                    {cfg.icon}
                                  </span>
                                </div>
                                <div className="col-span-1 text-right text-sm font-medium">
                                  {row.direction === 'debit' ? <span className="text-rose-600">{formatCurrency(Number(row.amount))}</span> : <span className="text-slate-300">—</span>}
                                </div>
                                <div className="col-span-1 text-right text-sm font-medium">
                                  {row.direction === 'credit' ? <span className="text-emerald-600">{formatCurrency(Number(row.amount))}</span> : <span className="text-slate-300">—</span>}
                                </div>
                                <div className="col-span-2 text-right flex items-center justify-end gap-2">
                                  <span className={`font-bold text-sm ${row.running_balance < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                                    {formatCurrency(row.running_balance)}
                                  </span>
                                  <button
                                    onClick={() => setDeleteTarget({ type: 'transaction', id: row.id })}
                                    className="p-1 text-slate-200 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="px-6 py-4 bg-blue-700 text-white rounded-b-xl">
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-2 text-blue-200 text-xs font-medium uppercase tracking-wider">Final</div>
                          <div className="col-span-3 text-sm font-bold">Current Balance</div>
                          <div className="col-span-2" />
                          <div className="col-span-1" />
                          <div className="col-span-1 text-right text-sm text-red-300 font-semibold">
                            {formatCurrency(round2(ledgerRows.filter(r => r.direction === 'debit').reduce((s, r) => s + Number(r.amount), 0)))}
                          </div>
                          <div className="col-span-1 text-right text-sm text-emerald-300 font-semibold">
                            {formatCurrency(round2(ledgerRows.filter(r => r.direction === 'credit').reduce((s, r) => s + Number(r.amount), 0)))}
                          </div>
                          <div className="col-span-2 text-right text-lg font-black">
                            {formatCurrency(ledgerRows[ledgerRows.length - 1].running_balance)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>}
            </div>
          )}
        </div>
      )}

      {/* Add Transaction Modal */}
      {showAddTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowAddTx(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-4 sm:p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-slate-800">New Bank Transaction</h3>
              <button onClick={() => setShowAddTx(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Transaction Type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Transaction Type</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(Object.keys(TX_CONFIG) as BankTxType[]).map(type => {
                    const cfg = TX_CONFIG[type];
                    const isCheckPayment = type === 'check_payment';
                    return (
                      <button
                        key={type}
                        onClick={() => handleTxTypeChange(type)}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                          form.tx_type === type && !isCheckPayment
                            ? `${cfg.bg} ${cfg.color} ${cfg.border} ring-2 ring-offset-1 ${cfg.color.replace('text-', 'ring-')}`
                            : isCheckPayment
                            ? `${cfg.bg} ${cfg.color} ${cfg.border} hover:ring-2 hover:ring-offset-1 hover:${cfg.color.replace('text-', 'ring-')}`
                            : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {cfg.icon}
                        <span className="text-center leading-tight">{cfg.label}</span>
                        {isCheckPayment ? (
                          <span className="text-[10px] font-bold text-amber-700">Opens Form</span>
                        ) : (
                          <span className={`text-[10px] font-bold ${cfg.direction === 'credit' ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {cfg.direction === 'credit' ? '+ Credit' : '− Debit'}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* For adjustments, allow manual direction override */}
              {form.tx_type === 'adjustment' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Direction</label>
                  <div className="flex gap-2">
                    {(['credit', 'debit'] as BankTxDirection[]).map(dir => (
                      <button
                        key={dir}
                        onClick={() => setForm(f => ({ ...f, direction: dir }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          form.direction === dir
                            ? dir === 'credit' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-rose-600 text-white border-rose-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {dir === 'credit' ? '+ Credit (Add)' : '− Debit (Deduct)'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Date *</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount (₱) *</label>
                  <input
                    type="number" inputMode="decimal"
                    value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Payroll deposit, BDO service fee..."
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {form.tx_type === 'check_payment' ? 'Check Number' : 'Reference / Slip Number'}
                </label>
                <input
                  type="text"
                  value={form.ref_number}
                  onChange={e => setForm(f => ({ ...f, ref_number: e.target.value }))}
                  placeholder="Optional"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Preview */}
              {form.amount && (
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${TX_CONFIG[form.tx_type].bg} ${TX_CONFIG[form.tx_type].border}`}>
                  <span className={TX_CONFIG[form.tx_type].color}>{TX_CONFIG[form.tx_type].icon}</span>
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${TX_CONFIG[form.tx_type].color}`}>
                      {form.direction === 'credit' ? '+' : '−'} {formatCurrency(parseFloat(form.amount) || 0)}
                    </p>
                    <p className="text-xs text-slate-500">{TX_CONFIG[form.tx_type].label} · {selectedAccount?.name}</p>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowAddTx(false)} className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={saveTransaction}
                  disabled={saving || !form.amount || !form.date}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
                >
                  {saving ? 'Saving...' : 'Record Transaction'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Account Modal */}
      {showAddAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowAddAccount(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-4 sm:p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-slate-800">Add Bank Account</h3>
              <button onClick={() => setShowAddAccount(false)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Account Name *</label>
                <input
                  type="text"
                  value={newAccount.name}
                  onChange={e => setNewAccount(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. BDO Savings"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Bank Name</label>
                  <input
                    type="text"
                    value={newAccount.bank_name}
                    onChange={e => setNewAccount(p => ({ ...p, bank_name: e.target.value }))}
                    placeholder="BDO, BPI, etc."
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Account Number</label>
                  <input
                    type="text"
                    value={newAccount.account_number}
                    onChange={e => setNewAccount(p => ({ ...p, account_number: e.target.value }))}
                    placeholder="Optional"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Beginning Balance (₱)</label>
                <input
                  type="number" inputMode="decimal"
                  value={newAccount.beginning_balance}
                  onChange={e => setNewAccount(p => ({ ...p, beginning_balance: e.target.value }))}
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowAddAccount(false)} className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={addAccount}
                  disabled={savingAccount || !newAccount.name.trim()}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingAccount ? 'Adding...' : 'Add Account'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTarget?.type === 'account' ? 'Remove Bank Account' : deleteTarget?.type === 'deposit' ? 'Delete Deposit' : 'Delete Transaction'}
        message={deleteTarget?.type === 'account'
          ? 'This will deactivate the bank account. Transaction history will be kept.'
          : deleteTarget?.type === 'deposit'
          ? 'This will delete the deposit, reverse the bank balance, and also void the linked GCash cash-out transaction if one exists.'
          : 'Are you sure? This will delete the transaction and reverse the balance change. If this was a GCash-linked deposit, the GCash transaction will also be voided.'}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {showCheckIssuance && (
        <CheckIssuanceModal
          source="bank"
          bankAccountId={selectedAccountId}
          onClose={() => setShowCheckIssuance(false)}
          onSaved={handleCheckIssuanceSaved}
        />
      )}
    </div>
  );
}
