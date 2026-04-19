import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import { loadFinanceMonitoringSnapshot } from '../lib/financeMonitoring';
import { supabase } from '../lib/supabase';
import { RecurringObligation } from '../lib/types';
import { formatCurrency, formatDate, getTodayDateString } from '../lib/utils';

const EMPTY_FORM = {
  name: '',
  category: 'rent',
  default_amount: '',
  frequency: 'monthly' as RecurringObligation['frequency'],
  due_date_rule: '',
  next_due_date: getTodayDateString(),
  remarks: '',
};

function advanceRecurringDate(currentDate: string, frequency: RecurringObligation['frequency'], dueRule: string) {
  const date = new Date(`${currentDate}T00:00:00`);
  if (frequency === 'weekly') date.setDate(date.getDate() + 7);
  else if (frequency === 'monthly') date.setMonth(date.getMonth() + 1);
  else date.setDate(date.getDate() + Math.max(Number(dueRule) || 30, 1));
  return date.toISOString().slice(0, 10);
}

export default function RecurringObligationsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [obligations, setObligations] = useState<RecurringObligation[]>([]);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const snapshot = await loadFinanceMonitoringSnapshot();
      setObligations(snapshot.recurring_obligations);
    } catch {
      showToast('Failed to load recurring obligations', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const today = getTodayDateString();
    const tomorrow = new Date(`${today}T00:00:00`);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    return {
      dueToday: obligations.filter(item => item.is_active && item.next_due_date === today).reduce((sum, item) => sum + Number(item.default_amount), 0),
      dueTomorrow: obligations.filter(item => item.is_active && item.next_due_date === tomorrowKey).reduce((sum, item) => sum + Number(item.default_amount), 0),
      totalActive: obligations.filter(item => item.is_active).length,
    };
  }, [obligations]);

  async function handleSave() {
    const amount = Number(form.default_amount);
    if (!form.name.trim() || !amount || amount <= 0 || !form.next_due_date) {
      showToast('Complete the recurring obligation details', 'warning');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('recurring_obligations').insert({
        name: form.name.trim(),
        category: form.category.trim(),
        default_amount: amount,
        frequency: form.frequency,
        due_date_rule: form.due_date_rule.trim(),
        next_due_date: form.next_due_date,
        remarks: form.remarks.trim(),
        created_by: user?.id ?? null,
      });
      if (error) throw error;

      await writeAuditLog(user?.id ?? null, 'CREATE', 'RecurringObligations', undefined, {
        name: form.name,
        amount,
        frequency: form.frequency,
      });
      setForm(EMPTY_FORM);
      showToast('Recurring obligation saved', 'success');
      await load(true);
    } catch {
      showToast('Failed to save recurring obligation', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: RecurringObligation) {
    try {
      await supabase.from('recurring_obligations').update({
        is_active: !item.is_active,
        updated_at: new Date().toISOString(),
      }).eq('id', item.id);
      await load(true);
    } catch {
      showToast('Failed to update obligation', 'error');
    }
  }

  async function markPaid(item: RecurringObligation) {
    const nextDate = advanceRecurringDate(item.next_due_date, item.frequency, item.due_date_rule);
    try {
      await supabase.from('recurring_obligations').update({
        last_paid_date: getTodayDateString(),
        last_paid_amount: item.default_amount,
        next_due_date: nextDate,
        updated_at: new Date().toISOString(),
      }).eq('id', item.id);

      await writeAuditLog(user?.id ?? null, 'MARK_PAID', 'RecurringObligations', item.id, {
        amount: item.default_amount,
        previous_due_date: item.next_due_date,
        next_due_date: nextDate,
      });
      showToast('Obligation marked paid and advanced', 'success');
      await load(true);
    } catch {
      showToast('Failed to update obligation', 'error');
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
          <h1 className="text-2xl font-bold text-slate-800">Recurring Obligations</h1>
          <p className="text-sm text-slate-500 mt-0.5">Monitor startup fixed dues like rent, utilities, subscriptions, payroll, and scheduled supplier payments.</p>
        </div>
        <button onClick={() => load(true)} disabled={refreshing} className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active Obligations</p>
          <p className="text-2xl font-black text-slate-800 mt-2">{summary.totalActive}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Due Today</p>
          <p className="text-2xl font-black text-amber-800 mt-2">{formatCurrency(summary.dueToday)}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Due Tomorrow</p>
          <p className="text-2xl font-black text-blue-800 mt-2">{formatCurrency(summary.dueTomorrow)}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-800">Add Recurring Obligation</h2>
          <Plus className="w-4 h-4 text-slate-400" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
            <input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Category</label>
            <input value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Default Amount</label>
            <input type="number" min="0" step="0.01" value={form.default_amount} onChange={event => setForm(current => ({ ...current, default_amount: event.target.value }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Frequency</label>
            <select value={form.frequency} onChange={event => setForm(current => ({ ...current, frequency: event.target.value as RecurringObligation['frequency'] }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm">
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Due Rule</label>
            <input value={form.due_date_rule} onChange={event => setForm(current => ({ ...current, due_date_rule: event.target.value }))} placeholder="e.g. every 15th / 30 days" className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Next Due Date</label>
            <input type="date" value={form.next_due_date} onChange={event => setForm(current => ({ ...current, next_due_date: event.target.value }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div className="xl:col-span-3">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Remarks</label>
            <input value={form.remarks} onChange={event => setForm(current => ({ ...current, remarks: event.target.value }))} className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={() => void handleSave()} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
            {saving ? 'Saving...' : 'Save Obligation'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">Upcoming Obligations</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Category</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Frequency</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Next Due</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {obligations.map(item => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <CalendarClock className="w-4 h-4 text-blue-500" />
                      <div>
                        <p className="font-medium text-slate-800">{item.name}</p>
                        <p className="text-xs text-slate-400">{item.remarks || '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.category}</td>
                  <td className="px-4 py-3 text-slate-600 capitalize">{item.frequency}</td>
                  <td className="px-4 py-3">
                    <p className="text-slate-700">{formatDate(item.next_due_date)}</p>
                    {item.last_paid_date && <p className="text-xs text-slate-400">Last paid {formatDate(item.last_paid_date)}</p>}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-800">{formatCurrency(Number(item.default_amount))}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => void markPaid(item)} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                        Mark Paid
                      </button>
                      <button onClick={() => void toggleActive(item)} className={`px-2.5 py-1 rounded-lg text-xs font-medium ${item.is_active ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}>
                        {item.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
