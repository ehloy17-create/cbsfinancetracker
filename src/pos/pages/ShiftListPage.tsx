import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, X, ChevronDown, Monitor, Clock, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PosShift, PosShiftStatus } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import {
  SHIFT_STATUS_LABELS,
  SHIFT_STATUS_COLORS,
  formatDate,
  formatDateTime,
  formatCurrency,
} from '../lib/posUtils';
import { enrichShifts } from '../lib/shiftData';

function ShiftBadge({ status }: { status: PosShiftStatus }) {
  const c = SHIFT_STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {SHIFT_STATUS_LABELS[status]}
    </span>
  );
}

export default function ShiftListPage() {
  const { user, profile } = useAuth();
  const [shifts, setShifts] = useState<PosShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('open');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const isAdmin = profile?.role === 'admin';
  const [myShiftsOnly, setMyShiftsOnly] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('pos_shifts')
      .select('*')
      .order('opened_at', { ascending: false })
      .limit(200);

    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    if (!isAdmin || (isAdmin && myShiftsOnly)) q = q.eq('cashier_id', user?.id ?? '');
    if (dateFrom) q = q.gte('business_date', dateFrom);
    if (dateTo) q = q.lte('business_date', dateTo);

    const { data } = await q;
    setShifts(await enrichShifts((data ?? []) as Record<string, unknown>[]));
    setLoading(false);
  }, [statusFilter, myShiftsOnly, isAdmin, user?.id, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const filtered = shifts.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    const cashier = s.cashier as unknown as { name: string } | undefined;
    const terminal = s.pos_terminals as unknown as { terminal_name: string } | undefined;
    const loc = s.inv_locations as unknown as { name: string } | undefined;
    return (
      (cashier?.name ?? '').toLowerCase().includes(q) ||
      (terminal?.terminal_name ?? '').toLowerCase().includes(q) ||
      (loc?.name ?? '').toLowerCase().includes(q)
    );
  });

  const openCount = shifts.filter(s => s.status === 'open').length;

  return (
    <div className="p-6 max-w-screen-xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Shifts</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {openCount > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                {openCount} open shift{openCount !== 1 ? 's' : ''}
              </span>
            ) : 'No open shifts'}
          </p>
        </div>
        <Link
          to="/inventory/pos/open-shift"
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Open Shift
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search cashier, terminal, location..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="relative">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as 'all' | 'open' | 'closed')}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="open">Open</option>
              <option value="all">All</option>
              <option value="closed">Closed</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>

          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="From date"
          />
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="To date"
          />

          {isAdmin && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setMyShiftsOnly(v => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors ${myShiftsOnly ? 'bg-blue-600' : 'bg-slate-200'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${myShiftsOnly ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm text-slate-600">My shifts only</span>
            </label>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center">
            <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">Loading shifts...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Clock className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-500">No shifts found</p>
            <Link
              to="/inventory/pos/open-shift"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Open a Shift
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Cashier</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Terminal</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Location</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Business Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Opened</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Closed</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Opening Cash</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(s => {
                  const cashier = s.cashier as unknown as { id: string; name: string } | undefined;
                  const terminal = s.pos_terminals as unknown as { terminal_name: string } | undefined;
                  const loc = s.inv_locations as unknown as { name: string; code: string } | undefined;
                  const isOwn = cashier?.id === user?.id;
                  return (
                    <tr key={s.shift_id} className={`transition-colors hover:bg-slate-50 ${s.status === 'open' && isOwn ? 'bg-emerald-50/30' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{cashier?.name ?? '—'}</p>
                        {isOwn && <p className="text-xs text-blue-600">You</p>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Monitor className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-slate-700">{terminal?.terminal_name ?? '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {loc ? `[${loc.code}] ${loc.name}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{formatDate(s.business_date)}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{formatDateTime(s.shift_open_time)}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{s.shift_close_time ? formatDateTime(s.shift_close_time) : '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">₱{formatCurrency(s.opening_cash)}</td>
                      <td className="px-4 py-3 text-center"><ShiftBadge status={s.status} /></td>
                      <td className="px-4 py-3 text-center">
                        {s.status === 'open' && isOwn && (
                          <Link
                            to={`/inventory/pos/session/${s.shift_id}`}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800 px-2.5 py-1 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors"
                          >
                            Resume
                          </Link>
                        )}
                        {s.status === 'closed' && (
                          <span className="text-xs text-slate-400">
                            <CheckCircle2 className="w-4 h-4 inline" />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400">
              {filtered.length} shift{filtered.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
