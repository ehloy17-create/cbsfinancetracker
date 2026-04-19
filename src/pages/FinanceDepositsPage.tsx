import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowDownCircle, CheckCircle2, Clock3, Plus, RefreshCw, Search, XCircle } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import {
  archiveBankTransactions,
  createBankLedgerEntry,
  loadFinanceMonitoringSnapshot,
} from '../lib/financeMonitoring';
import { supabase } from '../lib/supabase';
import { BankAccount, BankDeposit } from '../lib/types';
import { formatCurrency, formatDate, getTodayDateString } from '../lib/utils';

type DepositStatus = NonNullable<BankDeposit['status']>;

const STATUS_META: Record<DepositStatus, { label: string; tone: string; icon: React.ReactNode }> = {
  pending: {
    label: 'Pending',
    tone: 'bg-amber-50 text-amber-700 border-amber-200',
    icon: <Clock3 className="w-3.5 h-3.5" />,
  },
  deposited: {
    label: 'Deposited',
    tone: 'bg-blue-50 text-blue-700 border-blue-200',
    icon: <ArrowDownCircle className="w-3.5 h-3.5" />,
  },
  verified: {
    label: 'Verified',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  cancelled: {
    label: 'Cancelled',
    tone: 'bg-rose-50 text-rose-700 border-rose-200',
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
};

const EMPTY_FORM = {
  bank_account_id: '',
  date: getTodayDateString(),
  amount: '',
  source_type: 'other_deposit',
  source_description: '',
  notes: '',
  attachment_reference: '',
};

export default function FinanceDepositsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | DepositStatus>('');
  const [cancelTarget, setCancelTarget] = useState<BankDeposit | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [deposits, setDeposits] = useState<BankDeposit[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const snapshot = await loadFinanceMonitoringSnapshot();
      setBankAccounts(snapshot.bank_accounts);
      setDeposits(snapshot.bank_deposits);
    } catch {
      showToast('Failed to load finance deposits', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return deposits.filter(deposit => {
      if (statusFilter && (deposit.status ?? 'verified') !== statusFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      const bankName = bankAccounts.find(account => account.id === deposit.bank_account_id)?.name?.toLowerCase() ?? '';
      return (
        bankName.includes(q)
        || deposit.source_type.toLowerCase().includes(q)
        || deposit.source_description.toLowerCase().includes(q)
        || deposit.notes.toLowerCase().includes(q)
      );
    });
  }, [bankAccounts, deposits, search, statusFilter]);

  const totals = useMemo(() => {
    return (['pending', 'deposited', 'verified', 'cancelled'] as DepositStatus[]).reduce(
      (acc, status) => {
        const rows = filtered.filter(deposit => (deposit.status ?? 'verified') === status);
        acc[status] = rows.reduce((sum, row) => sum + Number(row.amount), 0);
        acc[`${status}Count` as const] = rows.length;
        return acc;
      },
      {
        pending: 0,
        pendingCount: 0,
        deposited: 0,
        depositedCount: 0,
        verified: 0,
        verifiedCount: 0,
        cancelled: 0,
        cancelledCount: 0,
      }
    );
  }, [filtered]);

  async function handleCreateDeposit() {
    const amount = Number(form.amount);
    if (!form.bank_account_id || !form.date || !amount || amount <= 0 || !form.source_description.trim()) {
      showToast('Complete the deposit request details', 'warning');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('bank_deposits').insert({
        bank_account_id: form.bank_account_id,
        date: form.date,
        amount,
        source_type: form.source_type,
        source_description: form.source_description.trim(),
        notes: form.notes.trim(),
        attachment_reference: form.attachment_reference.trim() || null,
        status: 'pending',
        created_by: user?.id ?? null,
      });
      if (error) throw error;

      await writeAuditLog(user?.id ?? null, 'CREATE', 'BankDeposits', undefined, {
        status: 'pending',
        amount,
        source_type: form.source_type,
      });
      showToast('Deposit request saved', 'success');
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load(true);
    } catch {
      showToast('Failed to save deposit request', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkDeposited(target: BankDeposit) {
    try {
      await supabase
        .from('bank_deposits')
        .update({
          status: 'deposited',
          deposited_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.id);
      showToast('Deposit marked as deposited', 'success');
      await load(true);
    } catch {
      showToast('Failed to update deposit status', 'error');
    }
  }

  async function handleVerifyDeposit(target: BankDeposit) {
    try {
      const sourceTransactionId = target.source_transaction_id || target.id;
      const { data: existingTx } = await supabase
        .from('bank_transactions')
        .select('id')
        .eq('source_transaction_id', sourceTransactionId)
        .eq('bank_account_id', target.bank_account_id)
        .eq('is_deleted', false)
        .maybeSingle();

      if (!existingTx) {
        await createBankLedgerEntry({
          bank_account_id: target.bank_account_id,
          date: target.date,
          tx_type: 'deposit',
          amount: Number(target.amount),
          description: target.source_description || 'Verified bank deposit',
          ref_number: target.source_type,
          direction: 'credit',
          notes: target.notes,
          source_transaction_id: sourceTransactionId,
          module_source: 'finance_deposit',
          attachment_reference: target.attachment_reference ?? null,
          created_by: user?.id ?? null,
        });
      }

      await supabase
        .from('bank_deposits')
        .update({
          status: 'verified',
          deposited_at: target.deposited_at ?? new Date().toISOString(),
          verified_at: new Date().toISOString(),
          verified_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.id);

      await writeAuditLog(user?.id ?? null, 'VERIFY', 'BankDeposits', target.id, {
        amount: target.amount,
        bank_account_id: target.bank_account_id,
      });
      showToast('Deposit verified and posted to bank ledger', 'success');
      await load(true);
    } catch {
      showToast('Failed to verify deposit', 'error');
    }
  }

  async function handleCancelDeposit(target: BankDeposit) {
    setCancelTarget(target);
    try {
      await archiveBankTransactions({
        source_transaction_id: target.source_transaction_id || target.id,
        bank_account_id: target.bank_account_id,
      });

      await supabase
        .from('bank_deposits')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.id);

      await writeAuditLog(user?.id ?? null, 'CANCEL', 'BankDeposits', target.id, {
        amount: target.amount,
        source_module: target.source_module,
      });
      showToast('Deposit cancelled', 'success');
      await load(true);
    } catch {
      showToast('Failed to cancel deposit', 'error');
    } finally {
      setCancelTarget(null);
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
          <h1 className="text-2xl font-bold text-slate-800">Deposits In Transit</h1>
          <p className="text-sm text-slate-500 mt-0.5">Track pending, deposited, verified, and cancelled bank deposits without double-posting the bank ledger.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            New Deposit Request
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {(['pending', 'deposited', 'verified', 'cancelled'] as DepositStatus[]).map(status => {
          const meta = STATUS_META[status];
          return (
            <button
              key={status}
              onClick={() => setStatusFilter(current => (current === status ? '' : status))}
              className={`rounded-xl border p-4 text-left transition-all ${statusFilter === status ? meta.tone : 'bg-white border-slate-200 hover:border-slate-300'}`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-2">
                {meta.icon}
                {meta.label}
              </div>
              <p className="text-xl font-black text-slate-800">{formatCurrency(totals[status])}</p>
              <p className="text-xs text-slate-500 mt-1">{totals[`${status}Count` as const]} record{totals[`${status}Count` as const] !== 1 ? 's' : ''}</p>
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[220px] border border-slate-200 rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search bank, source, notes..."
            className="flex-1 outline-none text-sm"
          />
        </div>
        {statusFilter && (
          <button onClick={() => setStatusFilter('')} className="text-sm text-blue-600 font-medium hover:underline">
            Clear status filter
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-20 text-center">
            <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500 font-medium">No deposits found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Bank</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Source</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(deposit => {
                  const meta = STATUS_META[deposit.status ?? 'verified'];
                  const bank = bankAccounts.find(account => account.id === deposit.bank_account_id);
                  return (
                    <tr key={deposit.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-slate-600">{formatDate(deposit.date)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{bank?.name ?? '—'}</p>
                        <p className="text-xs text-slate-400">{bank?.bank_name ?? ''}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">{deposit.source_description || 'Deposit'}</p>
                        <p className="text-xs text-slate-400">{deposit.source_type || 'manual'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${meta.tone}`}>
                          {meta.icon}
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{deposit.notes || '—'}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800">{formatCurrency(Number(deposit.amount))}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {(deposit.status ?? 'verified') === 'pending' && (
                            <button onClick={() => void handleMarkDeposited(deposit)} className="px-2.5 py-1 text-xs rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200">
                              Mark Deposited
                            </button>
                          )}
                          {((deposit.status ?? 'verified') === 'pending' || (deposit.status ?? 'verified') === 'deposited') && (
                            <button onClick={() => void handleVerifyDeposit(deposit)} className="px-2.5 py-1 text-xs rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                              Verify
                            </button>
                          )}
                          {(deposit.status ?? 'verified') !== 'cancelled' && (
                            <button onClick={() => setCancelTarget(deposit)} className="px-2.5 py-1 text-xs rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200">
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !saving && setShowForm(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">New Deposit Request</h2>
                <p className="text-sm text-slate-500">This stays off the bank ledger until verified.</p>
              </div>
              <button onClick={() => !saving && setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Deposit Date</label>
                <input type="date" value={form.date} onChange={event => setForm(current => ({ ...current, date: event.target.value }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount</label>
                <input type="number" min="0" step="0.01" value={form.amount} onChange={event => setForm(current => ({ ...current, amount: event.target.value }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Bank Account</label>
                <select value={form.bank_account_id} onChange={event => setForm(current => ({ ...current, bank_account_id: event.target.value }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm">
                  <option value="">Select bank account</option>
                  {bankAccounts.map(account => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Source Type</label>
                <select value={form.source_type} onChange={event => setForm(current => ({ ...current, source_type: event.target.value }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm">
                  <option value="pos_register">POS Register</option>
                  <option value="cash_fund">Cash Fund</option>
                  <option value="gcash_move">GCash</option>
                  <option value="owner_funding">Owner Funding</option>
                  <option value="other_deposit">Other Deposit</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Attachment / Reference</label>
                <input value={form.attachment_reference} onChange={event => setForm(current => ({ ...current, attachment_reference: event.target.value }))} placeholder="Slip / proof / URL" className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Source Description</label>
                <input value={form.source_description} onChange={event => setForm(current => ({ ...current, source_description: event.target.value }))} placeholder="Describe where this deposit came from" className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Remarks</label>
                <textarea value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} rows={3} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm resize-none" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
              <button onClick={() => void handleCreateDeposit()} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'Saving...' : 'Save Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel Deposit"
        message="This will mark the deposit as cancelled and reverse any linked bank ledger posting."
        confirmLabel="Cancel Deposit"
        danger
        onConfirm={() => cancelTarget && void handleCancelDeposit(cancelTarget)}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
