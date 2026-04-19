import { useState, useEffect, useCallback } from 'react';
import { Pencil, Trash2, MapPin } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvLocation } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import InvPageHeader from '../components/InvPageHeader';
import InvTable from '../components/InvTable';
import InvModal from '../components/InvModal';
import StatusBadge from '../components/StatusBadge';

const PAGE_SIZE = 20;
const EMPTY_FORM = { code: '', name: '', address: '', city: '', phone: '', manager_name: '', is_active: true };

export default function InvLocationsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [rows, setRows] = useState<InvLocation[]>([]);
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
    const { data, error } = await supabase.from('inv_locations').select('*').order('name');
    if (error) showToast('Failed to load locations', 'error');
    const allRows: InvLocation[] = (data ?? []) as InvLocation[];
    const searchTerm = search.trim().toLowerCase();
    const filteredRows = searchTerm
      ? allRows.filter((row: InvLocation) =>
          row.name.toLowerCase().includes(searchTerm) ||
          row.code.toLowerCase().includes(searchTerm) ||
          row.city.toLowerCase().includes(searchTerm),
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
  function openEdit(r: InvLocation) {
    setEditId(r.id);
    setForm({ code: r.code, name: r.name, address: r.address, city: r.city, phone: r.phone, manager_name: r.manager_name, is_active: r.is_active });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.code.trim() || !form.name.trim()) { showToast('Code and Name are required', 'error'); return; }
    setSaving(true);
    const payload = { ...form, code: form.code.toUpperCase().trim(), name: form.name.trim(), updated_at: new Date().toISOString() };
    let error;
    if (editId) ({ error } = await supabase.from('inv_locations').update(payload).eq('id', editId));
    else ({ error } = await supabase.from('inv_locations').insert({ ...payload, created_by: user?.id }));
    setSaving(false);
    if (error) { showToast(error.code === '23505' ? 'Location code already exists' : error.message, 'error'); return; }
    showToast(editId ? 'Location updated' : 'Location created', 'success');
    setModalOpen(false);
    fetchData();
  }

  async function handleDelete() {
    if (!deleteId) return;
    const { error } = await supabase.from('inv_locations').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) { showToast('Failed to delete location', 'error'); return; }
    showToast('Location deleted', 'success');
    fetchData();
  }

  const f = (key: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  const columns = [
    { key: 'code', label: 'Code', render: (r: InvLocation) => <span className="font-mono text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{r.code}</span> },
    { key: 'name', label: 'Location Name', render: (r: InvLocation) => (
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 bg-teal-50 rounded-lg flex items-center justify-center flex-shrink-0">
          <MapPin className="w-3.5 h-3.5 text-teal-600" />
        </div>
        <span className="font-medium text-slate-800">{r.name}</span>
      </div>
    )},
    { key: 'city', label: 'City' },
    { key: 'phone', label: 'Phone' },
    { key: 'manager_name', label: 'Manager' },
    { key: 'is_active', label: 'Status', render: (r: InvLocation) => <StatusBadge active={r.is_active} /> },
    { key: 'actions', label: '', className: 'w-20', render: (r: InvLocation) => (
      <div className="flex items-center gap-1">
        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
        <button onClick={() => setDeleteId(r.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    )},
  ];

  return (
    <div className="p-6">
      <InvPageHeader title="Locations" subtitle="Store branches and locations" search={search} onSearch={setSearch} onAdd={openAdd} addLabel="Add Location" />
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <InvTable columns={columns} data={rows} keyField="id" page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} loading={loading} emptyMessage="No locations found." />
      </div>

      <InvModal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Location' : 'Add Location'} size="md">
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Code <span className="text-red-500">*</span></label>
              <input value={form.code} onChange={f('code')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase font-mono" placeholder="MAIN" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Location Name <span className="text-red-500">*</span></label>
              <input value={form.name} onChange={f('name')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Branch name" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Address</label>
            <input value={form.address} onChange={f('address')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">City</label>
              <input value={form.city} onChange={f('city')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Phone</label>
              <input value={form.phone} onChange={f('phone')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Manager Name</label>
              <input value={form.manager_name} onChange={f('manager_name')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
                <span className="text-sm text-slate-700">Active</span>
              </label>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-white transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors">{saving ? 'Saving...' : editId ? 'Update' : 'Add Location'}</button>
        </div>
      </InvModal>

      <InvModal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Location" size="sm">
        <div className="p-6">
          <p className="text-sm text-slate-600 mb-6">Delete this location?</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handleDelete} className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button>
          </div>
        </div>
      </InvModal>
    </div>
  );
}
