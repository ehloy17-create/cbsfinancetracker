import { useState, useEffect, useCallback } from 'react';
import { Monitor, Plus, PencilLine, ToggleLeft, ToggleRight, MapPin, X, Loader2, Search, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PosTerminal, InvLocation } from '../../lib/types';
import { useToast } from '../../contexts/ToastContext';

interface TerminalModalProps {
  terminal: PosTerminal | null;
  locations: InvLocation[];
  onClose: () => void;
  onSaved: () => void;
}

function TerminalModal({ terminal, locations, onClose, onSaved }: TerminalModalProps) {
  const { showToast } = useToast();
  const [name, setName] = useState(terminal?.terminal_name ?? '');
  const [code, setCode] = useState(terminal?.terminal_code ?? '');
  const [locationId, setLocationId] = useState(terminal?.location_id ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) { showToast('Terminal name is required', 'error'); return; }
    if (!code.trim()) { showToast('Terminal code is required', 'error'); return; }
    if (!locationId)  { showToast('Location is required', 'error'); return; }
    setSaving(true);
    try {
      if (terminal) {
        const { error } = await supabase.from('pos_terminals').update({
          terminal_name: name.trim(),
          terminal_code: code.trim().toUpperCase(),
          location_id: locationId,
          updated_at: new Date().toISOString(),
        }).eq('terminal_id', terminal.terminal_id);
        if (error) { showToast(error.message || 'Failed to update terminal', 'error'); return; }
        showToast('Terminal updated', 'success');
      } else {
        const { error } = await supabase.from('pos_terminals').insert({
          terminal_name: name.trim(),
          terminal_code: code.trim().toUpperCase(),
          location_id: locationId,
          is_active: true,
        });
        if (error) { showToast(error.message || 'Failed to create terminal', 'error'); return; }
        showToast('Terminal created', 'success');
      }
      onSaved();
    } catch {
      showToast('Failed to save terminal', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">{terminal ? 'Edit Terminal' : 'New Terminal'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Terminal Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="e.g. POS-01"
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Terminal Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Cashier 1"
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Location <span className="text-red-500">*</span>
            </label>
            <select
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Select location...</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>[{l.code}] {l.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {terminal ? 'Save Changes' : 'Create Terminal'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PosTerminalsPage() {
  const { showToast } = useToast();
  const [terminals, setTerminals] = useState<PosTerminal[]>([]);
  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalTerminal, setModalTerminal] = useState<PosTerminal | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<PosTerminal | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('pos_terminals')
      .select('*')
      .order('terminal_name');
    setTerminals((data ?? []) as unknown as PosTerminal[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    supabase.from('inv_locations').select('*').eq('is_active', true).order('name').then(({ data }) => {
      setLocations((data ?? []) as InvLocation[]);
    });
  }, []);

  async function toggleActive(t: PosTerminal) {
    await supabase.from('pos_terminals').update({ is_active: !t.is_active, updated_at: new Date().toISOString() }).eq('terminal_id', t.terminal_id);
    showToast(`Terminal ${t.is_active ? 'deactivated' : 'activated'}`, 'success');
    load();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('pos_terminals').delete().eq('terminal_id', deleteTarget.terminal_id);
    setDeleting(false);
    if (error) {
      showToast(error.message || 'Failed to delete terminal', 'error');
    } else {
      showToast('Terminal deleted', 'success');
      setDeleteTarget(null);
      load();
    }
  }

  const filtered = terminals.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    const loc = locations.find(l => l.id === t.location_id);
    return (
      t.terminal_name.toLowerCase().includes(q) ||
      (t.terminal_code ?? '').toLowerCase().includes(q) ||
      (loc?.name ?? '').toLowerCase().includes(q) ||
      (loc?.code ?? '').toLowerCase().includes(q)
    );
  });

  const activeCount = terminals.filter(t => t.is_active).length;

  return (
    <div className="p-6 max-w-screen-xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">POS Terminals</h1>
          <p className="text-sm text-slate-500 mt-0.5">{terminals.length} terminal{terminals.length !== 1 ? 's' : ''} &middot; {activeCount} active</p>
        </div>
        <button
          onClick={() => setModalTerminal(null)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New Terminal
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search terminals..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center">
          <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading terminals...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-xl border border-slate-200">
          <Monitor className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">No terminals found</p>
          <p className="text-xs text-slate-400 mt-1">Create a terminal to start using POS</p>
          <button
            onClick={() => setModalTerminal(null)}
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Terminal
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(t => {
            const loc = locations.find(l => l.id === t.location_id);
            return (
              <div
                key={t.terminal_id}
                className={`bg-white rounded-xl border shadow-sm p-5 transition-all ${t.is_active ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${t.is_active ? 'bg-blue-50' : 'bg-slate-100'}`}>
                      <Monitor className={`w-5 h-5 ${t.is_active ? 'text-blue-600' : 'text-slate-400'}`} />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800 leading-tight">{t.terminal_name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{t.terminal_code}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {t.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {loc && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-4">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>[{loc.code}] {loc.name}</span>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => setModalTerminal(t)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    <PencilLine className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => toggleActive(t)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      t.is_active
                        ? 'border border-amber-200 text-amber-600 hover:bg-amber-50'
                        : 'border border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                    }`}
                  >
                    {t.is_active ? <ToggleLeft className="w-3.5 h-3.5" /> : <ToggleRight className="w-3.5 h-3.5" />}
                    {t.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(t)}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalTerminal !== undefined && (
        <TerminalModal
          terminal={modalTerminal}
          locations={locations}
          onClose={() => setModalTerminal(undefined)}
          onSaved={() => { setModalTerminal(undefined); load(); }}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-800">Delete Terminal</h2>
                <p className="text-sm text-slate-500">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-6">
              Are you sure you want to delete <span className="font-semibold text-slate-800">{deleteTarget.terminal_name}</span>{' '}
              (<span className="font-mono text-xs">{deleteTarget.terminal_code}</span>)?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
