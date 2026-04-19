import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Monitor, Plus, Clock, ArrowRight, User, MapPin, Calendar } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PosShift } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate, formatDateTime, formatCurrency } from '../lib/posUtils';
import { enrichShifts } from '../lib/shiftData';

export default function PosLandingPage() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [myOpenShifts, setMyOpenShifts] = useState<PosShift[]>([]);
  const [allOpenShifts, setAllOpenShifts] = useState<PosShift[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;

    const myQ = supabase
      .from('pos_shifts')
      .select('*')
      .eq('cashier_id', user.id)
      .eq('status', 'open')
      .order('opened_at', { ascending: false });

    if (isAdmin) {
      const allQ = supabase
        .from('pos_shifts')
        .select('*')
        .neq('cashier_id', user.id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false });

      Promise.all([myQ, allQ]).then(async ([myRes, allRes]) => {
        setMyOpenShifts(await enrichShifts((myRes.data ?? []) as Record<string, unknown>[]));
        setAllOpenShifts(await enrichShifts((allRes.data ?? []) as Record<string, unknown>[]));
        setLoading(false);
      });
    } else {
      myQ.then(async ({ data }) => {
        setMyOpenShifts(await enrichShifts((data ?? []) as Record<string, unknown>[]));
        setLoading(false);
      });
    }
  }, [user?.id, isAdmin]);

  function ShiftCard({ shift, resumable }: { shift: PosShift; resumable: boolean }) {
    const terminal = shift.pos_terminals as unknown as { terminal_name: string } | undefined;
    const loc = shift.inv_locations as unknown as { name: string; code: string } | undefined;
    const cashier = shift.cashier as unknown as { name: string } | undefined;

    const card = (
      <div className={`group bg-white rounded-xl border shadow-sm p-5 transition-all ${
        resumable ? 'border-emerald-200 hover:shadow-md hover:border-emerald-400 cursor-pointer' : 'border-slate-200'
      }`}>
        <div className="flex items-start justify-between mb-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${resumable ? 'bg-emerald-50 group-hover:bg-emerald-100' : 'bg-slate-50'}`}>
            <Monitor className={`w-6 h-6 ${resumable ? 'text-emerald-600' : 'text-slate-500'}`} />
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-semibold">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            Open
          </div>
        </div>

        <p className={`font-bold text-base mb-1 transition-colors ${resumable ? 'text-slate-800 group-hover:text-emerald-700' : 'text-slate-700'}`}>
          {terminal?.terminal_name ?? 'Terminal'}
        </p>

        <div className="space-y-1.5 mb-4">
          {cashier && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <User className="w-3.5 h-3.5 text-slate-400" />
              {cashier.name}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <MapPin className="w-3.5 h-3.5 text-slate-400" />
            {loc ? `[${loc.code}] ${loc.name}` : '—'}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            {formatDate(shift.business_date)}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            Opened {formatDateTime(shift.shift_open_time)}
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <div>
            <p className="text-xs text-slate-400">Opening Cash</p>
            <p className="text-sm font-semibold text-slate-700 font-mono">₱{formatCurrency(shift.opening_cash)}</p>
          </div>
          {resumable && (
            <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center group-hover:bg-emerald-500 transition-colors">
              <ArrowRight className="w-4 h-4 text-emerald-600 group-hover:text-white transition-colors" />
            </div>
          )}
        </div>
      </div>
    );

    if (resumable) {
      return (
        <Link key={shift.shift_id} to={`/inventory/pos/session/${shift.shift_id}`}>
          {card}
        </Link>
      );
    }
    return <div key={shift.shift_id}>{card}</div>;
  }

  return (
    <div className="p-6 max-w-screen-xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Point of Sale</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {profile?.name ? `Welcome, ${profile.name}` : 'Select a session to start selling'}
          </p>
        </div>
        <Link
          to="/inventory/pos/open-shift"
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Open New Shift
        </Link>
      </div>

      {/* My open shifts */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-3">Your Open Shifts</h2>
        {loading ? (
          <div className="py-8 text-center bg-white rounded-xl border border-slate-200">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : myOpenShifts.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Clock className="w-7 h-7 text-slate-400" />
            </div>
            <p className="font-medium text-slate-600">No open shifts</p>
            <p className="text-sm text-slate-400 mt-1">Open a shift to start taking sales</p>
            <Link
              to="/inventory/pos/open-shift"
              className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Open Shift
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {myOpenShifts.map(shift => (
              <ShiftCard key={shift.shift_id} shift={shift} resumable={true} />
            ))}
          </div>
        )}
      </div>

      {/* Admin: other open shifts */}
      {isAdmin && allOpenShifts.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-3">
            Other Open Shifts
            <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs normal-case font-semibold">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              {allOpenShifts.length} active
            </span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {allOpenShifts.map(shift => (
              <ShiftCard key={shift.shift_id} shift={shift} resumable={false} />
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <div>
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-3">POS Management</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { to: '/inventory/pos/shifts', icon: Clock, label: 'All Shifts', desc: 'View and manage shift history' },
              { to: '/inventory/pos/terminals', icon: Monitor, label: 'Terminals', desc: 'Manage POS terminal setup' },
            ].map(({ to, icon: Icon, label, desc }) => (
              <Link
                key={to}
                to={to}
                className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:shadow-md hover:border-slate-300 transition-all flex items-start gap-3"
              >
                <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-800 text-sm">{label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
