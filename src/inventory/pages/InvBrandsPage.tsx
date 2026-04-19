import { useState, useEffect, useCallback } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvBrand } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import InvPageHeader from '../components/InvPageHeader';
import InvTable from '../components/InvTable';
import InvModal from '../components/InvModal';
import StatusBadge from '../components/StatusBadge';

const PAGE_SIZE = 25;
const EMPTY_FORM = { name: '', description: '', is_active: true };

export default function InvBrandsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [rows, setRows] = useState<InvBrand[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('inv_brands').select('*');
    if (search.trim()) q = q.ilike('name', `%${search}%`);
    q = q.order('name');
    const { data, error } = await q;
    if (error) showToast('Failed to load brands', 'error');
    const allRows = data ?? [];
    const from = (page - 1) * PAGE_SIZE;
    setRows(allRows.slice(from, from + PAGE_SIZE));
    setTotal(allRows.length);
    setLoading(false);
  }, [page, search, showToast]);

  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => { fetchData(); }, [fetchData]);

  function openAdd() { setEditId(null); setForm(EMPTY_FORM); setModalOpen(true); }
  function openEdit(r: InvBrand) {
    setEditId(r.id);
    setForm({ name: r.name, description: r.description, is_active: r.is_active });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { showToast('Brand name is required', 'error'); return; }
    setSaving(true);
    const payload = { name: form.name.trim(), description: form.description.trim(), is_active: form.is_active, updated_at: new Date().toISOString() };
    let error;
    if (editId) ({ error } = await supabase.from('inv_brands').update(payload).eq('id', editId));
    else ({ error } = await supabase.from('inv_brands').insert({ ...payload, created_by: user?.id }));
    setSaving(false);
    if (error) { showToast(error.code === '23505' ? 'Brand name already exists' : error.message, 'error'); return; }
    showToast(editId ? 'Brand updated' : 'Brand created', 'success');
    setModalOpen(false);
    fetchData();
  }

  async function handleDelete() {
    if (!deleteId) return;
    const { error } = await supabase.from('inv_brands').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) { showToast('Failed to delete brand', 'error'); return; }
    showToast('Brand deleted', 'success');
    fetchData();
  }

  const columns = [
    { key: 'name', label: 'Brand Name', render: (r: InvBrand) => <span className="font-medium text-slate-800">{r.name}</span> },
    { key: 'description', label: 'Description', render: (r: InvBrand) => <span className="text-slate-500">{r.description || '—'}</span> },
    { key: 'is_active', label: 'Status', render: (r: InvBrand) => <StatusBadge active={r.is_active} /> },
    { key: 'actions', label: '', className: 'w-20', render: (r: InvBrand) => (
      <div className="flex items-center gap-1">
        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
        <button onClick={() => setDeleteId(r.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    )},
  ];

  return (
    <div className="p-6">
      <InvPageHeader title="Brands" subtitle="Product brands and manufacturers" search={search} onSearch={setSearch} onAdd={openAdd} addLabel="Add Brand" />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <InvTable columns={columns} data={rows} keyField="id" page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} loading={loading} emptyMessage="No brands found." />
      </div>

      <InvModal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Brand' : 'Add Brand'} size="sm">
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Brand Name <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Nestlé" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
            <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
            <span className="text-sm text-slate-700">Active</span>
          </label>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-white transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors">{saving ? 'Saving...' : editId ? 'Update' : 'Add Brand'}</button>
        </div>
      </InvModal>

      <InvModal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Brand" size="sm">
        <div className="p-6">
          <p className="text-sm text-slate-600 mb-6">Delete this brand? Products linked to it will become unlinked.</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handleDelete} className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button>
          </div>
        </div>
      </InvModal>
    </div>
  );
}
