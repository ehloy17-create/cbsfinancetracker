import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, X, ChevronDown, ClipboardCheck, Clock, FileCheck2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PhysicalCount, PhysicalCountStatus } from '../../lib/types';
import {
  PC_STATUS_LABELS,
  PC_STATUS_COLORS,
  FILTER_TYPE_LABELS,
  formatDate,
} from '../lib/physicalCountUtils';

function StatusBadge({ status }: { status: PhysicalCountStatus }) {
  const c = PC_STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {PC_STATUS_LABELS[status]}
    </span>
  );
}

type FilterStatus = 'all' | 'open' | PhysicalCountStatus;

export default function PhysicalCountListPage() {
  const [counts, setCounts] = useState<PhysicalCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('open');
  const [locationId, setLocationId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [locations, setLocations] = useState<{ id: string; name: string; code: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('physical_counts')
      .select('*, inv_locations(id, name, code), creator:created_by(name), poster:posted_by(name)')
      .order('created_at', { ascending: false });

    if (statusFilter === 'open') {
      q = q.in('status', ['draft', 'counted']);
    } else if (statusFilter !== 'all') {
      q = q.eq('status', statusFilter);
    }
    if (locationId) q = q.eq('location_id', locationId);
    if (dateFrom) q = q.gte('count_date', dateFrom);
    if (dateTo) q = q.lte('count_date', dateTo);

    const { data } = await q;
    setCounts((data ?? []) as unknown as PhysicalCount[]);
    setLoading(false);
  }, [statusFilter, locationId, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    supabase.from('inv_locations').select('id, name, code').eq('is_active', true).order('name').then(({ data }) => {
      setLocations((data ?? []) as { id: string; name: string; code: string }[]);
    });
  }, []);

  const filtered = counts.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    const loc = c.inv_locations as unknown as { name: string } | undefined;
    return (
      c.count_number.toLowerCase().includes(q) ||
      (loc?.name ?? '').toLowerCase().includes(q) ||
      c.remarks.toLowerCase().includes(q)
    );
  });

  const stats = {
    draft: counts.filter(c => c.status === 'draft').length,
    counted: counts.filter(c => c.status === 'counted').length,
    posted: counts.filter(c => c.status === 'posted').length,
  };

  return (
    <div className="p-6 max-w-screen-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Physical Count</h1>
          <p className="text-sm text-slate-500 mt-0.5">Stock take sessions and variance reconciliation</p>
        </div>
        <Link
          to="/inventory/physical-counts/new"
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New Count
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Draft', value: stats.draft, icon: ClipboardCheck, color: 'text-slate-600', bg: 'bg-slate-100' },
          { label: 'Counted', value: stats.counted, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Posted', value: stats.posted, icon: FileCheck2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
              <div className={`w-8 h-8 ${bg} rounded-lg flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-800 tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-52">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search count #, location, remarks..."
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
              onChange={e => setStatusFilter(e.target.value as FilterStatus)}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="open">Open</option>
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="counted">Counted</option>
              <option value="posted">Posted</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>

          <div className="relative">
            <select
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All Locations</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>

          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="Date from"
          />
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            title="Date to"
          />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> Clear dates
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center">
            <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">Loading count sessions...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <ClipboardCheck className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-500">No count sessions found</p>
            <p className="text-xs text-slate-400 mt-1">Start a new physical count to reconcile stock</p>
            <Link
              to="/inventory/physical-counts/new"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Count
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Count #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Location</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Scope</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Remarks</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Created By</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(c => {
                  const loc = c.inv_locations as unknown as { name: string; code: string } | undefined;
                  const creator = c.creator as unknown as { name: string } | undefined;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          to={`/inventory/physical-counts/${c.id}`}
                          className="font-mono font-semibold text-blue-700 hover:underline"
                        >
                          {c.count_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{formatDate(c.count_date)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{loc?.name ?? '—'}</p>
                        <p className="text-xs text-slate-400 font-mono">{loc?.code}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{FILTER_TYPE_LABELS[c.filter_type]}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-52">{c.remarks || '—'}</td>
                      <td className="px-4 py-3 text-center"><StatusBadge status={c.status} /></td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{creator?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {(c.status === 'draft' || c.status === 'counted') && (
                            <Link
                              to={`/inventory/physical-counts/${c.id}/sheet`}
                              className="text-xs font-medium text-blue-600 hover:text-blue-800 px-2.5 py-1 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors"
                            >
                              Count Sheet
                            </Link>
                          )}
                          {c.status === 'posted' && (
                            <Link
                              to={`/inventory/physical-counts/${c.id}/variance`}
                              className="text-xs font-medium text-emerald-600 hover:text-emerald-800 px-2.5 py-1 rounded-lg border border-emerald-200 hover:bg-emerald-50 transition-colors"
                            >
                              Variance Report
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400">
              {filtered.length} session{filtered.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
