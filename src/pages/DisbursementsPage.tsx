import { useState, useEffect, useCallback, useMemo } from 'react';
import { CreditCard, Plus, X, Trash2, Search, RefreshCw, Banknote, FileText, Smartphone, User, Link, ChevronDown, ChevronUp, Pencil, Check, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Account, BankAccount, Disbursement, FinanceOwner, OwnerLedgerEntry, PaymentMethod, Supplier, CheckIssued, PayablePayment } from '../lib/types';
import { formatCurrency, formatDate, formatDateTime, getTodayDateString, round2 } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import ConfirmDialog from '../components/ConfirmDialog';
import CheckIssuanceModal from '../components/CheckIssuanceModal';
import { archiveBankTransactions, createCashLedgerEntry, getCheckLifecycleStatus } from '../lib/financeMonitoring';
import { archiveOwnerLedgerEntriesByReference, computeOwnerBalance, createOwnerLedgerEntry, normalizeFinanceOwner, normalizeOwnerLedgerEntry } from '../lib/ownerLedger';
import { DisbursementSourceKey, getDisbursementSourceKey, getDisbursementSourceLabel, isRealDisbursement, upsertSourceDisbursement } from '../lib/disbursements';
import { getAvailableGcashBalance, linkCashFundTransactionToDisbursement, linkTransactionToDisbursement, processCashTransaction } from '../lib/cashTransactions';

function getMonthRange() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

const PM_CONFIG: Record<PaymentMethod, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  cash: { label: 'Cash', color: 'text-emerald-700', bg: 'bg-emerald-100', icon: <Banknote className="w-3.5 h-3.5" /> },
  check: { label: 'Check', color: 'text-blue-700', bg: 'bg-blue-100', icon: <FileText className="w-3.5 h-3.5" /> },
  gcash: { label: 'GCash', color: 'text-sky-700', bg: 'bg-sky-100', icon: <Smartphone className="w-3.5 h-3.5" /> },
  creditcard: { label: 'Owner Credit Card', color: 'text-violet-700', bg: 'bg-violet-100', icon: <CreditCard className="w-3.5 h-3.5" /> },
  advances_to_owner: { label: 'Owner Personal Fund', color: 'text-orange-700', bg: 'bg-orange-100', icon: <User className="w-3.5 h-3.5" /> },
};
const ACTIVE_PAYMENT_METHODS: PaymentMethod[] = ['cash', 'check', 'gcash', 'advances_to_owner'];

function parseAmount(val: string): number {
  return Math.round(parseFloat(val) * 100) / 100;
}

function getOwnerSourceAccountType(paymentMethod: PaymentMethod) {
  if (paymentMethod === 'creditcard') return 'owner_credit_card';
  if (paymentMethod === 'advances_to_owner') return 'owner_personal';
  return null;
}

const EMPTY_FORM = {
  date: getTodayDateString(),
  payee: '',
  purpose: '',
  amount: '',
  reference_number: '',
  payment_method: 'cash' as PaymentMethod,
  supplier_id: '',
  gcash_account_id: '',
  owner_id: '',
  affects_cashflow: true,
  notes: '',
};

interface EditForm {
  date: string;
  payee: string;
  purpose: string;
  amount: string;
  reference_number: string;
  notes: string;
  payment_method: PaymentMethod;
  owner_id: string;
  affects_cashflow: boolean;
}

