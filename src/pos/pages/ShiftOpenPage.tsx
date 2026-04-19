import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Monitor, MapPin, Banknote, AlertCircle, Loader2, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PosTerminal, PosShift, InvLocation } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency } from '../lib/posUtils';
import { enrichShifts, mapShiftRow } from '../lib/shiftData';

export default function ShiftOpenPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { showToast } = useToast();

  const [terminals, setTerminals] = useState<PosTerminal[]>([]);
  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [terminalId, setTerminalId] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [notes, setNotes] = useState('');
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));

  const [myOpenShifts, setMyOpenShifts] = useState<PosShift[]>([]);
  const [myExistingShift, setMyExistingShift] = useState<PosShift | null>(null);
  const [terminalConflictShift, setTerminalConflictShift] = useState<PosShift | null>(null);
  const [zReadingLockedShift, setZReadingLockedShift] = useState<PosShift | null>(null);
  const [checkingShift, setCheckingShift] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('pos_terminals').select('*').eq('is_active', true).order('terminal_name')
      .then(({ data }) => setTerminals((data ?? []) as unknown as PosTerminal[]));
    supabase.from('inv_locations').select('*').eq('is_active', true).order('name')
      .then(({ data }) => setLocations((data ?? []) as InvLocation[]));
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('pos_shifts')
      .select('*')
      .eq('cashier_id', user.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .then(async ({ data }) => setMyOpenShifts(await enrichShifts((data ?? []) as Record<string, unknown>[])));
  }, [user?.id]);

  useEffect(() => {
    if (!terminalId || !user?.id) {
      setMyExistingShift(null);
      setTerminalConflictShift(null);
      setZReadingLockedShift(null);
      return;
    }
      setCheckingShift(true);
      Promise.all([
        supabase.from('pos_shifts').select('*').eq('terminal_id', terminalId).eq('cashier_id', user.id).eq('status', 'open').maybeSingle(),
        supabase.from('pos_shifts').select('*').eq('terminal_id', terminalId).neq('cashier_id', user.id).eq('status', 'open').maybeSingle(),
        supabase.from('pos_shifts').select('*').eq('terminal_id', terminalId).eq('shift_date', businessDate).order('opened_at', { ascending: false }),
    ]).then(async ([myRes, conflictRes, lockedRes]) => {
      setMyExistingShift(myRes.data ? mapShiftRow(myRes.data as Record<string, unknown>) : null);
      const enrichedConflict = await enrichShifts(conflictRes.data ? [conflictRes.data as Record<string, unknown>] : []);
      setTerminalConflictShift(enrichedConflict[0] ?? null);
      const lockedShiftRows = (lockedRes.data ?? []) as Record<string, unknown>[];
      setZReadingLockedShift(
        lockedShiftRows
          .map(mapShiftRow)
          .find(shift => Boolean(shift.z_reading_posted_at)) ?? null
      );
      setCheckingShift(false);
    });
  }, [businessDate, terminalId, user?.id]);

  const selectedTerminal = terminals.find(t => t.terminal_id === terminalId);
  const selectedLoc = locations.find(l => l.id === selectedTerminal?.location_id);

  async function handleOpen() {
    if (!terminalId) { showToast('Please select a terminal', 'error'); return; }
    if (!openingCash || isNaN(parseFloat(openingCash))) {
      showToast('Please enter a valid opening cash amount', 'error');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('open_pos_shift', {
        terminal_id: terminalId,
        shift_date: businessDate,
        opening_cash: parseFloat(openingCash),
        notes: notes.trim(),
      });
      if (error) {
        throw error;
      }

      showToast('Shift opened successfully', 'success');
      navigate(`/inventory/pos/session/${data.shift_id}`);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to open shift', 'error');
    } finally {
      setSaving(false);
    }
  }

  const cashVal = parseFloat(openingCash) || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Back link */}
        <div className="mb-6">
          <Link to="/inventory/pos" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to POS
          </Link>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6 text-white">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <Monitor className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Open Shift</h1>
                <p className="text-blue-200 text-sm">Start a new cashier session</p>
              </div>
            </div>
          </div>

          {/* Cashier info */}
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Cashier</p>
            <p className="text-base font-semibold text-slate-800 mt-0.5">{profile?.name ?? user?.email}</p>
          </div>

          <div className="p-6 space-y-5">
            {myOpenShifts.length > 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Current Open Shift{myOpenShifts.length > 1 ? 's' : ''}</p>
                <div className="mt-3 space-y-2">
                  {myOpenShifts.map(shift => {
                    const terminal = shift.pos_terminals as { terminal_name: string } | undefined;
                    const location = shift.inv_locations as { name: string; code: string } | undefined;
                    return (
                      <button
                        key={shift.shift_id}
                        onClick={() => navigate(`/inventory/pos/session/${shift.shift_id}`)}
                        className="flex w-full items-center justify-between rounded-lg border border-emerald-200 bg-white px-3 py-2 text-left hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{terminal?.terminal_name ?? 'Terminal'}</p>
                          <p className="text-xs text-slate-500">{location ? `[${location.code}] ${location.name}` : '—'}</p>
                        </div>
                        <span className="text-xs font-semibold text-emerald-700">Resume</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Terminal Select */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Terminal <span className="text-red-500">*</span>
              </label>
              {terminals.length === 0 ? (
                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <p className="text-sm text-amber-700">No active terminals. Ask your admin to set one up.</p>
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={terminalId}
                    onChange={e => setTerminalId(e.target.value)}
                    className="w-full appearance-none pl-3 pr-8 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Select terminal...</option>
                    {terminals.map(t => {
                      const loc = locations.find(l => l.id === t.location_id);
                      return (
                        <option key={t.terminal_id} value={t.terminal_id}>
                          {t.terminal_name}{loc ? ` — [${loc.code}] ${loc.name}` : ''}
                        </option>
                      );
                    })}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
              )}
            </div>

            {/* Terminal info */}
            {selectedTerminal && selectedLoc && (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                <MapPin className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <p className="text-sm text-blue-700 font-medium">[{selectedLoc.code}] {selectedLoc.name}</p>
              </div>
            )}

            {/* Existing shift warning */}
            {checkingShift && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Checking for open shifts...
              </div>
            )}
            {myExistingShift && !checkingShift && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">You already have an open shift on this terminal</p>
                    <p className="text-xs text-amber-600 mt-0.5">Resume your existing session instead.</p>
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/inventory/pos/session/${myExistingShift.shift_id}`)}
                  className="mt-3 w-full py-2 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                >
                  Resume Shift
                </button>
              </div>
            )}
            {terminalConflictShift && !checkingShift && !myExistingShift && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-800">Terminal is in use by another cashier</p>
                    <p className="text-xs text-red-600 mt-0.5">
                      {(terminalConflictShift.cashier as unknown as { name: string } | undefined)?.name ?? 'Another user'} has an open shift on this terminal.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {zReadingLockedShift && !checkingShift && !myExistingShift && !terminalConflictShift && (
              <div className="p-3 bg-slate-900 border border-red-900 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-200">Z Reading already posted for this register/day</p>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Transactions stay locked until an admin resets this day from Settings.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Business Date */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Business Date
              </label>
              <input
                type="date"
                value={businessDate}
                onChange={e => setBusinessDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Opening Cash */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Opening Cash <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm">₱</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={openingCash}
                  onChange={e => setOpeningCash(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-right"
                />
              </div>
              {cashVal > 0 && (
                <p className="mt-1 text-right text-xs text-slate-500">
                  <span className="flex items-center justify-end gap-1">
                    <Banknote className="w-3 h-3" />
                    ₱{formatCurrency(cashVal)}
                  </span>
                </p>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Any notes about this shift..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {/* Open shift button */}
            <button
              onClick={handleOpen}
              disabled={saving || !terminalId || !openingCash || terminals.length === 0 || !!myExistingShift || !!terminalConflictShift || !!zReadingLockedShift}
              className="w-full py-3 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Open Shift
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
