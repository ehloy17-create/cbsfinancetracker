import { useState, useEffect, useCallback, useMemo } from 'react';
import { Clock, Plus, Edit2, AlertCircle, Trash2, AlertTriangle, Copy, CheckSquare, Square } from 'lucide-react';
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

// One row in the bulk entry table
interface BulkRow {
  work_date: string;
  included: boolean;
  alreadyExists: boolean;
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

function getDatesInRange(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  const end = new Date(dateTo + 'T00:00:00');
  const cur = new Date(dateFrom + 'T00:00:00');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function shortDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
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

  // Single-record edit modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [form, setForm] = useState<AttendanceForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Bulk add modal
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkEmployeeId, setBulkEmployeeId] = useState('');
  const [bulkCutoffId, setBulkCutoffId] = useState('');
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  // Template values at top of bulk modal
  const [tplTimeIn, setTplTimeIn] = useState('');
  const [tplTimeOut, setTplTimeOut] = useState('');
  const [tplHours, setTplHours] = useState('');
  const [tplLate, setTplLate] = useState('0');
  const [tplUndertime, setTplUndertime] = useState('0');
  const [tplOT, setTplOT] = useState('0');
  const [tplAbsent, setTplAbsent] = useState(false);
  const [tplRestDay, setTplRestDay] = useState(false);
  const [tplHolidayType, setTplHolidayType] = useState('None');
  const [tplHolidayName, setTplHolidayName] = useState('');
  const [tplRemarks, setTplRemarks] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<AttendanceRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function loadCutoffs() {
      try {
        const { data, error } = await supabase.rpc('search_payroll_cutoffs', { year: null, status: null, page: 1, page_size: 100 });
        if (error) throw error;
        const result = data as { cutoffs: Cutoff[]; total: number } | null;
        const list = result?.cutoffs ?? [];
        setCutoffs(list);
        if (list.length > 0 && !selectedCutoffId) setSelectedCutoffId(String(list[0].cutoff_id));
      } catch { /* ignore */ }
    }
    loadCutoffs();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function loadEmployees() {
      try {
        const { data, error } = await supabase.rpc('search_employees', { status: 'active', page: 1, page_size: 200 });
        if (error) throw error;
        const result = data as { employees: Employee[] } | null;
        setEmployees(result?.employees ?? []);
      } catch { /* ignore */ }
    }
    loadEmployees();
  }, []);

  const fetchAttendance = useCallback(async () => {
    if (!selectedCutoffId) return;
    setLoading(true);
    try {
      const emp = employees.find(e =>
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

  useEffect(() => { fetchAttendance(); }, [fetchAttendance]);

  const set = (field: keyof AttendanceForm, value: unknown) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleTimeChange = (field: 'time_in' | 'time_out', value: string) => {
    const updated = { ...form, [field]: value };
    const computed = computeHours(field === 'time_in' ? value : form.time_in, field === 'time_out' ? value : form.time_out);
    setForm({ ...updated, hours_worked: computed || form.hours_worked });
  };

  const selectedCutoff = useMemo(() => cutoffs.find(c => String(c.cutoff_id) === selectedCutoffId), [cutoffs, selectedCutoffId]);

  // ── Bulk add ──────────────────────────────────────────────────────────────

  function buildRowFromTemplate(date: string, exists: boolean): BulkRow {
    const isWeekend = ['Sat', 'Sun'].includes(shortDay(date));
    const absent = tplAbsent;
    const restDay = tplRestDay || isWeekend;
    return {
      work_date: date,
      included: !exists, // skip days that already have a record
      alreadyExists: exists,
      time_in: absent || restDay ? '' : tplTimeIn,
      time_out: absent || restDay ? '' : tplTimeOut,
      hours_worked: absent || restDay ? '0' : tplHours,
      late_minutes: tplLate,
      undertime_minutes: tplUndertime,
      overtime_hours: tplOT,
      is_absent: absent,
      is_rest_day: restDay,
      holiday_type: tplHolidayType,
      holiday_name: tplHolidayName,
      remarks: tplRemarks,
    };
  }

  const openBulkAdd = () => {
    const cutoff = cutoffs.find(c => String(c.cutoff_id) === selectedCutoffId);
    setBulkCutoffId(selectedCutoffId);
    setBulkEmployeeId('');
    setTplTimeIn('');
    setTplTimeOut('');
    setTplHours('');
    setTplLate('0');
    setTplUndertime('0');
    setTplOT('0');
    setTplAbsent(false);
    setTplRestDay(false);
    setTplHolidayType('None');
    setTplHolidayName('');
    setTplRemarks('');
    if (cutoff) {
      const dates = getDatesInRange(String(cutoff.date_from).slice(0, 10), String(cutoff.date_to).slice(0, 10));
      setBulkRows(dates.map(d => buildRowFromTemplate(d, false)));
    } else {
      setBulkRows([]);
    }
    setBulkModalOpen(true);
  };

  // When employee changes in bulk modal, mark days that already have records
  const handleBulkEmployeeChange = async (empId: string) => {
    setBulkEmployeeId(empId);
    if (!empId || !bulkCutoffId) return;
    try {
      const { data } = await supabase.rpc('search_attendance', {
        cutoff_id: bulkCutoffId,
        employee_id: empId,
        page: 1,
        page_size: 200,
      });
      const existing = new Set<string>(
        ((data as { attendance: AttendanceRecord[] } | null)?.attendance ?? []).map(r => String(r.work_date).slice(0, 10)),
      );
      const cutoff = cutoffs.find(c => String(c.cutoff_id) === bulkCutoffId);
      if (!cutoff) return;
      const dates = getDatesInRange(String(cutoff.date_from).slice(0, 10), String(cutoff.date_to).slice(0, 10));
      setBulkRows(dates.map(d => buildRowFromTemplate(d, existing.has(d))));
    } catch { /* ignore */ }
  };

  // Apply template to all included (non-existing) rows
  function applyTemplateToAll() {
    setBulkRows(prev => prev.map(row => {
      if (row.alreadyExists) return row;
      const hours = tplAbsent || row.is_rest_day ? '0' : (computeHours(tplTimeIn, tplTimeOut) || tplHours);
      return {
        ...row,
        time_in: tplAbsent || row.is_rest_day ? '' : tplTimeIn,
        time_out: tplAbsent || row.is_rest_day ? '' : tplTimeOut,
        hours_worked: hours,
        late_minutes: tplLate,
        undertime_minutes: tplUndertime,
        overtime_hours: tplOT,
        is_absent: tplAbsent,
        holiday_type: tplHolidayType,
        holiday_name: tplHolidayName,
        remarks: tplRemarks,
      };
    }));
  }

  function updateBulkRow(idx: number, patch: Partial<BulkRow>) {
    setBulkRows(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      // Auto-compute hours when time changes
      if ('time_in' in patch || 'time_out' in patch) {
        const row = next[idx];
        const computed = computeHours(row.time_in, row.time_out);
        if (computed) next[idx] = { ...next[idx], hours_worked: computed };
      }
      return next;
    });
  }

  function toggleAllIncluded(value: boolean) {
    setBulkRows(prev => prev.map(r => r.alreadyExists ? r : { ...r, included: value }));
  }

  const includedCount = bulkRows.filter(r => r.included).length;

  const handleBulkSave = async () => {
    if (!bulkEmployeeId) { showToast('Select an employee', 'error'); return; }
    const toSave = bulkRows.filter(r => r.included);
    if (toSave.length === 0) { showToast('No days selected to save', 'error'); return; }
    setBulkSaving(true);
    let saved = 0;
    let failed = 0;
    try {
      for (const row of toSave) {
        const payload = {
          id: null,
          employee_id: bulkEmployeeId,
          work_date: row.work_date,
          cutoff_id: bulkCutoffId,
          time_in: row.is_absent ? null : row.time_in || null,
          time_out: row.is_absent ? null : row.time_out || null,
          hours_worked: parseFloat(row.hours_worked) || 0,
          late_minutes: parseFloat(row.late_minutes) || 0,
          undertime_minutes: parseFloat(row.undertime_minutes) || 0,
          overtime_hours: parseFloat(row.overtime_hours) || 0,
          is_absent: row.is_absent ? 1 : 0,
          is_rest_day: row.is_rest_day ? 1 : 0,
          holiday_type: row.holiday_type,
          holiday_name: row.holiday_type !== 'None' ? row.holiday_name.trim() || null : null,
          remarks: row.remarks.trim() || null,
        };
        const { error } = await supabase.rpc('save_attendance', { record: payload });
        if (error) failed++;
        else saved++;
      }
      if (failed === 0) showToast(`${saved} attendance records saved`, 'success');
      else showToast(`${saved} saved, ${failed} failed`, 'warning');
      setBulkModalOpen(false);
      fetchAttendance();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Bulk save failed', 'error');
    } finally {
      setBulkSaving(false);
    }
  };

  // ── Single edit ──────────────────────────────────────────────────────────

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
    setEditModalOpen(true);
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
      showToast('Attendance updated', 'success');
      setEditModalOpen(false);
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
          onClick={openBulkAdd}
          disabled={!selectedCutoffId}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
        >
          <Plus className="w-4 h-4" />
          Add Records
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
                      {r.employee_code && <div className="text-xs text-slate-400">{r.employee_code}</div>}
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
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.is_absent
                        ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Absent</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{r.source ?? 'Manual'}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => openEdit(r)} title="Edit" className="p-1.5 rounded hover:bg-blue-50 text-blue-600">
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

      {/* ── Bulk Add Modal ────────────────────────────────────────────────── */}
      <InvModal open={bulkModalOpen} onClose={() => setBulkModalOpen(false)} title="Bulk Add Attendance" size="xl">
        <div className="flex flex-col" style={{ maxHeight: '82vh' }}>

          {/* Template section */}
          <div className="px-6 pt-5 pb-4 border-b border-slate-200 bg-slate-50 space-y-4 flex-shrink-0">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Employee <span className="text-red-500">*</span></label>
                <select
                  value={bulkEmployeeId}
                  onChange={e => handleBulkEmployeeChange(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select employee…</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Cutoff</label>
                <select
                  value={bulkCutoffId}
                  onChange={e => setBulkCutoffId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {cutoffs.map(c => (
                    <option key={c.cutoff_id} value={c.cutoff_id}>{c.period_name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Template row */}
            <div className="bg-white border border-blue-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
                  <Copy className="w-3.5 h-3.5" />
                  Template — applied to all selected days
                </p>
                <button
                  onClick={applyTemplateToAll}
                  className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
                >
                  Apply to All
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex items-center gap-3 col-span-3">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={tplAbsent} onChange={e => setTplAbsent(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600" />
                    Absent
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={tplRestDay} onChange={e => setTplRestDay(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600" />
                    Rest Day
                  </label>
                  <div className="flex-1" />
                  <select value={tplHolidayType} onChange={e => setTplHolidayType(e.target.value)}
                    className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                    <option>None</option><option>Legal</option><option>Special</option>
                  </select>
                  {tplHolidayType !== 'None' && (
                    <input value={tplHolidayName} onChange={e => setTplHolidayName(e.target.value)}
                      placeholder="Holiday name"
                      className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 w-32" />
                  )}
                </div>
                {!tplAbsent && (
                  <>
                    <div>
                      <label className="block text-xs text-slate-500 mb-0.5">Time In</label>
                      <input type="time" value={tplTimeIn} onChange={e => { setTplTimeIn(e.target.value); setTplHours(computeHours(e.target.value, tplTimeOut) || tplHours); }}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-0.5">Time Out</label>
                      <input type="time" value={tplTimeOut} onChange={e => { setTplTimeOut(e.target.value); setTplHours(computeHours(tplTimeIn, e.target.value) || tplHours); }}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-0.5">Hours</label>
                      <input type="number" step="0.01" value={tplHours} onChange={e => setTplHours(e.target.value)} placeholder="0.00"
                        className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-xs text-slate-500 mb-0.5">Late (min)</label>
                  <input type="number" min="0" value={tplLate} onChange={e => setTplLate(e.target.value)}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-0.5">Undertime (min)</label>
                  <input type="number" min="0" value={tplUndertime} onChange={e => setTplUndertime(e.target.value)}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-0.5">OT (hrs)</label>
                  <input type="number" min="0" step="0.5" value={tplOT} onChange={e => setTplOT(e.target.value)}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs text-slate-500 mb-0.5">Remarks</label>
                  <input value={tplRemarks} onChange={e => setTplRemarks(e.target.value)} placeholder="Optional"
                    className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Day rows */}
          <div className="flex-1 overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-2 bg-white border-b border-slate-100 sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <button onClick={() => toggleAllIncluded(true)} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                  <CheckSquare className="w-3.5 h-3.5" /> Select all
                </button>
                <button onClick={() => toggleAllIncluded(false)} className="flex items-center gap-1 text-xs text-slate-500 hover:underline">
                  <Square className="w-3.5 h-3.5" /> Deselect all
                </button>
              </div>
              <span className="text-xs text-slate-500">{includedCount} of {bulkRows.filter(r => !r.alreadyExists).length} new days selected</span>
            </div>

            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase sticky top-9 z-10">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2 text-left w-28">Date</th>
                  <th className="px-3 py-2 text-center">Absent</th>
                  <th className="px-3 py-2 text-center">Rest</th>
                  <th className="px-3 py-2 text-center">Time In</th>
                  <th className="px-3 py-2 text-center">Time Out</th>
                  <th className="px-3 py-2 text-center">Hrs</th>
                  <th className="px-3 py-2 text-center">Late</th>
                  <th className="px-3 py-2 text-center">UT</th>
                  <th className="px-3 py-2 text-center">OT</th>
                  <th className="px-3 py-2 text-left">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {bulkRows.map((row, idx) => {
                  const dayLabel = shortDay(row.work_date);
                  const isWeekend = dayLabel === 'Sat' || dayLabel === 'Sun';
                  return (
                    <tr key={row.work_date} className={`border-b border-slate-100 ${
                      row.alreadyExists ? 'bg-slate-50 opacity-50' :
                      !row.included ? 'bg-white opacity-60' :
                      isWeekend ? 'bg-amber-50/40' : 'bg-white hover:bg-blue-50/30'
                    }`}>
                      <td className="px-3 py-1.5 text-center">
                        {row.alreadyExists ? (
                          <span className="text-xs text-slate-400 font-medium">Exists</span>
                        ) : (
                          <input type="checkbox" checked={row.included}
                            onChange={e => updateBulkRow(idx, { included: e.target.checked })}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600" />
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="font-medium text-slate-800">{row.work_date.slice(5)}</div>
                        <div className={`text-slate-400 ${isWeekend ? 'text-amber-600 font-medium' : ''}`}>{dayLabel}</div>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <input type="checkbox" checked={row.is_absent} disabled={!row.included || row.alreadyExists}
                          onChange={e => updateBulkRow(idx, { is_absent: e.target.checked, time_in: '', time_out: '', hours_worked: '0' })}
                          className="w-3.5 h-3.5 rounded border-slate-300 text-red-500 disabled:opacity-40" />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <input type="checkbox" checked={row.is_rest_day} disabled={!row.included || row.alreadyExists}
                          onChange={e => updateBulkRow(idx, { is_rest_day: e.target.checked })}
                          className="w-3.5 h-3.5 rounded border-slate-300 text-amber-500 disabled:opacity-40" />
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="time" value={row.time_in} disabled={!row.included || row.alreadyExists || row.is_absent}
                          onChange={e => updateBulkRow(idx, { time_in: e.target.value })}
                          className="border border-slate-200 rounded px-1.5 py-0.5 text-xs w-24 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:opacity-50" />
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="time" value={row.time_out} disabled={!row.included || row.alreadyExists || row.is_absent}
                          onChange={e => updateBulkRow(idx, { time_out: e.target.value })}
                          className="border border-slate-200 rounded px-1.5 py-0.5 text-xs w-24 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:opacity-50" />
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="number" step="0.01" value={row.hours_worked} disabled={!row.included || row.alreadyExists}
                          onChange={e => updateBulkRow(idx, { hours_worked: e.target.value })}
                          className="border border-slate-200 rounded px-1.5 py-0.5 text-xs w-14 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:opacity-50" />
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="number" min="0" value={row.late_minutes} disabled={!row.included || row.alreadyExists}
                          onChange={e => updateBulkRow(idx, { late_minutes: e.target.value })}
                          className="border border-slate-200 rounded px-1.5 py-0.5 text-xs w-12 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:opacity-50" />
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="number" min="0" value={row.undertime_minutes} disabled={!row.included || row.alreadyExists}
                          onChange={e => updateBulkRow(idx, { undertime_minutes: e.target.value })}
                          className="border border-slate-200 rounded px-1.5 py-0.5 text-xs w-12 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:opacity-50" />
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="number" min="0" step="0.5" value={row.overtime_hours} disabled={!row.included || row.alreadyExists}
                          onChange={e => updateBulkRow(idx, { overtime_hours: e.target.value })}
                          className="border border-slate-200 rounded px-1.5 py-0.5 text-xs w-12 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:opacity-50" />
                      </td>
                      <td className="px-3 py-1.5">
                        <input value={row.remarks} disabled={!row.included || row.alreadyExists}
                          onChange={e => updateBulkRow(idx, { remarks: e.target.value })}
                          className="border border-slate-200 rounded px-1.5 py-0.5 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:opacity-50" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 flex-shrink-0 bg-white">
            <p className="text-sm text-slate-500">
              {includedCount > 0
                ? <><span className="font-semibold text-slate-800">{includedCount}</span> record{includedCount !== 1 ? 's' : ''} will be saved</>
                : 'No days selected'}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setBulkModalOpen(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleBulkSave} disabled={bulkSaving || includedCount === 0 || !bulkEmployeeId}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
                {bulkSaving ? 'Saving…' : `Save ${includedCount} Record${includedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      </InvModal>

      {/* ── Edit Modal ────────────────────────────────────────────────────── */}
      <InvModal open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Attendance Record" size="lg">
        <div className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Employee</label>
              <select value={form.employee_id} onChange={e => set('employee_id', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select employee…</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Work Date</label>
              <input type="date" value={form.work_date} onChange={e => set('work_date', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_absent} id="edit_absent"
                onChange={e => { set('is_absent', e.target.checked); if (e.target.checked) setForm(p => ({ ...p, is_absent: true, time_in: '', time_out: '', hours_worked: '0' })); }}
                className="w-4 h-4 rounded border-slate-300 text-blue-600" />
              <span className="text-sm font-medium text-slate-700">Absent</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_rest_day} id="edit_rest"
                onChange={e => set('is_rest_day', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600" />
              <span className="text-sm font-medium text-slate-700">Rest Day</span>
            </label>
          </div>
          {!form.is_absent && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Time In</label>
                <input type="time" value={form.time_in} onChange={e => handleTimeChange('time_in', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Time Out</label>
                <input type="time" value={form.time_out} onChange={e => handleTimeChange('time_out', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Hours <span className="text-xs font-normal text-slate-400">(auto)</span></label>
                <input type="number" step="0.01" value={form.hours_worked} onChange={e => set('hours_worked', e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0.00" />
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Late (min)</label>
              <input type="number" min="0" value={form.late_minutes} onChange={e => set('late_minutes', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Undertime (min)</label>
              <input type="number" min="0" value={form.undertime_minutes} onChange={e => set('undertime_minutes', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Overtime (hrs)</label>
              <input type="number" min="0" step="0.5" value={form.overtime_hours} onChange={e => set('overtime_hours', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Holiday Type</label>
              <select value={form.holiday_type} onChange={e => set('holiday_type', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option>None</option><option>Legal</option><option>Special</option>
              </select>
            </div>
            {form.holiday_type !== 'None' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Holiday Name</label>
                <input type="text" value={form.holiday_name} onChange={e => set('holiday_name', e.target.value)}
                  placeholder="e.g. Christmas Day"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Remarks</label>
            <textarea value={form.remarks} onChange={e => set('remarks', e.target.value)} rows={2}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Optional remarks…" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setEditModalOpen(false)}
              className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </InvModal>

      {/* Delete Confirmation */}
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
