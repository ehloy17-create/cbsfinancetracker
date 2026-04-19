import { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, X, CheckCircle, Clock, AlertCircle, XCircle, Filter, RefreshCw, Link, Pencil, Search, Calendar, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { CheckIssued, CheckStatus, BankAccount, Supplier } from '../lib/types';
import { formatCurrency, formatDate, getTodayDateString, round2 } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import ConfirmDialog from '../components/ConfirmDialog';
import { useSearchParams } from 'react-router-dom';
import {
  archiveBankTransactions,
  ensureCheckClearingLedger,
  getCheckLifecycleStatus,
  loadFinanceMonitoringSnapshot,
} from '../lib/financeMonitoring';
import { upsertSourceDisbursement } from '../lib/disbursements';

function getMonthRange() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

function getAllTimeRange() {
  return { from: '2000-01-01', to: '2099-12-31' };
}

const STATUS_CONFIG: Record<CheckStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  draft: { label: 'Draft', color: 'text-slate-700', bg: 'bg-slate-100', icon: <Clock className="w-3.5 h-3.5" /> },
  pdc: { label: 'PDC', color: 'text-blue-700', bg: 'bg-blue-100', icon: <Clock className="w-3.5 h-3.5" /> },
  outstanding: { label: 'Outstanding', color: 'text-amber-700', bg: 'bg-amber-100', icon: <AlertCircle className="w-3.5 h-3.5" /> },
  cleared: { label: 'Cleared', color: 'text-emerald-700', bg: 'bg-emerald-100', icon: <CheckCircle className="w-3.5 h-3.5" /> },
  cancelled: { label: 'Cancelled', color: 'text-red-700', bg: 'bg-red-100', icon: <XCircle className="w-3.5 h-3.5" /> },
  bounced: { label: 'Bounced', color: 'text-rose-700', bg: 'bg-rose-100', icon: <XCircle className="w-3.5 h-3.5" /> },
};

const EMPTY_FORM = {
  check_number: '',
  bank_account_id: '',
  supplier_id: '',
  issued_date: getTodayDateString(),
  check_date: getTodayDateString(),
  status: 'outstanding' as CheckStatus,
  amount: '',
  notes: '',
};

function getDefaultCheckBankId(bankAccounts: BankAccount[]) {
  const chinabank = bankAccounts.find(account => account.name.trim().toLowerCase() === 'chinabank');
  return chinabank?.id ?? '';
}

interface EditCheckForm {
  check_number: string;
  bank_account_id: string;
  supplier_id: string;
  issued_date: string;
  check_date: string;
  status: CheckStatus;
  amount: string;
  notes: string;
}

