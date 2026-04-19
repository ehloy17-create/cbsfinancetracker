import { useCallback, useEffect, useState } from 'react';
import { PlusCircle, Pencil, Trash2, X, Save, TrendingUp, TrendingDown, DollarSign, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { DailySales } from '../lib/types';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { formatCurrency, getTodayDateString } from '../lib/utils';
import ConfirmDialog from '../components/ConfirmDialog';

const emptyForm = {
  date: getTodayDateString(),
  sales: '',
  cost_of_sales: '',
  description: '',
  notes: '',
};

function fmt(n: number) {
  return `₱${formatCurrency(n)}`;
}

function profitColor(n: number) {
  if (n > 0) return 'text-emerald-600';
  if (n < 0) return 'text-red-600';
  return 'text-slate-500';
}

export default function SalesPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [rows, setRows] = useState<DailySales[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('daily_sales')
      .select('*')
      .eq('is_deleted', false)
      .order('date', { ascending: false });
    if (error) showToast(error.message, 'error');
    else setRows((data ?? []) as DailySales[]);
    setLoading(false);
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  function openAdd() {
    setForm({ ...emptyForm, date: getTodayDateString() });
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(row: DailySales) {
    setForm({
      date: row.date,
      sales: String(row.sales ?? ''),
      cost_of_sales: String(row.cost_of_sales ?? ''),
      description: row.description ?? '',
      notes: row.notes ?? '',
    });
    setEditId(row.id);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm);
  }

  async function handleSave() {
    if (!form.date) { showToast('Date is required', 'warning'); return; }
    const salesNum = parseFloat(form.sales);
    const costNum = parseFloat(form.cost_of_sales);
    if (isNaN(salesNum) || salesNum < 0) { showToast('Enter a valid sales amount', 'warning'); return; }
    if (isNaN(costNum) || costNum < 0) { showToast('Enter a valid cost amount', 'warning'); return; }

    setSaving(true);
    try {
      const payload = {
        date: form.date,
        sales: salesNum,
        cost_of_sales: costNum,
        description: form.description.trim(),
        notes: form.notes.trim(),
        updated_at: new Date().toISOString(),
      };

      if (editId) {
        const { error } = await supabase.from('daily_sales').update(payload).eq('id', editId);
        if (error) throw new Error(error.message);
        showToast('Entry updated', 'success');
      } else {
        const { error } = await supabase.from('daily_sales').insert({
          ...payload,
          created_by: user?.id ?? null,
          is_deleted: false,
        });
        if (error) {
          if (error.message?.includes('unique') || error.message?.includes('duplicate') || error.code === '23505') {
            throw new Error('An entry for this date already exists. Edit the existing one instead.');
          }
          throw new Error(error.message);
        }
        showToast('Entry added', 'success');
      }

      closeForm();
      void load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const { error } = await supabase
      .from('daily_sales')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) showToast(error.message, 'error');
    else { showToast('Entry deleted', 'success'); void load(); }
    setDeleteId(null);
  }

  const totalSales = rows.reduce((s, r) => s + Number(r.sales || 0), 0);
  const totalCost = rows.reduce((s, r) => s + Number(r.cost_of_sales || 0), 0);
  const totalProfit = totalSales - totalCost;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Daily Sales Entry</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manually record daily sales and cost figures.</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
        >
          <PlusCircle className="w-4 h-4" />
          Add Entry
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <DollarSign className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Total Sales</p>
            <p className="text-lg font-bold text-slate-800 font-mono">{fmt(totalSales)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <TrendingDown className="w-4 h-4 text-red-500" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Total Cost</p>
            <p className="text-lg font-bold text-slate-800 font-mono">{fmt(totalCost)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${totalProfit >= 0 ? 'bg-emerald-100' : 'bg-red-100'}`}>
            <TrendingUp className={`w-4 h-4 ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`} />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Gross Profit</p>
            <p className={`text-lg font-bold font-mono ${profitColor(totalProfit)}`}>{fmt(totalProfit)}</p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <FileText className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">No entries yet</p>
            <p className="text-xs mt-1">Click "Add Entry" to record your first daily sales.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Sales</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Cost</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Gross Profit</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Description</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(row => {
                const salesAmt = Number(row.sales || 0);
                const costAmt = Number(row.cost_of_sales || 0);
                const profit = salesAmt - costAmt;
                const margin = salesAmt > 0 ? (profit / salesAmt) * 100 : 0;
                return (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                      {new Date(row.date + 'T00:00:00').toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800">{fmt(salesAmt)}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-600">{fmt(costAmt)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-mono font-semibold ${profitColor(profit)}`}>{fmt(profit)}</span>
                      {salesAmt > 0 && (
                        <span className={`ml-1.5 text-xs ${profitColor(profit)}`}>({margin.toFixed(1)}%)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{row.description || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(row)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteId(row.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-800">
                {editId ? 'Edit Daily Sales Entry' : 'Add Daily Sales Entry'}
              </h2>
              <button onClick={closeForm} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Date *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={e => setForm({ ...form, date: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Sales *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={form.sales}
                      onChange={e => setForm({ ...form, sales: e.target.value })}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Cost *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={form.cost_of_sales}
                      onChange={e => setForm({ ...form, cost_of_sales: e.target.value })}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-slate-300 pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                  </div>
                </div>
              </div>
              {(parseFloat(form.sales) > 0 || parseFloat(form.cost_of_sales) > 0) && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-2.5 flex items-center justify-between text-sm">
                  <span className="text-slate-600">Gross Profit</span>
                  <span className={`font-mono font-semibold ${profitColor((parseFloat(form.sales) || 0) - (parseFloat(form.cost_of_sales) || 0))}`}>
                    {fmt((parseFloat(form.sales) || 0) - (parseFloat(form.cost_of_sales) || 0))}
                  </span>
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Description</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional label for this entry"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional notes"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4">
              <button onClick={closeForm} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {editId ? 'Save Changes' : 'Add Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Entry"
        message="Are you sure you want to delete this daily sales entry? This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteId && handleDelete(deleteId)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
