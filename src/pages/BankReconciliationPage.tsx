import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Landmark, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import { BankAccountMonitoringSummary, loadFinanceMonitoringSnapshot } from '../lib/financeMonitoring';
import { supabase } from '../lib/supabase';
import { BankAccount, BankReconciliation } from '../lib/types';
import { formatCurrency, formatDate, getTodayDateString, round2 } from '../lib/utils';

const EMPTY_FORM = {
  bank_account_id: '',
  statement_date: getTodayDateString(),
  statement_ending_balance: '',
  remarks: '',
  status: 'draft' as BankReconciliation['status'],
};

export default function BankReconciliationPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankSummaries, setBankSummaries] = useState<BankAccountMonitoringSummary[]>([]);
  const [reconciliations, setReconciliations] = useState<BankReconciliation[]>([]);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const snapshot = await loadFinanceMonitoringSnapshot();
      setBankAccounts(snapshot.bank_accounts);
      setBankSummaries(snapshot.bank_summaries);
      setReconciliations(snapshot.reconciliations);
    } catch {
      showToast('Failed to load bank reconciliations', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedAccount = bankAccounts.find(account => account.id === form.bank_account_id);
  const selectedReconciliationBase = useMemo(() => {
    if (!selectedAccount) {
      return {
        bookBalance: 0,
        unclearedChecks: 0,
        depositsInTransit: 0,
      };
    }
    const matchingSummary = bankSummaries.find(item => item.account.id === selectedAccount.id);
    return {
      bookBalance: Number(selectedAccount.actual_balance ?? selectedAccount.current_balance ?? 0),
      unclearedChecks: Number(selectedAccount.due_today ?? 0) + Number(selectedAccount.due_tomorrow ?? 0) + Number(selectedAccount.overdue_amount ?? 0),
      depositsInTransit: Number(matchingSummary?.deposits_in_transit_total ?? 0),
    };
  }, [bankSummaries, selectedAccount]);

  const statementEndingBalance = Number(form.statement_ending_balance || 0);
  const adjustedBalance = round2(statementEndingBalance - selectedReconciliationBase.unclearedChecks + selectedReconciliationBase.depositsInTransit);
  const variance = round2(adjustedBalance - selectedReconciliationBase.bookBalance);

  async function handleSave() {
    if (!form.bank_account_id || !form.statement_date || !form.statement_ending_balance) {
      showToast('Complete the reconciliation details', 'warning');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        bank_account_id: form.bank_account_id,
        statement_date: form.statement_date,
        statement_ending_balance: statementEndingBalance,
        system_book_balance: selectedReconciliationBase.bookBalance,
        uncleared_checks_total: selectedReconciliationBase.unclearedChecks,
        deposits_in_transit_total: selectedReconciliationBase.depositsInTransit,
        adjusted_balance: adjustedBalance,
        variance,
        remarks: form.remarks.trim(),
        status: form.status,
        created_by: user?.id ?? null,
        reviewed_by: form.status === 'reviewed' ? user?.id ?? null : null,
        reviewed_at: form.status === 'reviewed' ? new Date().toISOString() : null,
        finalized_by: form.status === 'finalized' ? user?.id ?? null : null,
        finalized_at: form.status === 'finalized' ? new Date().toISOString() : null,
      };
      const { error } = await supabase.from('bank_reconciliations').insert(payload);
      if (error) throw error;

      await writeAuditLog(user?.id ?? null, 'CREATE', 'BankReconciliations', undefined, {
        bank_account_id: form.bank_account_id,
        statement_date: form.statement_date,
        variance,
      });
      setForm(EMPTY_FORM);
      showToast('Bank reconciliation saved', 'success');
      await load(true);
    } catch {
      showToast('Failed to save bank reconciliation', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(item: BankReconciliation, status: BankReconciliation['status']) {
    try {
      await supabase.from('bank_reconciliations').update({
        status,
        reviewed_by: status === 'reviewed' ? user?.id ?? null : item.reviewed_by ?? null,
        reviewed_at: status === 'reviewed' ? new Date().toISOString() : item.reviewed_at ?? null,
        finalized_by: status === 'finalized' ? user?.id ?? null : null,
        finalized_at: status === 'finalized' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('id', item.id);
      await load(true);
    } catch {
      showToast('Failed to update reconciliation status', 'error');
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
          <h1 className="text-2xl font-bold text-slate-800">Bank Reconciliation</h1>
          <p className="text-sm text-slate-500 mt-0.5">Track statement balance, book balance, uncleared checks, deposits in transit, and reconciliation variance per bank account.</p>
        </div>
        <button onClick={() => load(true)} disabled={refreshing} className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-800">Create Reconciliation Entry</h2>
          <Plus className="w-4 h-4 text-slate-400" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Bank Account</label>
            <select value={form.bank_account_id} onChange={event => setForm(current => ({ ...current, bank_account_id: event.target.value }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm">
              <option value="">Select bank account</option>
              {bankAccounts.map(account => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Statement Date</label>
            <input type="date" value={form.statement_date} onChange={event => setForm(current => ({ ...current, statement_date: event.target.value }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Statement Ending Balance</label>
            <input type="number" min="0" step="0.01" value={form.statement_ending_balance} onChange={event => setForm(current => ({ ...current, statement_ending_balance: event.target.value }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
            <select value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value as BankReconciliation['status'] }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm">
              <option value="draft">Draft</option>
              <option value="reviewed">Reviewed</option>
              <option value="finalized">Finalized</option>
            </select>
          </div>
          <div className="xl:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Remarks</label>
            <input value={form.remarks} onChange={event => setForm(current => ({ ...current, remarks: event.target.value }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
            <p className="text-xs text-slate-500">System / Book Balance</p>
            <p className="text-lg font-bold text-slate-800 mt-1">{formatCurrency(selectedReconciliationBase.bookBalance)}</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
            <p className="text-xs text-slate-500">Adjusted / Variance</p>
            <p className="text-lg font-bold text-slate-800 mt-1">{formatCurrency(adjustedBalance)}</p>
            <p className={`text-xs mt-1 ${variance === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>Variance {formatCurrency(variance)}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Uncleared Checks Total</p>
            <p className="text-xl font-black text-amber-700 mt-2">{formatCurrency(selectedReconciliationBase.unclearedChecks)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deposits In Transit</p>
            <p className="text-xl font-black text-blue-700 mt-2">{formatCurrency(selectedReconciliationBase.depositsInTransit)}</p>
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={() => void handleSave()} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
            {saving ? 'Saving...' : 'Save Reconciliation'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">Reconciliation History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Bank</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Statement Date</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Statement</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Book</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Variance</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {reconciliations.map(item => {
                const bank = bankAccounts.find(account => account.id === item.bank_account_id);
                return (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Landmark className="w-4 h-4 text-blue-500" />
                        <span className="font-medium text-slate-800">{bank?.name ?? 'Bank'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(item.statement_date)}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{formatCurrency(Number(item.statement_ending_balance))}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(Number(item.system_book_balance))}</td>
                    <td className={`px-4 py-3 text-right font-bold ${Number(item.variance) === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {formatCurrency(Number(item.variance))}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${item.status === 'finalized' ? 'bg-emerald-50 text-emerald-700' : item.status === 'reviewed' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <select value={item.status} onChange={event => void updateStatus(item, event.target.value as BankReconciliation['status'])} className="px-2 py-1 border border-slate-200 rounded-lg text-xs">
                        <option value="draft">Draft</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="finalized">Finalized</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
