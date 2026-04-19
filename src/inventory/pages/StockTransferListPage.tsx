import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Search, X, ChevronDown,
  ArrowRightLeft, Package, Clock, CheckCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { StockTransfer, TransferStatus } from '../../lib/types';
import {
  TRANSFER_STATUS_LABELS, TRANSFER_STATUS_COLORS,
  formatDate,
} from '../lib/transferUtils';

type FilterStatus = 'all' | 'open' | TransferStatus;

function StatusBadge({ status }: { status: TransferStatus }) {
  const c = TRANSFER_STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {TRANSFER_STATUS_LABELS[status]}
    </span>
  );
}

export default function StockTransferListPage() {
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('open');
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<{ id: string; name: string; code: string }[]>([]);

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('stock_transfers')
      .select(`
        *,
        source_location:source_location_id(id, name, code),
        destination_location:destination_location_id(id, name, code),
        creator:created_by(name)
      `)
      .order('created_at', { ascending: false });

    if (statusFilter === 'open') {
      q = q.in('status', ['draft', 'approved', 'issued', 'partially_received']);
    } else if (statusFilter !== 'all') {
      q = q.eq('status', statusFilter);
    }

    const { data, error } = await q;
    if (!error) {
      const rows = (data ?? []) as StockTransfer[];
      setTransfers(locationId ? rows.filter((row) => row.source_location_id === locationId || row.destination_location_id === locationId) : rows);
    }
    setLoading(false);
  }, [statusFilter, locationId]);

  useEffect(() => { loadTransfers(); }, [loadTransfers]);

  useEffect(() => {
    supabase.from('inv_locations').select('id, name, code').eq('is_active', true).order('name').then(({ data }) => {
      setLocations((data ?? []) as { id: string; name: string; code: string }[]);
    });
  }, []);

  const filtered = transfers.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    const src = t.source_location as unknown as { name: string } | undefined;
    const dst = t.destination_location as unknown as { name: string } | undefined;
    return (
      t.transfer_number.toLowerCase().includes(q) ||
      (src?.name ?? '').toLowerCase().includes(q) ||
      (dst?.name ?? '').toLowerCase().includes(q) ||
      t.notes.toLowerCase().includes(q)
    );
  });

  const stats = {
    inTransit: transfers.filter(t => t.status === 'issued' || t.status === 'partially_received').length,
    draft: transfers.filter(t => t.status === 'draft').length,
    approved: transfers.filter(t => t.status === 'approved').length,
    fullyReceived: transfers.filter(t => t.status === 'fully_received').length,
  };

  return (
    <div className="p-6 max-w-screen-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Stock Transfers</h1>
          <p className="text-sm text-slate-500 mt-0.5">Move inventory between locations</p>
        </div>
        <Link
          to="/inventory/transfers/new"
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New Transfer
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'In Transit', value: stats.inTransit, icon: ArrowRightLeft, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Awaiting Approval', value: stats.draft, icon: Clock, color: 'text-slate-600', bg: 'bg-slate-100' },
          { label: 'Approved (Ready)', value: stats.approved, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Fully Received', value: stats.fullyReceived, icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
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
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search transfer #, location, notes..."
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
              <option value="open">Open Transfers</option>
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="issued">In Transit</option>
              <option value="partially_received">Partially Received</option>
              <option value="fully_received">Fully Received</option>
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
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 text-center">
            <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">Loading transfers...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <ArrowRightLeft className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-500">No transfers found</p>
            <p className="text-xs text-slate-400 mt-1">Create a new transfer to move stock between locations</p>
            <Link
              to="/inventory/transfers/new"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Transfer
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Transfer #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">From</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider w-6"></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">To</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Transfer Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Expected</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(t => {
                  const src = t.source_location as unknown as { name: string; code: string } | undefined;
                  const dst = t.destination_location as unknown as { name: string; code: string } | undefined;
                  return (
                    <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          to={`/inventory/transfers/${t.id}`}
                          className="font-mono font-semibold text-blue-700 hover:underline"
                        >
                          {t.transfer_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{src?.name}</p>
                        <p className="text-xs text-slate-400 font-mono">{src?.code}</p>
                      </td>
                      <td className="px-2 py-3 text-center">
                        <ArrowRightLeft className="w-3.5 h-3.5 text-slate-300 mx-auto" />
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{dst?.name}</p>
                        <p className="text-xs text-slate-400 font-mono">{dst?.code}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{formatDate(t.transfer_date)}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{t.expected_date ? formatDate(t.expected_date) : '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs truncate max-w-48">{t.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400">
              {filtered.length} transfer{filtered.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
