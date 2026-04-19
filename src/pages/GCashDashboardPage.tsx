import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, TrendingDown, ArrowDownCircle, ArrowUpCircle,
  Receipt, Truck, Wallet, RefreshCw, Pencil, Trash2, X, Banknote,
  ShoppingCart, Download, Plus, LogOut, CheckCircle, AlertTriangle, ArrowRightLeft
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Account, Transaction, DailySummary, CashBalance, DailySales, CashTransaction } from '../lib/types';
import { formatCurrency, formatDate, formatDateTime, getTodayDateString, round2, objectsToCSV, downloadCSV } from '../lib/utils';
import { closeFinanceDay, processMissedRollovers } from '../lib/rollover';
import { writeAuditLog } from '../lib/audit';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import RemittanceModal from '../components/RemittanceModal';
import { archiveBankTransactions, syncBankAccountBalances } from '../lib/financeMonitoring';
import {
  calculateCashFundRunningBalance,
  getCashFundDeltaFromGcash,
  getGcashFeeEffect,
  getPosRegisterDeltaFromGcash,
  upsertLinkedBankDepositRequest,
} from '../lib/cashTransactions';
import { calculateGcashRunningBalance } from '../lib/gcashBalances';

type DashboardTxn = Transaction & {
  amount_received?: number | string | null;
  cash_source?: string | null;
  cash_in_mode?: string | null;
};

function isPosManagedProductPayment(txn: Pick<Transaction, 'transaction_type' | 'cash_in_mode'>) {
  return txn.transaction_type === 'cash_in' && txn.cash_in_mode === 'payment';
}

function isPosProtectedTransaction(txn: Pick<Transaction, 'transaction_type' | 'cash_in_mode' | 'cash_out_type' | 'reversal_of_transaction_id'>) {
  return isPosManagedProductPayment(txn) || txn.cash_out_type === 'void_reversal' || Boolean(txn.reversal_of_transaction_id);
}

type DashboardTotals = {
  total_cash_in: number;
  total_cash_out: number;
  total_transaction_fee: number;
  total_delivery_fee: number;
  total_cash_fees: number;
  total_product_payment: number;
  total_cash_fund_given: number;
  total_pos_register: number;
  total_cash_out_to_fund: number;
  total_bank_fees: number;
};

type CashFundMovement = {
  id: string;
  created_at: string;
  label: string;
  source: string;
  notes: string;
  delta: number;
};

