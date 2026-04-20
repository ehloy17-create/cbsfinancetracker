import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Building2, Wallet, Clock, AlertCircle, XCircle,
  RefreshCw, ArrowRight, FileText,
  Banknote, ShieldCheck, AlertTriangle, Calendar,
  Package, ShoppingBag, Settings, Users,
  ArrowDownCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { BankAccount, BankDeposit, CheckIssued, CheckStatus, Supplier } from '../lib/types';
import { formatCurrency, formatDate, getTodayDateString, round2 } from '../lib/utils';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
  FinanceActivityItem,
  FinanceDueItem,
  loadFinanceMonitoringSnapshot,
} from '../lib/financeMonitoring';
import { canAccessPath, getUserRoleLabel, isAccountingRole, parseModuleAccess } from '../lib/accessControl';

const STATUS_CONFIG: Record<CheckStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  draft: { label: 'Draft', color: 'text-slate-700', bg: 'bg-slate-50', icon: <Clock className="w-4 h-4" /> },
  pdc: { label: 'PDC', color: 'text-blue-700', bg: 'bg-blue-50', icon: <Clock className="w-4 h-4" /> },
  outstanding: { label: 'Outstanding', color: 'text-amber-700', bg: 'bg-amber-50', icon: <AlertCircle className="w-4 h-4" /> },
  cleared: { label: 'Cleared', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: <Clock className="w-4 h-4" /> },
  cancelled: { label: 'Cancelled', color: 'text-red-700', bg: 'bg-red-50', icon: <XCircle className="w-4 h-4" /> },
  bounced: { label: 'Bounced', color: 'text-rose-700', bg: 'bg-rose-50', icon: <XCircle className="w-4 h-4" /> },
};

function safeFormatDate(value?: string | null) {
  if (!value) return '--';
  const normalized = value.includes('T')
    ? value.slice(0, 10)
    : value.includes(' ')
      ? value.split(' ')[0]
      : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? '--' : formatDate(normalized);
}

