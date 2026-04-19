import { useState, useEffect } from 'react';
import { Building2, Plus, Edit2, Briefcase, Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import InvModal from '../../inventory/components/InvModal';

interface Department {
  department_id: number;
  name: string;
  description: string;
  is_active: number | boolean;
}

interface Position {
  position_id: number;
  name: string;
  department_id: number;
  description: string;
  is_active: number | boolean;
}

interface DeptForm {
  department_id: number | null;
  name: string;
  description: string;
  is_active: boolean;
}

interface PosForm {
  position_id: number | null;
  name: string;
  department_id: string;
  description: string;
  is_active: boolean;
}

const EMPTY_DEPT: DeptForm = { department_id: null, name: '', description: '', is_active: true };
const EMPTY_POS: PosForm = { position_id: null, name: '', department_id: '', description: '', is_active: true };

export default function DepartmentsPage() {
  const { showToast } = useToast();

  const [tab, setTab] = useState<'departments' | 'positions'>('departments');

  // Departments state
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptLoading, setDeptLoading] = useState(false);
  const [deptModal, setDeptModal] = useState(false);
  const [deptForm, setDeptForm] = useState<DeptForm>(EMPTY_DEPT);
  const [deptSaving, setDeptSaving] = useState(false);
  const [deleteDept, setDeleteDept] = useState<Department | null>(null);
  const [deletingDept, setDeletingDept] = useState(false);

  // Positions state
  const [positions, setPositions] = useState<Position[]>([]);
  const [posLoading, setPosLoading] = useState(false);
  const [posModal, setPosModal] = useState(false);
  const [posForm, setPosForm] = useState<PosForm>(EMPTY_POS);
  const [posSaving, setPosSaving] = useState(false);
  const [deletePos, setDeletePos] = useState<Position | null>(null);
  const [deletingPos, setDeletingPos] = useState(false);

  const fetchDepartments = async () => {
    setDeptLoading(true);
    try {
      const { data, error } = await supabase.from('hr_departments').select('*').order('name');
      if (error) throw error;
      setDepartments((data as Department[]) ?? []);
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to load departments', 'error');
    } finally {
      setDeptLoading(false);
    }
  };

  const fetchPositions = async () => {
    setPosLoading(true);
    try {
      const { data, error } = await supabase.from('hr_positions').select('*').order('name');
      if (error) throw error;
      setPositions((data as Position[]) ?? []);
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to load positions', 'error');
    } finally {
      setPosLoading(false);
    }
  };

  useEffect(() => {
    fetchDepartments();
    fetchPositions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Department helpers
  const setDept = (field: keyof DeptForm, value: unknown) =>
    setDeptForm(prev => ({ ...prev, [field]: value }));

  const openAddDept = () => {
    setDeptForm(EMPTY_DEPT);
    setDeptModal(true);
  };

  const openEditDept = (d: Department) => {
    setDeptForm({
      department_id: d.department_id,
      name: d.name,
      description: d.description ?? '',
      is_active: !!d.is_active,
    });
    setDeptModal(true);
  };

  const saveDept = async () => {
    if (!deptForm.name.trim()) {
      showToast('Department name is required', 'error');
      return;
    }
    setDeptSaving(true);
    try {
      const payload = {
        name: deptForm.name.trim(),
        description: deptForm.description.trim(),
        is_active: deptForm.is_active ? 1 : 0,
      };
      if (deptForm.department_id) {
        const { error } = await supabase
          .from('hr_departments')
          .update(payload)
          .eq('department_id', deptForm.department_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('hr_departments').insert([payload]);
        if (error) throw error;
      }
      showToast(`Department ${deptForm.department_id ? 'updated' : 'created'} successfully`, 'success');
      setDeptModal(false);
      fetchDepartments();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to save department', 'error');
    } finally {
      setDeptSaving(false);
    }
  };

  // Position helpers
  const setPos = (field: keyof PosForm, value: unknown) =>
    setPosForm(prev => ({ ...prev, [field]: value }));

  const openAddPos = () => {
    setPosForm(EMPTY_POS);
    setPosModal(true);
  };

  const openEditPos = (p: Position) => {
    setPosForm({
      position_id: p.position_id,
      name: p.name,
      department_id: p.department_id ? String(p.department_id) : '',
      description: p.description ?? '',
      is_active: !!p.is_active,
    });
    setPosModal(true);
  };

  const savePos = async () => {
    if (!posForm.name.trim()) {
      showToast('Position name is required', 'error');
      return;
    }
    setPosSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: posForm.name.trim(),
        department_id: posForm.department_id ? parseInt(posForm.department_id) : null,
        description: posForm.description.trim(),
        is_active: posForm.is_active ? 1 : 0,
      };
      if (posForm.position_id) {
        const { error } = await supabase
          .from('hr_positions')
          .update(payload)
          .eq('position_id', posForm.position_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('hr_positions').insert([payload]);
        if (error) throw error;
      }
      showToast(`Position ${posForm.position_id ? 'updated' : 'created'} successfully`, 'success');
      setPosModal(false);
      fetchPositions();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to save position', 'error');
    } finally {
      setPosSaving(false);
    }
  };

  const getDeptName = (departmentId: number) =>
    departments.find(d => d.department_id === departmentId)?.name ?? '—';

  const handleDeleteDept = async () => {
    if (!deleteDept) return;
    setDeletingDept(true);
    try {
      const { error } = await supabase.rpc('delete_department', { department_id: deleteDept.department_id });
      if (error) throw error;
      showToast('Department deleted', 'success');
      setDeleteDept(null);
      fetchDepartments();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Delete failed', 'error');
    } finally {
      setDeletingDept(false);
    }
  };

  const handleDeletePos = async () => {
    if (!deletePos) return;
    setDeletingPos(true);
    try {
      const { error } = await supabase.rpc('delete_position', { position_id: deletePos.position_id });
      if (error) throw error;
      showToast('Position deleted', 'success');
      setDeletePos(null);
      fetchPositions();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Delete failed', 'error');
    } finally {
      setDeletingPos(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Departments & Positions</h1>
        <button
          onClick={tab === 'departments' ? openAddDept : openAddPos}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          {tab === 'departments' ? 'Add Department' : 'Add Position'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        <button
          onClick={() => setTab('departments')}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'departments'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Departments
        </button>
        <button
          onClick={() => setTab('positions')}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'positions'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          <Briefcase className="w-4 h-4" />
          Positions
        </button>
      </div>

      {/* Departments Tab */}
      {tab === 'departments' && (
        <div className="bg-white border border-slate-200 rounded-xl">
          {deptLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : departments.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No departments yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map(d => (
                    <tr key={d.department_id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{d.name}</td>
                      <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{d.description || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        {d.is_active ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">Inactive</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEditDept(d)}
                            title="Edit"
                            className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDeleteDept(d)} title="Delete" className="p-1.5 rounded hover:bg-red-50 text-red-500">
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
      )}

      {/* Positions Tab */}
      {tab === 'positions' && (
        <div className="bg-white border border-slate-200 rounded-xl">
          {posLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : positions.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Briefcase className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No positions yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Department</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map(p => (
                    <tr key={p.position_id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                      <td className="px-4 py-3 text-slate-600">{getDeptName(p.department_id)}</td>
                      <td className="px-4 py-3 text-center">
                        {p.is_active ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">Inactive</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEditPos(p)}
                            title="Edit"
                            className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDeletePos(p)} title="Delete" className="p-1.5 rounded hover:bg-red-50 text-red-500">
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
      )}

      {/* Department Modal */}
      <InvModal
        open={deptModal}
        onClose={() => setDeptModal(false)}
        title={deptForm.department_id ? 'Edit Department' : 'Add Department'}
        size="sm"
      >
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={deptForm.name}
              onChange={e => setDept('name', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Operations"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              rows={2}
              value={deptForm.description}
              onChange={e => setDept('description', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="dept_is_active"
              checked={deptForm.is_active}
              onChange={e => setDept('is_active', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="dept_is_active" className="text-sm font-medium text-slate-700">Active</label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setDeptModal(false)}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={saveDept}
              disabled={deptSaving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {deptSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </InvModal>

      {/* Position Modal */}
      <InvModal
        open={posModal}
        onClose={() => setPosModal(false)}
        title={posForm.position_id ? 'Edit Position' : 'Add Position'}
        size="sm"
      >
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={posForm.name}
              onChange={e => setPos('name', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Cashier"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Department</label>
            <select
              value={posForm.department_id}
              onChange={e => setPos('department_id', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select Department…</option>
              {departments.filter(d => d.is_active).map(d => (
                <option key={d.department_id} value={d.department_id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              rows={2}
              value={posForm.description}
              onChange={e => setPos('description', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="pos_is_active"
              checked={posForm.is_active}
              onChange={e => setPos('is_active', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="pos_is_active" className="text-sm font-medium text-slate-700">Active</label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setPosModal(false)}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={savePos}
              disabled={posSaving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {posSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </InvModal>

      {/* Delete Department Modal */}
      <InvModal open={!!deleteDept} onClose={() => setDeleteDept(null)} title="Delete Department" size="sm">
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-800">Delete this department?</p>
              <p className="text-sm text-slate-600 mt-1">{deleteDept?.name}</p>
              <p className="text-xs text-red-600 mt-2">This action cannot be undone.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setDeleteDept(null)} className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handleDeleteDept} disabled={deletingDept} className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-60">
              {deletingDept ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </InvModal>

      {/* Delete Position Modal */}
      <InvModal open={!!deletePos} onClose={() => setDeletePos(null)} title="Delete Position" size="sm">
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-800">Delete this position?</p>
              <p className="text-sm text-slate-600 mt-1">{deletePos?.name}</p>
              <p className="text-xs text-red-600 mt-2">This action cannot be undone.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setDeletePos(null)} className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handleDeletePos} disabled={deletingPos} className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-60">
              {deletingPos ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </InvModal>
    </div>
  );
}
