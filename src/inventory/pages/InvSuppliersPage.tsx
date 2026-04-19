import { useState, useEffect, useCallback } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvSupplier } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import InvPageHeader from '../components/InvPageHeader';
import InvTable from '../components/InvTable';
import InvModal from '../components/InvModal';
import StatusBadge from '../components/StatusBadge';

const PAGE_SIZE = 20;

const EMPTY_FORM = {
  code: '', name: '', contact_person: '', phone: '',
  email: '', address: '', city: '', terms: '', notes: '', is_active: true,
};

export default function InvSuppliersPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [rows, setRows] = useState<InvSupplier[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('suppliers').select('*').order('name');
    if (error) showToast('Failed to load suppliers', 'error');
    const allRows: InvSupplier[] = (data ?? []) as InvSupplier[];
    const searchTerm = search.trim().toLowerCase();
    const filteredRows = searchTerm
      ? allRows.filter((row: InvSupplier) =>
          row.name.toLowerCase().includes(searchTerm) ||
          row.code.toLowerCase().includes(searchTerm) ||
          row.contact_person.toLowerCase().includes(searchTerm),
        )
      : allRows;
    const from = (page - 1) * PAGE_SIZE;
    setRows(filteredRows.slice(from, from + PAGE_SIZE));
    setTotal(filteredRows.length);
    setLoading(false);
  }, [page, search, showToast]);

  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => { fetch(); }, [fetch]);

  function openAdd() { setEditId(null); setForm(EMPTY_FORM); setModalOpen(true); }
  function openEdit(r: InvSupplier) {
    setEditId(r.id);
    setForm({ code: r.code, name: r.name, contact_person: r.contact_person, phone: r.phone, email: r.email, address: r.address, city: r.city, terms: r.terms, notes: r.notes, is_active: r.is_active });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.code.trim() || !form.name.trim()) { showToast('Code and Name are required', 'error'); return; }
    setSaving(true);
    const payload = { ...form, code: form.code.toUpperCase().trim(), name: form.name.trim(), updated_at: new Date().toISOString() };
    let error;
    if (editId) ({ error } = await supabase.from('suppliers').update(payload).eq('id', editId));
    else ({ error } = await supabase.from('suppliers').insert({ ...payload, created_by: user?.id }));
    setSaving(false);
    if (error) { showToast(error.code === '23505' ? 'Supplier code already exists' : error.message, 'error'); return; }
    showToast(editId ? 'Supplier updated' : 'Supplier created', 'success');
    setModalOpen(false);
    fetch();
  }

  async function handleDelete() {
    if (!deleteId) return;
    const { error } = await supabase.from('suppliers').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) { showToast('Failed to delete supplier', 'error'); return; }
    showToast('Supplier deleted', 'success');
    fetch();
  }

  const f = (key: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  const columns = [
    { key: 'code', label: 'Code', render: (r: InvSupplier) => <span className="font-mono text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{r.code}</span> },
    { key: 'name', label: 'Supplier Name', render: (r: InvSupplier) => <span className="font-medium text-slate-800">{r.name}</span> },
    { key: 'contact_person', label: 'Contact Person' },
    { key: 'phone', label: 'Phone' },
    { key: 'city', label: 'City' },
    { key: 'terms', label: 'Terms' },
    { key: 'is_active', label: 'Status', render: (r: InvSupplier) => <StatusBadge active={r.is_active} /> },
    { key: 'actions', label: '', className: 'w-20', render: (r: InvSupplier) => (
      <div className="flex items-center gap-1">
        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
        <button onClick={() => setDeleteId(r.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    )},
  ];

  return (
    <div className="p-6">
      <InvPageHeader title="Suppliers" subtitle="Manage inventory suppliers" search={search} onSearch={setSearch} onAdd={openAdd} addLabel="Add Supplier" />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <InvTable columns={columns} data={rows} keyField="id" page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} loading={loading} emptyMessage="No suppliers found." />
      </div>

      <InvModal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Supplier' : 'Add Supplier'} size="lg">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Code <span className="text-red-500">*</span></label>
              <input value={form.code} onChange={f('code')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase font-mono" placeholder="SUP-001" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Supplier Name <span className="text-red-500">*</span></label>
              <input value={form.name} onChange={f('name')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Supplier company name" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Contact Person</label>
              <input value={form.contact_person} onChange={f('contact_person')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Phone</label>
              <input value={form.phone} onChange={f('phone')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={f('email')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">City</label>
              <input value={form.city} onChange={f('city')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Address</label>
            <input value={form.address} onChange={f('address')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Payment Terms</label>
              <input value={form.terms} onChange={f('terms')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Net 30, COD" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer mb-1">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
                <span className="text-sm text-slate-700">Active</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
            <textarea value={form.notes} onChange={f('notes')} rows={2} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-white transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors">{saving ? 'Saving...' : editId ? 'Update' : 'Add Supplier'}</button>
        </div>
      </InvModal>

      <InvModal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Supplier" size="sm">
        <div className="p-6">
          <p className="text-sm text-slate-600 mb-6">Delete this supplier? Products linked to this supplier will become unlinked.</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handleDelete} className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button>
          </div>
        </div>
      </InvModal>
    </div>
  );
}

