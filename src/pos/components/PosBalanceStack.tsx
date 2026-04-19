import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Banknote, ChevronRight, Smartphone, Wallet, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Account, CashDailyHistory, CashTransaction, Transaction } from '../../lib/types';
import { calculateCashFundRunningBalance } from '../../lib/cashTransactions';
import { formatCurrency, getTodayDateString, round2 } from '../../lib/utils';
import { mapGcashRunningBalances } from '../../lib/gcashBalances';
import { processMissedRollovers } from '../../lib/rollover';
import { useAuth } from '../../contexts/AuthContext';
import { fetchShiftReport } from '../lib/posCheckout';

interface BalanceCard {
  key: string;
  label: string;
  amount: number;
  meta?: string;
  icon: typeof Smartphone;
  tone: string;
  accountId?: string;
}

interface PosGcashTransaction extends Transaction {
  description?: string;
  reference_number?: string;
}

function normalizeName(name: string) {
  return name.toLowerCase().replace(/\s+/g, '');
}

function findAccount(accounts: Account[], matcher: (name: string) => boolean, fallbackIdx: number, excludeId?: string) {
  const matched = accounts.find(acc => acc.id !== excludeId && matcher(normalizeName(acc.name)));
  if (matched) return matched;
  return accounts.filter(acc => acc.id !== excludeId)[fallbackIdx] ?? null;
}

function describeAction(txn: PosGcashTransaction) {
  if (txn.transaction_type === 'cash_in' && txn.cash_in_mode === 'payment') return 'Reference POS payment';
  if (txn.transaction_type === 'cash_in' && txn.cash_source === 'cash_fund') return 'Receive cash from fund';
  if (txn.transaction_type === 'cash_in') return 'Confirm incoming amount';
  if (txn.cash_out_type === 'pos_remittance') return 'Release to POS register';
  if (txn.cash_out_type === 'add_to_cash_fund') return 'Release to cash fund';
  if (txn.cash_out_type === 'move_to_bank') return 'Transfer to bank';
  return 'Review transaction';
}

