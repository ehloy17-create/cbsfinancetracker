import { useState, useEffect, useCallback } from 'react';
import { Banknote, Building2, Wallet, Plus, Trash2, Save, TrendingDown, ArrowUpCircle, Calendar, CheckCircle, History, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { calculateCashFundRunningBalance } from '../lib/cashTransactions';
import { archiveSourceDisbursement, upsertSourceDisbursement } from '../lib/disbursements';
import { CashTransaction, CashDailyHistory, Transaction } from '../lib/types';
import { formatCurrency, formatDate, formatDateTime, getTodayDateString, round2 } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import ConfirmDialog from '../components/ConfirmDialog';
import { createCashLedgerEntry } from '../lib/financeMonitoring';
import { getCashFundOpeningBalance, hasCashFundBeginningBalanceSet, postCashDailyHistory, processMissedRollovers } from '../lib/rollover';

type FormMode = 'beginning_balance' | 'bank_deposit' | 'cash_fund_disbursement';

const emptyForm = {
  date: getTodayDateString(),
  mode: 'beginning_balance' as FormMode,
  amount: '',
  notes: '',
};

export default function CashLedgerPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [entries, setEntries] = useState<CashTransaction[]>([]);
  const [cashHistory, setCashHistory] = useState<CashDailyHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [dateFrom, setDateFrom] = useState(getTodayDateString());
  const [dateTo, setDateTo] = useState(getTodayDateString());
  const [showHistory, setShowHistory] = useState(false);
  const [cashFundInitialized, setCashFundInitialized] = useState(false);
  const [todayGcashTxns, setTodayGcashTxns] = useState<Array<Pick<Transaction, 'transaction_type' | 'amount' | 'transaction_fee' | 'fee_type' | 'cash_source' | 'cash_out_type' | 'cash_in_mode' | 'amount_received'>>>([]);
  const [openingBalanceToday, setOpeningBalanceToday] = useState(0);

  const today = getTodayDateString();

  const load = useCallback(async () => {
    setLoading(true);
    await processMissedRollovers(user?.id ?? null);
    const [{ data: txData }, { data: histData }, { data: gcashTxData }, initialized, openingBalance] = await Promise.all([
      supabase
        .from('cash_transactions')
        .select('*, profiles(name)')
        .eq('is_deleted', false)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('cash_daily_history')
        .select('*, profiles(name)')
        .order('date', { ascending: false })
        .limit(30),
      supabase
        .from('transactions')
        .select('transaction_type, amount, transaction_fee, fee_type, cash_source, cash_out_type, cash_in_mode, amount_received')
        .eq('date', today)
        .eq('is_deleted', false)
        .eq('is_closed', false),
      hasCashFundBeginningBalanceSet(),
      getCashFundOpeningBalance(today),
    ]);
    setEntries((txData as unknown as CashTransaction[]) || []);
    setCashHistory((histData as unknown as CashDailyHistory[]) || []);
    setTodayGcashTxns((gcashTxData as Array<Pick<Transaction, 'transaction_type' | 'amount' | 'transaction_fee' | 'fee_type' | 'cash_source' | 'cash_out_type' | 'cash_in_mode' | 'amount_received'>>) || []);
    setCashFundInitialized(initialized);
    setOpeningBalanceToday(openingBalance);
    setLoading(false);
  }, [today, user?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('cash-ledger')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_transactions' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_daily_history' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  async function handleSubmit() {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) {
      showToast('Please enter a valid amount', 'warning');
      return;
    }
    if (form.mode === 'beginning_balance' && cashFundInitialized) {
      showToast('Beginning balance is only set once. Daily opening now rolls forward automatically.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const data = await createCashLedgerEntry({
        date: form.date,
        transaction_type: form.mode,
        amount,
        description: form.notes?.trim() || (form.mode === 'beginning_balance'
          ? 'Cash fund beginning balance'
          : form.mode === 'bank_deposit'
          ? 'Cash fund bank deposit'
          : 'Cash fund disbursement'),
        notes: form.notes,
        source_module: form.mode === 'cash_fund_disbursement' ? 'cash_ledger' : 'cash_fund',
        transaction_category: form.mode === 'cash_fund_disbursement'
          ? 'disbursement'
          : form.mode === 'bank_deposit'
          ? 'transfer'
          : 'regular',
        created_by: user?.id ?? null,
      });
      await writeAuditLog(user?.id ?? null, 'CREATE', 'CashTransactions', data?.id, {
        type: form.mode,
        amount,
        date: form.date,
      });
      if (form.mode === 'cash_fund_disbursement' && data?.id) {
        const purpose = form.notes.trim() || 'Cash fund direct disbursement';
        const disbursement = await upsertSourceDisbursement({
          source_module: 'cash_fund',
          source_reference_id: String(data.id),
          source_account_type: 'cash_fund',
          source_account_id: null,
          disbursement_type: 'cash_fund_direct',
          date: form.date,
          payee: purpose,
          purpose,
          description: purpose,
          amount,
          payment_method: 'cash',
          notes: form.notes.trim(),
          created_by: user?.id ?? null,
        });
        await supabase
          .from('cash_transactions')
          .update({
            disbursement_id: disbursement.id,
            source_module: 'disbursement',
            updated_at: new Date().toISOString(),
          })
          .eq('id', data.id);
      }
      showToast(
        form.mode === 'beginning_balance'
          ? 'Beginning balance set'
          : form.mode === 'bank_deposit'
          ? 'Bank deposit recorded'
          : 'Cash disbursement recorded',
        'success'
      );
      setForm({ ...emptyForm, mode: form.mode, date: form.date });
    } catch {
      showToast('Failed to save entry', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    const { data: row } = await supabase
      .from('cash_transactions')
      .select('transaction_type')
      .eq('id', id)
      .maybeSingle();
    await supabase
      .from('cash_transactions')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (row?.transaction_type === 'cash_fund_disbursement') {
      await archiveSourceDisbursement('cash_fund', id);
    }
    await writeAuditLog(user?.id ?? null, 'DELETE', 'CashTransactions', id, {});
    showToast('Entry deleted', 'success');
    setDeleteTarget(null);
  }

  async function handleCloseDay() {
    setClosing(true);
    try {
      const ok = await postCashDailyHistory(today, user?.id ?? null);
      if (!ok) throw new Error('close failed');

      await writeAuditLog(user?.id ?? null, 'DAILY_CLOSE', 'CashDailyHistory', undefined, {
        date: today,
        ending_balance: todayBalance,
      });

      showToast('Cash day closed successfully', 'success');
      setCloseConfirm(false);
      setShowHistory(true);
    } catch {
      showToast('Failed to close day', 'error');
    } finally {
      setClosing(false);
    }
  }

  const filtered = entries.filter(e => e.date >= dateFrom && e.date <= dateTo);

  const todayBalance = (() => {
    const rangeEntries = entries.filter(e => e.date >= dateFrom && e.date <= dateTo && !e.is_deleted);
    if (dateFrom === dateTo && dateFrom === today) {
      return calculateCashFundRunningBalance(
        openingBalanceToday,
        rangeEntries.map(entry => ({ transaction_type: entry.transaction_type, amount: entry.amount })),
        todayGcashTxns
      );
    }
    const opening = Number(
      cashHistory
        .filter(h => h.date >= dateFrom && h.date <= dateTo)
        .sort((a, b) => a.date.localeCompare(b.date))[0]?.beginning_balance ?? 0
    );
    return calculateCashFundRunningBalance(
      opening,
      rangeEntries.map(entry => ({ transaction_type: entry.transaction_type, amount: entry.amount })),
      []
    );
  })();

  const todayClosed = cashHistory.some(h => h.date === today);

  const todaySummary = (() => {
    const todayEntries = entries.filter(e => e.date === today && !e.is_deleted);
    const deposits = round2(todayEntries
      .filter(e => e.transaction_type === 'bank_deposit')
      .reduce((s, e) => round2(s + Number(e.amount)), 0));
    const disbursements = round2(todayEntries
      .filter(e => e.transaction_type === 'cash_fund_disbursement')
      .reduce((s, e) => round2(s + Number(e.amount)), 0));
    return { beginning: openingBalanceToday, deposits, disbursements };
  })();

  const inputClass = 'w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition';
  const labelClass = 'block text-sm font-medium text-slate-700 mb-1.5';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
          <Banknote className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Cash Ledger</h1>
          <p className="text-slate-500 text-sm">Manage physical cash with rolled-forward opening balance and retained disbursement audit trails</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Form */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
            <p className={labelClass}>Transaction Type</p>
            <div className="grid grid-cols-3 gap-3 mb-5">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, mode: 'beginning_balance' }))}
                disabled={cashFundInitialized}
                className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                  form.mode === 'beginning_balance'
                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300'
                } ${cashFundInitialized ? 'opacity-50 cursor-not-allowed hover:border-slate-200' : ''}`}
              >
                <Wallet className="w-4 h-4" />
                <span className="text-xs text-center leading-tight">Beginning Balance</span>
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, mode: 'bank_deposit' }))}
                className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                  form.mode === 'bank_deposit'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                <Building2 className="w-4 h-4" />
                <span className="text-xs text-center leading-tight">Bank Deposit</span>
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, mode: 'cash_fund_disbursement' }))}
                className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                  form.mode === 'cash_fund_disbursement'
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                <ArrowUpCircle className="w-4 h-4" />
                <span className="text-xs text-center leading-tight">Direct Disbursement</span>
              </button>
            </div>

            {form.mode === 'beginning_balance' ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                <p className="text-xs text-amber-700 font-medium">
                  {cashFundInitialized
                    ? 'Beginning balance was already initialized. New days now inherit the previous ending balance automatically.'
                    : 'Sets the starting physical cash amount once. After that, each new day inherits the previous ending balance.'}
                </p>
              </div>
            ) : form.mode === 'bank_deposit' ? (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg mb-4">
                <p className="text-xs text-blue-700 font-medium">Records cash deposited to the bank. This amount is deducted from your cash on hand.</p>
              </div>
            ) : (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
                <p className="text-xs text-red-700 font-medium">Records a direct cash payment from the fund. Deducted from cash on hand.</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className={labelClass}>Date *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Amount (₱) *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                  <input
                    type="number" inputMode="decimal"
                    value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className="w-full pl-7 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes..."
                  className={inputClass}
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={submitting || (form.mode === 'beginning_balance' && cashFundInitialized)}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60 ${
                  form.mode === 'beginning_balance'
                    ? 'bg-amber-600 hover:bg-amber-700 text-white'
                    : form.mode === 'bank_deposit'
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {submitting
                  ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : form.mode === 'beginning_balance'
                  ? <Save className="w-4 h-4" />
                  : form.mode === 'bank_deposit'
                  ? <Plus className="w-4 h-4" />
                  : <ArrowUpCircle className="w-4 h-4" />
                }
                {submitting
                  ? 'Saving...'
                  : form.mode === 'beginning_balance'
                  ? 'Set Beginning Balance'
                  : form.mode === 'bank_deposit'
                  ? 'Record Bank Deposit'
                  : 'Record Disbursement'
                }
              </button>
            </div>
          </div>

          {/* Today's Summary + Close Day */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-semibold text-slate-700">
                  Cash Summary {dateFrom === dateTo ? `— ${formatDate(dateFrom)}` : `— ${formatDate(dateFrom)} to ${formatDate(dateTo)}`}
                </span>
              </div>
              {todayClosed && (
                <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                  <CheckCircle className="w-3 h-3" />
                  Closed
                </span>
              )}
            </div>
            {(() => {
              const dayEntries = entries.filter(e => e.date >= dateFrom && e.date <= dateTo && !e.is_deleted);
              const beginning = dateFrom === dateTo && dateFrom === today
                ? openingBalanceToday
                : Number(
                    cashHistory
                      .filter(h => h.date >= dateFrom && h.date <= dateTo)
                      .sort((a, b) => a.date.localeCompare(b.date))[0]?.beginning_balance ?? 0
                  );
              const deposits = round2(dayEntries
                .filter(e => e.transaction_type === 'bank_deposit')
                .reduce((s, e) => round2(s + Number(e.amount)), 0));
              const disbursements = round2(dayEntries
                .filter(e => e.transaction_type === 'cash_fund_disbursement')
                .reduce((s, e) => round2(s + Number(e.amount)), 0));
              const net = dateFrom === dateTo && dateFrom === today
                ? todayBalance
                : round2(beginning - deposits - disbursements);
              return (
                <div className="space-y-2">
                  <div className="flex justify-between items-center py-2 border-b border-slate-100">
                    <span className="text-sm text-slate-600">Beginning Cash</span>
                    <span className="text-sm font-semibold text-amber-700">{formatCurrency(beginning)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-100">
                    <span className="text-sm text-slate-600">Bank Deposits</span>
                    <span className="text-sm font-semibold text-blue-600">-{formatCurrency(deposits)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-100">
                    <span className="text-sm text-slate-600">Direct Disbursements</span>
                    <span className="text-sm font-semibold text-red-600">-{formatCurrency(disbursements)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm font-bold text-slate-700">Net Cash on Hand</span>
                    <span className={`text-lg font-black ${net >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(net)}</span>
                  </div>
                </div>
              );
            })()}
            <p className="text-xs text-slate-400 mt-2">Current-day balance includes GCash cash-side activity; close day archives the summary and clears non-disbursement rows.</p>

            {dateFrom === dateTo && dateFrom === today && (
              <button
                onClick={() => setCloseConfirm(true)}
                disabled={closing || todaySummary.beginning === 0}
                className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle className="w-4 h-4" />
                {todayClosed ? 'Re-close Day (Update)' : 'Close Day'}
              </button>
            )}
          </div>
        </div>

        {/* Log */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-700">Cash Ledger History</span>
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-slate-400 text-xs">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => { setDateFrom(getTodayDateString()); setDateTo(getTodayDateString()); }}
                  className="px-2 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Today
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-40">
                <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Banknote className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">No entries for this date</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50 overflow-y-auto flex-1 max-h-[500px]">
                {filtered.map(entry => {
                  const isBeginning = entry.transaction_type === 'beginning_balance';
                  const isDeposit = entry.transaction_type === 'bank_deposit';
                  return (
                    <div key={entry.id} className="px-5 py-3.5 flex items-center gap-3 hover:bg-slate-50 transition-colors group">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isBeginning ? 'bg-amber-100' : isDeposit ? 'bg-blue-100' : 'bg-red-100'
                      }`}>
                        {isBeginning
                          ? <Wallet className="w-4 h-4 text-amber-600" />
                          : isDeposit
                          ? <Building2 className="w-4 h-4 text-blue-600" />
                          : <ArrowUpCircle className="w-4 h-4 text-red-600" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold ${isBeginning ? 'text-amber-700' : 'text-red-600'}`}>
                            {isBeginning ? '' : '-'}{formatCurrency(Number(entry.amount))}
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                            isBeginning
                              ? 'bg-amber-100 text-amber-700'
                              : isDeposit
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {isBeginning ? 'Beginning' : isDeposit ? 'Bank Deposit' : 'Direct Disbursement'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-400">{formatDate(entry.date)}</span>
                          {entry.notes && (
                            <span className="text-xs text-slate-400 truncate max-w-[160px]">· {entry.notes}</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-300 mt-0.5">{formatDateTime(entry.created_at)}</p>
                      </div>
                      <button
                        onClick={() => setDeleteTarget(entry.id)}
                        className="p-1.5 rounded text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {!loading && filtered.length > 0 && (
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                <span className="text-xs text-slate-500">Net cash on hand</span>
                <span className={`text-sm font-bold flex items-center gap-1 ${todayBalance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {todayBalance < 0 && <TrendingDown className="w-3.5 h-3.5" />}
                  {formatCurrency(todayBalance)}
                </span>
              </div>
            )}
          </div>

          {/* Cash Daily History */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <button
              onClick={() => setShowHistory(h => !h)}
              className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-100 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-semibold text-slate-700">Cash Closing History</span>
                {cashHistory.length > 0 && (
                  <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{cashHistory.length}</span>
                )}
              </div>
              {showHistory ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>

            {showHistory && (
              cashHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <History className="w-7 h-7 mb-2 opacity-30" />
                  <p className="text-sm">No closing records yet</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        {['Date', 'Opening', 'Cash Fees', 'Given Out', 'Disbursed', 'Bank Dep.', 'Closing'].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {cashHistory.map(h => (
                        <tr key={h.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 text-slate-700 font-medium whitespace-nowrap">{formatDate(h.date)}</td>
                          <td className="px-4 py-3 text-amber-700 whitespace-nowrap">{formatCurrency(Number(h.beginning_balance))}</td>
                          <td className="px-4 py-3 text-orange-600 whitespace-nowrap">+{formatCurrency(Number(h.cash_fees_collected))}</td>
                          <td className="px-4 py-3 text-red-500 whitespace-nowrap">-{formatCurrency(Number(h.cash_given_out))}</td>
                          <td className="px-4 py-3 text-red-600 whitespace-nowrap">-{formatCurrency(Number(h.cash_fund_disbursements))}</td>
                          <td className="px-4 py-3 text-blue-600 whitespace-nowrap">-{formatCurrency(Number(h.bank_deposits))}</td>
                          <td className="px-4 py-3 font-bold text-slate-800 whitespace-nowrap">{formatCurrency(Number(h.ending_balance))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Entry"
        message="Are you sure you want to delete this cash ledger entry?"
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={closeConfirm}
        title={todayClosed ? 'Re-close Cash Day' : 'Close Cash Day'}
        message={`This will archive today's cash summary and carry ${formatCurrency(todayBalance)} forward as tomorrow's opening balance while keeping disbursement-linked entries for audit. Continue?`}
        confirmLabel={todayClosed ? 'Update Closing' : 'Close Day'}
        onConfirm={handleCloseDay}
        onCancel={() => setCloseConfirm(false)}
      />
    </div>
  );
}
