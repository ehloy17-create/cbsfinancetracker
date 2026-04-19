import { useState, useEffect, useCallback, useMemo } from 'react';
import { Clock, Plus, Edit2, AlertCircle, Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../lib/utils';
import InvModal from '../../inventory/components/InvModal';

interface Cutoff {
  cutoff_id: string;
  period_name: string;
  date_from: string;
  date_to: string;
}

interface Employee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
}

interface AttendanceRecord {
  id: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  work_date: string;
  cutoff_id: string;
  time_in: string | null;
  time_out: string | null;
  hours_worked: number;
  late_minutes: number;
  undertime_minutes: number;
  overtime_hours: number;
  is_absent: number | boolean;
  is_rest_day: number | boolean;
  holiday_type: string;
  holiday_name: string | null;
  remarks: string | null;
  source: string | null;
}

interface AttendanceForm {
  id: string | null;
  employee_id: string;
  work_date: string;
  cutoff_id: string;
  time_in: string;
  time_out: string;
  hours_worked: string;
  late_minutes: string;
  undertime_minutes: string;
  overtime_hours: string;
  is_absent: boolean;
  is_rest_day: boolean;
  holiday_type: string;
  holiday_name: string;
  remarks: string;
}

const EMPTY_FORM: AttendanceForm = {
  id: null,
  employee_id: '',
  work_date: '',
  cutoff_id: '',
  time_in: '',
  time_out: '',
  hours_worked: '',
  late_minutes: '0',
  undertime_minutes: '0',
  overtime_hours: '0',
  is_absent: false,
  is_rest_day: false,
  holiday_type: 'None',
  holiday_name: '',
  remarks: '',
};

function computeHours(timeIn: string, timeOut: string): string {
  if (!timeIn || !timeOut) return '';
  const [inH, inM] = timeIn.split(':').map(Number);
  const [outH, outM] = timeOut.split(':').map(Number);
  const totalMin = (outH * 60 + outM) - (inH * 60 + inM);
  if (totalMin <= 0) return '';
  return String(Math.round((totalMin / 60) * 100) / 100);
}

