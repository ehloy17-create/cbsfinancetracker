import { useState, useEffect, useCallback } from 'react';
import { CreditCard, Plus, Edit2, CheckCircle, Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency, formatDate } from '../../lib/utils';
import InvModal from '../../inventory/components/InvModal';

interface Employee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
}

interface CashAdvance {
  id: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  date_granted: string;
  amount: number;
  balance: number;
  deduction_per_cutoff: number;
  deduction_mode: string;
  status: string;
  remarks: string | null;
}

interface CashAdvanceForm {
  id: string | null;
  employee_id: string;
  date_granted: string;
  amount: string;
  balance: string;
  deduction_per_cutoff: string;
  deduction_mode: string;
  status: string;
  remarks: string;
}

const today = new Date().toISOString().slice(0, 10);

const EMPTY_FORM: CashAdvanceForm = {
  id: null,
  employee_id: '',
  date_granted: today,
  amount: '',
  balance: '',
  deduction_per_cutoff: '',
  deduction_mode: 'every_cutoff',
  status: 'Active',
  remarks: '',
};

function statusBadge(status: string) {
  switch (status) {
    case 'Active':
      return 'bg-green-100 text-green-700';
    case 'Settled':
      return 'bg-blue-100 text-blue-700';
    case 'Cancelled':
      return 'bg-slate-100 text-slate-500';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

export default function CashAdvancePage() {
  const { showToast } = useToast();

  const [advances, setAdvances] = useState<CashAdvance[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CashAdvanceForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [settleModalOpen, setSettleModalOpen] = useState(false);
  const [settleTarget, setSettleTarget] = useState<CashAdvance | null>(null);
  const [settling, setSettling] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<CashAdvance | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Load active employees for form dropdown
  useEffect(() => {
    async function loadEmployees() {
      try {
        const { data, error } = await supabase.rpc('search_employees', {
          status: 'active',
          page: 1,
          page_size: 200,
        });
        if (error) throw error;
        const result = data as { employees: Employee[] } | null;
        setEmployees(result?.employees ?? []);
      } catch {
        // silently ignore
      }
    }
    loadEmployees();
  }, []);

  const fetchAdvances = useCallback(async () => {
    setLoading(true);
    try {
      const emp = employees.find(
        e =>
          `${e.first_name} ${e.last_name}`.toLowerCase().includes(employeeSearch.toLowerCase()) ||
          e.employee_code.toLowerCase().includes(employeeSearch.toLowerCase()),
      );

      const { data, error } = await supabase.rpc('search_cash_advances', {
        employee_id: employeeSearch && emp ? emp.id : null,
        status: statusFilter || null,
        page: 1,
        page_size: 50,
      });
      if (error) throw error;
      const result = data as { advances: CashAdvance[]; total: number } | null;
      setAdvances(result?.advances ?? []);
      setTotal(result?.total ?? 0);
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to load cash advances', 'error');
    } finally {
      setLoading(false);
    }
  }, [employeeSearch, statusFilter, employees, showToast]);

  useEffect(() => {
    fetchAdvances();
  }, [fetchAdvances]);

  const set = (field: keyof CashAdvanceForm, value: unknown) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const openAdd = () => {
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEdit = (ca: CashAdvance) => {
    setForm({
      id: ca.id,
      employee_id: String(ca.employee_id),
      date_granted: String(ca.date_granted).slice(0, 10),
      amount: String(ca.amount),
      balance: String(ca.balance),
      deduction_per_cutoff: String(ca.deduction_per_cutoff),
      deduction_mode: ca.deduction_mode || 'every_cutoff',
      status: ca.status,
      remarks: ca.remarks ?? '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.employee_id) { showToast('Employee is required', 'error'); return; }
    if (!form.date_granted) { showToast('Date granted is required', 'error'); return; }
    const amount = parseFloat(form.amount) || 0;
    if (amount <= 0) { showToast('Amount must be greater than 0', 'error'); return; }

    setSaving(true);
    try {
      const isNew = !form.id;
      const payload = {
        id: form.id ?? null,
        employee_id: form.employee_id,
        date_granted: form.date_granted,
        amount,
        balance: isNew ? amount : parseFloat(form.balance) || 0,
        deduction_per_cutoff: parseFloat(form.deduction_per_cutoff) || 0,
        deduction_mode: form.deduction_mode,
        status: form.status,
        remarks: form.remarks.trim() || null,
      };
      const { error } = await supabase.rpc('save_cash_advance', { advance: payload, created_by: 'admin' });
      if (error) throw error;
      showToast(`Cash advance ${isNew ? 'created' : 'updated'} successfully`, 'success');
      setModalOpen(false);
      fetchAdvances();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to save cash advance', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openSettle = (ca: CashAdvance) => {
    setSettleTarget(ca);
    setSettleModalOpen(true);
  };

  const handleSettle = async () => {
    if (!settleTarget) return;
    setSettling(true);
    try {
      const payload = {
        id: settleTarget.id,
        employee_id: String(settleTarget.employee_id),
        date_granted: String(settleTarget.date_granted).slice(0, 10),
        amount: settleTarget.amount,
        balance: 0,
        deduction_per_cutoff: settleTarget.deduction_per_cutoff,
        deduction_mode: settleTarget.deduction_mode || 'every_cutoff',
        status: 'Settled',
        remarks: settleTarget.remarks ?? null,
      };
      const { error } = await supabase.rpc('save_cash_advance', { advance: payload, created_by: 'admin' });
      if (error) throw error;
      showToast('Cash advance marked as settled', 'success');
      setSettleModalOpen(false);
      setSettleTarget(null);
      fetchAdvances();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to settle cash advance', 'error');
    } finally {
      setSettling(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_cash_advance', { id: deleteTarget.id });
      if (error) throw error;
      showToast('Cash advance deleted', 'success');
      setDeleteTarget(null);
      fetchAdvances();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Cash Advances</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} record{total !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Add Cash Advance
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            type="text"
            placeholder="Search by employee name or code…"
            value={employeeSearch}
            onChange={e => setEmployeeSearch(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Settled">Settled</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : advances.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No cash advances found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Employee</th>
                  <th className="px-4 py-3 text-left">Date Granted</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">Deduction/Cutoff</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {advances.map(ca => (
                  <tr key={ca.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{ca.employee_name ?? '—'}</div>
                      {ca.employee_code && (
                        <div className="text-xs text-slate-400">{ca.employee_code}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(ca.date_granted)}</td>
                    <td className="px-4 py-3 text-right text-slate-800 font-medium">{formatCurrency(ca.amount)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={ca.balance > 0 ? 'text-orange-600 font-medium' : 'text-slate-500'}>
                        {formatCurrency(ca.balance)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(ca.deduction_per_cutoff)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(ca.status)}`}>
                        {ca.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openEdit(ca)}
                          title="Edit"
                          className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {ca.status === 'Active' && (
                          <button
                            onClick={() => openSettle(ca)}
                            title="Mark as Settled"
                            className="p-1.5 rounded hover:bg-green-50 text-green-600"
                          >
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => setDeleteTarget(ca)} title="Delete" className="p-1.5 rounded hover:bg-red-50 text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <InvModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.id ? 'Edit Cash Advance' : 'Add Cash Advance'}
        size="lg"
      >
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Employee <span className="text-red-500">*</span>
            </label>
            <select
              value={form.employee_id}
              onChange={e => set('employee_id', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select employee…</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.employee_code} — {e.first_name} {e.last_name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Date Granted <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={form.date_granted}
                onChange={e => set('date_granted', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Amount <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={e => set('amount', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Deduction per Cutoff</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.deduction_per_cutoff}
                onChange={e => set('deduction_per_cutoff', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select
                value={form.status}
                onChange={e => set('status', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>Active</option>
                <option>Settled</option>
                <option>Cancelled</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Deduction Schedule</label>
            <select
              value={form.deduction_mode}
              onChange={e => set('deduction_mode', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="every_cutoff">Every Cutoff</option>
              <option value="every_other">Every Other Cutoff (1st Half)</option>
              <option value="every_other_2nd">Every Other Cutoff (2nd Half)</option>
              <option value="manual">Manual (no auto-deduction)</option>
            </select>
            <p className="text-xs text-slate-400 mt-1">
              {form.deduction_mode === 'every_other'
                ? 'Deduction applies only on the 1st half cutoff each month.'
                : form.deduction_mode === 'every_other_2nd'
                ? 'Deduction applies only on the 2nd half cutoff each month.'
                : form.deduction_mode === 'manual'
                ? 'No automatic deduction — adjust balance manually as needed.'
                : 'Deduction applies automatically on every payroll run.'}
            </p>
          </div>

          {form.id && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Balance
                <span className="text-xs font-normal text-slate-400 ml-1">(manual adjustment)</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.balance}
                onChange={e => set('balance', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Remarks</label>
            <textarea
              value={form.remarks}
              onChange={e => set('remarks', e.target.value)}
              rows={2}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional remarks…"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setModalOpen(false)}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Cash Advance'}
            </button>
          </div>
        </div>
      </InvModal>

      {/* Settle Confirmation Modal */}
      <InvModal
        open={settleModalOpen}
        onClose={() => { setSettleModalOpen(false); setSettleTarget(null); }}
        title="Settle Cash Advance"
        size="md"
      >
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600">
            Mark this cash advance as <strong>Settled</strong>? The balance will be set to{' '}
            <strong>0</strong> and the status changed to Settled.
          </p>
          {settleTarget && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Employee</span>
                <span className="font-medium text-slate-800">{settleTarget.employee_name ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount</span>
                <span className="font-medium text-slate-800">{formatCurrency(settleTarget.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Current Balance</span>
                <span className="font-medium text-orange-600">{formatCurrency(settleTarget.balance)}</span>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => { setSettleModalOpen(false); setSettleTarget(null); }}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSettle}
              disabled={settling}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              <CheckCircle className="w-4 h-4" />
              {settling ? 'Settling…' : 'Confirm Settle'}
            </button>
          </div>
        </div>
      </InvModal>

      {/* Delete Confirmation Modal */}
      <InvModal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Cash Advance" size="sm">
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-800">Delete this cash advance?</p>
              <p className="text-sm text-slate-600 mt-1">{deleteTarget?.employee_name} — ₱{deleteTarget?.amount}</p>
              <p className="text-xs text-red-600 mt-2">This action cannot be undone.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-60">
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </InvModal>
    </div>
  );
}