export default function GCashDashboardPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [accountTxns, setAccountTxns] = useState<Record<string, Transaction[]>>({});
  const [allTodayTxns, setAllTodayTxns] = useState<Transaction[]>([]);
  const [cashFundEntries, setCashFundEntries] = useState<CashTransaction[]>([]);
  const [cashBalance, setCashBalance] = useState<CashBalance | null>(null);
  const [productSales, setProductSales] = useState<DailySales[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Transaction | null>(null);
  const [showEndShift, setShowEndShift] = useState(false);
  const [endingShift, setEndingShift] = useState(false);
  const [showRemittance, setShowRemittance] = useState(false);
  const [gcashAccounts, setGcashAccounts] = useState<Account[]>([]);
  const [bankAccounts, setBankAccounts] = useState<{ id: string; name: string; bank_name?: string; current_balance?: number }[]>([]);
  const [hasDashboardData, setHasDashboardData] = useState(false);
  const [editForm, setEditForm] = useState({
    cash_in_mode: 'regular' as 'regular' | 'payment',
    cash_source: 'pos_register' as 'pos_register' | 'cash_fund',
    amount: '',
    product_payment: '',
    delivery_fee: '',
    transaction_fee: '',
    fee_type: 'gcash' as 'cash' | 'gcash',
    notes: '',
  });
  const today = getTodayDateString();
  const loadInFlightRef = useRef(false);
  const queuedRefreshRef = useRef(false);
  const hasDashboardDataRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (loadInFlightRef.current) {
      if (silent) queuedRefreshRef.current = true;
      return;
    }
    loadInFlightRef.current = true;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      if (!silent) await processMissedRollovers(user?.id ?? null);
      const { data: accs } = await supabase
        .from('accounts').select('*').eq('is_active', true).order('name');
      if (!accs || accs.length === 0) {
        hasDashboardDataRef.current = false;
        setHasDashboardData(false);
        setGcashAccounts([]);
        setBankAccounts([]);
        setSummaries([]);
        setAccountTxns({});
        setAllTodayTxns([]);
        setCashBalance(null);
        setProductSales([]);
        return;
      }
      setGcashAccounts(accs);

      const { data: banks } = await supabase
        .from('bank_accounts').select('id, name, bank_name, current_balance').eq('is_active', true).order('name');
      setBankAccounts(banks || []);

      const [sums, txnsPerAcc] = await Promise.all([
        Promise.all(accs.map(async (acc: Account) => {
          const { data: txns } = await supabase
            .from('transactions').select('*')
            .eq('account_id', acc.id).eq('date', today).eq('is_deleted', false).eq('is_closed', false);

          const totals = ((txns || []) as DashboardTxn[]).reduce(
            (a: DashboardTotals, t: DashboardTxn) => {
              if (t.transaction_type === 'cash_in') {
                a.total_cash_in = round2(a.total_cash_in + Number(t.amount));
                a.total_cash_fund_given = round2(a.total_cash_fund_given + Math.max(0, -getCashFundDeltaFromGcash(t)));
                a.total_pos_register = round2(a.total_pos_register + Math.max(0, getPosRegisterDeltaFromGcash(t)));
              } else {
                a.total_cash_out = round2(a.total_cash_out + Number(t.amount));
                if (t.cash_out_type === 'add_to_cash_fund' || t.cash_out_type === 'pos_remittance') {
                  const toFundAmount = round2(Number(t.amount) + Number(t.transaction_fee || 0));
                  a.total_cash_out_to_fund = round2(a.total_cash_out_to_fund + toFundAmount);
                }
                if (t.cash_out_type === 'move_to_bank') {
                  const bankFee = Number(t.transaction_fee || 0);
                  a.total_bank_fees = round2(a.total_bank_fees + bankFee);
                }
              }
              const fee = Number(t.transaction_fee || 0);
              if (t.fee_type === 'cash') {
                const cashSideFee = t.transaction_type === 'cash_in'
                  ? -fee
                  : (t.cash_out_type === 'move_to_bank' ? 0 : fee);
                a.total_cash_fees = round2(a.total_cash_fees + cashSideFee);
              } else {
                a.total_transaction_fee = round2(a.total_transaction_fee + getGcashFeeEffect(t));
              }
              a.total_delivery_fee = round2(a.total_delivery_fee + Number(t.delivery_fee || 0));
              if (t.transaction_type === 'cash_in' && t.cash_in_mode === 'payment') {
                a.total_product_payment = round2(a.total_product_payment + Number(t.amount_received || 0));
              }
              return a;
            },
            { total_cash_in: 0, total_cash_out: 0, total_transaction_fee: 0, total_delivery_fee: 0, total_cash_fees: 0, total_product_payment: 0, total_cash_fund_given: 0, total_pos_register: 0, total_cash_out_to_fund: 0, total_bank_fees: 0 }
          );

          const running = calculateGcashRunningBalance(acc, (txns || []) as Transaction[]);

          return {
            account: acc,
            beginning_balance: Number(acc.current_beginning_balance),
            ...totals,
            running_balance: running,
          } satisfies DailySummary;
        })),
        Promise.all(accs.map(async (acc: Account) => {
          const { data } = await supabase
            .from('transactions')
            .select('*')
            .eq('account_id', acc.id)
            .eq('date', today)
            .eq('is_deleted', false)
            .eq('is_closed', false)
            .order('created_at', { ascending: false })
            .limit(12);
          return { id: acc.id, txns: (data as unknown as Transaction[]) || [] };
        })),
      ]);

      setSummaries(sums);
      const txnMap: Record<string, Transaction[]> = {};
      txnsPerAcc.forEach(({ id, txns }) => { txnMap[id] = txns; });
      setAccountTxns(txnMap);

      const { data: allTxns } = await supabase
        .from('transactions')
        .select('*')
        .eq('date', today)
        .eq('is_deleted', false)
        .eq('is_closed', false)
        .order('created_at', { ascending: false });
      setAllTodayTxns((allTxns as unknown as Transaction[]) || []);

      const { data: cashTxns } = await supabase
        .from('cash_transactions')
        .select('*')
        .eq('date', today)
        .eq('is_deleted', false)
        .eq('is_closed', false)
        .order('created_at', { ascending: false });
      setCashFundEntries((cashTxns as unknown as CashTransaction[]) || []);

      let beginning = 0;
      let bankDeposits = 0;
      let cashFundDisbursements = 0;
      let posRemittances = 0;
      for (const ct of cashTxns || []) {
        if (ct.transaction_type === 'beginning_balance') beginning = round2(beginning + Number(ct.amount));
        else if (ct.transaction_type === 'bank_deposit') bankDeposits = round2(bankDeposits + Number(ct.amount));
        else if (ct.transaction_type === 'cash_fund_disbursement') cashFundDisbursements = round2(cashFundDisbursements + Number(ct.amount));
        else if (ct.transaction_type === 'pos_remittance') posRemittances = round2(posRemittances + Number(ct.amount));
      }

      const cashFeesCollected = round2(sums.reduce((a, s) => round2(a + s.total_cash_fees), 0));
      const cashFundGivenOut = round2(sums.reduce((a, s) => round2(a + s.total_cash_fund_given), 0));
      const cashOutToFund = round2(sums.reduce((a, s) => round2(a + s.total_cash_out_to_fund), 0));
      const totalCashIn = round2(cashOutToFund + posRemittances);
      setCashBalance({
        beginning,
        cash_fees_collected: cashFeesCollected,
        cash_given_out: cashFundGivenOut,
        cash_out_to_fund: totalCashIn,
        bank_deposits: bankDeposits,
        cash_fund_disbursements: cashFundDisbursements,
        running: calculateCashFundRunningBalance(
          beginning,
          (cashTxns || []).filter((ct: CashTransaction) => ct.transaction_type !== 'beginning_balance') as Array<{ transaction_type: string; amount: number }>,
          (allTxns || []) as DashboardTxn[]
        ),
        date: today,
      });

      const { data: salesData } = await supabase
        .from('daily_sales')
        .select('*')
        .eq('date', today)
        .order('created_at', { ascending: true });
      setProductSales(salesData || []);
      const nextHasDashboardData = (
        accs.length > 0
        && (
          sums.length > 0
          || (allTxns?.length ?? 0) > 0
          || (salesData?.length ?? 0) > 0
          || (cashTxns?.length ?? 0) > 0
        )
      );
      hasDashboardDataRef.current = nextHasDashboardData;
      setHasDashboardData(nextHasDashboardData);
    } catch {
      hasDashboardDataRef.current = false;
      setHasDashboardData(false);
      showToast('Failed to load GCash data', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
      loadInFlightRef.current = false;
      if (queuedRefreshRef.current && hasDashboardDataRef.current) {
        queuedRefreshRef.current = false;
        void load(true);
      } else {
        queuedRefreshRef.current = false;
      }
    }
  }, [user?.id, today, showToast]);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    if (!hasDashboardData) return;
    const channel = supabase
      .channel('gcash-dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_transactions' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_sales' }, () => load(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hasDashboardData, load]);

  const cashFundMovements = useMemo<CashFundMovement[]>(() => {
    const accountNameById = new Map(gcashAccounts.map(account => [account.id, account.name]));

    const ledgerMovements = cashFundEntries
      .filter(entry => !entry.is_deleted)
      .map((entry): CashFundMovement | null => {
        const amount = round2(Number(entry.amount || 0));
        if (amount === 0) return null;

        switch (entry.transaction_type) {
          case 'beginning_balance':
            return {
              id: `cash-${entry.id}`,
              created_at: entry.created_at,
              label: 'Beginning Cash',
              source: 'Cash Ledger',
              notes: entry.notes || 'Opening cash fund balance',
              delta: amount,
            };
          case 'pos_remittance':
            return {
              id: `cash-${entry.id}`,
              created_at: entry.created_at,
              label: 'POS Remittance',
              source: 'Cash Ledger',
              notes: entry.notes || 'POS register cash added to fund',
              delta: amount,
            };
          case 'cash_in':
            return {
              id: `cash-${entry.id}`,
              created_at: entry.created_at,
              label: 'Cash Added',
              source: 'Cash Ledger',
              notes: entry.notes || 'Manual cash fund increase',
              delta: amount,
            };
          case 'bank_deposit':
            return {
              id: `cash-${entry.id}`,
              created_at: entry.created_at,
              label: 'Bank Deposit',
              source: 'Cash Ledger',
              notes: entry.notes || 'Cash fund moved to bank',
              delta: -amount,
            };
          case 'cash_fund_disbursement':
            return {
              id: `cash-${entry.id}`,
              created_at: entry.created_at,
              label: 'Cash Fund Disbursement',
              source: 'Cash Ledger',
              notes: entry.notes || 'Cash released from fund',
              delta: -amount,
            };
          case 'cash_out':
            return {
              id: `cash-${entry.id}`,
              created_at: entry.created_at,
              label: 'Cash Removed',
              source: 'Cash Ledger',
              notes: entry.notes || 'Manual cash fund decrease',
              delta: -amount,
            };
          default:
            return null;
        }
      })
      .filter((movement): movement is CashFundMovement => Boolean(movement));

    const gcashMovements = allTodayTxns
      .map((txn): CashFundMovement | null => {
        const delta = getCashFundDeltaFromGcash(txn as DashboardTxn);
        if (delta === 0) return null;

        const accountName = accountNameById.get(txn.account_id) ?? 'GCash';
        const isIncrease = delta > 0;
        return {
          id: `gcash-${txn.id}`,
          created_at: txn.created_at,
          label: isIncrease ? 'GCash to Cash Fund' : 'Cash Fund to GCash',
          source: accountName,
          notes: txn.notes || (isIncrease ? 'Cash out added to physical fund' : 'Cash fund used for GCash cash in'),
          delta,
        };
      })
      .filter((movement): movement is CashFundMovement => Boolean(movement));

    return [...ledgerMovements, ...gcashMovements].sort((left, right) => right.created_at.localeCompare(left.created_at));
  }, [allTodayTxns, cashFundEntries, gcashAccounts]);

  const cashFundMovementTotals = useMemo(() => ({
    increases: round2(cashFundMovements.filter(item => item.delta > 0).reduce((sum, item) => sum + item.delta, 0)),
    decreases: round2(cashFundMovements.filter(item => item.delta < 0).reduce((sum, item) => sum + Math.abs(item.delta), 0)),
  }), [cashFundMovements]);

  async function handleDelete(id: string) {
    const tx = allTodayTxns.find(item => item.id === id) ?? Object.values(accountTxns).flat().find(item => item.id === id) ?? null;
    if (tx && isPosProtectedTransaction(tx)) {
      showToast('This POS-linked transaction can only be reversed by voiding the sale in POS', 'warning');
      setDeleteTarget(null);
      return;
    }
    await supabase.from('transactions')
      .update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('id', id);
    if (tx?.cash_out_type === 'move_to_bank' && tx.bank_account_id) {
      await archiveBankTransactions({ source_transaction_id: id, bank_account_id: tx.bank_account_id });
      await supabase.from('bank_deposits')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('source_transaction_id', id);
      await syncBankAccountBalances(tx.bank_account_id);
    }
    await writeAuditLog(user?.id ?? null, 'DELETE', 'Transactions', id, {});
    showToast('Transaction deleted', 'success');
    setDeleteTarget(null);
    await load(true);
  }

  function openEdit(t: Transaction) {
    const isPaymentMode = t.cash_in_mode === 'payment';
    setEditTarget(t);
    setEditForm({
      cash_in_mode: t.cash_in_mode || 'regular',
      cash_source: (t.cash_source as 'pos_register' | 'cash_fund') || 'pos_register',
      amount: isPaymentMode ? '' : String(t.amount),
      product_payment: isPaymentMode ? String(t.amount_received ?? t.amount) : '',
      delivery_fee: isPaymentMode ? String(t.delivery_fee ?? '') : '',
      transaction_fee: String(t.transaction_fee || ''),
      fee_type: (t.fee_type as 'cash' | 'gcash') || 'gcash',
      notes: t.notes || '',
    });
  }

  async function handleEdit() {
    if (!editTarget) return;

    if (editTarget.transaction_type === 'cash_out') {
      const nextAmount = parseFloat(editForm.amount) || 0;
      const nextFee = parseFloat(editForm.transaction_fee) || 0;
      const payload: Record<string, unknown> = {
        amount: nextAmount,
        transaction_fee: nextFee,
        fee_type: 'cash',
        notes: editForm.notes,
        updated_at: new Date().toISOString(),
      };

      await supabase.from('transactions').update(payload).eq('id', editTarget.id);
      if (editTarget.cash_out_type === 'move_to_bank' && editTarget.bank_account_id) {
        await archiveBankTransactions({ source_transaction_id: editTarget.id, bank_account_id: editTarget.bank_account_id });
        await supabase.from('bank_deposits')
          .update({ is_deleted: true, updated_at: new Date().toISOString() })
          .eq('source_transaction_id', editTarget.id);
        const accountName = gcashAccounts.find(a => a.id === editTarget.account_id)?.name || 'GCash';
        await upsertLinkedBankDepositRequest({
          bank_account_id: editTarget.bank_account_id,
          date: editTarget.date,
          amount: nextAmount,
          source_type: 'gcash_move',
          source_description: `GCash deposit from ${accountName}`,
          notes: editForm.notes,
          source_transaction_id: editTarget.id,
          source_module: 'gcash_dashboard',
          created_by: user?.id ?? null,
          status: 'deposited',
        });
        await syncBankAccountBalances(editTarget.bank_account_id);
      }
      await writeAuditLog(user?.id ?? null, 'UPDATE', 'Transactions', editTarget.id, {
        amount: payload.amount,
        transaction_fee: payload.transaction_fee,
        notes: editForm.notes,
      });
      showToast('Transaction updated', 'success');
      setEditTarget(null);
      await load(true);
      return;
    }

    const isEditPayment = editForm.cash_in_mode === 'payment';
    const editProductPayment = isEditPayment ? parseFloat(editForm.product_payment) || 0 : 0;
    const editDeliveryFee = isEditPayment ? parseFloat(editForm.delivery_fee) || 0 : 0;
    const computedEditAmount = isEditPayment
      ? editProductPayment + editDeliveryFee
      : parseFloat(editForm.amount) || 0;

    const payload: Record<string, unknown> = {
      cash_in_mode: editForm.cash_in_mode,
      amount: computedEditAmount,
      transaction_fee: parseFloat(editForm.transaction_fee) || 0,
      fee_type: editForm.fee_type,
      notes: editForm.notes,
      updated_at: new Date().toISOString(),
    };

    if (!isEditPayment) {
      payload.cash_source = editForm.cash_source;
      payload.amount_received = null;
      payload.delivery_fee = null;
    } else {
      payload.cash_source = null;
      payload.amount_received = editProductPayment;
      payload.delivery_fee = editDeliveryFee;
    }

    await supabase.from('transactions').update(payload).eq('id', editTarget.id);
    await writeAuditLog(user?.id ?? null, 'UPDATE', 'Transactions', editTarget.id, { amount: computedEditAmount, notes: editForm.notes });
    showToast('Transaction updated', 'success');
    setEditTarget(null);
    await load(true);
  }

  async function handleEndShift() {
    if (endingShift) return;
    setEndingShift(true);
    try {
      await closeFinanceDay(user?.id ?? null, today);

      await writeAuditLog(user?.id ?? null, 'END_SHIFT', 'GCashDashboard', undefined, {
        date: today,
        accounts: summaries.map(s => ({ account_id: s.account.id, ending_balance: s.running_balance })),
      });

      showToast('Shift ended successfully. Summary posted to history.', 'success');
      setShowEndShift(false);
      await load(false);
    } catch {
      showToast('Failed to end shift. Please try again.', 'error');
    } finally {
      setEndingShift(false);
    }
  }

  function exportToExcel() {
    const accountNameById = Object.fromEntries(gcashAccounts.map(a => [a.id, a.name]));

    const rows = allTodayTxns.map(t => ({
      Date: t.date,
      Time: formatDateTime(t.created_at),
      Account: accountNameById[t.account_id] || '',
      Type: t.transaction_type === 'cash_in' ? 'Cash In' : 'Cash Out',
      Mode: t.cash_in_mode || '',
      Amount: Number(t.amount).toFixed(2),
      'Transaction Fee': Number(t.transaction_fee || 0).toFixed(2),
      'Fee Type': t.fee_type || '',
      'Delivery Fee': Number(t.delivery_fee || 0).toFixed(2),
      'Amount Received': Number(t.amount_received || 0).toFixed(2),
      Notes: t.notes || '',
      'Created By': t.created_by || '',
    }));

    const productRows = productSales.map(s => ({
      Date: s.date,
      Time: formatDateTime(s.created_at),
      Account: 'Product Sales',
      Type: 'Product Payment',
      Mode: '',
      Amount: Number(s.sales).toFixed(2),
      'Transaction Fee': '0.00',
      'Fee Type': '',
      'Delivery Fee': '0.00',
      'Amount Received': '0.00',
      Notes: s.description || '',
      'Created By': (s.profiles as unknown as { name: string })?.name || '',
    }));

    const combined = [...rows, ...productRows];
    if (combined.length === 0) {
      showToast('No transactions to export', 'warning');
      return;
    }

    downloadCSV(
      objectsToCSV(combined as unknown as Record<string, unknown>[]),
      `gcash_reconciliation_${today}.csv`
    );
    showToast('Export ready for download', 'success');
  }

  const combined = summaries.reduce(
    (a, s) => ({
      beginning: round2(a.beginning + s.beginning_balance),
      running: round2(a.running + s.running_balance),
    }),
    { beginning: 0, running: 0 }
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!hasDashboardData && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          No GCash data yet. Auto-refresh stays paused until accounts or transactions are added.
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800">GCash Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">{formatDate(today)}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowEndShift(true)}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">End Shift</span>
            <span className="sm:hidden">End</span>
          </button>
          <button
            onClick={exportToExcel}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
            <span className="sm:hidden">Export</span>
          </button>
          <button
            onClick={() => setShowRemittance(true)}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
          >
            <ArrowRightLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Remittance</span>
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

      {/* Summary Box */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 px-4 sm:px-6 py-6 sm:py-7 text-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white 0%, transparent 50%)' }} />
          <p className="text-blue-200 text-xs font-semibold uppercase tracking-widest mb-2">
            Total GCash Running Balance
          </p>
          <p className="text-white text-4xl sm:text-5xl font-black tracking-tight">
            {formatCurrency(combined.running)}
          </p>
          <p className="text-blue-200 text-sm mt-2">
            Beginning: {formatCurrency(combined.beginning)}
          </p>
        </div>

        <div className={`grid divide-x divide-slate-100 border-b border-slate-100 ${summaries.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {summaries.map(s => (
            <div key={s.account.id} className="px-6 py-5 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <Wallet className="w-3.5 h-3.5 text-blue-500" />
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{s.account.name}</p>
              </div>
              <p className="text-2xl font-bold text-blue-700">{formatCurrency(s.running_balance)}</p>
              <p className="text-xs text-slate-400 mt-0.5">Beginning: {formatCurrency(s.beginning_balance)}</p>
            </div>
          ))}
        </div>

        <div className="px-6 py-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Today's Activity</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left pb-2 pr-4 text-xs text-slate-400 font-medium w-36"></th>
                  {summaries.map(s => (
                    <th key={s.account.id} className="text-right pb-2 px-3 text-xs font-semibold text-slate-600">
                      {s.account.name}
                    </th>
                  ))}
                  <th className="text-right pb-2 px-3 text-xs font-semibold text-slate-500">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {[
                  { label: 'Cash In', icon: <ArrowDownCircle className="w-3.5 h-3.5 text-emerald-500" />, values: summaries.map(s => s.total_cash_in), cls: 'text-emerald-600' },
                  { label: 'Cash Out', icon: <ArrowUpCircle className="w-3.5 h-3.5 text-red-400" />, values: summaries.map(s => s.total_cash_out), cls: 'text-red-500' },
                  { label: 'POS Register', icon: <Banknote className="w-3.5 h-3.5 text-teal-500" />, values: summaries.map(s => s.total_pos_register), cls: 'text-teal-600' },
                  { label: 'GCash Fee', icon: <Receipt className="w-3.5 h-3.5 text-amber-500" />, values: summaries.map(s => s.total_transaction_fee), cls: 'text-amber-600' },
                  { label: 'Cash Fee', icon: <Banknote className="w-3.5 h-3.5 text-orange-500" />, values: summaries.map(s => s.total_cash_fees), cls: 'text-orange-600' },
                  { label: 'Product Payment', icon: <ShoppingCart className="w-3.5 h-3.5 text-emerald-500" />, values: summaries.map(s => s.total_product_payment), cls: 'text-emerald-700' },
                  { label: 'Delivery Fees', icon: <Truck className="w-3.5 h-3.5 text-blue-400" />, values: summaries.map(s => s.total_delivery_fee), cls: 'text-blue-500' },
                ].map(row => {
                  const rowTotal = round2(row.values.reduce((a, v) => round2(a + v), 0));
                  return (
                    <tr key={row.label} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-1.5">
                          {row.icon}
                          <span className="text-xs font-medium text-slate-600">{row.label}</span>
                        </div>
                      </td>
                      {row.values.map((v, i) => (
                        <td key={i} className={`py-2.5 px-3 text-right text-sm font-semibold ${row.cls}`}>
                          {formatCurrency(v)}
                        </td>
                      ))}
                      <td className={`py-2.5 px-3 text-right text-sm font-bold ${row.cls} border-l border-slate-100`}>
                        {formatCurrency(rowTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Shortcuts */}
        <div className="px-6 pb-5 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider pt-4 mb-3">Quick Entry</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => navigate('/cash-in')}
              className="flex items-center justify-center gap-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-all shadow-sm hover:shadow-md active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <ArrowDownCircle className="w-4 h-4" />
              Cash In
            </button>
            <button
              onClick={() => navigate('/cash-out')}
              className="flex items-center justify-center gap-2 py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold text-sm transition-all shadow-sm hover:shadow-md active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <ArrowUpCircle className="w-4 h-4" />
              Cash Out
            </button>
          </div>
        </div>
      </div>

      {/* Cash Balance */}
      {cashBalance !== null && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 bg-amber-50">
            <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
              <Banknote className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-800">Physical Cash Fund</p>
              <p className="text-xs text-amber-600">Cash on hand tracking</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-xs text-amber-600">Cash on Hand</p>
              <p className="text-2xl font-black text-amber-700">{formatCurrency(cashBalance.running)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y lg:divide-y-0 divide-slate-100">
            <div className="px-3 py-4 text-center">
              <p className="text-xs font-medium text-slate-500 mb-1">Beginning Cash</p>
              <p className="text-sm font-bold text-slate-700">{formatCurrency(cashBalance.beginning)}</p>
            </div>
            <div className="px-3 py-4 text-center">
              <p className="text-xs font-medium text-slate-500 mb-1">Given Out (GCash)</p>
              <p className="text-sm font-bold text-red-500">-{formatCurrency(cashBalance.cash_given_out)}</p>
            </div>
            <div className="px-3 py-4 text-center">
              <p className="text-xs font-medium text-slate-500 mb-1">Cash Fees</p>
              <p className="text-sm font-bold text-orange-600">+{formatCurrency(cashBalance.cash_fees_collected)}</p>
            </div>
            <div className="px-3 py-4 text-center">
              <p className="text-xs font-medium text-slate-500 mb-1">To Cash Fund</p>
              <p className="text-sm font-bold text-teal-600">+{formatCurrency(cashBalance.cash_out_to_fund)}</p>
            </div>
            <div className="px-3 py-4 text-center">
              <p className="text-xs font-medium text-slate-500 mb-1">Direct Disbursed</p>
              <p className="text-sm font-bold text-red-600">-{formatCurrency(cashBalance.cash_fund_disbursements)}</p>
            </div>
            <div className="px-3 py-4 text-center">
              <p className="text-xs font-medium text-slate-500 mb-1">Bank Deposits</p>
              <p className="text-sm font-bold text-blue-600">-{formatCurrency(cashBalance.bank_deposits)}</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100">
          <div>
            <p className="text-sm font-semibold text-slate-800">Cash Fund Movements</p>
            <p className="text-xs text-slate-500">Separate increases and decreases affecting the physical cash fund</p>
          </div>
          <button
            onClick={() => navigate('/cash-ledger')}
            className="px-3 py-2 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
          >
            Open Cash Ledger
          </button>
        </div>

        <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100">
          <div className="px-6 py-4">
            <p className="text-xs font-medium text-slate-500">Total Increases</p>
            <p className="mt-1 text-lg font-black text-emerald-600">+{formatCurrency(cashFundMovementTotals.increases)}</p>
          </div>
          <div className="px-6 py-4">
            <p className="text-xs font-medium text-slate-500">Total Decreases</p>
            <p className="mt-1 text-lg font-black text-red-500">-{formatCurrency(cashFundMovementTotals.decreases)}</p>
          </div>
        </div>

        {cashFundMovements.length === 0 ? (
          <div className="px-6 py-12 text-center text-slate-400">
            <Banknote className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">No cash fund movement yet</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {cashFundMovements.map(item => {
              const isIncrease = item.delta > 0;
              return (
                <div key={item.id} className="px-6 py-4 flex items-start justify-between gap-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isIncrease ? 'bg-emerald-100' : 'bg-red-100'}`}>
                      {isIncrease ? (
                        <TrendingUp className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-500" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${isIncrease ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          {isIncrease ? 'Increase' : 'Decrease'}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {item.source}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 break-words">{item.notes || 'No notes'}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(item.created_at)}</p>
                    </div>
                  </div>
                  <div className={`text-right text-sm font-black ${isIncrease ? 'text-emerald-600' : 'text-red-500'}`}>
                    {isIncrease ? '+' : '-'}{formatCurrency(Math.abs(item.delta))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Per-Account Recent Transactions */}
      <div>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recent Transactions by Account</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {summaries.map(s => (
            <div key={s.account.id} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-semibold text-slate-700">{s.account.name}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-400">Running Balance</span>
                  <p className="text-sm font-bold text-blue-700">{formatCurrency(s.running_balance)}</p>
                </div>
              </div>
              {!accountTxns[s.account.id] || accountTxns[s.account.id].length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-10 text-slate-400">
                  <Receipt className="w-7 h-7 mb-2 opacity-30" />
                  <p className="text-xs">No transactions yet</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50 flex-1 overflow-y-auto max-h-80">
                  {accountTxns[s.account.id].map(t => {
                    const isCashIn = t.transaction_type === 'cash_in';
                    const deleteDisabled = isPosProtectedTransaction(t);
                    return (
                      <div key={t.id} className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-slate-50 transition-colors group">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isCashIn ? 'bg-emerald-100' : 'bg-red-100'}`}>
                            {isCashIn
                              ? <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                              : <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm font-bold ${isCashIn ? 'text-emerald-600' : 'text-red-500'}`}>
                                {isCashIn ? '+' : '-'}{formatCurrency(Number(t.amount))}
                              </span>
                              {t.cash_in_mode === 'payment' && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Payment</span>
                              )}
                              {t.cash_out_type === 'void_reversal' && (
                                <span className="text-xs bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-medium">Void Reversal</span>
                              )}
                              {t.cash_out_type === 'pos_remittance' && (
                                <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">POS Remit</span>
                              )}
                              {t.cash_out_type === 'move_to_bank' && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">To Bank</span>
                              )}
                              {t.cash_out_type === 'add_to_cash_fund' && (
                                <span className="text-xs bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded font-medium">+ Fund</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              {Number(t.transaction_fee) > 0 && (
                                <span className={`text-xs ${t.fee_type === 'cash' ? 'text-orange-600' : t.cash_out_type === 'move_to_bank' ? 'text-blue-600' : 'text-amber-600'}`}>
                                  Fee: {formatCurrency(Number(t.transaction_fee))}{t.fee_type === 'cash' ? ' (cash)' : t.cash_out_type === 'move_to_bank' ? ' (bank fee)' : ''}
                                </span>
                              )}
                              {t.notes && <span className="text-xs text-slate-400 truncate max-w-[120px]">{t.notes}</span>}
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">{formatDateTime(t.created_at)}</p>
                          </div>
                        </div>
                        {profile?.role === 'admin' && (
                          <div className="flex items-center gap-1 flex-shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => openEdit(t)}
                              title={isPosProtectedTransaction(t) ? 'View POS-linked transaction details' : 'Edit transaction'}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(t.id)}
                              disabled={deleteDisabled}
                              title={deleteDisabled ? 'Reverse this transaction by voiding the related POS sale' : 'Delete transaction'}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-400 disabled:hover:bg-transparent"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Transaction"
        message="Are you sure you want to delete this transaction?"
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />

      {showRemittance && (
        <RemittanceModal
          gcashAccounts={gcashAccounts}
          bankAccounts={bankAccounts as import('../lib/types').BankAccount[]}
          runningBalances={Object.fromEntries(summaries.map(s => [s.account.id, s.running_balance]))}
          onClose={() => setShowRemittance(false)}
          onSuccess={() => { setShowRemittance(false); load(true); }}
        />
      )}

      {showEndShift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !endingShift && setShowEndShift(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="bg-rose-600 px-6 py-5 text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <LogOut className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">End Shift</h3>
                  <p className="text-rose-200 text-sm">{formatDate(today)}</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">This will close the current shift</p>
                  <p className="text-xs text-amber-700 mt-0.5">All open transactions will be locked and balances will roll over as the new beginning balance for the next shift.</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Shift Summary</p>
                <div className="space-y-3">
                  {summaries.map(s => (
                    <div key={s.account.id} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Wallet className="w-4 h-4 text-blue-500" />
                          <span className="text-sm font-bold text-slate-700">{s.account.name}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-400">Ending Balance</p>
                          <p className="text-base font-black text-blue-700">{formatCurrency(s.running_balance)}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-slate-400">Cash In</span><span className="text-emerald-600 font-medium">{formatCurrency(s.total_cash_in)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Cash Out</span><span className="text-red-500 font-medium">{formatCurrency(s.total_cash_out)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">POS Register</span><span className="text-teal-600 font-medium">{formatCurrency(s.total_pos_register)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">GCash Fee</span><span className="text-amber-600 font-medium">{formatCurrency(s.total_transaction_fee)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Cash Fee</span><span className="text-orange-600 font-medium">{formatCurrency(s.total_cash_fees)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">Product Payment</span><span className="text-emerald-700 font-medium">{formatCurrency(s.total_product_payment)}</span></div>
                        <div className="flex justify-between col-span-2"><span className="text-slate-400">Delivery Fees</span><span className="text-blue-500 font-medium">{formatCurrency(s.total_delivery_fee)}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-blue-600 font-semibold">Combined GCash Ending Balance</p>
                      <p className="text-xs text-blue-400 mt-0.5">Becomes beginning balance for next shift</p>
                    </div>
                    <p className="text-2xl font-black text-blue-700">{formatCurrency(combined.running)}</p>
                  </div>
                </div>
                {cashBalance !== null && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-amber-700 font-semibold">Cash Fund Ending Balance</p>
                        <p className="text-xs text-amber-500 mt-0.5">Carries over to next shift</p>
                      </div>
                      <p className="text-2xl font-black text-amber-700">{formatCurrency(cashBalance.running)}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setShowEndShift(false)}
                disabled={endingShift}
                className="flex-1 py-3 border border-slate-300 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleEndShift}
                disabled={endingShift}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {endingShift ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Closing Shift...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Confirm End Shift
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {editTarget && (() => {
        const isEditPayment = editForm.cash_in_mode === 'payment';
        const isCashIn = editTarget.transaction_type === 'cash_in';
        const isViewOnlyPayment = isPosProtectedTransaction(editTarget);
        const editProductPaymentDisplay = isEditPayment ? parseFloat(editForm.product_payment) || 0 : 0;
        const editDeliveryFeeDisplay = isEditPayment ? parseFloat(editForm.delivery_fee) || 0 : 0;
        const computedEditAmount = isEditPayment
          ? editProductPaymentDisplay + editDeliveryFeeDisplay
          : parseFloat(editForm.amount) || 0;
        const editHasFee = parseFloat(editForm.transaction_fee) > 0;
        const inputCls = "w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
        const labelCls = "block text-sm font-medium text-slate-700 mb-1.5";
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => setEditTarget(null)} />
            <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold text-slate-800">{isViewOnlyPayment ? 'Payment Details' : 'Edit Transaction'}</h3>
                <button onClick={() => setEditTarget(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4">
                {isViewOnlyPayment && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                    This transaction came from the POS module. Details are view-only here.
                  </div>
                )}

                {isCashIn && (
                  <>
                    <div>
                      <label className={labelCls}>Cash In Mode</label>
                      <div className="grid grid-cols-2 gap-3">
                        {(['regular', 'payment'] as const).map(mode => (
                          <button key={mode} type="button"
                            disabled={isViewOnlyPayment}
                            onClick={() => setEditForm(f => ({ ...f, cash_in_mode: mode, amount: '', product_payment: '', delivery_fee: '' }))}
                            className={`py-2 px-4 rounded-lg border text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                              editForm.cash_in_mode === mode
                                ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                                : 'border-slate-300 text-slate-600 hover:border-slate-400'
                            }`}>
                            {mode === 'regular' ? 'Regular' : 'Payment Transaction'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {!isEditPayment && (
                      <div>
                        <label className={labelCls}>Cash Source</label>
                        <div className="grid grid-cols-2 gap-3">
                          {([
                            { value: 'pos_register', label: 'POS Cash Register' },
                            { value: 'cash_fund', label: 'Cash Fund' },
                          ] as const).map(opt => (
                            <button key={opt.value} type="button"
                              disabled={isViewOnlyPayment}
                              onClick={() => setEditForm(f => ({ ...f, cash_source: opt.value }))}
                              className={`py-2 px-4 rounded-lg border text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                                editForm.cash_source === opt.value
                                  ? 'border-teal-600 bg-teal-50 text-teal-700'
                                  : 'border-slate-300 text-slate-600 hover:border-slate-400'
                              }`}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {isEditPayment && (
                      <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100 space-y-3">
                        <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">Payment Details</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={labelCls}>Product Payment *</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                              <input type="number" inputMode="decimal" value={editForm.product_payment}
                                readOnly={isViewOnlyPayment}
                                onChange={e => setEditForm(f => ({ ...f, product_payment: e.target.value }))}
                                placeholder="0.00" step="0.01" min="0"
                                className={`${inputCls} pl-7 ${isViewOnlyPayment ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'bg-white'}`} />
                            </div>
                          </div>
                          <div>
                            <label className={labelCls}>Delivery Fee</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                              <input type="number" inputMode="decimal" value={editForm.delivery_fee}
                                readOnly={isViewOnlyPayment}
                                onChange={e => setEditForm(f => ({ ...f, delivery_fee: e.target.value }))}
                                placeholder="0.00" step="0.01" min="0"
                                className={`${inputCls} pl-7 ${isViewOnlyPayment ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'bg-white'}`} />
                            </div>
                          </div>
                        </div>
                        <div className="pt-1 border-t border-emerald-200 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-emerald-600">Product Payment</span>
                            <span className="text-sm font-semibold text-emerald-700">{formatCurrency(editProductPaymentDisplay)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-emerald-600">Delivery Fee</span>
                            <span className="text-sm font-semibold text-blue-600">{formatCurrency(editDeliveryFeeDisplay)}</span>
                          </div>
                          <div className="flex items-center justify-between border-t border-emerald-100 pt-1">
                            <span className="text-sm font-semibold text-emerald-700">Total Amount</span>
                            <span className="text-lg font-bold text-emerald-700">{formatCurrency(computedEditAmount)}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {isCashIn && !isEditPayment ? (
                    <div>
                      <label className={labelCls}>Amount *</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                        <input type="number" inputMode="decimal" value={editForm.amount}
                          readOnly={isViewOnlyPayment}
                          onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))}
                          placeholder="0.00" step="0.01" min="0"
                          className={`${inputCls} pl-7 ${isViewOnlyPayment ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`} />
                      </div>
                    </div>
                  ) : isCashIn && isEditPayment ? (
                    <div>
                      <label className={labelCls}>Total Amount (auto)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                        <input type="text" value={computedEditAmount.toFixed(2)} readOnly
                          className={`${inputCls} pl-7 bg-slate-50 text-slate-500 cursor-not-allowed`} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className={labelCls}>Amount *</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                        <input type="number" inputMode="decimal" value={editForm.amount}
                          readOnly={isViewOnlyPayment}
                          onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))}
                          placeholder="0.00" step="0.01" min="0"
                          className={`${inputCls} pl-7 ${isViewOnlyPayment ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`} />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className={labelCls}>Transaction Fee</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                      <input type="number" inputMode="decimal" value={editForm.transaction_fee}
                        readOnly={isViewOnlyPayment}
                        onChange={e => setEditForm(f => ({ ...f, transaction_fee: e.target.value }))}
                        placeholder="0.00" step="0.01" min="0"
                        className={`${inputCls} pl-7 ${isViewOnlyPayment ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`} />
                    </div>
                  </div>
                </div>

                {editHasFee && (
                  <div>
                    <label className={labelCls}>Fee Payment Method</label>
                    {isCashIn ? (
                      <div className="grid grid-cols-2 gap-3">
                        {(['gcash', 'cash'] as const).map(ft => (
                          <button key={ft} type="button"
                            disabled={isViewOnlyPayment}
                            onClick={() => setEditForm(f => ({ ...f, fee_type: ft }))}
                            className={`py-2 px-4 rounded-lg border text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                              editForm.fee_type === ft
                                ? ft === 'gcash'
                                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                                  : 'border-amber-500 bg-amber-50 text-amber-700'
                                : 'border-slate-300 text-slate-600 hover:border-slate-400'
                            }`}>
                            {ft === 'gcash' ? 'GCash (add to balance)' : 'Cash (cash fund)'}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="px-3 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-700">
                        Cash out fee is always added to cash fund.
                      </div>
                    )}
                    {(editForm.fee_type === 'cash' || !isCashIn) && (
                      <p className="text-xs text-amber-600 mt-1.5">Fee collected as physical cash — added to Cash Fund</p>
                    )}
                  </div>
                )}

                  <div>
                    <label className={labelCls}>Notes</label>
                    <textarea value={editForm.notes} readOnly={isViewOnlyPayment} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                      className={`${inputCls} resize-none ${isViewOnlyPayment ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`} />
                  </div>

                  <div className="flex gap-3 pt-2">
                  <button onClick={() => setEditTarget(null)} className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
                    {isViewOnlyPayment ? 'Close' : 'Cancel'}
                  </button>
                  {!isViewOnlyPayment && (
                    <button onClick={handleEdit} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                      Save Changes
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