export default function AttendancePage() {
  const { showToast } = useToast();

  const [cutoffs, setCutoffs] = useState<Cutoff[]>([]);
  const [selectedCutoffId, setSelectedCutoffId] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<AttendanceForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AttendanceRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Load cutoffs for dropdown
  useEffect(() => {
    async function loadCutoffs() {
      try {
        const { data, error } = await supabase.rpc('search_payroll_cutoffs', {
          year: null,
          status: null,
          page: 1,
          page_size: 100,
        });
        if (error) throw error;
        const result = data as { cutoffs: Cutoff[]; total: number } | null;
        const list = result?.cutoffs ?? [];
        setCutoffs(list);
        if (list.length > 0 && !selectedCutoffId) {
          setSelectedCutoffId(String(list[0].cutoff_id));
        }
      } catch {
        // silently ignore cutoff load failure
      }
    }
    loadCutoffs();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

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
        // silently ignore employee load failure
      }
    }
    loadEmployees();
  }, []);

  const fetchAttendance = useCallback(async () => {
    if (!selectedCutoffId) return;
    setLoading(true);
    try {
      const emp = employees.find(
        e =>
          `${e.first_name} ${e.last_name}`.toLowerCase().includes(employeeSearch.toLowerCase()) ||
          e.employee_code.toLowerCase().includes(employeeSearch.toLowerCase()),
      );
      const { data, error } = await supabase.rpc('search_attendance', {
        cutoff_id: selectedCutoffId,
        employee_id: employeeSearch && emp ? emp.id : null,
        page: 1,
        page_size: 200,
      });
      if (error) throw error;
      const result = data as { attendance: AttendanceRecord[]; total: number } | null;
      setAttendance(result?.attendance ?? []);
      setTotal(result?.total ?? 0);
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to load attendance', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedCutoffId, employeeSearch, employees, showToast]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  const set = (field: keyof AttendanceForm, value: unknown) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleTimeChange = (field: 'time_in' | 'time_out', value: string) => {
    const updated = { ...form, [field]: value };
    const computed = computeHours(
      field === 'time_in' ? value : form.time_in,
      field === 'time_out' ? value : form.time_out,
    );
    setForm({ ...updated, hours_worked: computed || form.hours_worked });
  };

  const selectedCutoff = useMemo(
    () => cutoffs.find(c => String(c.cutoff_id) === selectedCutoffId),
    [cutoffs, selectedCutoffId],
  );

  const openAdd = () => {
    setForm({
      ...EMPTY_FORM,
      cutoff_id: selectedCutoffId,
      work_date: selectedCutoff?.date_from
        ? String(selectedCutoff.date_from).slice(0, 10)
        : '',
    });
    setModalOpen(true);
  };

  const openEdit = (r: AttendanceRecord) => {
    setForm({
      id: r.id,
      employee_id: String(r.employee_id),
      work_date: String(r.work_date).slice(0, 10),
      cutoff_id: String(r.cutoff_id),
      time_in: r.time_in ?? '',
      time_out: r.time_out ?? '',
      hours_worked: String(r.hours_worked ?? ''),
      late_minutes: String(r.late_minutes ?? 0),
      undertime_minutes: String(r.undertime_minutes ?? 0),
      overtime_hours: String(r.overtime_hours ?? 0),
      is_absent: !!r.is_absent,
      is_rest_day: !!r.is_rest_day,
      holiday_type: r.holiday_type ?? 'None',
      holiday_name: r.holiday_name ?? '',
      remarks: r.remarks ?? '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.employee_id) { showToast('Employee is required', 'error'); return; }
    if (!form.work_date) { showToast('Work date is required', 'error'); return; }
    if (!form.cutoff_id) { showToast('Cutoff is required', 'error'); return; }

    setSaving(true);
    try {
      const payload = {
        id: form.id ?? null,
        employee_id: form.employee_id,
        work_date: form.work_date,
        cutoff_id: form.cutoff_id,
        time_in: form.is_absent ? null : form.time_in || null,
        time_out: form.is_absent ? null : form.time_out || null,
        hours_worked: parseFloat(form.hours_worked) || 0,
        late_minutes: parseFloat(form.late_minutes) || 0,
        undertime_minutes: parseFloat(form.undertime_minutes) || 0,
        overtime_hours: parseFloat(form.overtime_hours) || 0,
        is_absent: form.is_absent ? 1 : 0,
        is_rest_day: form.is_rest_day ? 1 : 0,
        holiday_type: form.holiday_type,
        holiday_name: form.holiday_type !== 'None' ? form.holiday_name.trim() || null : null,
        remarks: form.remarks.trim() || null,
      };
      const { error } = await supabase.rpc('save_attendance', { record: payload });
      if (error) throw error;
      showToast(`Attendance ${form.id ? 'updated' : 'saved'} successfully`, 'success');
      setModalOpen(false);
      fetchAttendance();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to save attendance', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_attendance', { id: deleteTarget.id });
      if (error) throw error;
      showToast('Record deleted', 'success');
      setDeleteTarget(null);
      fetchAttendance();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const holidayBadge = (type: string) => {
    if (type === 'Legal') return 'bg-red-100 text-red-700';
    if (type === 'Special') return 'bg-amber-100 text-amber-700';
    return '';
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Attendance / DTR</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} record{total !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={openAdd}
          disabled={!selectedCutoffId}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
        >
          <Plus className="w-4 h-4" />
          Add Record
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Cutoff Period</label>
            <select
              value={selectedCutoffId}
              onChange={e => setSelectedCutoffId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select cutoff…</option>
              {cutoffs.map(c => (
                <option key={c.cutoff_id} value={c.cutoff_id}>{c.period_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Employee Search</label>
            <input
              type="text"
              placeholder="Search by name or code…"
              value={employeeSearch}
              onChange={e => setEmployeeSearch(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        {selectedCutoff && (
          <p className="text-xs text-slate-400 mt-2">
            Period: {formatDate(selectedCutoff.date_from)} – {formatDate(selectedCutoff.date_to)}
          </p>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !selectedCutoffId ? (
          <div className="text-center py-16 text-slate-400">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Select a cutoff period to view attendance</p>
          </div>
        ) : attendance.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No attendance records found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Employee</th>
                  <th className="px-4 py-3 text-center">Time In</th>
                  <th className="px-4 py-3 text-center">Time Out</th>
                  <th className="px-4 py-3 text-center">Hours</th>
                  <th className="px-4 py-3 text-center">Late (min)</th>
                  <th className="px-4 py-3 text-center">OT Hrs</th>
                  <th className="px-4 py-3 text-center">Holiday</th>
                  <th className="px-4 py-3 text-center">Absent</th>
                  <th className="px-4 py-3 text-left">Source</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map(r => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-800">{formatDate(r.work_date)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{r.employee_name ?? '—'}</div>
                      {r.employee_code && (
                        <div className="text-xs text-slate-400">{r.employee_code}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">{r.time_in ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{r.time_out ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-slate-700">{r.hours_worked ?? 0}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{r.late_minutes ?? 0}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{r.overtime_hours ?? 0}</td>
                    <td className="px-4 py-3 text-center">
                      {r.holiday_type && r.holiday_type !== 'None' ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${holidayBadge(r.holiday_type)}`}>
                          {r.holiday_type}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.is_absent ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Absent</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{r.source ?? 'Manual'}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => openEdit(r)}
                        title="Edit"
                        className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteTarget(r)} title="Delete" className="p-1.5 rounded hover:bg-red-50 text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
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
        title={form.id ? 'Edit Attendance Record' : 'Add Attendance Record'}
        size="lg"
      >
        <div className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Work Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={form.work_date}
                onChange={e => set('work_date', e.target.value)}
                min={selectedCutoff ? String(selectedCutoff.date_from).slice(0, 10) : undefined}
                max={selectedCutoff ? String(selectedCutoff.date_to).slice(0, 10) : undefined}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="att_is_absent"
                checked={form.is_absent}
                onChange={e => {
                  set('is_absent', e.target.checked);
                  if (e.target.checked) {
                    setForm(prev => ({ ...prev, is_absent: true, time_in: '', time_out: '', hours_worked: '0' }));
                  }
                }}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="att_is_absent" className="text-sm font-medium text-slate-700">Absent</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="att_is_rest_day"
                checked={form.is_rest_day}
                onChange={e => set('is_rest_day', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="att_is_rest_day" className="text-sm font-medium text-slate-700">Rest Day</label>
            </div>
          </div>

          {!form.is_absent && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Time In</label>
                <input
                  type="time"
                  value={form.time_in}
                  onChange={e => handleTimeChange('time_in', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Time Out</label>
                <input
                  type="time"
                  value={form.time_out}
                  onChange={e => handleTimeChange('time_out', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Hours Worked
                  <span className="text-xs font-normal text-slate-400 ml-1">(auto)</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.hours_worked}
                  onChange={e => set('hours_worked', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Late (min)</label>
              <input
                type="number"
                min="0"
                value={form.late_minutes}
                onChange={e => set('late_minutes', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Undertime (min)</label>
              <input
                type="number"
                min="0"
                value={form.undertime_minutes}
                onChange={e => set('undertime_minutes', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Overtime (hrs)</label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={form.overtime_hours}
                onChange={e => set('overtime_hours', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Holiday Type</label>
              <select
                value={form.holiday_type}
                onChange={e => set('holiday_type', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>None</option>
                <option>Legal</option>
                <option>Special</option>
              </select>
            </div>
            {form.holiday_type !== 'None' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Holiday Name</label>
                <input
                  type="text"
                  value={form.holiday_name}
                  onChange={e => set('holiday_name', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Christmas Day"
                />
              </div>
            )}
          </div>

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
              {saving ? 'Saving…' : 'Save Record'}
            </button>
          </div>
        </div>
      </InvModal>

      {/* Delete Confirmation Modal */}
      <InvModal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Attendance Record" size="sm">
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-800">Delete this attendance record?</p>
              <p className="text-sm text-slate-600 mt-1">{deleteTarget?.employee_name} — {deleteTarget?.work_date}</p>
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
