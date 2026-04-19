import { useState, useEffect } from 'react';
import { X, FileText, CheckCircle2, Clock, AlertCircle, XCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Supplier, CheckIssued, CheckStatus } from '../lib/types';
import { formatCurrency, formatDate } from '../lib/utils';

interface Props {
  supplier: Supplier;
  onClose: () => void;
}

const STATUS_CONFIG: Record<CheckStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  draft:       { label: 'Draft',       color: 'text-slate-700',  bg: 'bg-slate-100',  icon: <Clock        className="w-3 h-3" /> },
  pdc:         { label: 'PDC',         color: 'text-blue-700',   bg: 'bg-blue-100',   icon: <Clock        className="w-3 h-3" /> },
  outstanding: { label: 'Outstanding', color: 'text-amber-700',  bg: 'bg-amber-100',  icon: <AlertCircle  className="w-3 h-3" /> },
  cleared:     { label: 'Cleared',     color: 'text-emerald-700',bg: 'bg-emerald-100',icon: <CheckCircle2 className="w-3 h-3" /> },
  cancelled:   { label: 'Cancelled',   color: 'text-red-700',    bg: 'bg-red-100',    icon: <XCircle      className="w-3 h-3" /> },
  bounced:     { label: 'Bounced',     color: 'text-rose-700',   bg: 'bg-rose-100',   icon: <XCircle      className="w-3 h-3" /> },
};

const BALANCE_STATUSES: CheckStatus[] = ['draft', 'pdc', 'outstanding'];

export default function SupplierLedgerModal({ supplier, onClose }: Props) {
  const [checks, setChecks] = useState<CheckIssued[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('checks_issued')
      .select('*')
      .eq('supplier_id', supplier.id)
      .eq('is_deleted', false)
      .order('check_date', { ascending: false })
      .then(({ data }) => {
        setChecks((data as CheckIssued[]) || []);
        setLoading(false);
      });
  }, [supplier.id]);

  const totalIssued   = checks.reduce((s, c) => s + Number(c.amount), 0);
  const totalCleared  = checks.filter(c => c.status === 'cleared').reduce((s, c) => s + Number(c.amount), 0);
  const totalBalance  = checks.filter(c => BALANCE_STATUSES.includes(c.status)).reduce((s, c) => s + Number(c.amount), 0);
  const countBalance  = checks.filter(c => BALANCE_STATUSES.includes(c.status)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 flex items-center justify-center">
              <FileText className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">{supplier.name}</h2>
              <p className="text-xs text-slate-400">Supplier Ledger</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3 px-6 py-4 border-b border-white/10 flex-shrink-0">
              <div className="bg-white/5 rounded-xl p-4">
                <p className="text-xs text-slate-400 mb-1">Total Issued</p>
                <p className="text-xl font-bold text-white">{formatCurrency(totalIssued)}</p>
                <p className="text-xs text-slate-500 mt-0.5">{checks.length} check{checks.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="bg-emerald-600/10 rounded-xl p-4">
                <p className="text-xs text-emerald-400 mb-1">Cleared</p>
                <p className="text-xl font-bold text-emerald-300">{formatCurrency(totalCleared)}</p>
                <p className="text-xs text-emerald-600 mt-0.5">{checks.filter(c => c.status === 'cleared').length} check{checks.filter(c => c.status === 'cleared').length !== 1 ? 's' : ''}</p>
              </div>
              <div className={`rounded-xl p-4 ${totalBalance > 0 ? 'bg-amber-600/10' : 'bg-white/5'}`}>
                <p className={`text-xs mb-1 ${totalBalance > 0 ? 'text-amber-400' : 'text-slate-400'}`}>Outstanding Balance</p>
                <p className={`text-xl font-bold ${totalBalance > 0 ? 'text-amber-300' : 'text-slate-400'}`}>{formatCurrency(totalBalance)}</p>
                <p className={`text-xs mt-0.5 ${totalBalance > 0 ? 'text-amber-600' : 'text-slate-500'}`}>{countBalance} pending</p>
              </div>
            </div>

            {/* Check list */}
            <div className="overflow-y-auto flex-1">
              {checks.length === 0 ? (
                <div className="py-16 text-center text-slate-500">
                  <FileText className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No checks issued to this supplier</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#0f172a] z-10">
                    <tr className="border-b border-white/10">
                      <th className="text-left px-6 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Check #</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Issued</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Check Date</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Cleared</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {checks.map(check => {
                      const cfg = STATUS_CONFIG[check.status] ?? STATUS_CONFIG.draft;
                      return (
                        <tr key={check.id} className="hover:bg-white/5 transition-colors">
                          <td className="px-6 py-3.5 font-mono text-sm text-white font-medium">
                            {check.check_number}
                            {check.description && (
                              <p className="text-xs text-slate-500 font-sans truncate max-w-[160px]">{check.description}</p>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-slate-300 text-xs">{formatDate(check.issued_date)}</td>
                          <td className="px-4 py-3.5 text-slate-300 text-xs">{formatDate(check.check_date)}</td>
                          <td className="px-4 py-3.5 text-right font-semibold text-white">{formatCurrency(Number(check.amount))}</td>
                          <td className="px-4 py-3.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
                              {cfg.icon}{cfg.label}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-slate-400 text-xs">
                            {check.cleared_date ? formatDate(check.cleared_date) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer total row */}
            {checks.length > 0 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-white/10 flex-shrink-0 bg-white/5">
                <p className="text-xs text-slate-400">{checks.length} total record{checks.length !== 1 ? 's' : ''}</p>
                {totalBalance > 0 && (
                  <p className="text-sm font-semibold text-amber-300">
                    Balance due: {formatCurrency(totalBalance)}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