export default function DashboardPage() {
  const { showToast } = useToast();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const today = getTodayDateString();
  const role = profile?.role;
  const isAdmin = role === 'admin';
  const isFinanceUser = isAccountingRole(role);
  const moduleAccess = parseModuleAccess(profile?.module_access);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [gcashTotal, setGcashTotal] = useState(0);
  const [cashFundTotal, setCashFundTotal] = useState(0);
  const [payableOutstanding, setPayableOutstanding] = useState(0);
  const [, setTotalLiquidFunds] = useState(0);
  const [totalVerifiedDeposits, setTotalVerifiedDeposits] = useState(0);
  const [dueTodayTotal, setDueTodayTotal] = useState(0);
  const [dueTomorrowTotal, setDueTomorrowTotal] = useState(0);
  const [overdueTotal, setOverdueTotal] = useState(0);
  const [projectedBalance, setProjectedBalance] = useState(0);
  const [projectedAfterTomorrow, setProjectedAfterTomorrow] = useState(0);
  const [upcomingDueItems, setUpcomingDueItems] = useState<FinanceDueItem[]>([]);
  const [recentActivity, setRecentActivity] = useState<FinanceActivityItem[]>([]);
  const [recentVerifiedDeposits, setRecentVerifiedDeposits] = useState<BankDeposit[]>([]);
  const [projectedSevenDays, setProjectedSevenDays] = useState<Array<{ date: string; amount: number }>>([]);
  const [checks, setChecks] = useState<CheckIssued[]>([]);
  const [hasDashboardData, setHasDashboardData] = useState(false);
  const loadInFlightRef = useRef(false);
  const queuedRefreshRef = useRef(false);
  const hasDashboardDataRef = useRef(false);

  const hasSnapshotData = useCallback((snapshot: Awaited<ReturnType<typeof loadFinanceMonitoringSnapshot>>) => (
    snapshot.bank_accounts.length > 0
    || snapshot.checks.length > 0
    || snapshot.upcoming_due_items.length > 0
    || snapshot.recent_finance_activity.length > 0
    || snapshot.recent_verified_deposits.length > 0
    || snapshot.latest_reconciliation_statuses.length > 0
    || snapshot.total_gcash_balance !== 0
    || snapshot.total_cash_fund_balance !== 0
    || snapshot.total_payable_outstanding !== 0
    || snapshot.total_liquid_funds !== 0
    || snapshot.total_due_today !== 0
    || snapshot.total_due_tomorrow !== 0
    || snapshot.total_overdue !== 0
    || snapshot.total_pending_deposits !== 0
    || snapshot.total_deposits_in_transit !== 0
  ), []);

  const load = useCallback(async (silent = false) => {
    if (!isFinanceUser) {
      setLoading(false);
      setRefreshing(false);
      setHasDashboardData(false);
      return;
    }

    if (loadInFlightRef.current) {
      if (silent) queuedRefreshRef.current = true;
      return;
    }
    loadInFlightRef.current = true;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [snapshot, { data: supplierRows }] = await Promise.all([
        loadFinanceMonitoringSnapshot(),
        supabase.from('suppliers').select('*'),
      ]);

      const suppliers = new Map(((supplierRows || []) as Supplier[]).map(supplier => [supplier.id, supplier]));
      const banks = new Map(snapshot.bank_accounts.map(account => [account.id, account]));
      const snapshotHasData = hasSnapshotData(snapshot);
      const dashboardHasData = snapshotHasData;
      hasDashboardDataRef.current = dashboardHasData;

      setBankAccounts(snapshot.bank_accounts);
      setGcashTotal(snapshot.total_gcash_balance);
      setCashFundTotal(snapshot.total_cash_fund_balance);
      setPayableOutstanding(snapshot.total_payable_outstanding);
      setTotalLiquidFunds(snapshot.total_liquid_funds);
      setTotalVerifiedDeposits(snapshot.total_verified_deposits);
      setDueTodayTotal(snapshot.total_due_today);
      setDueTomorrowTotal(snapshot.total_due_tomorrow);
      setOverdueTotal(snapshot.total_overdue);
      setProjectedBalance(snapshot.projected_available_liquidity);
      setProjectedAfterTomorrow(snapshot.projected_after_tomorrow_liquidity);
      setUpcomingDueItems(snapshot.upcoming_due_items.slice(0, 8));
      setRecentActivity(snapshot.recent_finance_activity);
      setRecentVerifiedDeposits(snapshot.recent_verified_deposits);
      setProjectedSevenDays(snapshot.projected_cashflow_next_7_days);
      setHasDashboardData(dashboardHasData);
      setChecks(
        snapshot.checks.map(check => ({
          ...check,
          suppliers: check.supplier_id ? suppliers.get(check.supplier_id) : undefined,
          bank_accounts: check.bank_account_id ? banks.get(check.bank_account_id) : undefined,
        }))
      );

    } catch {
      hasDashboardDataRef.current = false;
      setHasDashboardData(false);
      showToast('Failed to load dashboard', 'error');
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
  }, [hasSnapshotData, isFinanceUser, showToast]);

  useEffect(() => { void load(false); }, [load]);

  useEffect(() => {
    if (!hasDashboardData) return;
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bank_transactions' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bank_accounts' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checks_issued' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_transactions' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payables' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bank_deposits' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_owner_movements' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recurring_obligations' }, () => load(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hasDashboardData, load]);

  const bankTotal = round2(bankAccounts.reduce((s, a) => round2(s + Number(a.actual_balance ?? a.current_balance)), 0));
  const pdcTotal = round2(checks.filter(c => c.status === 'pdc').reduce((s, c) => round2(s + Number(c.amount)), 0));
  const outstandingTotal = round2(checks.filter(c => c.status === 'outstanding').reduce((s, c) => round2(s + Number(c.amount)), 0));
  const activeChecks = checks.filter(c => c.status === 'pdc' || c.status === 'outstanding').slice(0, 8);

  const availableBalance = projectedBalance;
  const availableNegative = availableBalance < 0;

  const menuGroups = [
    {
      title: 'Core',
      items: [
        {
          label: 'GCash',
          description: 'Cash in, cash out, remittances',
          icon: Wallet,
          route: '/gcash',
        },
        {
          label: 'Cashier View',
          description: 'Open selling screen and shifts',
          icon: ShoppingBag,
          route: '/inventory/pos',
        },
        {
          label: 'Price Checker',
          description: 'Large tablet-friendly price and stock lookup',
          icon: Package,
          route: '/price-checker',
        },
        {
          label: 'Customer Credit',
          description: 'Profiles, balances, and ledger',
          icon: Users,
          route: '/inventory/pos/customers',
        },
      ],
    },
    {
      title: 'Inventory',
      items: [
        {
          label: 'Inventory',
          description: 'Products, stock, receiving',
          icon: Package,
          route: '/inventory',
        },
        {
          label: 'Purchase Orders',
          description: 'Create and monitor supplier orders',
          icon: FileText,
          route: '/inventory/purchase-orders',
        },
        {
          label: 'Product Receiving',
          description: 'Receive delivered products into stock',
          icon: Package,
          route: '/inventory/receivings',
        },
        {
          label: 'Stock List',
          description: 'Check current stock on hand',
          icon: ShieldCheck,
          route: '/inventory/stock',
        },
      ],
    },
    {
      title: 'People & Admin',
      items: [
        {
          label: 'DTR Entries',
          description: 'Attendance and daily time records',
          icon: Clock,
          route: '/timeclock/app',
        },
        {
          label: 'Payroll',
          description: 'Employees, cutoffs, payroll runs',
          icon: Users,
          route: '/payroll',
        },
        {
          label: 'Users',
          description: 'Manage staff access and roles',
          icon: Users,
          route: '/users',
        },
        {
          label: 'Settings',
          description: 'System and backup settings',
          icon: Settings,
          route: '/settings',
        },
      ],
    },
  ]
    .map(group => ({
      ...group,
      items: group.items.filter(item => canAccessPath(role, item.route, moduleAccess)),
    }))
    .filter(group => group.items.length > 0);

  const quickAccessCards = [
    { label: 'Bank', icon: Building2, route: '/bank' },
    { label: 'Checks', icon: FileText, route: '/checks' },
    { label: 'Users', icon: Users, route: '/users' },
    { label: 'Sales', icon: Banknote, route: '/sales' },
  ].filter(item => canAccessPath(role, item.route, moduleAccess));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Main Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">{safeFormatDate(today)} · {getUserRoleLabel(role)}</p>
        </div>
        {isFinanceUser && (
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-sm font-medium text-white hover:bg-white/20 transition-colors shadow-sm disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      {/* ── TOP: Finance Balance Widgets ─────────────────────────── */}
      {isFinanceUser && (
        <>
          {!hasDashboardData && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              No finance or daily sales data yet. Auto-refresh stays paused until accounts, transactions, deposits, checks, or daily sales records exist.
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            <button
              onClick={() => navigate('/bank')}
              className="col-span-1 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl p-4 text-left text-white hover:from-blue-700 hover:to-blue-800 transition-all shadow-md group"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                  <Building2 className="w-4 h-4 text-white" />
                </div>
                <ArrowRight className="w-4 h-4 text-blue-300 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-blue-200 text-xs font-medium mb-1">Bank Balance</p>
              <p className="text-2xl font-black leading-tight">{formatCurrency(bankTotal)}</p>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                <p className="text-blue-300 text-xs">Proj. {formatCurrency(projectedBalance)}</p>
                <p className="text-blue-300 text-xs">PDC {formatCurrency(pdcTotal)}</p>
              </div>
            </button>

            <button
              onClick={() => navigate('/gcash')}
              className="col-span-1 bg-gradient-to-br from-sky-500 to-sky-600 rounded-2xl p-4 text-left text-white hover:from-sky-600 hover:to-sky-700 transition-all shadow-md group"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-white" />
                </div>
                <ArrowRight className="w-4 h-4 text-sky-300 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-sky-200 text-xs font-medium mb-1">GCash Balance</p>
              <p className="text-2xl font-black leading-tight">{formatCurrency(gcashTotal)}</p>
              <p className="text-sky-300 text-xs mt-1">Open balance</p>
            </button>

            <button
              onClick={() => navigate('/cash-ledger')}
              className="col-span-1 bg-gradient-to-br from-amber-500 to-amber-600 rounded-2xl p-4 text-left text-white hover:from-amber-600 hover:to-amber-700 transition-all shadow-md group"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                  <Banknote className="w-4 h-4 text-white" />
                </div>
                <ArrowRight className="w-4 h-4 text-amber-200 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-amber-100 text-xs font-medium mb-1">Cash Fund</p>
              <p className="text-2xl font-black leading-tight">{formatCurrency(cashFundTotal)}</p>
              <p className="text-amber-100 text-xs mt-1">Physical cash</p>
            </button>

            <button
              onClick={() => navigate('/checks?scope=all')}
              className={`col-span-1 rounded-2xl p-4 text-left text-white transition-all shadow-md group ${
                availableNegative
                  ? 'bg-gradient-to-br from-red-600 to-red-700 hover:from-red-700 hover:to-red-800'
                  : 'bg-gradient-to-br from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4 text-white" />
                </div>
                <ArrowRight className={`w-4 h-4 group-hover:translate-x-0.5 transition-transform ${availableNegative ? 'text-red-300' : 'text-emerald-300'}`} />
              </div>
              <p className={`text-xs font-medium mb-1 ${availableNegative ? 'text-red-200' : 'text-emerald-200'}`}>Available Balance</p>
              <p className="text-2xl font-black leading-tight">{formatCurrency(availableBalance)}</p>
              <p className={`text-xs mt-1 ${availableNegative ? 'text-red-300' : 'text-emerald-300'}`}>After dues & overdue</p>
            </button>

            <button
              onClick={() => navigate('/disbursements')}
              className="col-span-1 bg-gradient-to-br from-rose-600 to-rose-700 rounded-2xl p-4 text-left text-white hover:from-rose-700 hover:to-rose-800 transition-all shadow-md group"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                  <ArrowDownCircle className="w-4 h-4 text-white" />
                </div>
                <ArrowRight className="w-4 h-4 text-rose-300 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-rose-200 text-xs font-medium mb-1">Disbursement</p>
              <p className="text-2xl font-black leading-tight">{formatCurrency(payableOutstanding)}</p>
              <p className="text-rose-300 text-xs mt-1">Payables outstanding</p>
            </button>

            <button
              onClick={() => navigate('/finance-deposits')}
              className="col-span-1 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl p-4 text-left text-white hover:from-indigo-600 hover:to-indigo-700 transition-all shadow-md group"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                  <Banknote className="w-4 h-4 text-white" />
                </div>
                <ArrowRight className="w-4 h-4 text-indigo-300 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-indigo-200 text-xs font-medium mb-1">Deposit</p>
              <p className="text-2xl font-black leading-tight">{formatCurrency(totalVerifiedDeposits)}</p>
              <p className="text-indigo-300 text-xs mt-1">Verified deposits</p>
            </button>
          </div>
        </>
      )}

      {/* ── MIDDLE: Main Menu ─────────────────────────────────────── */}
      <div className="bg-[#0f172a] rounded-2xl shadow-sm p-5">
        <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-white">Main Menu</h2>
            <p className="text-sm text-slate-400">Important modules with thumbnail shortcuts.</p>
          </div>
          <div className="rounded-xl px-4 py-3 bg-white/10 border border-white/10">
            <p className="text-xs text-slate-400">Signed in as</p>
            <p className="text-sm font-semibold mt-1 text-white">{getUserRoleLabel(role)}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {menuGroups.map(group => (
            <div key={group.title} className="h-full rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="px-2 pb-3">
                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{group.title}</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {group.items.map(item => (
                  <button
                    key={item.route}
                    onClick={() => navigate(item.route)}
                    className="h-full min-h-[132px] w-full rounded-2xl p-4 text-left text-white bg-[#2563eb] shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:brightness-105 group"
                  >
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-3">
                      <item.icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-base font-bold">{item.label}</p>
                        <p className="text-sm text-white/85 mt-1">{item.description}</p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-white/80 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

      </div>

      {/* ── BOTTOM: Detailed Dashboard Content ───────────────────── */}
      {isAdmin && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
            <div className="space-y-3 bg-[#0f172a] rounded-2xl border border-white/10 p-5">
              <div>
                <h2 className="text-sm font-semibold text-white">Shortcuts</h2>
                <p className="text-xs text-slate-400 mt-1">Open the most-used finance and sales modules quickly.</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
              { label: 'GCash', description: 'Manage GCash transactions', icon: Wallet, route: '/gcash', iconBg: 'bg-sky-500' },
              { label: 'Bank Deposits', description: 'Track deposits in transit', icon: Banknote, route: '/finance-deposits', iconBg: 'bg-blue-500' },
              { label: 'Checks Issued', description: 'Track issued checks', icon: FileText, route: '/checks', iconBg: 'bg-amber-500' },
              { label: 'Recurring Dues', description: 'Manage fixed obligations', icon: Calendar, route: '/recurring-obligations', iconBg: 'bg-orange-500' },
              { label: 'Owner Ledger', description: 'Track due-to-owner balances', icon: ShieldCheck, route: '/owner-movements', iconBg: 'bg-purple-500' },
            ].map(item => (
              <button
                key={item.route}
                onClick={() => navigate(item.route)}
                className="flex flex-col items-start gap-3 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all group"
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${item.iconBg}`}>
                  <item.icon className="w-4 h-4 text-white" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold leading-tight text-white">{item.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-snug">{item.description}</p>
                </div>
                <ArrowRight className="w-3.5 h-3.5 mt-auto text-white/40 group-hover:text-white/80 group-hover:translate-x-0.5 transition-all" />
              </button>
            ))}
              </div>
            </div>
            <div className="bg-[#0f172a] rounded-2xl border border-white/10 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <h2 className="text-sm font-semibold text-white">Check Status Summary</h2>
                </div>
                <button
                  onClick={() => navigate('/checks?scope=all')}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium"
                >
                  View all <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="grid grid-cols-2 divide-x divide-white/10">
                {([
                  { status: 'pdc' as CheckStatus, amount: pdcTotal, count: checks.filter(c => c.status === 'pdc').length },
                  { status: 'outstanding' as CheckStatus, amount: outstandingTotal, count: checks.filter(c => c.status === 'outstanding').length },
                ]).map(({ status, amount, count }) => {
                  const cfg = STATUS_CONFIG[status];
                  return (
                    <button
                      key={status}
                      onClick={() => navigate(`/checks?status=${status}&scope=all`)}
                      className="px-3 sm:px-5 py-5 text-center hover:bg-white/5 transition-colors group"
                    >
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold mb-3 ${cfg.bg} ${cfg.color}`}>
                        {cfg.icon}
                        {cfg.label}
                      </div>
                      <p className={`text-lg sm:text-2xl font-bold ${cfg.color} group-hover:scale-105 transition-transform`}>{formatCurrency(amount)}</p>
                      <p className="text-xs text-slate-500 mt-1">{count} check{count !== 1 ? 's' : ''}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {(dueTodayTotal > 0 || dueTomorrowTotal > 0 || overdueTotal > 0 || projectedSevenDays.length > 0) && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="bg-[#0f172a] rounded-2xl border border-white/10 overflow-hidden">
                <div className="flex items-center gap-2 px-6 py-4 border-b border-white/10">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <h2 className="text-sm font-semibold text-white">Due Check Warnings</h2>
                </div>
                <div className="p-4 space-y-3">
                  {[
                    { label: 'Due today', amount: dueTodayTotal, tone: dueTodayTotal > 0 ? 'text-red-400' : 'text-slate-500' },
                    { label: 'Due tomorrow', amount: dueTomorrowTotal, tone: dueTomorrowTotal > 0 ? 'text-orange-400' : 'text-slate-500' },
                    { label: 'Past due', amount: overdueTotal, tone: overdueTotal > 0 ? 'text-rose-400' : 'text-slate-500' },
                    { label: 'Upcoming PDC', amount: pdcTotal, tone: pdcTotal > 0 ? 'text-blue-400' : 'text-slate-500' },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                      <span className="text-sm text-slate-300">{item.label}</span>
                      <span className={`text-sm font-bold ${item.tone}`}>{formatCurrency(item.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#0f172a] rounded-2xl border border-white/10 overflow-hidden">
                <div className="flex items-center gap-2 px-6 py-4 border-b border-white/10">
                  <Calendar className="w-4 h-4 text-blue-400" />
                  <h2 className="text-sm font-semibold text-white">Projected Obligations (Next 7 Days)</h2>
                </div>
                <div className="p-4 space-y-3">
                  {projectedSevenDays.length === 0 ? (
                    <p className="text-sm text-slate-500">No tracked obligations due in the next 7 days.</p>
                  ) : (
                    projectedSevenDays.map(item => (
                      <div key={item.date} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                        <span className="text-sm text-slate-300">{safeFormatDate(item.date)}</span>
                        <span className="text-sm font-bold text-white">{formatCurrency(item.amount)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="bg-[#0f172a] rounded-2xl border border-white/10 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <h2 className="text-sm font-semibold text-white">Upcoming Dues Panel</h2>
                <button onClick={() => navigate('/recurring-obligations')} className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1">
                  Manage <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                {upcomingDueItems.length === 0 ? (
                  <p className="text-sm text-slate-500">No obligations due in the next 7 days.</p>
                ) : (
                  upcomingDueItems.map(item => (
                    <div key={`${item.kind}-${item.id}`} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">{item.label}</p>
                          <p className="text-xs text-slate-400">{item.kind} · {safeFormatDate(item.date)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-white">{formatCurrency(item.amount)}</p>
                          <p className="text-xs text-slate-400">{item.status}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-[#0f172a] rounded-2xl border border-white/10 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <h2 className="text-sm font-semibold text-white">Recent Finance Activity</h2>
                <button onClick={() => navigate('/owner-movements')} className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1">
                  View all <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                {recentActivity.length === 0 ? (
                  <p className="text-sm text-slate-500">No recent finance activity.</p>
                ) : (
                  recentActivity.slice(0, 5).map(item => (
                    <div key={`${item.module}-${item.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-white">{item.label}</p>
                        <p className="text-xs text-slate-400">{item.module} · {safeFormatDate(item.date)}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${item.direction === 'inflow' ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(item.amount)}</p>
                        {item.status && <p className="text-xs text-slate-400">{item.status}</p>}
                      </div>
                    </div>
                  ))
                )}
                {recentActivity.length > 5 && (
                  <button onClick={() => navigate('/owner-movements')} className="w-full text-xs text-blue-400 hover:text-blue-300 font-medium py-2 text-center flex items-center justify-center gap-1">
                    View all {recentActivity.length} activities <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="bg-[#0f172a] rounded-2xl border border-white/10 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <h2 className="text-sm font-semibold text-white">Verified Deposits</h2>
                <button onClick={() => navigate('/finance-deposits')} className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1">
                  View <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                {recentVerifiedDeposits.length === 0 ? (
                  <p className="text-sm text-slate-500">No verified deposits yet.</p>
                ) : (
                  recentVerifiedDeposits.map(item => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-white">{item.source_description || 'Verified deposit'}</p>
                        <p className="text-xs text-slate-400">{safeFormatDate(item.verified_at ?? item.date)}</p>
                      </div>
                      <p className="text-sm font-bold text-emerald-400">{formatCurrency(item.amount)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {activeChecks.length > 0 && (
            <div className="bg-[#0f172a] rounded-2xl border border-white/10 overflow-hidden">
              <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/10">
                <h2 className="text-sm font-semibold text-white">Active Checks (PDC & Outstanding)</h2>
                <button onClick={() => navigate('/checks?scope=all')} className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1">
                  View all <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="sm:hidden divide-y divide-white/10">
                {activeChecks.map(c => {
                  const cfg = STATUS_CONFIG[c.status];
                  const sup = c.suppliers as unknown as { name: string } | undefined;
                  return (
                    <div
                      key={c.id}
                      onClick={() => navigate(`/checks?status=${c.status}`)}
                      className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-white/5 active:bg-white/10"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-white text-sm">{c.check_number}</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
                            {cfg.icon}{cfg.label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{sup?.name || '—'} · {safeFormatDate(c.check_date)}</p>
                      </div>
                      <p className="font-bold text-white text-sm ml-3 flex-shrink-0">{formatCurrency(Number(c.amount))}</p>
                    </div>
                  );
                })}
              </div>
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white/5 border-b border-white/10">
                    <tr>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Check #</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Payee</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Amount</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Date</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {activeChecks.map(c => {
                      const cfg = STATUS_CONFIG[c.status];
                      const sup = c.suppliers as unknown as { name: string } | undefined;
                      return (
                        <tr
                          key={c.id}
                          onClick={() => navigate(`/checks?status=${c.status}`)}
                          className="hover:bg-white/5 transition-colors cursor-pointer"
                        >
                          <td className="px-5 py-3 font-mono font-semibold text-white">{c.check_number}</td>
                          <td className="px-4 py-3 text-slate-300">{sup?.name || '—'}</td>
                          <td className="px-4 py-3 text-right font-bold text-white">{formatCurrency(Number(c.amount))}</td>
                          <td className="px-4 py-3 text-center text-slate-400 text-xs">{safeFormatDate(c.check_date)}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
                              {cfg.icon}
                              {cfg.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </>
      )}
    </div>
  );
}
