import { useState, useEffect, useCallback } from 'react';
import { ScrollText, AlertTriangle, Search, Filter, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AuditLog, Profile } from '../lib/types';
import { formatDateTime } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';

const MODULE_COLORS: Record<string, string> = {
  Auth: 'bg-blue-100 text-blue-700',
  Transactions: 'bg-emerald-100 text-emerald-700',
  DailyHistory: 'bg-amber-100 text-amber-700',
  Accounts: 'bg-slate-100 text-slate-700',
  Users: 'bg-red-100 text-red-700',
  Settings: 'bg-slate-100 text-slate-600',
};

const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  CREATE: 'Created',
  INSERT: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  VERIFY: 'Verified',
  CANCEL: 'Cancelled',
  DAILY_CLOSE: 'Daily Close',
  CREATE_USER: 'Create User',
  UPDATE_USER: 'Update User',
};

export default function AuditLogsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterModule, setFilterModule] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (filterModule) q = q.eq('module', filterModule);

    const [{ data: logData }, { data: profileData }] = await Promise.all([
      q,
      supabase.from('profiles').select('id, name, email'),
    ]);

    const profileMap = new Map(((profileData || []) as Profile[]).map(item => [item.id, item]));
    const mappedLogs = ((logData || []) as Array<AuditLog & { created_at?: string }>).map(log => ({
      ...log,
      timestamp: String(log.timestamp || log.created_at || ''),
      profiles: log.user_id ? profileMap.get(log.user_id) : undefined,
    }));

    setLogs(mappedLogs);
    setLoading(false);
  }, [filterModule]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async () => {
    if (!deleteId) return;
    setDeleting(true);
    const { error } = await supabase.from('audit_logs').delete().eq('id', deleteId);
    setDeleting(false);

    if (error) {
      showToast(error.message || 'Failed to delete audit log', 'error');
      return;
    }

    setDeleteId(null);
    showToast('Audit log deleted', 'success');
    await load();
  }, [deleteId, load, showToast]);

  const filtered = logs.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      l.action.toLowerCase().includes(q) ||
      l.module.toLowerCase().includes(q) ||
      (l.profiles as unknown as Profile)?.name?.toLowerCase().includes(q) ||
      (l.profiles as unknown as Profile)?.email?.toLowerCase().includes(q)
    );
  });

  const modules = [...new Set(logs.map(l => l.module))];

  if (profile?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center text-slate-400">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
          <p>Admin access required</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Audit Logs</h1>
        <p className="text-slate-500 text-sm mt-1">{filtered.length} events • auto-kept for 5 days</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-600">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search user, action..."
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filterModule}
            onChange={e => setFilterModule(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Modules</option>
            {modules.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <ScrollText className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>No audit logs found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {['Timestamp', 'User', 'Action', 'Module', 'Record', 'Details', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {formatDateTime(log.timestamp || log.created_at || '')}
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {(log.profiles as unknown as Profile)?.name
                        || (log.profiles as unknown as Profile)?.email
                        || (log.user_id ? `User ${log.user_id.slice(0, 8)}` : 'System')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${MODULE_COLORS[log.module] || 'bg-slate-100 text-slate-600'}`}>
                        {log.module}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap font-mono">
                      {log.record_id?.slice(0, 8) || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-[200px] truncate">
                      {Object.keys(log.details || {}).length > 0
                        ? JSON.stringify(log.details).slice(0, 80)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={() => setDeleteId(log.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete audit log"
        message="This will permanently remove the selected audit log entry."
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        cancelLabel="Cancel"
        danger
        onCancel={() => !deleting && setDeleteId(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