export default function ChecksPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [checks, setChecks] = useState<CheckIssued[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const paramStatus = searchParams.get('status') as CheckStatus | null;
  const paramScope = searchParams.get('scope');
  const [filterStatus, setFilterStatus] = useState<CheckStatus | ''>(
    paramStatus && ['pdc', 'outstanding', 'cleared', 'cancelled'].includes(paramStatus) ? paramStatus : ''
  );
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchBy, setSearchBy] = useState<'check_number' | 'supplier' | 'amount'>('check_number');
  const [editTarget, setEditTarget] = useState<CheckIssued | null>(null);
  const [editForm, setEditForm] = useState<EditCheckForm | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const initRange = paramScope === 'all' ? getAllTimeRange() : getMonthRange();
  const [dateFrom, setDateFrom] = useState(initRange.from);
  const [dateTo, setDateTo] = useState(initRange.to);

  useEffect(() => {
    setFilterStatus(
      paramStatus && ['pdc', 'outstanding', 'cleared', 'cancelled'].includes(paramStatus) ? paramStatus : ''
    );
  }, [paramStatus]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ bank_accounts: monitoringBanks, checks: monitoringChecks }, { data: sups }] = await Promise.all([
      loadFinanceMonitoringSnapshot(),
      supabase.from('suppliers').select('id,name').eq('is_active', true).order('name'),
    ]);
    const suppliersList = (sups as unknown as Supplier[]) || [];
    const supplierMap = new Map(suppliersList.map(supplier => [supplier.id, supplier]));
    const bankMap = new Map(monitoringBanks.map(account => [account.id, account]));
    const filteredChecks = monitoringChecks
      .filter(check => check.issued_date >= dateFrom && check.issued_date <= dateTo)
      .sort((left, right) => right.check_date.localeCompare(left.check_date))
      .map(check => ({
        ...check,
        suppliers: check.supplier_id ? supplierMap.get(check.supplier_id) : undefined,
        bank_accounts: check.bank_account_id ? bankMap.get(check.bank_account_id) : undefined,
      }));
    setChecks(filteredChecks);
    setBankAccounts(monitoringBanks);
    setSuppliers(suppliersList);
    setForm(prev => ({
      ...prev,
      bank_account_id: prev.bank_account_id || getDefaultCheckBankId(monitoringBanks),
    }));
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const selectedSupplier = suppliers.find(s => s.id === form.supplier_id);

  function deriveStatus(checkDate: string): CheckStatus {
    return getCheckLifecycleStatus(checkDate, false, 'outstanding');
  }

  function getManualStatusFlag(checkDate: string, status: CheckStatus) {
    return status !== deriveStatus(checkDate);
  }

  async function addCheck() {
    if (!form.check_number.trim() || !form.amount || !form.check_date || !form.issued_date || !form.bank_account_id) return;
    setSaving(true);
    try {
      const selectedStatus = form.status;
      const manuallySetStatus = getManualStatusFlag(form.check_date, selectedStatus);
      const payeeName = selectedSupplier?.name || `Check #${form.check_number}`;

      const { data: checkData, error: checkError } = await supabase
        .from('checks_issued')
        .insert({
          check_number: form.check_number.trim(),
          bank_account_id: form.bank_account_id,
          supplier_id: form.supplier_id || null,
          date: form.issued_date,
          issued_date: form.issued_date,
          check_date: form.check_date,
          payee: payeeName,
          description: form.notes.trim() || `Check #${form.check_number}`,
          amount: parseFloat(form.amount),
          notes: form.notes.trim(),
          status: selectedStatus,
          manually_set_status: manuallySetStatus,
          created_by: user?.id,
        })
        .select()
        .single();

      if (checkError) throw checkError;

      const { data: disbData, error: disbError } = await supabase
        .from('disbursements')
        .insert({
          date: form.issued_date,
          payee: payeeName,
          purpose: form.notes.trim() || `Check #${form.check_number}`,
          description: form.notes.trim() || `Check #${form.check_number}`,
          amount: parseFloat(form.amount),
          payment_method: 'check',
          check_id: checkData.id,
          check_number: form.check_number.trim(),
          supplier_id: form.supplier_id || null,
          disbursement_type: 'check_issuance_pending',
          source_module: 'check_issuance',
          source_reference_id: checkData.id,
          source_account_type: 'bank',
          source_account_id: form.bank_account_id,
          notes: form.notes.trim(),
          created_by: user?.id,
        })
        .select()
        .single();

      if (disbError) throw disbError;

      await supabase
        .from('checks_issued')
        .update({ disbursement_id: disbData.id })
        .eq('id', checkData.id);

      await writeAuditLog(user?.id ?? null, 'INSERT', 'ChecksIssued', checkData.id, {
        check_number: form.check_number,
        auto_disbursement: disbData.id,
      });

      showToast('Check recorded and disbursement created', 'success');
      setForm({ ...EMPTY_FORM, bank_account_id: getDefaultCheckBankId(bankAccounts) });
      setShowForm(false);
      load();
    } catch {
      showToast('Failed to record check', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: CheckStatus) {
    setUpdatingStatus(id);
    try {
      const check = checks.find(c => c.id === id);

      // DB constraint: status IN ('pending','cleared','cancelled','stale').
      // 'outstanding' and 'pdc' are frontend-computed from check_date; store as 'pending'.
      const dbStatus = (status === 'outstanding' || status === 'pdc') ? 'pending' : status;
      await supabase.from('checks_issued').update({
        status: dbStatus,
        manually_set_status: status === 'outstanding' || status === 'pdc',
        cleared_date: status === 'cleared' ? getTodayDateString() : null,
        updated_at: new Date().toISOString(),
      }).eq('id', id);

      const prevStatus = check?.status;

      if (status === 'cleared' && check) {
        const sup = check.suppliers as unknown as Supplier | undefined;
        const clearedDate = getTodayDateString();

        const { data: existingDisb } = await supabase
          .from('disbursements')
          .select('id, payment_method')
          .eq('id', check.disbursement_id || '')
          .maybeSingle();

        if (existingDisb) {
          await supabase.from('disbursements').update({
            date: clearedDate,
            payment_method: 'check',
            disbursement_type: 'check_issuance_cleared',
            description: check.notes || `Check #${check.check_number}`,
            notes: check.notes || `[Cleared on ${clearedDate}]`,
            source_module: 'check_issuance',
            source_reference_id: id,
            source_account_type: 'bank',
            source_account_id: check.bank_account_id,
            updated_at: new Date().toISOString(),
          }).eq('id', existingDisb.id);
        } else {
          const { data: newDisb } = await supabase
            .from('disbursements')
            .insert({
              date: clearedDate,
              payee: sup?.name || `Check #${check.check_number}`,
              purpose: check.notes || `Check #${check.check_number}`,
              description: check.notes || `Check #${check.check_number}`,
              amount: Number(check.amount),
              payment_method: 'check',
              check_id: id,
              check_number: check.check_number,
              supplier_id: check.supplier_id,
              disbursement_type: 'check_issuance_cleared',
              source_module: 'check_issuance',
              source_reference_id: id,
              source_account_type: 'bank',
              source_account_id: check.bank_account_id,
              notes: '[Cleared on ' + clearedDate + ']',
              created_by: user?.id,
            })
            .select()
            .single();

          if (newDisb) {
            await supabase.from('checks_issued').update({ disbursement_id: newDisb.id }).eq('id', id);
          }
        }

        await ensureCheckClearingLedger(
          {
            ...check,
            payee: sup?.name || check.payee || '',
            status,
            cleared_date: clearedDate,
          },
          clearedDate,
          user?.id
        );

        await writeAuditLog(user?.id ?? null, 'UPDATE', 'ChecksIssued', id, { status: 'cleared', auto_bank_tx: !!check.bank_account_id });

      } else if (prevStatus === 'cleared' && check) {
        await archiveBankTransactions({ check_id: id });
        if (check.disbursement_id) {
          await supabase.from('disbursements').update({
            date: check.issued_date || check.check_date,
            disbursement_type: 'check_issuance_pending',
            source_module: 'check_issuance',
            source_reference_id: id,
            source_account_type: 'bank',
            source_account_id: check.bank_account_id,
            updated_at: new Date().toISOString(),
          }).eq('id', check.disbursement_id);
        }

        await writeAuditLog(user?.id ?? null, 'UPDATE', 'ChecksIssued', id, { status, reversed_from: 'cleared', amount_reversed: check.amount });

      } else {
        await writeAuditLog(user?.id ?? null, 'UPDATE', 'ChecksIssued', id, { status });
      }

      const reversedFromCleared = prevStatus === 'cleared' && status !== 'cleared';
      showToast(
        status === 'cleared'
          ? `Check cleared${check?.bank_account_id ? ' — bank ledger updated' : ''}`
          : reversedFromCleared && check?.bank_account_id
            ? `Check ${STATUS_CONFIG[status].label.toLowerCase()} — bank ledger restored`
            : `Check marked as ${STATUS_CONFIG[status].label}`,
        'success'
      );
      load();
    } catch {
      showToast('Failed to update status', 'error');
    } finally {
      setUpdatingStatus(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const check = checks.find(c => c.id === deleteTarget);
    await archiveBankTransactions({ check_id: deleteTarget });
    await supabase.from('checks_issued').update({ is_deleted: true }).eq('id', deleteTarget);
    if (check?.disbursement_id) {
      await supabase.from('disbursements').update({ is_deleted: true }).eq('id', check.disbursement_id);
    }
    showToast('Check and linked disbursement deleted', 'success');
    setDeleteTarget(null);
    load();
  }

  function openEdit(c: CheckIssued) {
    const bank = c.bank_accounts as unknown as BankAccount | undefined;
    const sup = c.suppliers as unknown as Supplier | undefined;
    setEditTarget(c);
    setEditForm({
      check_number: c.check_number,
      bank_account_id: bank?.id || '',
      supplier_id: sup?.id || '',
      issued_date: c.issued_date || getTodayDateString(),
      check_date: c.check_date,
      status: c.status,
      amount: String(Number(c.amount)),
      notes: c.notes || '',
    });
  }

  async function saveEdit() {
    if (!editTarget || !editForm) return;
    if (!editForm.check_number.trim() || !editForm.amount || !editForm.check_date || !editForm.bank_account_id) return;
    setEditSaving(true);
    try {
      const amount = parseFloat(editForm.amount);
      const editSupplier = suppliers.find(s => s.id === editForm.supplier_id);
      const payeeName = editSupplier?.name || `Check #${editForm.check_number}`;
      await supabase.from('checks_issued').update({
        check_number: editForm.check_number.trim(),
        bank_account_id: editForm.bank_account_id,
        supplier_id: editForm.supplier_id || null,
        date: editForm.issued_date,
        issued_date: editForm.issued_date,
        check_date: editForm.check_date,
        payee: payeeName,
        description: editForm.notes.trim() || `Check #${editForm.check_number}`,
        amount,
        notes: editForm.notes.trim(),
        status: editForm.status,
        manually_set_status: getManualStatusFlag(editForm.check_date, editForm.status),
        updated_at: new Date().toISOString(),
      }).eq('id', editTarget.id);

      if (editTarget.disbursement_id) {
        await supabase.from('disbursements').update({
          date: editForm.status === 'cleared'
            ? (editTarget.cleared_date || getTodayDateString())
            : editForm.issued_date,
          amount,
          check_number: editForm.check_number.trim(),
          disbursement_type: editForm.status === 'cleared' ? 'check_issuance_cleared' : 'check_issuance_pending',
          source_module: 'check_issuance',
          source_reference_id: editTarget.id,
          source_account_type: 'bank',
          source_account_id: editForm.bank_account_id,
          description: editForm.notes.trim() || `Check #${editForm.check_number}`,
          notes: editForm.notes.trim(),
          updated_at: new Date().toISOString(),
        }).eq('id', editTarget.disbursement_id);
      } else {
        await upsertSourceDisbursement({
          source_module: 'check_issuance',
          source_reference_id: editTarget.id,
          source_account_type: 'bank',
          source_account_id: editForm.bank_account_id,
          disbursement_type: editForm.status === 'cleared' ? 'check_issuance_cleared' : 'check_issuance_pending',
          date: editForm.status === 'cleared'
            ? (editTarget.cleared_date || getTodayDateString())
            : editForm.issued_date,
          payee: payeeName,
          purpose: editForm.notes.trim() || `Check #${editForm.check_number}`,
          description: editForm.notes.trim() || `Check #${editForm.check_number}`,
          amount,
          payment_method: 'check',
          supplier_id: editForm.supplier_id || null,
          check_id: editTarget.id,
          check_number: editForm.check_number.trim(),
          notes: editForm.notes.trim(),
          created_by: user?.id ?? null,
        });
      }

      await writeAuditLog(user?.id ?? null, 'UPDATE', 'ChecksIssued', editTarget.id, {
        check_number: editForm.check_number,
        amount,
      });
      showToast('Check updated', 'success');
      setEditTarget(null);
      setEditForm(null);
      load();
    } catch {
      showToast('Failed to update check', 'error');
    } finally {
      setEditSaving(false);
    }
  }

  const filtered = checks.filter(c => {
    const matchStatus = !filterStatus || c.status === filterStatus;
    if (!search.trim()) return matchStatus;
    const q = search.trim().toLowerCase();
    let matchSearch = false;
    if (searchBy === 'check_number') {
      matchSearch = c.check_number.toLowerCase().includes(q);
    } else if (searchBy === 'supplier') {
      const sup = c.suppliers as unknown as Supplier | undefined;
      matchSearch = (sup?.name || '').toLowerCase().includes(q);
    } else if (searchBy === 'amount') {
      matchSearch = String(Number(c.amount)).includes(q.replace(/,/g, ''));
    }
    return matchStatus && matchSearch;
  });

  const totals = {
    pdc: round2(checks.filter(c => c.status === 'pdc').reduce((s, c) => round2(s + Number(c.amount)), 0)),
    outstanding: round2(checks.filter(c => c.status === 'outstanding').reduce((s, c) => round2(s + Number(c.amount)), 0)),
    cleared: round2(checks.filter(c => c.status === 'cleared').reduce((s, c) => round2(s + Number(c.amount)), 0)),
  };

  const bankWarnings: { bankName: string; outstanding: number; balance: number }[] = [];
  for (const acc of bankAccounts) {
    const outstandingTotal = round2(
      checks
        .filter(c => {
          const bank = c.bank_accounts as unknown as BankAccount | undefined;
          return c.status === 'outstanding' && bank?.id === acc.id;
        })
        .reduce((s, c) => round2(s + Number(c.amount)), 0)
    );
    const actualBalance = Number(acc.actual_balance ?? acc.current_balance);
    if (outstandingTotal > actualBalance) {
      bankWarnings.push({ bankName: acc.name, outstanding: outstandingTotal, balance: actualBalance });
    }
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Checks Issued</h1>
          <p className="text-slate-500 text-sm mt-0.5">Track PDC, outstanding, and cleared checks</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 shadow-sm">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Issue Check
          </button>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="flex flex-wrap items-center gap-3 bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-sm">
        <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="text-sm font-medium text-slate-600">Issued Date:</span>
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-slate-400 text-sm">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => { setDateFrom(getMonthRange().from); setDateTo(getMonthRange().to); }}
            className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50"
          >
            This Month
          </button>
          <button
            onClick={() => { setDateFrom('2000-01-01'); setDateTo('2099-12-31'); }}
            className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            All Time
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden flex-1">
          <select
            value={searchBy}
            onChange={e => { setSearchBy(e.target.value as typeof searchBy); setSearch(''); }}
            className="px-3 py-2.5 text-sm font-medium text-slate-600 bg-slate-50 border-r border-slate-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 shrink-0"
          >
            <option value="check_number">Check #</option>
            <option value="supplier">Supplier</option>
            <option value="amount">Amount</option>
          </select>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type={searchBy === 'amount' ? 'number' : 'text'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={
                searchBy === 'check_number' ? 'Search by check number...'
                : searchBy === 'supplier' ? 'Search by supplier name...'
                : 'Search by amount...'
              }
              className="w-full pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 bg-transparent"
            />
          </div>
          {search && (
            <button onClick={() => setSearch('')} className="px-3 text-slate-400 hover:text-slate-600 border-l border-slate-200">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {([
          { status: 'pdc' as CheckStatus, amount: totals.pdc, count: checks.filter(c => c.status === 'pdc').length },
          { status: 'outstanding' as CheckStatus, amount: totals.outstanding, count: checks.filter(c => c.status === 'outstanding').length },
          { status: 'cleared' as CheckStatus, amount: totals.cleared, count: checks.filter(c => c.status === 'cleared').length },
        ]).map(({ status, amount, count }) => {
          const cfg = STATUS_CONFIG[status];
          return (
            <button
              key={status}
              onClick={() => {
                const next = filterStatus === status ? '' : status;
                setFilterStatus(next);
                if (next) {
                  setSearchParams(paramScope === 'all' ? { status: next, scope: 'all' } : { status: next });
                } else {
                  setSearchParams(paramScope === 'all' ? { scope: 'all' } : {});
                }
              }}
              className={`p-3 sm:p-4 rounded-xl border-2 text-left transition-all ${
                filterStatus === status
                  ? `${cfg.bg} border-current ${cfg.color}`
                  : 'bg-white border-slate-100 hover:border-slate-200'
              }`}
            >
              <div className={`flex items-center gap-1.5 mb-2 ${filterStatus === status ? cfg.color : 'text-slate-500'}`}>
                {cfg.icon}
                <span className="text-xs font-semibold uppercase tracking-wide">{cfg.label}</span>
              </div>
              <p className={`text-base sm:text-xl font-bold ${filterStatus === status ? cfg.color : 'text-slate-800'}`}>
                {formatCurrency(amount)}
              </p>
              <p className={`text-xs mt-0.5 ${filterStatus === status ? cfg.color : 'text-slate-400'}`}>
                {count} check{count !== 1 ? 's' : ''}
              </p>
            </button>
          );
        })}
      </div>

      {bankWarnings.length > 0 && (
        <div className="space-y-2">
          {bankWarnings.map(w => (
            <div key={w.bankName} className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-800">
                  Insufficient Bank Balance — {w.bankName}
                </p>
                <p className="text-xs text-red-600 mt-0.5">
                  Outstanding checks ({formatCurrency(w.outstanding)}) exceed current bank balance ({formatCurrency(w.balance)}). Shortfall: {formatCurrency(round2(w.outstanding - w.balance))}.
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {filterStatus && (
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-500">Showing: {STATUS_CONFIG[filterStatus].label}</span>
          <button
            onClick={() => {
              setFilterStatus('');
              setSearchParams(paramScope === 'all' ? { scope: 'all' } : {});
            }}
            className="text-xs text-blue-600 hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">No checks found</p>
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden divide-y divide-slate-100">
              {filtered.map(c => {
                const cfg = STATUS_CONFIG[c.status];
                const sup = c.suppliers as unknown as Supplier | undefined;
                const bank = c.bank_accounts as unknown as BankAccount | undefined;
                return (
                  <div key={c.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-slate-800">{c.check_number}</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
                            {cfg.icon}{cfg.label}
                          </span>
                          {c.disbursement_id && (
                            <span className="inline-flex items-center justify-center w-5 h-5 bg-emerald-100 text-emerald-600 rounded-full">
                              <Link className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{sup?.name ?? '—'}{bank ? ` · ${bank.name}` : ''}</p>
                        {c.notes && <p className="text-xs text-slate-400 mt-0.5 truncate">{c.notes}</p>}
                      </div>
                      <p className="font-bold text-slate-800 flex-shrink-0">{formatCurrency(Number(c.amount))}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-400">
                        Issued: {c.issued_date ? formatDate(c.issued_date) : '—'} · Check: {formatDate(c.check_date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      {c.status !== 'cleared' && (
                        <button
                          onClick={() => updateStatus(c.id, 'cleared')}
                          disabled={updatingStatus === c.id}
                          className="px-2.5 py-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-lg text-xs font-medium transition-colors"
                        >
                          {updatingStatus === c.id ? '...' : 'Clear'}
                        </button>
                      )}
                      {c.status !== 'cancelled' && (
                        <button
                          onClick={() => updateStatus(c.id, 'cancelled')}
                          disabled={updatingStatus === c.id}
                          className="px-2.5 py-1.5 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-xs font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                      {(c.status === 'cleared' || c.status === 'cancelled') && (
                        <button
                          onClick={() => updateStatus(c.id, c.check_date > getTodayDateString() ? 'pdc' : 'outstanding')}
                          disabled={updatingStatus === c.id}
                          className="px-2.5 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg text-xs font-medium transition-colors"
                        >
                          Reopen
                        </button>
                      )}
                      <button onClick={() => openEdit(c)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setDeleteTarget(c.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Check #</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Supplier / Payee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Bank</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Issued</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Check Date</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Linked</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map(c => {
                    const cfg = STATUS_CONFIG[c.status];
                    const sup = c.suppliers as unknown as Supplier | undefined;
                    const bank = c.bank_accounts as unknown as BankAccount | undefined;
                    return (
                      <tr key={c.id} className="hover:bg-slate-50 transition-colors group">
                        <td className="px-4 py-3">
                          <p className="font-mono font-semibold text-slate-800">{c.check_number}</p>
                          {c.notes && <p className="text-xs text-slate-400 truncate max-w-[120px]">{c.notes}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-slate-700">{sup?.name ?? '—'}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-slate-600">{bank?.name ?? '—'}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-800">
                          {formatCurrency(Number(c.amount))}
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-slate-500">
                          {c.issued_date ? formatDate(c.issued_date) : '—'}
                        </td>
                        <td className="px-4 py-3 text-center text-sm text-slate-700 font-medium">
                          {formatDate(c.check_date)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
                            {cfg.icon}
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {c.disbursement_id ? (
                            <span title="Linked to disbursement" className="inline-flex items-center justify-center w-6 h-6 bg-emerald-100 text-emerald-600 rounded-full">
                              <Link className="w-3 h-3" />
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {c.status !== 'cleared' && (
                              <button
                                onClick={() => updateStatus(c.id, 'cleared')}
                                disabled={updatingStatus === c.id}
                                className="px-2.5 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-lg text-xs font-medium transition-colors"
                                title={bank ? 'Mark cleared — bank ledger will be updated' : 'Mark cleared'}
                              >
                                {updatingStatus === c.id ? '...' : 'Clear'}
                              </button>
                            )}
                            {c.status !== 'cancelled' && (
                              <button
                                onClick={() => updateStatus(c.id, 'cancelled')}
                                disabled={updatingStatus === c.id}
                                className="px-2.5 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-xs font-medium transition-colors"
                              >
                                Cancel
                              </button>
                            )}
                            {(c.status === 'cleared' || c.status === 'cancelled') && (
                              <button
                                onClick={() => updateStatus(c.id, c.check_date > getTodayDateString() ? 'pdc' : 'outstanding')}
                                disabled={updatingStatus === c.id}
                                className="px-2.5 py-1 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg text-xs font-medium transition-colors"
                              >
                                Reopen
                              </button>
                            )}
                            <button
                              onClick={() => openEdit(c)}
                              className="p-1.5 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(c.id)}
                              className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowForm(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">Issue Check</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Check Number *</label>
                  <input
                    type="text"
                    value={form.check_number}
                    onChange={e => setForm(p => ({ ...p, check_number: e.target.value }))}
                    placeholder="e.g. 001234"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount (₱) *</label>
                  <input
                    type="number" inputMode="decimal"
                    value={form.amount}
                    onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Issued Date *</label>
                  <input
                    type="date"
                    value={form.issued_date}
                    onChange={e => setForm(p => ({ ...p, issued_date: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">Date check was prepared</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Check Date *</label>
                  <input
                    type="date"
                    value={form.check_date}
                    onChange={e => {
                      const nextCheckDate = e.target.value;
                      setForm(p => ({
                        ...p,
                        check_date: nextCheckDate,
                        status: getManualStatusFlag(p.check_date, p.status) ? p.status : deriveStatus(nextCheckDate),
                      }));
                    }}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">Date printed on check</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Status *</label>
                <select
                  value={form.status}
                  onChange={e => setForm(p => ({ ...p, status: e.target.value as CheckStatus }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="outstanding">Outstanding</option>
                  <option value="pdc">PDC</option>
                </select>
                <p className="text-xs text-slate-400 mt-1">Default follows check date, but you can override it here.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Supplier / Payee</label>
                <select
                  value={form.supplier_id}
                  onChange={e => setForm(p => ({ ...p, supplier_id: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">None</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {selectedSupplier && (
                  <p className="text-xs text-slate-400 mt-1">Payee: <span className="font-medium text-slate-600">{selectedSupplier.name}</span></p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Bank Account *</label>
                <select
                  value={form.bank_account_id}
                  onChange={e => setForm(p => ({ ...p, bank_account_id: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select bank account</option>
                  {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {!form.bank_account_id && (
                  <p className="text-xs text-red-600 mt-1">Bank account is required to issue a check.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes / Purpose</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Purpose or remarks"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {form.check_date && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-xs font-medium ${
                  form.status === 'pdc'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-amber-50 text-amber-700'
                }`}>
                  {form.status === 'pdc' ? (
                    <><Clock className="w-3.5 h-3.5 flex-shrink-0" /> This entry will be recorded as PDC.</>
                  ) : (
                    <><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> This entry will be recorded as Outstanding.</>
                  )}
                </div>
              )}

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-500 flex items-start gap-2">
                <Link className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
                A disbursement entry will be automatically created and linked. When cleared, the bank ledger will be updated automatically.
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={addCheck}
                  disabled={saving || !form.check_number.trim() || !form.amount || !form.check_date || !form.issued_date || !form.bank_account_id}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Issue Check'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Check"
        message="Are you sure you want to delete this check? The linked disbursement entry will also be removed."
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {editTarget && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setEditTarget(null); setEditForm(null); }} />
          <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">Edit Check</h3>
              <button onClick={() => { setEditTarget(null); setEditForm(null); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Check Number *</label>
                  <input
                    type="text"
                    value={editForm.check_number}
                    onChange={e => setEditForm(p => p ? { ...p, check_number: e.target.value } : p)}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount (₱) *</label>
                  <input
                    type="number" inputMode="decimal"
                    value={editForm.amount}
                    onChange={e => setEditForm(p => p ? { ...p, amount: e.target.value } : p)}
                    step="0.01"
                    min="0"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Issued Date *</label>
                  <input
                    type="date"
                    value={editForm.issued_date}
                    onChange={e => setEditForm(p => p ? { ...p, issued_date: e.target.value } : p)}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Check Date *</label>
                  <input
                    type="date"
                    value={editForm.check_date}
                    onChange={e => {
                      const nextCheckDate = e.target.value;
                      setEditForm(p => p ? {
                        ...p,
                        check_date: nextCheckDate,
                        status: getManualStatusFlag(p.check_date, p.status) ? p.status : deriveStatus(nextCheckDate),
                      } : p);
                    }}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Status *</label>
                <select
                  value={editForm.status}
                  onChange={e => setEditForm(p => p ? { ...p, status: e.target.value as CheckStatus } : p)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="outstanding">Outstanding</option>
                  <option value="pdc">PDC</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Supplier / Payee</label>
                <select
                  value={editForm.supplier_id}
                  onChange={e => setEditForm(p => p ? { ...p, supplier_id: e.target.value } : p)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">None</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Bank Account *</label>
                <select
                  value={editForm.bank_account_id}
                  onChange={e => setEditForm(p => p ? { ...p, bank_account_id: e.target.value } : p)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select bank account</option>
                  {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {!editForm.bank_account_id && (
                  <p className="text-xs text-red-600 mt-1">Bank account is required to save this check.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes / Purpose</label>
                <input
                  type="text"
                  value={editForm.notes}
                  onChange={e => setEditForm(p => p ? { ...p, notes: e.target.value } : p)}
                  placeholder="Purpose or remarks"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {editTarget.disbursement_id && (
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700 flex items-start gap-2">
                  <Link className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  Amount and notes changes will also update the linked disbursement record.
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setEditTarget(null); setEditForm(null); }}
                  className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={editSaving || !editForm.check_number.trim() || !editForm.amount || !editForm.check_date || !editForm.bank_account_id}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                >
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
