import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Plus, Edit2, Lock, Play, Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../lib/utils';
import InvModal from '../../inventory/components/InvModal';

interface Cutoff {
  cutoff_id: string;
  period_name: string;
  date_from: string;
  date_to: string;
  payroll_month: number;
  payroll_year: number;
  cutoff_seq: number;
  status: string;
  notes: string | null;
}

interface CutoffForm {
  cutoff_id: string | null;
  period_name: string;
  date_from: string;
  date_to: string;
  payroll_month: string;
  payroll_year: string;
  cutoff_seq: string;
  status: string;
  notes: string;
}

const EMPTY_FORM: CutoffForm = {
  cutoff_id: null,
  period_name: '',
  date_from: '',
  date_to: '',
  payroll_month: '',
  payroll_year: '',
  cutoff_seq: '1',
  status: 'Open',
  notes: '',
};

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function statusBadge(status: string) {
  switch (status) {
    case 'Processing':
      return 'bg-yellow-100 text-yellow-700';
    case 'Finalized':
      return 'bg-blue-100 text-blue-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

export default function CutoffsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const currentYear = new Date().getFullYear();
  const [yearFilter, setYearFilter] = useState(String(currentYear));
  const [cutoffs, setCutoffs] = useState<Cutoff[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CutoffForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Cutoff | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchCutoffs = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('search_payroll_cutoffs', {
        year: yearFilter ? parseInt(yearFilter) : null,
        status: null,
        page: 1,
        page_size: 24,
      });
      if (error) throw error;
      const result = data as { cutoffs: Cutoff[]; total: number } | null;
      setCutoffs(result?.cutoffs ?? []);
      setTotal(result?.total ?? 0);
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to load cutoffs', 'error');
    } finally {
      setLoading(false);
    }
  }, [yearFilter, showToast]);

  useEffect(() => {
    fetchCutoffs();
  }, [fetchCutoffs]);

  const set = (field: keyof CutoffForm, value: unknown) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, payroll_year: yearFilter });
    setModalOpen(true);
  };

  const openEdit = (c: Cutoff) => {
    setForm({
      cutoff_id: c.cutoff_id,
      period_name: c.period_name,
      date_from: String(c.date_from).slice(0, 10),
      date_to: String(c.date_to).slice(0, 10),
      payroll_month: String(c.payroll_month),
      payroll_year: String(c.payroll_year),
      cutoff_seq: String(c.cutoff_seq),
      status: c.status,
      notes: c.notes ?? '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.period_name.trim()) { showToast('Period name is required', 'error'); return; }
    if (!form.date_from) { showToast('Date From is required', 'error'); return; }
    if (!form.date_to) { showToast('Date To is required', 'error'); return; }
    if (!form.payroll_month) { showToast('Payroll month is required', 'error'); return; }
    if (!form.payroll_year) { showToast('Payroll year is required', 'error'); return; }

    setSaving(true);
    try {
      const isNew = !form.cutoff_id;
      const payload = {
        cutoff_id: form.cutoff_id ?? null,
        period_name: form.period_name.trim(),
        date_from: form.date_from,
        date_to: form.date_to,
        payroll_month: parseInt(form.payroll_month),
        payroll_year: parseInt(form.payroll_year),
        cutoff_seq: parseInt(form.cutoff_seq),
        status: form.status,
        notes: form.notes.trim() || null,
      };
      const { data: saveData, error } = await supabase.rpc('save_payroll_cutoff', { cutoff: payload, created_by: 'admin' });
      if (error) throw error;

      // Auto-populate DTR for new cutoffs
      if (isNew) {
        const savedCutoffId = (saveData as { cutoff_id?: string } | null)?.cutoff_id;
        if (savedCutoffId) {
          try {
            const { data: dtrData } = await supabase.rpc('generate_dtr_for_cutoff', { cutoff_id: savedCutoffId });
            const result = dtrData as { created?: number; skipped?: number } | null;
            if (result?.created) {
              showToast(`Cutoff created. ${result.created} attendance records generated automatically.`, 'success');
            } else {
              showToast('Cutoff created successfully', 'success');
            }
          } catch {
            showToast('Cutoff created. Could not auto-generate DTR records.', 'success');
          }
        } else {
          showToast('Cutoff created successfully', 'success');
        }
      } else {
        showToast('Cutoff updated successfully', 'success');
      }
      setModalOpen(false);
      fetchCutoffs();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to save cutoff', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_payroll_cutoff', { cutoff_id: deleteTarget.cutoff_id });
      if (error) throw error;
      showToast('Cutoff deleted', 'success');
      setDeleteTarget(null);
      fetchCutoffs();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - 1 + i);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Payroll Cutoffs</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} cutoff period{total !== 1 ? 's' : ''} for {yearFilter}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Cutoff
          </button>
        </div>
      </div>

      {/* Year Filter */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">Year</label>
          <select
            value={yearFilter}
            onChange={e => setYearFilter(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {yearOptions.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : cutoffs.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No cutoffs found for {yearFilter}</p>
            <p className="text-xs mt-1">Click "Add Cutoff" to create a payroll period.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Period Name</th>
                  <th className="px-4 py-3 text-left">From</th>
                  <th className="px-4 py-3 text-left">To</th>
                  <th className="px-4 py-3 text-center">Seq</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cutoffs.map(c => (
                  <tr key={c.cutoff_id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{c.period_name}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(c.date_from)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(c.date_to)}</td>
                    <td className="px-4 py-3 text-center text-slate-500">{c.cutoff_seq}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(c.status)}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {c.status === 'Finalized' ? (
                          <span className="p-1.5 text-slate-400" title="Finalized — locked">
                            <Lock className="w-4 h-4" />
                          </span>
                        ) : (
                          <button
                            onClick={() => openEdit(c)}
                            title="Edit"
                            className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/payroll/processing?cutoff_id=${c.cutoff_id}`)}
                          title="Process Payroll"
                          className="p-1.5 rounded hover:bg-green-50 text-green-600"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                        {c.status !== 'Finalized' && (
                          <button onClick={() => setDeleteTarget(c)} title="Delete" className="p-1.5 rounded hover:bg-red-50 text-red-500">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
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
        title={form.cutoff_id ? 'Edit Cutoff' : 'Add Cutoff'}
        size="md"
      >
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Period Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.period_name}
              onChange={e => set('period_name', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Jan 2025 - 1st Half"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Date From <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={form.date_from}
                onChange={e => set('date_from', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Date To <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={form.date_to}
                onChange={e => set('date_to', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Payroll Month <span className="text-red-500">*</span>
              </label>
              <select
                value={form.payroll_month}
                onChange={e => set('payroll_month', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select month…</option>
                {MONTH_NAMES.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m} ({i + 1})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Payroll Year <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={form.payroll_year}
                onChange={e => set('payroll_year', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. 2025"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Cutoff Seq</label>
              <select
                value={form.cutoff_seq}
                onChange={e => set('cutoff_seq', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="1">1 — 1st Half</option>
                <option value="2">2 — 2nd Half</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select
                value={form.status}
                onChange={e => set('status', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>Open</option>
                <option>Processing</option>
                <option>Finalized</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional notes…"
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
              {saving ? 'Saving…' : 'Save Cutoff'}
            </button>
          </div>
        </div>
      </InvModal>

      {/* Delete Confirmation Modal */}
      <InvModal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Cutoff" size="sm">
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-800">Delete this cutoff?</p>
              <p className="text-sm text-slate-600 mt-1">{deleteTarget?.period_name}</p>
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