interface EnrichedDisbursement extends Disbursement {
  sourceKey: DisbursementSourceKey;
  sourceLabel: string;
  ownerName: string;
  paymentAccountLabel: string;
  linkedReference: string;
  createdByLabel: string;
  isSynthetic?: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export default function DisbursementsPage() {
  const { user, profile } = useAuth();
  const isAccountingOnly = profile?.role === 'accounting';
  const { showToast } = useToast();
  const [disbursements, setDisbursements] = useState<Disbursement[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [owners, setOwners] = useState<FinanceOwner[]>([]);
  const [ownerLedger, setOwnerLedger] = useState<OwnerLedgerEntry[]>([]);
  const [gcashAccounts, setGcashAccounts] = useState<Account[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterMethod, setFilterMethod] = useState<PaymentMethod | ''>('');
  const [filterSource, setFilterSource] = useState<DisbursementSourceKey | ''>('');
  const [filterOwner, setFilterOwner] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showCheckIssuance, setShowCheckIssuance] = useState(false);
  const [checkInitialValues, setCheckInitialValues] = useState<Record<string, string>>({});
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [gcashBalance, setGcashBalance] = useState<number | null>(null);
  const [gcashBalanceLoading, setGcashBalanceLoading] = useState(false);

  const initRange = getMonthRange();
  const [dateFrom, setDateFrom] = useState(initRange.from);
  const [dateTo, setDateTo] = useState(initRange.to);

  const load = useCallback(async () => {
    setLoading(true);
    const [
      { data: disbs },
      { data: sups },
      { data: chks },
      { data: ownerRows },
      { data: ownerLedgerRows },
      { data: accountRows },
      { data: bankRows },
      { data: cashOutRows },
      { data: cashFundRows },
      { data: payablePaymentRows },
      { data: payableRows },
    ] = await Promise.all([
      supabase.from('disbursements')
        .select('*')
        .eq('is_deleted', false)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      supabase.from('checks_issued').select('*').eq('is_deleted', false),
      supabase.from('finance_owners').select('*').eq('is_active', true).order('name'),
      supabase.from('owner_ledger').select('*').eq('is_deleted', false).order('transaction_date', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('accounts').select('id,name,current_beginning_balance,is_active').eq('is_active', true).order('name'),
      supabase.from('bank_accounts').select('id,name,bank_name,current_balance,is_active,beginning_balance').eq('is_active', true).order('name'),
      supabase.from('transactions')
        .select('*')
        .eq('transaction_type', 'cash_out')
        .eq('cash_out_type', 'disbursement')
        .eq('is_deleted', false)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('cash_transactions')
        .select('*')
        .eq('transaction_type', 'cash_fund_disbursement')
        .eq('is_deleted', false)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('payable_payments')
        .select('*')
        .eq('payment_method', 'owner_personal_fund')
        .gte('payment_date', dateFrom)
        .lte('payment_date', dateTo)
        .order('payment_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('payables').select('id,payable_number,supplier_id'),
    ]);
    const checksMap = new Map(
      (((chks as unknown as CheckIssued[]) || []).map(check => [
        check.id,
        {
          ...check,
          status: getCheckLifecycleStatus(
            check.check_date,
            check.manually_set_status,
            check.status,
            check.cleared_date
          ),
        },
      ]))
    );
    const suppliersMap = new Map((((sups as unknown as Supplier[]) || []).map(supplier => [supplier.id, supplier])));
    const ownersList = (((ownerRows as Record<string, unknown>[]) || []).map(normalizeFinanceOwner));
    const ownerMap = new Map(ownersList.map(owner => [owner.id, owner]));
    const payableMap = new Map((((payableRows as Record<string, unknown>[]) || []).map(row => [String(row.id ?? ''), row])));
    const existingSourceRefs = new Set(
      (((disbs as unknown as Disbursement[]) || []).map(row => `${row.source_module ?? ''}:${row.source_reference_id ?? ''}`))
    );
    const existingCheckIds = new Set(
      (((disbs as unknown as Disbursement[]) || []).map(row => row.check_id).filter(Boolean))
    );

    const normalizedDisbursements = (((disbs as unknown as Disbursement[]) || []).map(disbursement => {
      const linkedCheck = disbursement.check_id ? checksMap.get(disbursement.check_id) : undefined;
      return {
        ...disbursement,
        affects_cashflow: disbursement.affects_cashflow !== false,
        suppliers: disbursement.supplier_id ? suppliersMap.get(disbursement.supplier_id) : undefined,
        owners: disbursement.owner_id ? ownerMap.get(disbursement.owner_id) : undefined,
        checks_issued: linkedCheck ? { ...linkedCheck } : undefined,
      };
    }));

    const synthesizedCashOut = ((cashOutRows as Record<string, unknown>[]) || [])
      .filter(row => !existingSourceRefs.has(`cash_out:${String(row.id ?? '')}`))
      .map(row => {
        const accountId = String(row.account_id ?? '');
        const accountName = ((accountRows as Account[]) || []).find(account => account.id === accountId)?.name ?? 'GCash';
        const purpose = String(row.notes ?? row.description ?? `Direct disbursement from ${accountName}`);
        return {
          id: `cash-out-${String(row.id ?? '')}`,
          date: String(row.date ?? ''),
          payee: purpose,
          purpose,
          amount: Number(row.amount ?? 0),
          affects_cashflow: true,
          payment_method: 'gcash' as PaymentMethod,
          check_id: null,
          owner_id: null,
          owner_ledger_id: null,
          check_number: '',
          supplier_id: null,
          description: purpose,
          reference_number: String(row.id ?? ''),
          disbursement_type: 'cash_out_direct',
          source_module: 'cash_out',
          source_reference_id: String(row.id ?? ''),
          source_account_type: 'gcash',
          source_account_id: accountId,
          notes: String(row.notes ?? ''),
          created_by: row.created_by ? String(row.created_by) : null,
          created_at: String(row.created_at ?? ''),
          updated_at: String(row.updated_at ?? row.created_at ?? ''),
          is_deleted: false,
          isSynthetic: true,
        } satisfies Disbursement & { isSynthetic: boolean };
      });

    const synthesizedCashFund = ((cashFundRows as Record<string, unknown>[]) || [])
      .filter(row => !existingSourceRefs.has(`cash_fund:${String(row.id ?? '')}`))
      .map(row => {
        const purpose = String(row.notes ?? row.description ?? 'Cash fund direct disbursement');
        return {
          id: `cash-fund-${String(row.id ?? '')}`,
          date: String(row.date ?? ''),
          payee: purpose,
          purpose,
          amount: Number(row.amount ?? 0),
          affects_cashflow: true,
          payment_method: 'cash' as PaymentMethod,
          check_id: null,
          owner_id: null,
          owner_ledger_id: null,
          check_number: '',
          supplier_id: null,
          description: purpose,
          reference_number: String(row.id ?? ''),
          disbursement_type: 'cash_fund_direct',
          source_module: 'cash_fund',
          source_reference_id: String(row.id ?? ''),
          source_account_type: 'cash_fund',
          source_account_id: null,
          notes: String(row.notes ?? ''),
          created_by: row.created_by ? String(row.created_by) : null,
          created_at: String(row.created_at ?? ''),
          updated_at: String(row.updated_at ?? row.created_at ?? ''),
          is_deleted: false,
          isSynthetic: true,
        } satisfies Disbursement & { isSynthetic: boolean };
      });

    const synthesizedClearedChecks = (((chks as unknown as CheckIssued[]) || [])
      .filter(check => {
        const status = checksMap.get(check.id)?.status;
        return status === 'cleared'
          && !existingCheckIds.has(check.id)
          && !existingSourceRefs.has(`check_issuance:${check.id}`);
      })
      .map(check => ({
        id: `check-${check.id}`,
        date: check.cleared_date || check.issued_date || check.check_date,
        payee: check.payee || `Check #${check.check_number}`,
        purpose: check.notes || `Check #${check.check_number}`,
        amount: Number(check.amount),
        affects_cashflow: true,
        payment_method: 'check' as PaymentMethod,
        check_id: check.id,
        owner_id: null,
        owner_ledger_id: null,
        check_number: check.check_number,
        supplier_id: check.supplier_id,
        description: check.description || check.notes || `Check #${check.check_number}`,
        reference_number: check.check_number,
        disbursement_type: 'check_issuance_cleared',
        source_module: 'check_issuance',
        source_reference_id: check.id,
        source_account_type: 'bank',
        source_account_id: check.bank_account_id,
        notes: check.notes,
        created_by: check.created_by,
        created_at: check.created_at,
        updated_at: check.updated_at,
        is_deleted: false,
        suppliers: check.supplier_id ? suppliersMap.get(check.supplier_id) : undefined,
        checks_issued: checksMap.get(check.id),
        isSynthetic: true,
      } satisfies Disbursement & { isSynthetic: boolean })));

    const synthesizedOwnerPaid = (((payablePaymentRows as unknown as PayablePayment[]) || [])
      .filter(payment => !existingSourceRefs.has(`payable_payment:${payment.id}`))
      .map(payment => {
        const payable = payableMap.get(payment.payable_id);
        const supplierId = payable?.supplier_id ? String(payable.supplier_id) : null;
        const ownerId = payment.owner_id ?? null;
        const payee = supplierId ? suppliersMap.get(supplierId)?.name ?? 'Supplier Bill' : 'Supplier Bill';
        const purpose = payable?.payable_number
          ? `Owner-paid supplier bill - ${String(payable.payable_number)}`
          : 'Owner-paid supplier bill';
        return {
          id: `owner-payment-${payment.id}`,
          date: payment.payment_date,
          payee,
          purpose,
          amount: Number(payment.amount),
          affects_cashflow: true,
          payment_method: 'advances_to_owner' as PaymentMethod,
          check_id: payment.check_id ?? null,
          owner_id: ownerId,
          owner_ledger_id: payment.owner_ledger_id ?? null,
          check_number: payment.reference_number,
          supplier_id: supplierId,
          description: purpose,
          reference_number: payment.reference_number,
          disbursement_type: 'owner_personal_fund',
          source_module: 'payable_payment',
          source_reference_id: payment.id,
          source_account_type: 'owner_personal',
          source_account_id: ownerId,
          notes: payment.remarks,
          created_by: payment.created_by,
          created_at: payment.created_at,
          updated_at: payment.created_at,
          is_deleted: false,
          suppliers: supplierId ? suppliersMap.get(supplierId) : undefined,
          owners: ownerId ? ownerMap.get(ownerId) : undefined,
          isSynthetic: true,
        } satisfies Disbursement & { isSynthetic: boolean };
      }));

    setDisbursements([
      ...normalizedDisbursements,
      ...synthesizedCashOut,
      ...synthesizedCashFund,
      ...synthesizedClearedChecks,
      ...synthesizedOwnerPaid,
    ].sort((left, right) => {
      const dateDiff = right.date.localeCompare(left.date);
      return dateDiff !== 0 ? dateDiff : right.created_at.localeCompare(left.created_at);
    }));
    setSuppliers((sups as unknown as Supplier[]) || []);
    setOwners(ownersList);
    setOwnerLedger((((ownerLedgerRows as Record<string, unknown>[]) || []).map(normalizeOwnerLedgerEntry)));
    setGcashAccounts((accountRows as Account[]) || []);
    setBankAccounts((bankRows as BankAccount[]) || []);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const selectedSupplier = suppliers.find(s => s.id === form.supplier_id);
  const selectedGcashAccount = gcashAccounts.find(account => account.id === form.gcash_account_id);
  const ownerRequiredMethods: PaymentMethod[] = ['advances_to_owner'];
  const effectivePayee = selectedSupplier?.name || form.payee.trim();

  useEffect(() => {
    let active = true;

    async function loadGcashBalance() {
      if (!form.affects_cashflow || form.payment_method !== 'gcash' || !form.gcash_account_id || !form.date) {
        setGcashBalance(null);
        setGcashBalanceLoading(false);
        return;
      }

      setGcashBalanceLoading(true);
      try {
        const nextBalance = await getAvailableGcashBalance(form.gcash_account_id, form.date);
        if (active) {
          setGcashBalance(nextBalance);
        }
      } catch {
        if (active) {
          setGcashBalance(null);
        }
      } finally {
        if (active) {
          setGcashBalanceLoading(false);
        }
      }
    }

    void loadGcashBalance();
    return () => {
      active = false;
    };
  }, [form.affects_cashflow, form.date, form.gcash_account_id, form.payment_method]);

  function getOwnerLedgerDescription(payee: string, purpose: string) {
    return `${payee} - ${purpose.trim()}`;
  }

  async function saveDisbursement() {
    if (form.payment_method === 'check' && form.affects_cashflow) {
      if (!effectivePayee || !form.amount || !form.purpose.trim()) {
        showToast('Complete the payee, amount, and purpose before continuing to Check Issuance', 'warning');
        return;
      }
      setCheckInitialValues({
        supplier_id: form.supplier_id,
        payee: effectivePayee,
        amount: form.amount,
        issued_date: form.date,
        check_date: form.date,
        purpose: form.purpose.trim(),
        notes: form.notes.trim(),
      });
      setShowForm(false);
      setShowCheckIssuance(true);
      return;
    }
    if (!effectivePayee || !form.amount || !form.purpose.trim()) return;
    if (ownerRequiredMethods.includes(form.payment_method) && !form.owner_id) {
      showToast('Select the owner whose personal fund paid this expense', 'warning');
      return;
    }
    if (form.affects_cashflow && form.payment_method === 'gcash' && !form.gcash_account_id) {
      showToast('Select the GCash account to use for this disbursement', 'warning');
      return;
    }
    setSaving(true);
    try {
      const amount = parseAmount(form.amount);

      if (form.affects_cashflow && form.payment_method === 'gcash') {
        if (gcashBalance !== null && amount > gcashBalance) {
          showToast('Insufficient GCash balance for this disbursement.', 'error');
          return;
        }

        const { transaction } = await processCashTransaction({
          date: form.date,
          account_id: form.gcash_account_id,
          type: 'CASH_OUT',
          cashout_type: 'disbursement',
          transaction_mode: 'standard',
          amount,
          fee: '0',
          total_amount: amount,
          description: `${effectivePayee} - ${form.purpose.trim()}`,
          notes: form.notes.trim(),
          created_by: user?.id,
          source_module: 'disbursements_page',
        });

        const transactionId = String((transaction as { id?: string } | null)?.id ?? '');
        if (!transactionId) {
          throw new Error('Failed to save GCash disbursement');
        }

        const disbursement = await upsertSourceDisbursement({
          source_module: 'cash_out',
          source_reference_id: transactionId,
          source_account_type: 'gcash',
          source_account_id: form.gcash_account_id,
          disbursement_type: 'cash_out_direct',
          date: form.date,
          payee: effectivePayee,
          purpose: form.purpose.trim(),
          description: form.purpose.trim(),
          amount,
          affects_cashflow: true,
          payment_method: 'gcash',
          supplier_id: form.supplier_id || null,
          notes: form.notes.trim(),
          created_by: user?.id ?? null,
        });
        await linkTransactionToDisbursement(transactionId, disbursement.id);

        await writeAuditLog(user?.id ?? null, 'INSERT', 'Transactions', transactionId, {
          type: 'cash_out',
          cash_out_type: 'disbursement',
          amount,
          account_id: form.gcash_account_id,
          disbursement_payee: effectivePayee,
          supplier_id: form.supplier_id || null,
        });

        showToast('GCash direct disbursement recorded', 'success');
        setForm(EMPTY_FORM);
        setShowForm(false);
        load();
        return;
      }

      if (form.affects_cashflow && form.payment_method === 'cash') {
        const cashRow = await createCashLedgerEntry({
          date: form.date,
          transaction_type: 'cash_fund_disbursement',
          amount,
          description: form.purpose.trim(),
          notes: form.notes.trim(),
          source_module: 'disbursements_page',
          transaction_category: 'disbursement',
          created_by: user?.id ?? null,
        });

        const disbursement = await upsertSourceDisbursement({
          source_module: 'cash_fund',
          source_reference_id: String(cashRow.id),
          source_account_type: 'cash_fund',
          source_account_id: null,
          disbursement_type: 'cash_fund_direct',
          date: form.date,
          payee: effectivePayee,
          purpose: form.purpose.trim(),
          description: form.purpose.trim(),
          amount,
          affects_cashflow: true,
          payment_method: 'cash',
          supplier_id: form.supplier_id || null,
          notes: form.notes.trim(),
          created_by: user?.id ?? null,
        });
        await linkCashFundTransactionToDisbursement(String(cashRow.id), disbursement.id);

        await writeAuditLog(user?.id ?? null, 'INSERT', 'CashTransactions', cashRow.id, {
          type: 'cash_fund_disbursement',
          amount,
          disbursement_payee: effectivePayee,
          supplier_id: form.supplier_id || null,
        });

        showToast('Cash fund disbursement recorded', 'success');
        setForm(EMPTY_FORM);
        setShowForm(false);
        load();
        return;
      }

      const { data: disbData, error: disbError } = await supabase
        .from('disbursements')
        .insert({
          date: form.date,
          payee: effectivePayee,
          purpose: form.purpose.trim(),
          amount,
          affects_cashflow: form.affects_cashflow,
          payment_method: form.payment_method,
          supplier_id: form.supplier_id || null,
          owner_id: ownerRequiredMethods.includes(form.payment_method) ? form.owner_id : null,
          description: form.purpose.trim(),
          reference_number: form.reference_number.trim(),
          disbursement_type: !form.affects_cashflow
            ? 'historical_report_entry'
            : form.payment_method === 'advances_to_owner'
            ? 'owner_personal_fund'
            : 'manual_entry',
          source_module: form.affects_cashflow ? 'disbursements_page' : 'historical_report_entry',
          source_reference_id: null,
          source_account_type: form.affects_cashflow ? getOwnerSourceAccountType(form.payment_method) : null,
          source_account_id: form.affects_cashflow && ownerRequiredMethods.includes(form.payment_method) ? form.owner_id : null,
          notes: form.notes.trim(),
          created_by: user?.id,
          check_number: '',
          check_id: null as string | null,
          owner_ledger_id: null as string | null,
        })
        .select()
        .single();

      if (disbError) throw disbError;

      if (form.affects_cashflow && ownerRequiredMethods.includes(form.payment_method)) {
        const ledger = await createOwnerLedgerEntry({
          owner_id: form.owner_id,
          transaction_date: form.date,
          transaction_type: 'owner_paid_expense',
          reference_type: 'disbursement',
          reference_id: disbData.id,
          source_module: 'disbursements',
          description: getOwnerLedgerDescription(effectivePayee, form.purpose),
          increase_amount: amount,
          source_account_type: 'owner_personal',
          reference_number: form.reference_number.trim(),
          remarks: form.notes.trim(),
          created_by: user?.id ?? null,
        });
        await supabase
          .from('disbursements')
          .update({ owner_ledger_id: ledger.id, updated_at: new Date().toISOString() })
          .eq('id', disbData.id);
      }

      await writeAuditLog(user?.id ?? null, 'INSERT', 'Disbursements', disbData.id, {
        payee: effectivePayee,
        amount,
        method: form.payment_method,
        supplier_id: form.supplier_id || null,
        owner_id: ownerRequiredMethods.includes(form.payment_method) ? form.owner_id : null,
        affects_cashflow: form.affects_cashflow,
        reference_number: form.reference_number.trim() || null,
      });

      showToast(form.affects_cashflow ? 'Disbursement recorded' : 'Historical report-only expense recorded', 'success');
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to record disbursement', 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleCheckIssuanceSaved() {
    setShowCheckIssuance(false);
    setCheckInitialValues({});
    setForm(EMPTY_FORM);
    load();
  }

  function startEdit(d: Disbursement) {
    setEditingId(d.id);
      setEditForm({
        date: d.date,
        payee: d.payee,
        purpose: d.purpose,
        amount: String(Number(d.amount)),
        reference_number: d.reference_number || '',
        notes: d.notes || '',
        payment_method: d.payment_method,
        owner_id: d.owner_id || '',
        affects_cashflow: d.affects_cashflow !== false,
      });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
  }

  async function saveEdit(d: Disbursement) {
    if (!editForm) return;
    if (!editForm.payee.trim() || !editForm.amount || !editForm.purpose.trim()) return;
    if (editForm.affects_cashflow && editForm.payment_method === 'gcash') {
      showToast('Manage GCash disbursements from the GCash Cash Out flow to keep linked records consistent', 'warning');
      return;
    }
    if (ownerRequiredMethods.includes(editForm.payment_method) && !editForm.owner_id) {
      showToast('Select the owner whose personal fund paid this expense', 'warning');
      return;
    }
    setEditSaving(true);
    try {
      const amount = parseAmount(editForm.amount);
      await supabase.from('disbursements').update({
        date: editForm.date,
        payee: editForm.payee.trim(),
        purpose: editForm.purpose.trim(),
        amount,
        notes: editForm.notes.trim(),
        affects_cashflow: editForm.affects_cashflow,
        payment_method: editForm.payment_method,
        owner_id: ownerRequiredMethods.includes(editForm.payment_method) ? editForm.owner_id : null,
        description: editForm.purpose.trim(),
        reference_number: editForm.reference_number.trim(),
        disbursement_type: !editForm.affects_cashflow
          ? 'historical_report_entry'
          : editForm.payment_method === 'advances_to_owner'
          ? 'owner_personal_fund'
          : 'manual_entry',
        source_module: editForm.affects_cashflow ? 'disbursements_page' : 'historical_report_entry',
        source_account_type: editForm.affects_cashflow ? getOwnerSourceAccountType(editForm.payment_method) : null,
        source_account_id: editForm.affects_cashflow && ownerRequiredMethods.includes(editForm.payment_method) ? editForm.owner_id : null,
        owner_ledger_id: null,
        updated_at: new Date().toISOString(),
      }).eq('id', d.id);

      await archiveOwnerLedgerEntriesByReference('disbursement', d.id);
      if (editForm.affects_cashflow && ownerRequiredMethods.includes(editForm.payment_method)) {
        const ledger = await createOwnerLedgerEntry({
          owner_id: editForm.owner_id,
          transaction_date: editForm.date,
          transaction_type: 'owner_paid_expense',
          reference_type: 'disbursement',
          reference_id: d.id,
          source_module: 'disbursements',
          description: getOwnerLedgerDescription(editForm.payee.trim(), editForm.purpose),
          increase_amount: amount,
          source_account_type: 'owner_personal',
          reference_number: editForm.reference_number.trim(),
          remarks: editForm.notes.trim(),
          created_by: user?.id ?? null,
        });
        await supabase
          .from('disbursements')
          .update({ owner_ledger_id: ledger.id, updated_at: new Date().toISOString() })
          .eq('id', d.id);
      }

      if (d.check_id) {
        const linkedCheck = d.checks_issued as unknown as CheckIssued | undefined;
        if (linkedCheck?.disbursement_id === d.id) {
          await supabase.from('checks_issued').update({
            amount,
            updated_at: new Date().toISOString(),
          }).eq('id', d.check_id);
        }
      }

      await writeAuditLog(user?.id ?? null, 'UPDATE', 'Disbursements', d.id, {
        amount,
        payee: editForm.payee,
        affects_cashflow: editForm.affects_cashflow,
      });

      showToast('Disbursement updated', 'success');
      setEditingId(null);
      setEditForm(null);
      load();
    } catch {
      showToast('Failed to update disbursement', 'error');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const disb = disbursements.find(d => d.id === deleteTarget);
    if (disb?.source_reference_id || disb?.source_module === 'payable_payment' || disb?.check_id) {
      showToast('Delete this record from its original module to keep linked data consistent', 'warning');
      setDeleteTarget(null);
      return;
    }
    await supabase.from('disbursements').update({ is_deleted: true }).eq('id', deleteTarget);
    await archiveOwnerLedgerEntriesByReference('disbursement', deleteTarget);
    if (disb?.check_id) {
      const chk = disb.checks_issued as unknown as CheckIssued | undefined;
      if (chk?.disbursement_id === deleteTarget) {
        await archiveBankTransactions({ check_id: disb.check_id, payable_id: chk.payable_id ?? undefined });
        await supabase.from('checks_issued').update({ is_deleted: true }).eq('id', disb.check_id);
      }
    }
    showToast('Disbursement deleted', 'success');
    setDeleteTarget(null);
    setExpandedId(null);
    load();
  }

  const ownerBalanceMap = useMemo(
    () => new Map(owners.map(owner => [
      owner.id,
      computeOwnerBalance(ownerLedger.filter(entry => entry.owner_id === owner.id && !entry.is_deleted)),
    ])),
    [ownerLedger, owners]
  );

  const enrichedDisbursements = useMemo(() => {
    const ownerMap = new Map(owners.map(owner => [owner.id, owner]));
    const supplierMap = new Map(suppliers.map(supplier => [supplier.id, supplier]));
    const gcashMap = new Map(gcashAccounts.map(account => [account.id, account.name]));
    const bankMap = new Map(bankAccounts.map(account => [account.id, account.name]));

    return (disbursements
      .map(disbursement => {
        const linkedCheck = disbursement.checks_issued as unknown as CheckIssued | undefined;
        const sourceKey = getDisbursementSourceKey(disbursement, linkedCheck?.status ?? null);
        if (!isRealDisbursement(disbursement, linkedCheck?.status ?? null)) {
          return null as EnrichedDisbursement | null;
        }

        const owner = (disbursement.owners as FinanceOwner | undefined)
          ?? (disbursement.owner_id ? ownerMap.get(disbursement.owner_id) : undefined);
        const supplier = (disbursement.suppliers as Supplier | undefined)
          ?? (disbursement.supplier_id ? supplierMap.get(disbursement.supplier_id) : undefined);

        let paymentAccountLabel = '—';
        if (sourceKey === 'cash_out_direct') {
          paymentAccountLabel = disbursement.source_account_id
            ? gcashMap.get(disbursement.source_account_id) ?? 'GCash'
            : 'GCash';
        } else if (sourceKey === 'cash_fund_direct') {
          paymentAccountLabel = 'Cash Fund';
        } else if (sourceKey === 'check_issuance_cleared') {
          paymentAccountLabel = linkedCheck?.bank_account_id
            ? bankMap.get(linkedCheck.bank_account_id) ?? 'Bank'
            : 'Bank';
        } else if (sourceKey === 'owner_credit_card') {
          paymentAccountLabel = owner?.name ? `${owner.name} Credit Card` : 'Owner Credit Card';
        } else if (sourceKey === 'owner_personal_fund') {
          paymentAccountLabel = owner?.name ? `${owner.name} Personal Fund` : 'Owner Personal Fund';
        }

        const linkedReference = disbursement.reference_number
          || disbursement.check_number
          || disbursement.source_reference_id
          || disbursement.check_id
          || '';

        return {
          ...disbursement,
          suppliers: supplier,
          owners: owner,
          sourceKey,
          sourceLabel: getDisbursementSourceLabel(disbursement, linkedCheck?.status ?? null),
          ownerName: owner?.name ?? '',
          paymentAccountLabel,
          linkedReference,
          createdByLabel: disbursement.created_by ?? '—',
          canEdit: !disbursement.isSynthetic && !disbursement.source_reference_id && !disbursement.check_id,
          canDelete: !disbursement.isSynthetic && !disbursement.source_reference_id && !disbursement.check_id,
        } satisfies EnrichedDisbursement;
      })
      .filter((row): row is EnrichedDisbursement => row !== null));
  }, [bankAccounts, disbursements, gcashAccounts, owners, suppliers]);

  const filtered = useMemo(() => enrichedDisbursements.filter(d => {
    const q = search.trim().toLowerCase();
    const matchSearch = !q
      || d.payee.toLowerCase().includes(q)
      || d.purpose.toLowerCase().includes(q)
      || d.sourceLabel.toLowerCase().includes(q)
      || d.ownerName.toLowerCase().includes(q)
      || d.paymentAccountLabel.toLowerCase().includes(q)
      || d.linkedReference.toLowerCase().includes(q);
    const matchMethod = !filterMethod || d.payment_method === filterMethod;
    const matchSource = !filterSource || d.sourceKey === filterSource;
    const matchOwner = !filterOwner || d.owner_id === filterOwner;
    return matchSearch && matchMethod && matchSource && matchOwner;
  }), [enrichedDisbursements, filterMethod, filterOwner, filterSource, search]);

  const totals = useMemo(() => ({
    grandTotal: round2(filtered.reduce((sum, row) => round2(sum + Number(row.amount)), 0)),
    manualEntry: round2(filtered.filter(row => row.sourceKey === 'manual_entry').reduce((sum, row) => round2(sum + Number(row.amount)), 0)),
    reportOnly: round2(filtered.filter(row => row.sourceKey === 'historical_report_entry').reduce((sum, row) => round2(sum + Number(row.amount)), 0)),
    cashFund: round2(filtered.filter(row => row.sourceKey === 'cash_fund_direct').reduce((sum, row) => round2(sum + Number(row.amount)), 0)),
    clearedChecks: round2(filtered.filter(row => row.sourceKey === 'check_issuance_cleared').reduce((sum, row) => round2(sum + Number(row.amount)), 0)),
    ownerPaid: round2(filtered.filter(row => row.sourceKey === 'owner_credit_card' || row.sourceKey === 'owner_personal_fund').reduce((sum, row) => round2(sum + Number(row.amount)), 0)),
  }), [filtered]);

  const totalByMethod = useMemo(
    () => ACTIVE_PAYMENT_METHODS.reduce((acc, pm) => {
      acc[pm] = round2(filtered.filter(d => d.payment_method === pm).reduce((sum, row) => round2(sum + Number(row.amount)), 0));
      return acc;
    }, {} as Record<PaymentMethod, number>),
    [filtered]
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Disbursements</h1>
          <p className="text-slate-500 text-sm mt-0.5">Record all expense and payment transactions</p>
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
            Add Disbursement
          </button>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="flex flex-wrap items-center gap-3 bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-sm">
        <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="text-sm font-medium text-slate-600">Date Range:</span>
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

      <div className="bg-gradient-to-br from-slate-700 to-slate-800 rounded-2xl p-5 text-white">
        <p className="text-slate-300 text-xs font-semibold uppercase tracking-wider mb-1">Total Disbursements</p>
        <p className="text-3xl font-black mb-4">{formatCurrency(totals.grandTotal)}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6 mb-3">
          {[
            { label: 'Manual Entry', value: totals.manualEntry },
            { label: 'Report Only', value: totals.reportOnly },
            { label: 'Cash Fund', value: totals.cashFund },
            { label: 'Cleared Check', value: totals.clearedChecks },
            { label: 'Owner Paid', value: totals.ownerPaid },
            { label: 'Filtered Total', value: totals.grandTotal },
          ].map(card => (
            <div key={card.label} className="p-2 rounded-lg bg-white/10">
              <div className="text-xs font-medium text-white/70">{card.label}</div>
              <p className="text-sm font-bold text-white mt-1">{formatCurrency(card.value)}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {ACTIVE_PAYMENT_METHODS.filter(pm => !isAccountingOnly || (pm === 'cash' || pm === 'check')).map(pm => {
            const cfg = PM_CONFIG[pm];
            return (
            <button
              key={pm}
              onClick={() => setFilterMethod(prev => prev === pm ? '' : pm)}
              className={`p-2 rounded-lg text-left transition-all ${filterMethod === pm ? 'bg-white/20 ring-1 ring-white/40' : 'bg-white/10 hover:bg-white/15'}`}
            >
              <div className="flex items-center gap-1 mb-1 text-white/70">
                {cfg.icon}
                <span className="text-xs font-medium">{cfg.label}</span>
              </div>
              <p className="text-sm font-bold text-white">{formatCurrency(totalByMethod[pm])}</p>
            </button>
            );
          })}
        </div>
      </div>

      {owners.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {owners.map(owner => (
            <div key={owner.id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Due to {owner.name}</p>
              <p className="mt-2 text-2xl font-black text-orange-700">{formatCurrency(ownerBalanceMap.get(owner.id) ?? 0)}</p>
              <p className="mt-1 text-xs text-slate-500">
                Owner-paid disbursements in view: {formatCurrency(
                  round2(filtered.filter(row => row.owner_id === owner.id && (row.sourceKey === 'owner_credit_card' || row.sourceKey === 'owner_personal_fund')).reduce((sum, row) => sum + Number(row.amount), 0))
                )}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[2fr,1fr,1fr]">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search payee, purpose, source, owner, or reference..."
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>
        <select
          value={filterSource}
          onChange={e => setFilterSource(e.target.value as DisbursementSourceKey | '')}
          className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">All sources</option>
          <option value="manual_entry">Manual Entry</option>
          <option value="historical_report_entry">Historical / Report Only</option>
          <option value="cash_out_direct">Cash Out - Direct Disbursement</option>
          <option value="check_issuance_cleared">Check Issuance - Cleared</option>
          <option value="cash_fund_direct">Cash Fund - Direct Disbursement</option>
          <option value="owner_credit_card">Owner Credit Card</option>
          <option value="owner_personal_fund">Owner Personal Fund</option>
        </select>
        <select
          value={filterOwner}
          onChange={e => setFilterOwner(e.target.value)}
          className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">All owners</option>
          {owners.map(owner => (
            <option key={owner.id} value={owner.id}>{owner.name}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-3 flex-wrap">
        {filterMethod && (
          <button
            onClick={() => setFilterMethod('')}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200"
          >
            <X className="w-3.5 h-3.5" />
            {PM_CONFIG[filterMethod].label}
          </button>
        )}
        {filterSource && (
          <button
            onClick={() => setFilterSource('')}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200"
            >
              <X className="w-3.5 h-3.5" />
              {filterSource === 'manual_entry'
                ? 'Manual Entry'
                : filterSource === 'historical_report_entry'
                ? 'Historical / Report Only'
                : filterSource === 'cash_out_direct'
                ? 'Cash Out - Direct Disbursement'
                : filterSource === 'check_issuance_cleared'
              ? 'Check Issuance - Cleared'
              : filterSource === 'cash_fund_direct'
              ? 'Cash Fund - Direct Disbursement'
              : filterSource === 'owner_credit_card'
              ? 'Owner Credit Card'
              : 'Owner Personal Fund'}
          </button>
        )}
        {filterOwner && (
          <button
            onClick={() => setFilterOwner('')}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200"
          >
            <X className="w-3.5 h-3.5" />
            {owners.find(owner => owner.id === filterOwner)?.name ?? 'Owner'}
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">No disbursements found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map(d => {
              const cfg = PM_CONFIG[d.payment_method];
              const sup = d.suppliers as unknown as Supplier | undefined;
              const linkedCheck = d.checks_issued as unknown as CheckIssued | undefined;
              const isExpanded = expandedId === d.id;
              const isEditing = editingId === d.id;
              const isCheckCleared = d.sourceKey === 'check_issuance_cleared';

              return (
                <div key={d.id} className="transition-colors">
                  <button
                    onClick={() => {
                      if (isEditing) return;
                      setExpandedId(isExpanded ? null : d.id);
                    }}
                    className="w-full px-5 py-4 flex items-start gap-4 hover:bg-slate-50 transition-colors text-left"
                  >
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.bg} ${cfg.color}`}>
                      {cfg.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-800">{d.payee}</p>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
                          {cfg.icon}
                          {cfg.label}
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                          {d.sourceLabel}
                        </span>
                        {!d.affects_cashflow && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                            Report Only
                          </span>
                        )}
                        {d.check_number && (
                          <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                            Chk #{d.check_number}
                          </span>
                        )}
                        {isCheckCleared && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                            <Check className="w-3 h-3" />
                            Cleared
                          </span>
                        )}
                        {linkedCheck && (
                          <span title="Linked to check record" className="inline-flex items-center justify-center w-5 h-5 bg-emerald-100 text-emerald-600 rounded-full">
                            <Link className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{d.purpose}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <p className="text-xs text-slate-400">{formatDate(d.date)}</p>
                        {sup && <p className="text-xs text-slate-400">· {sup.name}</p>}
                        {d.ownerName && <p className="text-xs text-slate-400">· {d.ownerName}</p>}
                        {d.paymentAccountLabel !== '—' && <p className="text-xs text-slate-400">· {d.paymentAccountLabel}</p>}
                        {d.notes && <p className="text-xs text-slate-400 italic">· {d.notes}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <p className="text-base font-bold text-slate-800">
                        {formatCurrency(Number(d.amount))}
                      </p>
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-slate-400" />
                        : <ChevronDown className="w-4 h-4 text-slate-400" />
                      }
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-5 bg-slate-50 border-t border-slate-100">
                      {isEditing && editForm ? (
                        <div className="pt-4 space-y-3">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Edit Disbursement</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
                              <input
                                type="date"
                                value={editForm.date}
                                onChange={e => setEditForm(p => p ? { ...p, date: e.target.value } : p)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Amount (₱)</label>
                              <input
                                type="number" inputMode="decimal"
                                value={editForm.amount}
                                onChange={e => setEditForm(p => p ? { ...p, amount: e.target.value } : p)}
                                step="0.01"
                                min="0"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Payee</label>
                            <input
                              type="text"
                              value={editForm.payee}
                              onChange={e => setEditForm(p => p ? { ...p, payee: e.target.value } : p)}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Purpose</label>
                            <input
                              type="text"
                              value={editForm.purpose}
                              onChange={e => setEditForm(p => p ? { ...p, purpose: e.target.value } : p)}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Reference No.</label>
                            <input
                              type="text"
                              value={editForm.reference_number}
                              onChange={e => setEditForm(p => p ? { ...p, reference_number: e.target.value } : p)}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                              placeholder="Invoice, OR, or check reference"
                            />
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-medium text-slate-700">Affects Current Cashflow</p>
                                <p className="text-[11px] text-slate-500 mt-0.5">Disable for historical/report-only P&amp;L entries.</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditForm(p => p ? { ...p, affects_cashflow: !p.affects_cashflow } : p)}
                                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${editForm.affects_cashflow ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}
                              >
                                {editForm.affects_cashflow ? 'Yes - Live' : 'No - Report Only'}
                              </button>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Payment Method</label>
                            <div className="flex gap-2 flex-wrap">
                            {[...ACTIVE_PAYMENT_METHODS.filter(pm => pm !== 'gcash'), ...(editForm.payment_method === 'creditcard' ? (['creditcard'] as PaymentMethod[]) : [])]
                            .filter((pm, index, list) => list.indexOf(pm) === index)
                            .map(pm => {
                                const pmCfg = PM_CONFIG[pm];
                                return (
                                <button
                                  key={pm}
                                  type="button"
                                  onClick={() => setEditForm(p => p ? { ...p, payment_method: pm } : p)}
                                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                                    editForm.payment_method === pm
                                      ? `${pmCfg.bg} ${pmCfg.color} border-current`
                                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                  }`}
                                >
                                  {pmCfg.icon}
                                  {pmCfg.label}
                                </button>
                                );
                              })}
                            </div>
                          </div>
                          {ownerRequiredMethods.includes(editForm.payment_method) && (
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Owner</label>
                              <select
                                value={editForm.owner_id}
                                onChange={e => setEditForm(p => p ? { ...p, owner_id: e.target.value } : p)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                              >
                                <option value="">Select owner</option>
                                {owners.map(owner => (
                                  <option key={owner.id} value={owner.id}>{owner.name}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                            <input
                              type="text"
                              value={editForm.notes}
                              onChange={e => setEditForm(p => p ? { ...p, notes: e.target.value } : p)}
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                              placeholder="Optional"
                            />
                          </div>
                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={cancelEdit}
                              className="flex-1 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-white"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => saveEdit(d)}
                              disabled={
                                editSaving
                                || !editForm.payee.trim()
                                || !editForm.amount
                                || !editForm.purpose.trim()
                                || (ownerRequiredMethods.includes(editForm.payment_method) && !editForm.owner_id)
                              }
                              className="flex-1 flex items-center justify-center gap-2 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                            >
                              {editSaving
                                ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                : <Check className="w-4 h-4" />
                              }
                              Save Changes
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="pt-4 space-y-3">
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <div>
                              <p className="text-xs text-slate-400 mb-0.5">Date</p>
                              <p className="text-sm font-medium text-slate-700">{formatDate(d.date)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-400 mb-0.5">Amount</p>
                              <p className="text-sm font-bold text-slate-800">{formatCurrency(Number(d.amount))}</p>
                            </div>
                              <div>
                                <p className="text-xs text-slate-400 mb-0.5">Payment Method</p>
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
                                  {cfg.icon}{cfg.label}
                                </span>
                              </div>
                              <div>
                                <p className="text-xs text-slate-400 mb-0.5">Source</p>
                                <p className="text-sm text-slate-700">{d.sourceLabel}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-400 mb-0.5">Cashflow</p>
                                <p className="text-sm text-slate-700">{d.affects_cashflow ? 'Live entry' : 'Report only'}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-400 mb-0.5">Payment Account</p>
                                <p className="text-sm text-slate-700">{d.paymentAccountLabel}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-400 mb-0.5">Payee</p>
                                <p className="text-sm text-slate-700">{d.payee}</p>
                              </div>
                            <div>
                              <p className="text-xs text-slate-400 mb-0.5">Purpose</p>
                              <p className="text-sm text-slate-700">{d.purpose}</p>
                            </div>
                            {sup && (
                              <div>
                                <p className="text-xs text-slate-400 mb-0.5">Supplier</p>
                                <p className="text-sm text-slate-700">{sup.name}</p>
                              </div>
                            )}
                            {d.notes && (
                              <div>
                                <p className="text-xs text-slate-400 mb-0.5">Notes</p>
                                <p className="text-sm text-slate-600 italic">{d.notes}</p>
                              </div>
                            )}
                            {d.ownerName && (
                              <div>
                                <p className="text-xs text-slate-400 mb-0.5">Owner</p>
                                <p className="text-sm text-slate-700">{d.ownerName}</p>
                              </div>
                            )}
                            {d.check_number && (
                              <div>
                                <p className="text-xs text-slate-400 mb-0.5">Check Number</p>
                                <p className="text-sm font-mono text-slate-700">{d.check_number}</p>
                              </div>
                            )}
                            {linkedCheck && (
                              <div>
                                <p className="text-xs text-slate-400 mb-0.5">Check Date</p>
                                <p className="text-sm text-slate-700">{formatDate(linkedCheck.check_date)}</p>
                              </div>
                            )}
                            {d.reference_number && (
                              <div>
                                <p className="text-xs text-slate-400 mb-0.5">Reference No.</p>
                                <p className="text-sm text-slate-700 break-all">{d.reference_number}</p>
                              </div>
                            )}
                            {d.created_at && (
                              <div>
                                <p className="text-xs text-slate-400 mb-0.5">Recorded At</p>
                                <p className="text-xs text-slate-500">{formatDateTime(d.created_at)}</p>
                              </div>
                            )}
                            {d.linkedReference && (
                              <div>
                                <p className="text-xs text-slate-400 mb-0.5">Linked Reference</p>
                                <p className="text-sm text-slate-700 break-all">{d.linkedReference}</p>
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2 pt-2 border-t border-slate-200">
                            {d.canEdit ? (
                              <button
                                onClick={() => startEdit(d)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                Edit
                              </button>
                            ) : (
                              <div className="px-3 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-lg">
                                Managed from source module
                              </div>
                            )}
                            {d.canDelete && (
                              <button
                                onClick={() => setDeleteTarget(d.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-100 rounded-lg hover:bg-red-100 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowForm(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">Add Disbursement</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Date *</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Supplier / Payee</label>
                <select
                  value={form.supplier_id}
                  onChange={e => {
                    const sup = suppliers.find(s => s.id === e.target.value);
                    setForm(p => ({ ...p, supplier_id: e.target.value, payee: sup?.name || p.payee }));
                  }}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Manual payee entry</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <p className="text-xs text-slate-400 mt-1">Preferred: select from the supplier list. Use manual payee only when needed.</p>
              </div>

              {!selectedSupplier && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Manual Payee *</label>
                  <input
                    type="text"
                    value={form.payee}
                    onChange={e => setForm(p => ({ ...p, payee: e.target.value }))}
                    placeholder="Who was paid?"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {selectedSupplier && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-xs text-slate-500">Selected supplier</p>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{selectedSupplier.name}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Purpose *</label>
                <input
                  type="text"
                  value={form.purpose}
                  onChange={e => setForm(p => ({ ...p, purpose: e.target.value }))}
                  placeholder="What was this payment for?"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Reference No.</label>
                <input
                  type="text"
                  value={form.reference_number}
                  onChange={e => setForm(p => ({ ...p, reference_number: e.target.value }))}
                  placeholder="Invoice, OR, check no., or historical reference"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Affects Current Cashflow</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Turn this off for historical/report-only expenses that should appear in Profit and Loss without changing live cash, GCash, bank, or owner balances.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm(p => ({
                      ...p,
                      affects_cashflow: !p.affects_cashflow,
                      gcash_account_id: !p.affects_cashflow ? p.gcash_account_id : '',
                    }))}
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${form.affects_cashflow ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}
                  >
                    {form.affects_cashflow ? 'Yes - Live' : 'No - Report Only'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Payment Method *</label>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {ACTIVE_PAYMENT_METHODS.filter(pm => !isAccountingOnly || (pm === 'cash' || pm === 'check')).map(pm => {
                    const cfg = PM_CONFIG[pm];
                    return (
                    <button
                      key={pm}
                      type="button"
                      onClick={() => setForm(p => ({ ...p, payment_method: pm }))}
                      className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 text-xs font-medium transition-all ${
                        form.payment_method === pm
                          ? `${cfg.bg} ${cfg.color} border-current`
                          : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {cfg.icon}
                      <span>{cfg.label}</span>
                    </button>
                    );
                  })}
                </div>
              </div>

              {!form.affects_cashflow && (
                <div className="p-4 bg-amber-50 rounded-lg border border-amber-100 flex items-start gap-3">
                  <FileText className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Historical / Report-Only Entry</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      This entry is saved only as a disbursement row for reporting. No linked check, cash fund, GCash, bank, or owner balance movement will be created.
                    </p>
                  </div>
                </div>
              )}

              {form.affects_cashflow && form.payment_method === 'check' && (
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 flex items-start gap-3">
                  <FileText className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-blue-800">Check Payment</p>
                    <p className="text-xs text-blue-600 mt-0.5">
                      Clicking "Record Disbursement" will open the Check Issuance form. The check and disbursement will be created together and stored in the same record.
                    </p>
                  </div>
                </div>
              )}

              {form.affects_cashflow && form.payment_method === 'cash' && (
                <div className="p-4 bg-amber-50 rounded-lg border border-amber-100 flex items-start gap-3">
                  <Banknote className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Cash Fund Source</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Cash manual entry always deducts from the Cash Fund. No other cash source is used here.
                    </p>
                  </div>
                </div>
              )}

              {form.affects_cashflow && form.payment_method === 'gcash' && (
                <div className="space-y-3">
                  <div className="p-4 bg-sky-50 rounded-lg border border-sky-100 flex items-start gap-3">
                    <Smartphone className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-sky-800">GCash Direct Disbursement</p>
                      <p className="text-xs text-sky-700 mt-0.5">
                        This reuses the GCash Cash Out direct disbursement flow. The selected GCash balance is checked before posting, and the linked disbursement stays in sync without creating a duplicate manual row.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">GCash Account *</label>
                    <select
                      value={form.gcash_account_id}
                      onChange={e => setForm(p => ({ ...p, gcash_account_id: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select GCash account</option>
                      {gcashAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                    </select>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Available Balance</p>
                    <p className="mt-1 font-semibold text-slate-800">
                      {!form.gcash_account_id
                        ? 'Select a GCash account'
                        : gcashBalanceLoading
                        ? 'Checking balance...'
                        : gcashBalance === null
                        ? 'Balance unavailable'
                        : `${selectedGcashAccount?.name ?? 'GCash'}: ${formatCurrency(gcashBalance)}`}
                    </p>
                  </div>
                </div>
              )}

              {ownerRequiredMethods.includes(form.payment_method) && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Owner *</label>
                  <select
                    value={form.owner_id}
                    onChange={e => setForm(p => ({ ...p, owner_id: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select owner</option>
                    {owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">
                    Required when the owner used personal cash. This increases the amount due back to the selected owner.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional remarks"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={saveDisbursement}
                    disabled={
                      saving ||
                      !effectivePayee
                      || !form.amount
                      || !form.purpose.trim()
                      || (form.affects_cashflow && form.payment_method === 'gcash' && !form.gcash_account_id)
                      || (ownerRequiredMethods.includes(form.payment_method) && !form.owner_id)
                    }
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? 'Saving...' : form.affects_cashflow && form.payment_method === 'check' ? 'Continue to Check Issuance' : 'Record Disbursement'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Disbursement"
        message="Are you sure you want to delete this disbursement? If it created a check record, that will also be removed."
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {showCheckIssuance && (
        <CheckIssuanceModal
          source="disbursement"
          initialValues={checkInitialValues}
          onClose={() => {
            setShowCheckIssuance(false);
            setCheckInitialValues({});
            setShowForm(true);
          }}
          onSaved={handleCheckIssuanceSaved}
        />
      )}
    </div>
  );
}
