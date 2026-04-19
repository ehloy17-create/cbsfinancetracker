import { useState, useEffect, useCallback } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvUnit } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import InvPageHeader from '../components/InvPageHeader';
import InvTable from '../components/InvTable';
import InvModal from '../components/InvModal';
import StatusBadge from '../components/StatusBadge';

const PAGE_SIZE = 25;
const EMPTY_FORM = { code: '', name: '', description: '', is_active: true };

export default function InvUnitsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [rows, setRows] = useState<InvUnit[]>([]);
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
    const { data, error } = await supabase.from('inv_units').select('*').order('name');
    if (error) showToast('Failed to load units', 'error');
    const allRows: InvUnit[] = (data ?? []) as InvUnit[];
    const searchTerm = search.trim().toLowerCase();
    const filteredRows = searchTerm
      ? allRows.filter((row: InvUnit) =>
          row.name.toLowerCase().includes(searchTerm) ||
          row.code.toLowerCase().includes(searchTerm),
        )
      : allRows;
    const from = (page - 1) * PAGE_SIZE;
    setRows(filteredRows.slice(from, from + PAGE_SIZE));
    setTotal(filteredRows.length);
    setLoading(false);
  }, [page, search, showToast]);

  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => { fetchData(); }, [fetchData]);

  function openAdd() { setEditId(null); setForm(EMPTY_FORM); setModalOpen(true); }
  function openEdit(r: InvUnit) {
    setEditId(r.id);
    setForm({ code: r.code, name: r.name, description: r.description ?? '', is_active: r.is_active });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.code.trim() || !form.name.trim()) { showToast('Code and Name are required', 'error'); return; }
    setSaving(true);
    const payload = { code: form.code.toUpperCase().trim(), name: form.name.trim(), description: form.description.trim(), is_active: form.is_active, updated_at: new Date().toISOString() };
    let error;
    if (editId) ({ error } = await supabase.from('inv_units').update(payload).eq('id', editId));
    else ({ error } = await supabase.from('inv_units').insert({ ...payload, created_by: user?.id }));
    setSaving(false);
    if (error) { showToast(error.code === '23505' ? 'Unit code already exists' : error.message, 'error'); return; }
    showToast(editId ? 'Unit updated' : 'Unit created', 'success');
    setModalOpen(false);
    fetchData();
  }

  async function handleDelete() {
    if (!deleteId) return;
    const { error } = await supabase.from('inv_units').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) { showToast('Cannot delete unit — products are linked to it', 'error'); return; }
    showToast('Unit deleted', 'success');
    fetchData();
  }

  const columns = [
    { key: 'code', label: 'Code', render: (r: InvUnit) => <span className="font-mono text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-semibold">{r.code}</span> },
    { key: 'name', label: 'Unit Name', render: (r: InvUnit) => <span className="font-medium text-slate-800">{r.name}</span> },
    { key: 'description', label: 'Description', render: (r: InvUnit) => <span className="text-slate-500">{r.description || '—'}</span> },
    { key: 'is_active', label: 'Status', render: (r: InvUnit) => <StatusBadge active={r.is_active} /> },
    { key: 'actions', label: '', className: 'w-20', render: (r: InvUnit) => (
      <div className="flex items-center gap-1">
        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
        <button onClick={() => setDeleteId(r.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    )},
  ];

  return (
    <div className="p-6">
      <InvPageHeader title="Units of Measure" subtitle="Units used for product quantities" search={search} onSearch={setSearch} onAdd={openAdd} addLabel="Add Unit" />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <InvTable columns={columns} data={rows} keyField="id" page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} loading={loading} emptyMessage="No units found." />
      </div>

      <InvModal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Unit' : 'Add Unit'} size="sm">
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Code <span className="text-red-500">*</span></label>
            <input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase font-mono" placeholder="PC" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Unit Name <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Piece" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
            <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Individual unit" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
            <span className="text-sm text-slate-700">Active</span>
          </label>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-white transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors">{saving ? 'Saving...' : editId ? 'Update' : 'Add Unit'}</button>
        </div>
      </InvModal>

      <InvModal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Unit" size="sm">
        <div className="p-6">
          <p className="text-sm text-slate-600 mb-6">Delete this unit of measure?</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handleDelete} className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button>
          </div>
        </div>
      </InvModal>
    </div>
  );
}
