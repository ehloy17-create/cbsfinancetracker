import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Filter, Plus, RefreshCw, Wallet } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import { createBankLedgerEntry, loadFinanceMonitoringSnapshot } from '../lib/financeMonitoring';
import { createOwnerLedgerEntry, OWNER_LEDGER_TRANSACTION_LABELS, normalizeFinanceOwner } from '../lib/ownerLedger';
import { supabase } from '../lib/supabase';
import { Account, BankAccount, FinanceOwner, OwnerLedgerEntry, OwnerLedgerTransactionType } from '../lib/types';
import { formatCurrency, formatDate, getTodayDateString, round2 } from '../lib/utils';

function getMonthRange() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

type EntryMode = 'funding' | 'repayment' | 'adjustment_increase' | 'adjustment_decrease';
type AccountMode = 'bank' | 'gcash' | 'cash_fund' | 'adjustment';

const EMPTY_FORM = {
  owner_id: '',
  date: getTodayDateString(),
  mode: 'funding' as EntryMode,
  account_mode: 'bank' as AccountMode,
  bank_account_id: '',
  gcash_account_id: '',
  amount: '',
  reference_number: '',
  remarks: '',
};

const EMPTY_OWNER_FORM = {
  name: '',
  remarks: '',
};

function getTransactionType(mode: EntryMode, accountMode: AccountMode): OwnerLedgerTransactionType {
  if (mode === 'funding') {
    if (accountMode === 'bank') return 'owner_funding_to_bank';
    if (accountMode === 'gcash') return 'owner_funding_to_gcash';
    return 'owner_funding_to_cash_fund';
  }
  if (mode === 'repayment') {
    if (accountMode === 'bank') return 'payment_to_owner_from_bank';
    if (accountMode === 'gcash') return 'payment_to_owner_from_gcash';
    return 'payment_to_owner_from_cash_fund';
  }
  return mode === 'adjustment_increase' ? 'owner_advance_adjustment' : 'owner_balance_adjustment';
}

function getSourceLabel(entry: OwnerLedgerEntry, bankMap: Map<string, string>, gcashMap: Map<string, string>) {
  if (entry.source_account_type === 'bank') return bankMap.get(entry.source_account_id ?? '') ?? 'Bank';
  if (entry.source_account_type === 'gcash') return gcashMap.get(entry.source_account_id ?? '') ?? 'GCash';
  if (entry.source_account_type === 'cash_fund') return 'Cash Fund';
  if (entry.source_account_type === 'owner_personal') return 'Owner Personal Fund';
  if (entry.source_account_type === 'adjustment') return 'Adjustment';
  return '—';
}

