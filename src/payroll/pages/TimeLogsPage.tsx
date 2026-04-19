import { useState, useEffect, useCallback } from 'react';
import { Clock, Trash2, AlertTriangle, Edit2 } from 'lucide-react';
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

interface DailySummary {
  log_date: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  first_time_in: string | null;
  last_time_out: string | null;
  log_count: number;
}

interface RawLog {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  log_date: string;
  log_time: string;
  log_type: 'TIME_IN' | 'TIME_OUT';
  device_name: string | null;
}

function fmtTime(t: string | null) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function computeHours(timeIn: string | null, timeOut: string | null): string {
  if (!timeIn || !timeOut) return '—';
  const [ih, im] = timeIn.split(':').map(Number);
  const [oh, om] = timeOut.split(':').map(Number);
  const hrs = Math.max(0, (oh * 60 + om - ih * 60 - im) / 60);
  return hrs.toFixed(2);
}

export default function TimeLogsPage() {
  const { showToast } = useToast();
  const [cutoffs, setCutoffs] = useState<Cutoff[]>([]);
  const [selectedCutoffId, setSelectedCutoffId] = useState('');
  const [summary, setSummary] = useState<DailySummary[]>([]);
  const [rawLogs, setRawLogs] = useState<RawLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'summary' | 'raw'>('raw');
  const [empFilter, setEmpFilter] = useState('');

  const [editTarget, setEditTarget] = useState<RawLog | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editType, setEditType] = useState<'TIME_IN' | 'TIME_OUT'>('TIME_IN');
  const [editDevice, setEditDevice] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<RawLog | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    supabase.rpc('search_payroll_cutoffs', { year: new Date().getFullYear(), page: 1, page_size: 50 })
      .then(({ data }) => {
        const result = data as { cutoffs?: Cutoff[] } | null;
        setCutoffs(result?.cutoffs ?? []);
        if (result?.cutoffs?.length) setSelectedCutoffId(result.cutoffs[0].cutoff_id);
      });
  }, []);

  const fetchLogs = useCallback(async () => {
    if (!selectedCutoffId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('search_time_logs', { cutoff_id: selectedCutoffId });
      if (error) throw error;
      const res = data as { daily_summary: DailySummary[]; raw_logs: RawLog[] } | null;
      setSummary(res?.daily_summary ?? []);
      setRawLogs(res?.raw_logs ?? []);
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to load logs', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedCutoffId, showToast]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const openEdit = (log: RawLog) => {
    setEditTarget(log);
    setEditDate(String(log.log_date).slice(0, 10));
    setEditTime(String(log.log_time || '').slice(0, 5));
    setEditType(log.log_type);
    setEditDevice(log.device_name ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    if (!editDate || !editTime) {
      showToast('Date and time are required', 'warning');
      return;
    }

    setSavingEdit(true);
    try {
      const { error } = await supabase
        .from('employee_time_logs')
        .update({
          log_date: editDate,
          log_time: editTime,
          log_type: editType,
          device_name: editDevice || null,
        })
        .eq('id', editTarget.id);
      if (error) throw error;
      showToast('Log entry updated', 'success');
      setEditTarget(null);
      fetchLogs();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Update failed', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('employee_time_logs')
        .delete()
        .eq('id', deleteTarget.id);
      if (error) throw error;
      showToast('Log entry deleted', 'success');
      setDeleteTarget(null);
      fetchLogs();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const filteredSummary = empFilter
    ? summary.filter(r =>
        r.employee_name?.toLowerCase().includes(empFilter.toLowerCase()) ||
        r.employee_code?.toLowerCase().includes(empFilter.toLowerCase())
      )
    : summary;

  const filteredRaw = empFilter
    ? rawLogs.filter(r =>
        r.employee_name?.toLowerCase().includes(empFilter.toLowerCase()) ||
        r.employee_code?.toLowerCase().includes(empFilter.toLowerCase())
      )
    : rawLogs;

  const selectedCutoff = cutoffs.find(c => c.cutoff_id === selectedCutoffId);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-xl">
            <Clock className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Time Logs — DTR View</h1>
            <p className="text-sm text-slate-500">Employee daily time-in / time-out records by payroll cutoff</p>
          </div>
        </div>
        <a
          href="/timeclock/kiosk"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg"
        >
          <Clock className="w-4 h-4" />
          Open Time Clock
        </a>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700 whitespace-nowrap">Payroll Period</label>
            <select
              value={selectedCutoffId}
              onChange={e => setSelectedCutoffId(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[220px]"
            >
              <option value="">Select cutoff…</option>
              {cutoffs.map(c => (
                <option key={`${c.cutoff_id}-${c.date_from}-${c.date_to}`} value={c.cutoff_id}>{c.period_name}</option>
              ))}
            </select>
          </div>
          {selectedCutoff && (
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
              {formatDate(selectedCutoff.date_from)} → {formatDate(selectedCutoff.date_to)}
            </span>
          )}
          <input
            type="text"
            value={empFilter}
            onChange={e => setEmpFilter(e.target.value)}
            placeholder="Filter by employee…"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
            <button
              onClick={() => setView('summary')}
              className={`px-4 py-2 font-medium ${view === 'summary' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Daily Summary
            </button>
            <button
              onClick={() => setView('raw')}
              className={`px-4 py-2 font-medium ${view === 'raw' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Raw Logs
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : view === 'summary' ? (
          filteredSummary.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No time logs for this cutoff period</p>
              <p className="text-xs mt-1">Employees can log in/out via the Time Clock screen</p>
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
                    <th className="px-4 py-3 text-center">Log Count</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSummary.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{formatDate(r.log_date)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{r.employee_name ?? '—'}</div>
                        <div className="text-xs text-slate-400">{r.employee_code}</div>
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-green-700">
                        {fmtTime(r.first_time_in)}
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-blue-700">
                        {fmtTime(r.last_time_out)}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-700">
                        {computeHours(r.first_time_in, r.last_time_out)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">
                          {r.log_count} event{r.log_count !== 1 ? 's' : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* Raw logs view */
          filteredRaw.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No raw logs found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Employee</th>
                    <th className="px-4 py-3 text-center">Time</th>
                    <th className="px-4 py-3 text-center">Type</th>
                    <th className="px-4 py-3 text-center">Device</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRaw.map(r => (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{formatDate(r.log_date)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{r.employee_name ?? '—'}</div>
                        <div className="text-xs text-slate-400">{r.employee_code}</div>
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-slate-700">
                        {fmtTime(r.log_time)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          r.log_type === 'TIME_IN'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {r.log_type === 'TIME_IN' ? 'Time In' : 'Time Out'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-slate-500">
                        {r.device_name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => openEdit(r)}
                            title="Edit log entry"
                            className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(r)}
                            title="Delete log entry"
                            className="p-1.5 rounded hover:bg-red-50 text-red-500"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      <InvModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="Edit Time Log"
        size="sm"
      >
        <div className="space-y-4 px-6 py-5">
          {editTarget && (
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">{editTarget.employee_name}</span>
              <span className="text-slate-400"> · {editTarget.employee_code}</span>
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Date</label>
              <input
                type="date"
                value={editDate}
                onChange={e => setEditDate(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Time</label>
              <input
                type="time"
                value={editTime}
                onChange={e => setEditTime(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Log Type</label>
              <select
                value={editType}
                onChange={e => setEditType(e.target.value as 'TIME_IN' | 'TIME_OUT')}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="TIME_IN">Time In</option>
                <option value="TIME_OUT">Time Out</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Device</label>
              <input
                type="text"
                value={editDevice}
                onChange={e => setEditDevice(e.target.value)}
                placeholder="Optional"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setEditTarget(null)}
              className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={savingEdit}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {savingEdit ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </InvModal>

      {/* Delete confirm modal */}
      <InvModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Log Entry"
        size="sm"
      >
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-800">
                Delete this time log entry?
              </p>
              {deleteTarget && (
                <p className="text-sm text-slate-600 mt-1">
                  <span className="font-medium">{deleteTarget.employee_name}</span> —{' '}
                  {deleteTarget.log_type === 'TIME_IN' ? 'Time In' : 'Time Out'} at{' '}
                  <span className="font-medium">{fmtTime(deleteTarget.log_time)}</span> on{' '}
                  {formatDate(deleteTarget.log_date)}
                </p>
              )}
              <p className="text-xs text-red-600 mt-2">This action cannot be undone.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setDeleteTarget(null)}
              className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-60"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </InvModal>
    </div>
  );
}