export default function PosBalanceStack({ refreshKey = 0, shiftId }: { refreshKey?: number; shiftId?: string }) {
  const { user } = useAuth();
  const [cards, setCards] = useState<BalanceCard[]>([]);
  const [accountDetails, setAccountDetails] = useState<Record<string, { name: string; txns: PosGcashTransaction[] }>>({});
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const hasSyncedRollovers = useRef(false);

  const load = useCallback(async (runRollovers = false) => {
    if (runRollovers && !hasSyncedRollovers.current) {
      await processMissedRollovers(user?.id ?? null);
      hasSyncedRollovers.current = true;
    }

    const today = getTodayDateString();
    const [{ data: accountRows }, { data: cashRows }, { data: historyRows }, { data: txnRows }, shiftReport] = await Promise.all([
      supabase.from('accounts').select('*').eq('is_active', true).order('name', { ascending: true }),
      supabase
        .from('cash_transactions')
        .select('date, transaction_type, amount')
        .eq('date', today)
        .eq('is_deleted', false),
      supabase
        .from('cash_daily_history')
        .select('date, ending_balance')
        .order('date', { ascending: false })
        .limit(1),
      supabase
        .from('transactions')
        .select('id, account_id, date, transaction_type, cash_in_mode, amount, transaction_fee, amount_received, delivery_fee, notes, created_by, created_at, updated_at, fee_type, cash_source, cash_out_type, bank_account_id, is_deleted, description, reference_number')
        .eq('date', today)
        .eq('is_deleted', false)
        .eq('is_closed', false),
      shiftId ? fetchShiftReport(shiftId) : Promise.resolve(null),
    ]);

    const accounts = ((accountRows ?? []) as Account[]).slice().sort((a, b) => a.name.localeCompare(b.name));
    const cashEntries = (cashRows ?? []) as CashTransaction[];
    const lastCashHistory = ((historyRows ?? []) as CashDailyHistory[])[0] ?? null;
    const txns = (txnRows ?? []) as PosGcashTransaction[];
    const runningBalances = mapGcashRunningBalances(accounts, txns);

    let shiftTxns: PosGcashTransaction[] = [];
    if (shiftReport?.shift.shift_open_time) {
      let shiftTxnQuery = supabase
        .from('transactions')
        .select('id, account_id, date, transaction_type, cash_in_mode, amount, transaction_fee, amount_received, delivery_fee, notes, created_by, created_at, updated_at, fee_type, cash_source, cash_out_type, bank_account_id, is_deleted, description, reference_number')
        .eq('is_deleted', false)
        .gte('created_at', shiftReport.shift.shift_open_time);

      if (shiftReport.shift.shift_close_time) {
        shiftTxnQuery = shiftTxnQuery.lte('created_at', shiftReport.shift.shift_close_time);
      }

      const { data: shiftTxnRows } = await shiftTxnQuery.order('created_at', { ascending: false });
      shiftTxns = (shiftTxnRows ?? []) as PosGcashTransaction[];
    }

    const nextAccountDetails = accounts.reduce<Record<string, { name: string; txns: PosGcashTransaction[] }>>((acc, account) => {
      acc[account.id] = {
        name: account.name,
        txns: shiftTxns
          .filter(txn => txn.account_id === account.id)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      };
      return acc;
    }, {});

    const gcash1 = findAccount(accounts, name => name.includes('gcash') && name.includes('1'), 0);
    const gcash2 = findAccount(accounts, name => name.includes('gcash') && name.includes('2'), 0, gcash1?.id);

    const beginningEntries = round2(cashEntries
      .filter(entry => entry.transaction_type === 'beginning_balance')
      .reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0));
    const cashBeginning = beginningEntries > 0
      ? beginningEntries
      : round2(Number(lastCashHistory?.ending_balance ?? 0));
    const cashFundRunning = calculateCashFundRunningBalance(
      cashBeginning,
      cashEntries
        .filter(entry => entry.transaction_type !== 'beginning_balance')
        .map(entry => ({ transaction_type: entry.transaction_type, amount: entry.amount })),
      txns
    );

    setAccountDetails(nextAccountDetails);
    setCards([
      {
        key: 'pos-register',
        label: 'POS Register',
        amount: round2(Number(shiftReport?.expectedCash ?? shiftReport?.shift.expected_cash_count ?? shiftReport?.shift.opening_cash ?? 0)),
        meta: `Beg: ${formatCurrency(Number(shiftReport?.shift.opening_cash ?? 0))}`,
        icon: Banknote,
        tone: 'border-fuchsia-800/60 bg-fuchsia-950/30 text-fuchsia-300',
      },
      {
        key: 'gcash-1',
        label: gcash1?.name ?? 'GCash 1',
        amount: round2(runningBalances[gcash1?.id ?? ''] ?? Number(gcash1?.current_beginning_balance ?? 0)),
        meta: gcash1?.id ? 'Click to view transactions' : undefined,
        icon: Smartphone,
        tone: 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300',
        accountId: gcash1?.id,
      },
      {
        key: 'gcash-2',
        label: gcash2?.name ?? 'GCash 2',
        amount: round2(runningBalances[gcash2?.id ?? ''] ?? Number(gcash2?.current_beginning_balance ?? 0)),
        meta: gcash2?.id ? 'Click to view transactions' : undefined,
        icon: Banknote,
        tone: 'border-blue-800/60 bg-blue-950/30 text-blue-300',
        accountId: gcash2?.id,
      },
      {
        key: 'cash-fund',
        label: 'Cash Fund',
        amount: cashFundRunning,
        icon: Wallet,
        tone: 'border-amber-800/60 bg-amber-950/30 text-amber-300',
      },
    ]);
  }, [shiftId, user?.id]);

  useEffect(() => {
    void load(true);
    const intervalId = window.setInterval(() => {
      void load();
    }, 5000);

    function handleWindowFocus() {
      void load();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void load();
      }
    }

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [load, refreshKey]);

  const selectedAccount = selectedAccountId ? accountDetails[selectedAccountId] : null;

  return (
    <>
      <div className="flex h-full flex-col gap-2">
        {cards.map(card => {
          const Icon = card.icon;
          const isClickable = Boolean(card.accountId);
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => isClickable && setSelectedAccountId(card.accountId ?? null)}
              disabled={!isClickable}
              className={`grid min-h-0 flex-1 grid-cols-[1fr_auto] items-center gap-3 rounded-xl border px-3 py-2 text-left ${card.tone} ${isClickable ? 'transition hover:bg-black/10 focus:outline-none focus:ring-2 focus:ring-white/20' : 'cursor-default'} disabled:opacity-100`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-black/10">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-semibold uppercase tracking-wider opacity-80">{card.label}</p>
                  {card.meta && <p className="truncate text-[10px] opacity-70">{card.meta}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isClickable && <ChevronRight className="h-4 w-4 opacity-70" />}
                <p className="truncate text-right font-mono text-base font-black">{formatCurrency(card.amount)}</p>
              </div>
            </button>
          );
        })}
      </div>

      {selectedAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setSelectedAccountId(null)}>
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-800 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{selectedAccount.name}</h3>
                <p className="text-xs text-slate-400">All transactions for this shift</p>
              </div>
              <button onClick={() => setSelectedAccountId(null)} className="text-slate-500 transition-colors hover:text-slate-300">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {selectedAccount.txns.length === 0 ? (
                <div className="rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-400">
                  No transactions for this GCash account in the current shift.
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900/40">
                  <div className="grid grid-cols-[88px_78px_1fr_120px_110px] gap-3 border-b border-slate-700 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    <span>Time</span>
                    <span>Type</span>
                    <span>Reference / Notes</span>
                    <span>Action</span>
                    <span className="text-right">Amount</span>
                  </div>
                  <div className="divide-y divide-slate-800">
                    {selectedAccount.txns.map(txn => {
                      const isCashIn = txn.transaction_type === 'cash_in';
                      const ref = txn.reference_number?.trim() || '—';
                      const note = txn.notes?.trim() || txn.description?.trim() || '';
                      return (
                        <div key={txn.id} className="grid grid-cols-[88px_78px_1fr_120px_110px] gap-3 px-3 py-2 text-xs">
                          <div className="text-slate-400">
                            {new Date(txn.created_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true })}
                          </div>
                          <div className={`inline-flex items-center gap-1 font-semibold ${isCashIn ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {isCashIn ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                            <span>{isCashIn ? 'IN' : 'OUT'}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-mono text-slate-100">{ref}</p>
                            <p className="truncate text-[11px] text-slate-400">
                              {note || (txn.cash_in_mode === 'payment' ? 'POS payment transaction' : '—')}
                            </p>
                          </div>
                          <div className="truncate text-[11px] text-amber-300">{describeAction(txn)}</div>
                          <div className="text-right">
                            <p className={`font-mono font-bold ${isCashIn ? 'text-emerald-300' : 'text-rose-300'}`}>
                              {isCashIn ? '+' : '-'}{formatCurrency(Number(txn.amount ?? 0))}
                            </p>
                            {(Number(txn.transaction_fee ?? 0) > 0 || Number(txn.delivery_fee ?? 0) > 0) && (
                              <p className="truncate text-[10px] text-slate-400">
                                {Number(txn.transaction_fee ?? 0) > 0 ? `F ${formatCurrency(Number(txn.transaction_fee ?? 0))}` : ''}
                                {Number(txn.transaction_fee ?? 0) > 0 && Number(txn.delivery_fee ?? 0) > 0 ? ' • ' : ''}
                                {Number(txn.delivery_fee ?? 0) > 0 ? `D ${formatCurrency(Number(txn.delivery_fee ?? 0))}` : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