export default function FinanceOwnerMovementsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingOwner, setSavingOwner] = useState(false);
  const [showOwnerForm, setShowOwnerForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [ownerForm, setOwnerForm] = useState(EMPTY_OWNER_FORM);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [gcashAccounts, setGcashAccounts] = useState<Account[]>([]);
  const [owners, setOwners] = useState<FinanceOwner[]>([]);
  const [ownerBalances, setOwnerBalances] = useState<Array<{ owner: FinanceOwner; current_balance: number }>>([]);
  const [ledger, setLedger] = useState<OwnerLedgerEntry[]>([]);

  const monthRange = getMonthRange();
  const [dateFrom, setDateFrom] = useState(monthRange.from);
  const [dateTo, setDateTo] = useState(monthRange.to);
  const [ownerFilter, setOwnerFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [snapshot, { data: gcashRows }, { data: ownerRows }] = await Promise.all([
        loadFinanceMonitoringSnapshot(),
        supabase.from('accounts').select('id, name, current_beginning_balance, is_active').eq('is_active', true).order('name'),
        supabase.from('finance_owners').select('*').eq('is_active', true).order('name'),
      ]);

      setBankAccounts(snapshot.bank_accounts);
      setGcashAccounts((gcashRows as Account[]) || []);
      const ownerList = ((ownerRows as Record<string, unknown>[]) || []).map(normalizeFinanceOwner);
      setOwners(ownerList);
      setOwnerBalances(snapshot.owner_balances.map(item => ({ owner: item.owner, current_balance: item.current_balance })));
      setLedger(snapshot.owner_ledger);

      setForm(current => ({
        ...current,
        owner_id: current.owner_id || ownerList[0]?.id || '',
      }));
    } catch {
      showToast('Failed to load owner ledger', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const bankMap = useMemo(
    () => new Map(bankAccounts.map(account => [account.id, account.name])),
    [bankAccounts]
  );
  const gcashMap = useMemo(
    () => new Map(gcashAccounts.map(account => [account.id, account.name])),
    [gcashAccounts]
  );
  const ownerMap = useMemo(
    () => new Map(owners.map(owner => [owner.id, owner.name])),
    [owners]
  );

  const filteredLedger = useMemo(() => ledger.filter(entry => {
    const inRange = entry.transaction_date >= dateFrom && entry.transaction_date <= dateTo;
    const matchesOwner = !ownerFilter || entry.owner_id === ownerFilter;
    const matchesType = !typeFilter || entry.transaction_type === typeFilter;
    const matchesModule = !moduleFilter || entry.source_module === moduleFilter;
    const sourceValue = `${entry.source_account_type ?? ''}:${entry.source_account_id ?? ''}`;
    const matchesSource = !sourceFilter || sourceValue === sourceFilter;
    return inRange && matchesOwner && matchesType && matchesModule && matchesSource;
  }), [ledger, dateFrom, dateTo, ownerFilter, typeFilter, moduleFilter, sourceFilter]);

  const totals = useMemo(() => ({
    dueToOwner: round2(ownerBalances.reduce((sum, item) => sum + Number(item.current_balance), 0)),
    fundingThisMonth: round2(filteredLedger
      .filter(entry => entry.transaction_type === 'owner_funding_to_bank' || entry.transaction_type === 'owner_funding_to_gcash' || entry.transaction_type === 'owner_funding_to_cash_fund')
      .reduce((sum, entry) => sum + Number(entry.increase_amount), 0)),
    ownerPaidThisMonth: round2(filteredLedger
      .filter(entry => entry.transaction_type === 'owner_paid_expense' || entry.transaction_type === 'owner_paid_purchase' || entry.transaction_type === 'owner_paid_supplier_bill' || entry.transaction_type === 'owner_paid_shopee_purchase')
      .reduce((sum, entry) => sum + Number(entry.increase_amount), 0)),
    repaymentsThisMonth: round2(filteredLedger
      .filter(entry => entry.transaction_type === 'payment_to_owner_from_bank' || entry.transaction_type === 'payment_to_owner_from_gcash' || entry.transaction_type === 'payment_to_owner_from_cash_fund' || entry.transaction_type === 'owner_settlement')
      .reduce((sum, entry) => sum + Number(entry.decrease_amount), 0)),
  }), [filteredLedger, ownerBalances]);

  async function handleCreateOwner() {
    if (!ownerForm.name.trim()) {
      showToast('Enter the owner name', 'warning');
      return;
    }

    setSavingOwner(true);
    try {
      const { data, error } = await supabase
        .from('finance_owners')
        .insert({
          name: ownerForm.name.trim(),
          remarks: ownerForm.remarks.trim(),
          is_active: true,
          created_by: user?.id ?? null,
        })
        .select('*')
        .single();

      if (error) throw error;

      const owner = normalizeFinanceOwner(data as Record<string, unknown>);
      setOwners(current => [...current, owner].sort((left, right) => left.name.localeCompare(right.name)));
      setOwnerBalances(current => [...current, { owner, current_balance: 0 }].sort((left, right) => left.owner.name.localeCompare(right.owner.name)));
      setForm(current => ({ ...current, owner_id: owner.id }));
      setOwnerForm(EMPTY_OWNER_FORM);
      setShowOwnerForm(false);
      showToast('Owner added', 'success');
    } catch {
      showToast('Failed to add owner', 'error');
    } finally {
      setSavingOwner(false);
    }
  }

  async function handleSave() {
    const amount = round2(Number(form.amount));
    if (!form.owner_id) {
      showToast('Select the owner', 'warning');
      return;
    }
    if (!form.date || !amount || amount <= 0) {
      showToast('Enter a valid amount', 'warning');
      return;
    }
    if ((form.mode === 'funding' || form.mode === 'repayment') && form.account_mode === 'bank' && !form.bank_account_id) {
      showToast('Select the bank account', 'warning');
      return;
    }
    if ((form.mode === 'funding' || form.mode === 'repayment') && form.account_mode === 'gcash' && !form.gcash_account_id) {
      showToast('Select the GCash account', 'warning');
      return;
    }

    setSaving(true);
    try {
      let postedBankTransactionId: string | null = null;
      let postedTransactionId: string | null = null;
      let postedCashTransactionId: string | null = null;

      const description = form.remarks.trim() || OWNER_LEDGER_TRANSACTION_LABELS[getTransactionType(form.mode, form.account_mode)];
      const sourceAccountId = form.account_mode === 'bank'
        ? form.bank_account_id || null
        : form.account_mode === 'gcash'
        ? form.gcash_account_id || null
        : null;

      if (form.mode === 'funding' || form.mode === 'repayment') {
        if (form.account_mode === 'bank' && form.bank_account_id) {
          const bankTx = await createBankLedgerEntry({
            bank_account_id: form.bank_account_id,
            date: form.date,
            tx_type: form.mode === 'funding' ? 'owner_funding' : 'owner_withdrawal',
            amount,
            description,
            ref_number: form.reference_number.trim(),
            direction: form.mode === 'funding' ? 'credit' : 'debit',
            notes: form.remarks.trim(),
            module_source: 'owner_ledger',
            created_by: user?.id ?? null,
          });
          postedBankTransactionId = (bankTx as { id?: string } | null)?.id ?? null;
        } else if (form.account_mode === 'gcash' && form.gcash_account_id) {
          const { data, error } = await supabase
            .from('transactions')
            .insert({
              date: form.date,
              account_id: form.gcash_account_id,
              transaction_type: form.mode === 'funding' ? 'cash_in' : 'cash_out',
              cash_in_mode: form.mode === 'funding' ? 'regular' : null,
              cash_out_type: form.mode === 'repayment' ? 'disbursement' : null,
              amount,
              transaction_fee: 0,
              amount_received: null,
              delivery_fee: 0,
              notes: description,
              fee_type: 'gcash',
              created_by: user?.id ?? null,
            })
            .select('id')
            .single();
          if (error) throw error;
          postedTransactionId = String(data.id);
        } else if (form.account_mode === 'cash_fund') {
          const { data, error } = await supabase
            .from('cash_transactions')
            .insert({
              date: form.date,
              transaction_type: form.mode === 'funding' ? 'cash_in' : 'cash_out',
              amount,
              notes: description,
              created_by: user?.id ?? null,
            })
            .select('id')
            .single();
          if (error) throw error;
          postedCashTransactionId = String(data.id);
        }
      }

      let ownerMovementId: string | null = null;
      if (form.mode === 'funding' || form.mode === 'repayment') {
        const { data, error } = await supabase
          .from('finance_owner_movements')
          .insert({
            owner_id: form.owner_id,
            date: form.date,
            movement_type: form.mode === 'funding' ? 'funding' : 'withdrawal',
            target_module: form.account_mode === 'adjustment' ? 'cash_fund' : form.account_mode,
            bank_account_id: form.account_mode === 'bank' ? form.bank_account_id || null : null,
            account_id: form.account_mode === 'gcash' ? form.gcash_account_id || null : null,
            amount,
            reference_number: form.reference_number.trim(),
            remarks: form.remarks.trim(),
            attachment_reference: null,
            approval_required: false,
            approval_status: 'approved',
            approved_by: user?.id ?? null,
            approved_at: new Date().toISOString(),
            posted_bank_transaction_id: postedBankTransactionId,
            posted_transaction_id: postedTransactionId,
            posted_cash_transaction_id: postedCashTransactionId,
            created_by: user?.id ?? null,
          })
          .select('id')
          .single();
        if (error) throw error;
        ownerMovementId = String(data.id);
      }

      const transactionType = getTransactionType(form.mode, form.account_mode);
      const ledger = await createOwnerLedgerEntry({
        owner_id: form.owner_id,
        transaction_date: form.date,
        transaction_type: transactionType,
        reference_type: ownerMovementId ? 'finance_owner_movement' : 'owner_adjustment',
        reference_id: ownerMovementId,
        source_module: form.mode === 'funding' || form.mode === 'repayment' ? 'owner_movement' : 'owner_adjustment',
        description,
        increase_amount: form.mode === 'funding' || form.mode === 'adjustment_increase' ? amount : 0,
        decrease_amount: form.mode === 'repayment' || form.mode === 'adjustment_decrease' ? amount : 0,
        source_account_type: form.account_mode,
        source_account_id: sourceAccountId,
        reference_number: form.reference_number.trim(),
        remarks: form.remarks.trim(),
        created_by: user?.id ?? null,
      });

      if (ownerMovementId) {
        await supabase
          .from('finance_owner_movements')
          .update({ owner_ledger_id: ledger.id, updated_at: new Date().toISOString() })
          .eq('id', ownerMovementId);
      }

      await writeAuditLog(user?.id ?? null, 'CREATE', 'OwnerLedger', ledger.id, {
        owner_id: form.owner_id,
        transaction_type: transactionType,
        amount,
      });

      setForm(current => ({
        ...EMPTY_FORM,
        owner_id: current.owner_id,
        account_mode: current.account_mode,
      }));
      showToast('Owner ledger entry posted', 'success');
      try {
        await load(true);
      } catch {
        showToast('Owner ledger entry was saved, but the page could not refresh immediately', 'warning');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to save owner ledger entry', 'error');
    } finally {
      setSaving(false);
    }
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Owner Ledger</h1>
          <p className="text-sm text-slate-500 mt-0.5">Track owner funding, owner-paid business costs, repayments, and running due-to-owner balances per owner.</p>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Amount Due to Owners</p>
          <p className="text-2xl font-black text-violet-800 mt-2">{formatCurrency(totals.dueToOwner)}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Funding This Month</p>
          <p className="text-2xl font-black text-emerald-800 mt-2">{formatCurrency(totals.fundingThisMonth)}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Owner-Paid Costs This Month</p>
          <p className="text-2xl font-black text-amber-800 mt-2">{formatCurrency(totals.ownerPaidThisMonth)}</p>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Repayments This Month</p>
          <p className="text-2xl font-black text-rose-800 mt-2">{formatCurrency(totals.repaymentsThisMonth)}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-800">Owners</h2>
          <button
            onClick={() => setShowOwnerForm(value => !value)}
            className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <Plus className="w-4 h-4" />
            Add Owner
          </button>
        </div>

        {showOwnerForm && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 p-4 rounded-xl border border-slate-200 bg-slate-50">
            <input
              value={ownerForm.name}
              onChange={event => setOwnerForm(current => ({ ...current, name: event.target.value }))}
              placeholder="Owner name"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
            />
            <input
              value={ownerForm.remarks}
              onChange={event => setOwnerForm(current => ({ ...current, remarks: event.target.value }))}
              placeholder="Remarks"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
            />
            <button
              onClick={() => void handleCreateOwner()}
              disabled={savingOwner}
              className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              {savingOwner ? 'Saving...' : 'Save Owner'}
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {ownerBalances.length === 0 ? (
            <p className="text-sm text-slate-400">No owners yet. Add at least one owner to start tracking due-to-owner balances.</p>
          ) : ownerBalances.map(item => (
            <div key={item.owner.id} className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-semibold text-slate-800">{item.owner.name}</p>
              <p className="text-xs text-slate-400 mt-1">{item.owner.remarks || 'Owner ledger account'}</p>
              <p className={`text-xl font-black mt-3 ${item.current_balance > 0 ? 'text-violet-700' : 'text-slate-500'}`}>
                {formatCurrency(item.current_balance)}
              </p>
              <p className="text-xs text-slate-400 mt-1">Business due to owner</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-800">Post Owner Funding / Repayment / Adjustment</h2>
          <Wallet className="w-4 h-4 text-slate-400" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Owner</label>
            <select
              value={form.owner_id}
              onChange={event => setForm(current => ({ ...current, owner_id: event.target.value }))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
            >
              <option value="">Select owner</option>
              {owners.map(owner => (
                <option key={owner.id} value={owner.id}>{owner.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Date</label>
            <input
              type="date"
              value={form.date}
              onChange={event => setForm(current => ({ ...current, date: event.target.value }))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Entry Type</label>
            <select
              value={form.mode}
              onChange={event => setForm(current => ({
                ...current,
                mode: event.target.value as EntryMode,
                account_mode: event.target.value.startsWith('adjustment') ? 'adjustment' : current.account_mode === 'adjustment' ? 'bank' : current.account_mode,
              }))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
            >
              <option value="funding">Owner Funding</option>
              <option value="repayment">Repayment to Owner</option>
              <option value="adjustment_increase">Increase Adjustment</option>
              <option value="adjustment_decrease">Decrease Adjustment</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={event => setForm(current => ({ ...current, amount: event.target.value }))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
            />
          </div>

          {!(form.mode === 'adjustment_increase' || form.mode === 'adjustment_decrease') && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{form.mode === 'funding' ? 'Destination Account' : 'Source Account'}</label>
                <select
                  value={form.account_mode}
                  onChange={event => setForm(current => ({ ...current, account_mode: event.target.value as AccountMode }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                >
                  <option value="bank">Bank</option>
                  <option value="gcash">GCash</option>
                  <option value="cash_fund">Cash Fund</option>
                </select>
              </div>

              {form.account_mode === 'bank' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Bank Account</label>
                  <select
                    value={form.bank_account_id}
                    onChange={event => setForm(current => ({ ...current, bank_account_id: event.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="">Select bank account</option>
                    {bankAccounts.map(account => (
                      <option key={account.id} value={account.id}>{account.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {form.account_mode === 'gcash' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">GCash Account</label>
                  <select
                    value={form.gcash_account_id}
                    onChange={event => setForm(current => ({ ...current, gcash_account_id: event.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="">Select GCash account</option>
                    {gcashAccounts.map(account => (
                      <option key={account.id} value={account.id}>{account.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Reference Number</label>
            <input
              value={form.reference_number}
              onChange={event => setForm(current => ({ ...current, reference_number: event.target.value }))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div className="xl:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Remarks</label>
            <input
              value={form.remarks}
              onChange={event => setForm(current => ({ ...current, remarks: event.target.value }))}
              placeholder="Purpose, repayment note, or adjustment reason"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Post Entry'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-800">Owner Ledger Filters</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
          <input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
          <select value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm">
            <option value="">All owners</option>
            {owners.map(owner => (
              <option key={owner.id} value={owner.id}>{owner.name}</option>
            ))}
          </select>
          <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm">
            <option value="">All transaction types</option>
            {Object.entries(OWNER_LEDGER_TRANSACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select value={moduleFilter} onChange={event => setModuleFilter(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm">
            <option value="">All source modules</option>
            <option value="owner_movement">Owner Movement</option>
            <option value="disbursements">Disbursements</option>
            <option value="payables">Payables</option>
            <option value="owner_adjustment">Owner Adjustment</option>
          </select>
          <select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm">
            <option value="">All source accounts</option>
            {bankAccounts.map(account => (
              <option key={`bank:${account.id}`} value={`bank:${account.id}`}>{account.name}</option>
            ))}
            {gcashAccounts.map(account => (
              <option key={`gcash:${account.id}`} value={`gcash:${account.id}`}>{account.name}</option>
            ))}
            <option value="cash_fund:">Cash Fund</option>
            <option value="owner_personal:">Owner Personal Fund</option>
            <option value="adjustment:">Adjustment</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">Owner Ledger History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Owner</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Module</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Source</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Description</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Reference</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Increase</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Decrease</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Running</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredLedger.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-400">No owner ledger entries found for the current filters.</td>
                </tr>
              ) : filteredLedger.map(entry => (
                <tr key={entry.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">{formatDate(entry.transaction_date)}</td>
                  <td className="px-4 py-3 text-slate-700 font-medium">{ownerMap.get(entry.owner_id) ?? 'Owner'}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                      Number(entry.increase_amount) > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                    }`}>
                      {Number(entry.increase_amount) > 0 ? <ArrowDownCircle className="w-3.5 h-3.5" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                      {OWNER_LEDGER_TRANSACTION_LABELS[entry.transaction_type]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{entry.source_module || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{getSourceLabel(entry, bankMap, gcashMap)}</td>
                  <td className="px-4 py-3 text-slate-600">{entry.description}</td>
                  <td className="px-4 py-3 text-slate-500">{entry.reference_number || '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-700">{entry.increase_amount > 0 ? formatCurrency(entry.increase_amount) : '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold text-rose-700">{entry.decrease_amount > 0 ? formatCurrency(entry.decrease_amount) : '—'}</td>
                  <td className="px-4 py-3 text-right font-bold text-violet-700">{formatCurrency(entry.running_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
