import { useState, useEffect, useCallback } from 'react';
import { ArrowRightLeft, RefreshCw, Trash2, Building2, Wallet, Banknote, Receipt } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Account, BankAccount, Transaction } from '../lib/types';
import { formatCurrency, formatDate, formatDateTime, getTodayDateString, round2 } from '../lib/utils';
import { writeAuditLog } from '../lib/audit';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import RemittanceModal from '../components/RemittanceModal';
import { mapGcashRunningBalances } from '../lib/gcashBalances';
import { archiveBankTransactions, syncBankAccountBalances } from '../lib/financeMonitoring';

interface Remittance {
  id: string;
  date: string;
  source_type: string;
  source_account_id: string | null;
  destination_type: string;
  destination_bank_id: string | null;
  shift_id: string | null;
  amount: number;
  bank_fee: number;
  notes: string;
  source_transaction_id: string | null;
  destination_transaction_id: string | null;
  created_at: string;
  accounts?: { name: string } | null;
  bank_accounts?: { name: string } | null;
}

interface PosShiftOption {
  shift_id: string;
  business_date: string;
  cashier_name: string;
}

export default function RemittancePage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [remittances, setRemittances] = useState<Remittance[]>([]);
  const [gcashAccounts, setGcashAccounts] = useState<Account[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [runningBalances, setRunningBalances] = useState<Record<string, number>>({});
  const [posShifts, setPosShifts] = useState<PosShiftOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [filterDate, setFilterDate] = useState(getTodayDateString());

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [{ data: accs }, { data: banks }, { data: remits }, { data: shifts }, { data: openTxns }] = await Promise.all([
        supabase.from('accounts').select('*').eq('is_active', true).order('name'),
        supabase.from('bank_accounts').select('*').eq('is_active', true).order('name'),
        supabase
          .from('cashier_remittances')
          .select('*, accounts(name), bank_accounts(name)')
          .eq('date', filterDate)
          .eq('is_deleted', false)
          .order('created_at', { ascending: false }),
        // Load today's closed POS shifts for POS register remittance linkage
        supabase
          .from('pos_shifts')
          .select('shift_id, business_date, cashier:cashier_id(name)')
          .eq('business_date', filterDate)
          .eq('status', 'closed')
          .order('shift_id', { ascending: false }),
        supabase
          .from('transactions')
          .select('account_id, transaction_type, amount, transaction_fee, fee_type, cash_out_type')
          .eq('date', filterDate)
          .eq('is_deleted', false)
          .eq('is_closed', false),
      ]);
      const gcashRows = (accs || []) as Account[];
      setGcashAccounts(gcashRows);
      setBankAccounts(banks || []);
      setRemittances((remits as unknown as Remittance[]) || []);
      setRunningBalances(
        mapGcashRunningBalances(
          gcashRows,
          (openTxns || []) as Array<Pick<Transaction, 'account_id' | 'transaction_type' | 'amount' | 'transaction_fee' | 'fee_type' | 'cash_out_type'>>
        )
      );
      setPosShifts(
        ((shifts || []) as unknown as { shift_id: string; business_date: string; cashier: { name: string } | null }[])
          .map(s => ({
            shift_id: s.shift_id,
            business_date: s.business_date,
            cashier_name: s.cashier?.name ?? 'Cashier',
          }))
      );
    } catch {
      showToast('Failed to load remittances', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterDate, showToast]);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('remittances-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cashier_remittances' }, () => load(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  async function handleDelete(id: string) {
    const remittance = remittances.find(item => item.id === id);
    if (!remittance) return;
    await supabase
      .from('cashier_remittances')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (remittance.source_type === 'gcash' && remittance.source_transaction_id) {
      await supabase
        .from('transactions')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('id', remittance.source_transaction_id);
    }

    if (remittance.source_type === 'cash_fund' && remittance.source_transaction_id) {
      await supabase
        .from('cash_transactions')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('id', remittance.source_transaction_id);
    }

    if (remittance.destination_type === 'bank') {
      await archiveBankTransactions({
        source_transaction_id: remittance.source_transaction_id || remittance.id,
        bank_account_id: remittance.destination_bank_id ?? undefined,
      });
      await supabase
        .from('bank_deposits')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('cashier_remittance_id', id);
      if (remittance.destination_bank_id) {
        await syncBankAccountBalances(remittance.destination_bank_id);
      }
    }

    if (
      remittance.destination_type === 'cash_fund' &&
      remittance.destination_transaction_id &&
      (remittance.source_type === 'gcash' || remittance.source_type === 'pos_register')
    ) {
      await supabase
        .from('cash_transactions')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('id', remittance.destination_transaction_id);
    }

    await writeAuditLog(user?.id ?? null, 'DELETE', 'CashierRemittances', id, {});
    showToast('Remittance deleted and linked balances refreshed', 'success');
    setDeleteTarget(null);
    load(true);
  }

  const totals = remittances.reduce(
    (a, r) => ({
      amount: round2(a.amount + Number(r.amount)),
      bank_fee: round2(a.bank_fee + Number(r.bank_fee)),
    }),
    { amount: 0, bank_fee: 0 }
  );

  function sourceLabel(r: Remittance) {
    if (r.source_type === 'gcash') return (r.accounts as unknown as { name: string })?.name || 'GCash';
    if (r.source_type === 'pos_register') return 'POS Register';
    return 'Cash Fund';
  }

  function destLabel(r: Remittance) {
    if (r.destination_type === 'bank') return (r.bank_accounts as unknown as { name: string })?.name || 'Bank';
    return 'Cash Fund';
  }

  function sourceIcon(r: Remittance) {
    if (r.source_type === 'gcash') return <Wallet className="w-4 h-4 text-blue-500" />;
    if (r.source_type === 'pos_register') return <Receipt className="w-4 h-4 text-teal-500" />;
    return <Banknote className="w-4 h-4 text-amber-500" />;
  }

  function destIcon(r: Remittance) {
    if (r.destination_type === 'bank') return <Building2 className="w-4 h-4 text-blue-600" />;
    return <Banknote className="w-4 h-4 text-amber-500" />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Cashier Remittances</h1>
          <p className="text-slate-500 text-sm mt-0.5">Daily fund transfers between GCash, cash fund, and bank</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
          >
            <ArrowRightLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Make Remittance</span>
            <span className="sm:hidden">Remit</span>
          </button>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Date filter */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3 flex items-center gap-3">
        <label className="text-sm font-medium text-slate-600">Date</label>
        <input
          type="date"
          value={filterDate}
          onChange={e => setFilterDate(e.target.value)}
          className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Summary */}
      {remittances.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-blue-50 rounded-xl p-4">
            <p className="text-xs font-medium text-blue-600">Total Remitted</p>
            <p className="text-xl font-bold text-blue-700 mt-1">{formatCurrency(totals.amount)}</p>
          </div>
          <div className="bg-rose-50 rounded-xl p-4">
            <p className="text-xs font-medium text-rose-600">Total Bank Fees</p>
            <p className="text-xl font-bold text-rose-700 mt-1">{formatCurrency(totals.bank_fee)}</p>
          </div>
          <div className="bg-emerald-50 rounded-xl p-4">
            <p className="text-xs font-medium text-emerald-600">Net Deposited</p>
            <p className="text-xl font-bold text-emerald-700 mt-1">{formatCurrency(round2(totals.amount - totals.bank_fee))}</p>
          </div>
        </div>
      )}

      {/* Remittances list */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">Remittances for {formatDate(filterDate)}</h2>
        </div>

        {remittances.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <ArrowRightLeft className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm">No remittances for this date</p>
          </div>
        ) : (
          <>
            {/* Mobile */}
            <div className="sm:hidden divide-y divide-slate-100">
              {remittances.map(r => (
                <div key={r.id} className="px-4 py-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {sourceIcon(r)}
                      <span className="text-sm font-semibold text-slate-700">{sourceLabel(r)}</span>
                      <ArrowRightLeft className="w-3.5 h-3.5 text-slate-400" />
                      {destIcon(r)}
                      <span className="text-sm font-semibold text-slate-700">{destLabel(r)}</span>
                    </div>
                    {profile?.role === 'admin' && (
                      <button onClick={() => setDeleteTarget(r.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">{formatDateTime(r.created_at)}</span>
                    <span className="font-bold text-slate-800">{formatCurrency(Number(r.amount))}</span>
                  </div>
                  {Number(r.bank_fee) > 0 && (
                    <p className="text-xs text-rose-500 mt-0.5">Bank fee: -{formatCurrency(Number(r.bank_fee))}</p>
                  )}
                  {r.notes && <p className="text-xs text-slate-400 mt-0.5">{r.notes}</p>}
                </div>
              ))}
            </div>

            {/* Desktop */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    {['Time', 'Source', 'Destination', 'Amount', 'Bank Fee', 'Net', 'Notes', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {remittances.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {sourceIcon(r)}
                          <span className="font-medium text-slate-700">{sourceLabel(r)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {destIcon(r)}
                          <span className="font-medium text-slate-700">{destLabel(r)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">{formatCurrency(Number(r.amount))}</td>
                      <td className="px-4 py-3 text-rose-600 whitespace-nowrap">{Number(r.bank_fee) > 0 ? `-${formatCurrency(Number(r.bank_fee))}` : '—'}</td>
                      <td className="px-4 py-3 font-bold text-emerald-700 whitespace-nowrap">{formatCurrency(round2(Number(r.amount) - Number(r.bank_fee)))}</td>
                      <td className="px-4 py-3 text-slate-400 max-w-[180px] truncate">{r.notes || '—'}</td>
                      <td className="px-4 py-3">
                        {profile?.role === 'admin' && (
                          <button onClick={() => setDeleteTarget(r.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Remittance"
        message="Are you sure you want to delete this remittance? Linked finance entries will be reversed where available."
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />

      {showModal && (
        <RemittanceModal
          gcashAccounts={gcashAccounts}
          bankAccounts={bankAccounts}
          posShifts={posShifts}
          runningBalances={runningBalances}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); load(true); }}
        />
      )}
    </div>
  );
}
