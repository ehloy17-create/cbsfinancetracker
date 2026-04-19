import { useState, useEffect, useCallback } from 'react';
import { Truck, Plus, Pencil, Trash2, Search, X, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Supplier } from '../lib/types';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import ConfirmDialog from '../components/ConfirmDialog';

const EMPTY_SUPPLIER = { name: '', contact_person: '', phone: '', address: '', notes: '' };

export default function SuppliersPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Supplier | null>(null);
  const [form, setForm] = useState(EMPTY_SUPPLIER);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('suppliers').select('*').eq('is_active', true).order('name');
    setSuppliers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditTarget(null);
    setForm(EMPTY_SUPPLIER);
    setShowForm(true);
  }

  function openEdit(s: Supplier) {
    setEditTarget(s);
    setForm({ name: s.name, contact_person: s.contact_person, phone: s.phone, address: s.address, notes: s.notes });
    setShowForm(true);
  }

  async function saveSupplier() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editTarget) {
        await supabase.from('suppliers').update({
          ...form,
          updated_at: new Date().toISOString(),
        }).eq('id', editTarget.id);
        await writeAuditLog(user?.id ?? null, 'UPDATE', 'Suppliers', editTarget.id, { name: form.name });
        showToast('Supplier updated', 'success');
      } else {
        await supabase.from('suppliers').insert({ ...form, created_by: user?.id });
        await writeAuditLog(user?.id ?? null, 'INSERT', 'Suppliers', undefined, { name: form.name });
        showToast('Supplier added', 'success');
      }
      setShowForm(false);
      load();
    } catch {
      showToast('Failed to save supplier', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function deleteSupplier() {
    if (!deleteTarget) return;
    await supabase.from('suppliers').update({ is_active: false }).eq('id', deleteTarget);
    await writeAuditLog(user?.id ?? null, 'DELETE', 'Suppliers', deleteTarget, {});
    showToast('Supplier removed', 'success');
    setDeleteTarget(null);
    load();
  }

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.contact_person.toLowerCase().includes(search.toLowerCase())
  );

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
          <h1 className="text-2xl font-bold text-slate-800">Suppliers</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage check recipients and payees</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add Supplier
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search suppliers..."
          className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      </div>

      {/* Supplier List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <Truck className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">No suppliers found</p>
            <p className="text-xs mt-1">Add suppliers to use them when issuing checks</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {filtered.map(s => (
              <div key={s.id} className="px-5 py-4 flex items-start gap-4 group hover:bg-slate-50 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Truck className="w-5 h-5 text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{s.name}</p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {s.contact_person && <p className="text-xs text-slate-500">{s.contact_person}</p>}
                    {s.phone && <p className="text-xs text-slate-400">{s.phone}</p>}
                  </div>
                  {s.address && <p className="text-xs text-slate-400 mt-0.5 truncate">{s.address}</p>}
                  {s.notes && <p className="text-xs text-slate-400 italic mt-0.5 truncate">{s.notes}</p>}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={() => openEdit(s)}
                    className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(s.id)}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowForm(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">
                {editTarget ? 'Edit Supplier' : 'Add Supplier'}
              </h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Supplier Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Company or individual name"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Contact Person</label>
                  <input
                    type="text"
                    value={form.contact_person}
                    onChange={e => setForm(p => ({ ...p, contact_person: e.target.value }))}
                    placeholder="Optional"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Phone</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder="Optional"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Address</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                  placeholder="Optional"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional"
                  rows={2}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={saveSupplier}
                  disabled={saving || !form.name.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                  {editTarget ? 'Save Changes' : 'Add Supplier'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove Supplier"
        message="This supplier will be deactivated. Existing checks and disbursements will retain the reference."
        confirmLabel="Remove"
        danger
        onConfirm={deleteSupplier}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
