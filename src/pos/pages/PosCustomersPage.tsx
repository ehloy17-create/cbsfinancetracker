import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Printer, Receipt, RefreshCw, Search, Star, Users, Wallet } from 'lucide-react';
import { CustomerCreditLedgerEntry, PosCustomer } from '../../lib/types';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatCurrency, formatDateTime } from '../../lib/utils';
import { PAYMENT_METHOD_LABELS } from '../lib/posUtils';
import { searchCustomers } from '../lib/posCheckout';
import PosCustomerModal from '../components/PosCustomerModal';
import { openPrintPreviewWindow } from '../lib/printPreview';
import { SLIP_STYLES, formatSlipMoney } from '../lib/slip';

type SaleSummaryRow = {
  sale_id: string;
  receipt_no: string;
  total_amount: number;
  discount_amount: number;
  sale_status: string;
  created_at: string;
};

const EMPTY_PAYMENT_FORM = {
  amount: '',
  paymentMethod: 'cash' as 'cash' | 'gcash',
  accountId: '',
  referenceNo: '',
  notes: '',
};

type PaymentReceiptPayload = {
  ledger_entry_id?: string;
  customer_name?: string;
  payment_number?: string;
  amount: number;
  payment_method: 'cash' | 'gcash';
  posted_to_label?: string;
  posted_to_type?: string;
  balance_before: number;
  balance_after: number;
  created_at?: string;
  reference_no?: string;
  notes?: string;
};

export default function PosCustomersPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null);
  const [ledgerRows, setLedgerRows] = useState<CustomerCreditLedgerEntry[]>([]);
  const [salesRows, setSalesRows] = useState<SaleSummaryRow[]>([]);
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT_FORM);
  const [viewMode, setViewMode] = useState<'directory' | 'balances'>('directory');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'with-balance' | 'no-balance'>('all');
  const [showCustomerManager, setShowCustomerManager] = useState(false);
  const [gcashAccounts, setGcashAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [lastPaymentReceipt, setLastPaymentReceipt] = useState<PaymentReceiptPayload | null>(null);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('pos_customers')
      .select('*')
      .eq('is_active', true)
      .order('last_name')
      .limit(200);

    if (error) {
      showToast(error.message || 'Failed to load customers', 'error');
      setCustomers([]);
    } else {
      const rows = ((data as PosCustomer[]) || []).map(customer => ({
        ...customer,
        loyalty_points: Number(customer.loyalty_points ?? 0),
        credit_balance: Number(customer.credit_balance ?? 0),
      }));
      setCustomers(rows);
      setSelectedCustomer(current => current ?? rows[0] ?? null);
    }
    setLoading(false);
  }, [showToast]);

  const loadCustomerDetails = useCallback(async (customer: PosCustomer | null) => {
    if (!customer?.customer_id) {
      setLedgerRows([]);
      setSalesRows([]);
      return;
    }

    setLoading(true);
    const [{ data: customerRows, error: customerError }, { data: ledgerData, error: ledgerError }, { data: salesData, error: salesError }] = await Promise.all([
      supabase
        .from('pos_customers')
        .select('*')
        .eq('customer_id', customer.customer_id)
        .maybeSingle(),
      supabase
        .from('customer_credit_ledger')
        .select('*')
        .eq('customer_id', customer.customer_id)
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('sales')
        .select('sale_id, receipt_no, total_amount, discount_amount, sale_status, created_at')
        .eq('customer_id', customer.customer_id)
        .order('created_at', { ascending: false })
        .limit(25),
    ]);

    if (customerError || ledgerError || salesError) {
      showToast(customerError?.message || ledgerError?.message || salesError?.message || 'Failed to load customer details', 'error');
    } else {
      if (customerRows) {
        setSelectedCustomer({
          ...(customerRows as PosCustomer),
          loyalty_points: Number((customerRows as PosCustomer).loyalty_points ?? 0),
          credit_balance: Number((customerRows as PosCustomer).credit_balance ?? 0),
        });
      }

      setLedgerRows(((ledgerData as CustomerCreditLedgerEntry[]) || []).map(entry => ({
        ...entry,
        amount: Number(entry.amount ?? 0),
        balance_before: Number(entry.balance_before ?? 0),
        balance_after: Number(entry.balance_after ?? 0),
      })));

      setSalesRows(((salesData as SaleSummaryRow[]) || []).map(row => ({
        ...row,
        total_amount: Number(row.total_amount ?? 0),
        discount_amount: Number(row.discount_amount ?? 0),
      })));
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    const run = async () => {
      const { data } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      const rows = (data as Array<{ id: string; name: string }>) || [];
      setGcashAccounts(rows);
      if (rows.length > 0) {
        setPaymentForm(current => ({ ...current, accountId: current.accountId || rows[0].id }));
      }
    };
    void run();
  }, []);

  useEffect(() => {
    void loadCustomerDetails(selectedCustomer);
    setLastPaymentReceipt(null);
  }, [loadCustomerDetails, selectedCustomer?.customer_id]);

  useEffect(() => {
    const run = async () => {
      if (!q.trim()) {
        await loadCustomers();
        return;
      }
      setLoading(true);
      try {
        const rows = await searchCustomers(q.trim());
        setCustomers(rows.map(customer => ({
          ...customer,
          loyalty_points: Number(customer.loyalty_points ?? 0),
          credit_balance: Number(customer.credit_balance ?? 0),
        })));
      } catch {
        setCustomers([]);
      } finally {
        setLoading(false);
      }
    };

    const timer = window.setTimeout(() => {
      void run();
    }, 200);

    return () => window.clearTimeout(timer);
  }, [q, loadCustomers]);

  const totalCharged = useMemo(
    () => ledgerRows.filter(row => row.entry_type === 'charge').reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    [ledgerRows],
  );

  const totalPaid = useMemo(
    () => ledgerRows.filter(row => row.entry_type === 'payment').reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    [ledgerRows],
  );

  const filteredCustomers = useMemo(() => {
    return customers.filter(customer => {
      const balance = Number(customer.credit_balance ?? 0);
      if (balanceFilter === 'with-balance') return balance > 0;
      if (balanceFilter === 'no-balance') return balance <= 0;
      return true;
    });
  }, [balanceFilter, customers]);

  function handlePrintPaymentReceipt(payment: PaymentReceiptPayload) {
    if (!selectedCustomer && !payment.customer_name) return;

    const customerLabel = payment.customer_name || `${selectedCustomer?.first_name || ''} ${selectedCustomer?.last_name || ''}`.trim() || 'Customer';
    const formatReceiptDate = (value?: string) => {
      if (!value) return '—';
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
      return parsed.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      });
    };

    const allRows = [{
      id: payment.ledger_entry_id ?? 'latest-payment',
      entry_type: 'payment' as const,
      amount: payment.amount,
      balance_after: payment.balance_after,
      created_at: payment.created_at,
    }, ...ledgerRows]
      .filter((row, index, array) => array.findIndex(item => item.id === row.id) === index)
      .sort((a, b) => new Date(String(a.created_at ?? '')).getTime() - new Date(String(b.created_at ?? '')).getTime());

    const datedBalances: Array<{ key: string; dateLabel: string; remaining: number }> = [];

    for (const row of allRows) {
      const key = String(row.created_at ?? '').slice(0, 10) || 'unknown';
      const dateLabel = formatReceiptDate(row.created_at);
      const amount = Number(row.amount ?? 0);

      if (row.entry_type === 'charge') {
        const existing = datedBalances.find(item => item.key === key);
        if (existing) {
          existing.remaining += amount;
        } else {
          datedBalances.push({ key, dateLabel, remaining: amount });
        }
        continue;
      }

      if (row.entry_type === 'payment') {
        let remainingPayment = amount;
        for (const item of datedBalances) {
          if (remainingPayment <= 0) break;
          if (item.remaining <= 0) continue;
          const applied = Math.min(item.remaining, remainingPayment);
          item.remaining -= applied;
          remainingPayment -= applied;
        }
      }
    }

    const outstandingRows = datedBalances
      .filter(row => row.remaining > 0.0001)
      .sort((a, b) => a.key.localeCompare(b.key));

    const rows = outstandingRows.map(row => `
      <div class="row">
        <span>${row.dateLabel}</span>
        <span>${formatSlipMoney(row.remaining)}</span>
      </div>
    `).join('');

    const contentHtml = `
      <div class="slip-paper">
        <style>${SLIP_STYLES}</style>
        <div class="store-name">CUSTOMER PAYMENT RECEIPT</div>
        <div class="center receipt-no">${payment.payment_number || payment.reference_no || 'Customer Payment'}</div>
        <div class="center header-meta">${formatReceiptDate(payment.created_at)}</div>
        <div class="divider"></div>
        <div class="row"><span>Customer</span><span>${customerLabel}</span></div>
        <div class="row"><span>Payment</span><span>₱${formatSlipMoney(Number(payment.amount ?? 0))}</span></div>
        <div class="row"><span>Method</span><span>${PAYMENT_METHOD_LABELS[payment.payment_method] ?? payment.payment_method}</span></div>
        <div class="row"><span>Posted To</span><span>${payment.posted_to_label || (payment.payment_method === 'cash' ? 'Cash Fund' : 'GCash')}</span></div>
        ${payment.reference_no ? `<div class="row"><span>Reference</span><span>${payment.reference_no}</span></div>` : ''}
        <div class="divider"></div>
        <div class="item-header"><span>Date</span><span>Balance Amount</span></div>
        ${rows || '<div class="center footer-note">No dated balances remaining.</div>'}
        <div class="divider"></div>
        <div class="row"><span>Balance Before</span><span>₱${formatSlipMoney(Number(payment.balance_before ?? 0))}</span></div>
        <div class="row bold"><span>Payment</span><span>₱${formatSlipMoney(Number(payment.amount ?? 0))}</span></div>
        <div class="row total-row"><span>BALANCE</span><span>₱${formatSlipMoney(Number(payment.balance_after ?? 0))}</span></div>
        ${payment.notes ? `<div class="divider"></div><div class="footer-note">${payment.notes}</div>` : ''}
        <div class="cut-line"></div>
      </div>
    `;

    openPrintPreviewWindow({
      title: `Customer Payment - ${payment.payment_number || payment.reference_no || 'Receipt'}`,
      windowTitle: `Customer Payment ${payment.payment_number || ''}`,
      contentHtml,
      documentStyles: `${SLIP_STYLES} .preview-slip { width: 58mm; margin: 0 auto; background: #fff; }`,
      previewScale: 1.85,
      contentClassName: 'preview-slip',
      width: 1100,
      height: 920,
    });
  }

  async function handleSubmitPayment() {
    if (!selectedCustomer?.customer_id) {
      showToast('Select a customer first', 'error');
      return;
    }

    const amount = Number(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('Enter a valid payment amount', 'error');
      return;
    }
    if (paymentForm.paymentMethod === 'gcash' && !paymentForm.accountId) {
      showToast('Select which GCash account will receive the payment', 'error');
      return;
    }

    setSaving(true);
    const { data, error } = await supabase.rpc('post_customer_credit_payment', {
      p_customer_id: selectedCustomer.customer_id,
      p_amount: amount,
      p_payment_method: paymentForm.paymentMethod,
      p_account_id: paymentForm.paymentMethod === 'gcash' ? paymentForm.accountId : null,
      p_reference_no: paymentForm.referenceNo.trim(),
      p_notes: paymentForm.notes.trim(),
      p_received_by: user?.id ?? null,
    });

    setSaving(false);

    const payload = (data ?? {}) as PaymentReceiptPayload & { error?: string };
    if (error || payload.error) {
      showToast(error?.message || payload.error || 'Failed to post customer payment', 'error');
      return;
    }

    showToast(`Customer payment posted to ${payload.posted_to_label || (paymentForm.paymentMethod === 'cash' ? 'Cash Fund' : 'GCash')}`, 'success');
    setLastPaymentReceipt(payload);
    handlePrintPaymentReceipt(payload);
    setPaymentForm(current => ({ ...EMPTY_PAYMENT_FORM, accountId: current.accountId }));
    await loadCustomers();
    await loadCustomerDetails(selectedCustomer);
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Customer Ledger & Credit Payments</h1>
          <p className="text-sm text-slate-500 mt-1">Manage customer profiles, account balances, and credit settlements under POS.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowCustomerManager(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Users className="w-4 h-4" /> Manage Customers
          </button>
          <button
            onClick={() => {
              void loadCustomers();
              void loadCustomerDetails(selectedCustomer);
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setViewMode('directory')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${viewMode === 'directory' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            Customer List
          </button>
          <button
            onClick={() => setViewMode('balances')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${viewMode === 'balances' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            Ledger Balances
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setBalanceFilter('all')}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${balanceFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            All Customers
          </button>
          <button
            onClick={() => setBalanceFilter('with-balance')}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${balanceFilter === 'with-balance' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
          >
            With Balance Only
          </button>
          <button
            onClick={() => setBalanceFilter('no-balance')}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${balanceFilter === 'no-balance' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
          >
            No Balance
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search customer..."
                className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {loading && filteredCustomers.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">Loading customers…</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No customers found for the selected balance filter.</div>
            ) : filteredCustomers.map(customer => {
              const isActive = selectedCustomer?.customer_id === customer.customer_id;
              return (
                <button
                  key={customer.customer_id}
                  onClick={() => setSelectedCustomer(customer)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-colors ${isActive ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-800">{customer.first_name} {customer.last_name}</p>
                      <p className="text-xs text-slate-500">{customer.phone || 'No phone'} • {customer.price_level || 'Retail'}</p>
                      {customer.address && <p className="text-[11px] text-slate-400 truncate max-w-[220px]">{customer.address}</p>}
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${Number(customer.credit_balance ?? 0) > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {formatCurrency(Number(customer.credit_balance ?? 0))}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          {selectedCustomer ? (
            <>
              {viewMode === 'directory' ? (
                <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2"><Users className="w-4 h-4" /> Customer</p>
                  <p className="mt-2 text-lg font-black text-slate-900">{selectedCustomer.first_name} {selectedCustomer.last_name}</p>
                  <p className="text-xs text-slate-500 mt-1">{selectedCustomer.price_level || 'Retail'} • {selectedCustomer.phone || 'No phone'}</p>
                  <p className="text-[11px] text-slate-400 mt-1">{selectedCustomer.address || 'No delivery address saved'}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2"><Wallet className="w-4 h-4" /> Outstanding Credit</p>
                  <p className="mt-2 text-2xl font-black text-amber-700">{formatCurrency(Number(selectedCustomer.credit_balance ?? 0))}</p>
                  <p className="text-xs text-slate-500 mt-1">Current customer account balance</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2"><Receipt className="w-4 h-4" /> Charged Sales</p>
                  <p className="mt-2 text-2xl font-black text-rose-700">{formatCurrency(totalCharged)}</p>
                  <p className="text-xs text-slate-500 mt-1">Total sales posted to account</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2"><Star className="w-4 h-4" /> Loyalty Points</p>
                  <p className="mt-2 text-2xl font-black text-blue-700">{Number(selectedCustomer.loyalty_points ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-1">Total payments received {formatCurrency(totalPaid)}</p>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2"><BookOpen className="w-4 h-4 text-blue-600" /> Customer Credit Ledger</h2>
                    <p className="text-xs text-slate-500 mt-1">Charges and payments for this customer account.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Date</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Charge</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Payment</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Form</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Posted To</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Balance</th>
                          <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">Print</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerRows.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No customer credit activity yet.</td>
                          </tr>
                        ) : ledgerRows.map(row => (
                          <tr key={row.id} className="border-b border-slate-50">
                            <td className="px-4 py-3 text-slate-600">
                              <div>{formatDateTime(row.created_at)}</div>
                              <div className="text-[11px] text-slate-400 font-mono">{row.payment_number || row.reference_number || '—'}</div>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-rose-700">{row.entry_type === 'charge' ? formatCurrency(Number(row.amount ?? 0)) : '—'}</td>
                            <td className="px-4 py-3 text-right font-semibold text-emerald-700">{row.entry_type === 'payment' ? formatCurrency(Number(row.amount ?? 0)) : '—'}</td>
                            <td className="px-4 py-3 text-slate-700">{PAYMENT_METHOD_LABELS[row.payment_method] ?? row.payment_method}</td>
                            <td className="px-4 py-3 text-slate-600">{row.target_account_name || (row.payment_method === 'cash' ? 'Cash Fund' : row.payment_method === 'gcash' ? 'GCash' : 'Charge')}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-900">{formatCurrency(Number(row.balance_after ?? 0))}</td>
                            <td className="px-4 py-3 text-center">
                              {row.entry_type === 'payment' ? (
                                <button
                                  onClick={() => handlePrintPaymentReceipt({
                                    ledger_entry_id: row.id,
                                    payment_number: row.payment_number,
                                    amount: Number(row.amount ?? 0),
                                    payment_method: row.payment_method === 'gcash' ? 'gcash' : 'cash',
                                    posted_to_label: row.target_account_name,
                                    posted_to_type: row.target_account_type,
                                    balance_before: Number(row.balance_before ?? 0),
                                    balance_after: Number(row.balance_after ?? 0),
                                    created_at: row.created_at,
                                    reference_no: row.reference_number,
                                    notes: row.notes,
                                  })}
                                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                                  title="Print payment receipt"
                                >
                                  <Printer className="h-4 w-4" />
                                </button>
                              ) : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-50 border-t border-slate-200 font-bold text-slate-900">
                          <td className="px-4 py-3">Totals</td>
                          <td className="px-4 py-3 text-right text-rose-700">{formatCurrency(totalCharged)}</td>
                          <td className="px-4 py-3 text-right text-emerald-700">{formatCurrency(totalPaid)}</td>
                          <td className="px-4 py-3" colSpan={2}>Current Balance</td>
                          <td className="px-4 py-3 text-right text-amber-700">{formatCurrency(Number(selectedCustomer.credit_balance ?? 0))}</td>
                          <td className="px-4 py-3" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <h2 className="text-base font-bold text-slate-900">Credit Payment Module</h2>
                    <p className="text-xs text-slate-500 mt-1">Receive customer payments for account charges.</p>
                  </div>
                  <div className="p-5 space-y-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Amount</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={paymentForm.amount}
                        onChange={e => setPaymentForm(current => ({ ...current, amount: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Payment Method</label>
                      <select
                        value={paymentForm.paymentMethod}
                        onChange={e => setPaymentForm(current => ({ ...current, paymentMethod: e.target.value as 'cash' | 'gcash' }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="cash">Cash</option>
                        <option value="gcash">GCash</option>
                      </select>
                    </div>
                    {paymentForm.paymentMethod === 'gcash' ? (
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">GCash Account</label>
                        <select
                          value={paymentForm.accountId}
                          onChange={e => setPaymentForm(current => ({ ...current, accountId: e.target.value }))}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {gcashAccounts.map(account => (
                            <option key={account.id} value={account.id}>{account.name}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        Cash payments are posted to <span className="font-bold text-slate-900">Cash Fund</span>.
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Reference No.</label>
                      <input
                        value={paymentForm.referenceNo}
                        onChange={e => setPaymentForm(current => ({ ...current, referenceNo: e.target.value }))}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Optional"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Notes</label>
                      <textarea
                        value={paymentForm.notes}
                        onChange={e => setPaymentForm(current => ({ ...current, notes: e.target.value }))}
                        rows={3}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Optional notes"
                      />
                    </div>
                    <button
                      onClick={() => void handleSubmitPayment()}
                      disabled={saving || Number(selectedCustomer.credit_balance ?? 0) <= 0}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {saving ? 'Posting Payment...' : 'Post Customer Payment'}
                    </button>
                    {lastPaymentReceipt && (
                      <button
                        onClick={() => handlePrintPaymentReceipt(lastPaymentReceipt)}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <Printer className="w-4 h-4" /> Print Latest Payment
                      </button>
                    )}
                    {Number(selectedCustomer.credit_balance ?? 0) <= 0 && (
                      <p className="text-xs text-slate-500">This customer has no outstanding credit balance.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="text-base font-bold text-slate-900">Recent Sales History</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Date</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Receipt</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Discount</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No POS sales found for this customer.</td>
                        </tr>
                      ) : salesRows.map(row => (
                        <tr key={row.sale_id} className="border-b border-slate-50">
                          <td className="px-4 py-3 text-slate-600">{formatDateTime(row.created_at)}</td>
                          <td className="px-4 py-3 font-mono text-slate-800">{row.receipt_no}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${row.sale_status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                              {row.sale_status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-amber-700">{formatCurrency(Number(row.discount_amount ?? 0))}</td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatCurrency(Number(row.total_amount ?? 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
                </>
              ) : (
                <div className="space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100">
                      <h2 className="text-base font-bold text-slate-900">Customer Balance List</h2>
                      <p className="text-xs text-slate-500 mt-1">Toggle between all customers, with balances only, or no balances.</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Customer</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Contact</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Address</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCustomers.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-4 py-8 text-center text-slate-500">No customers available for this balance view.</td>
                            </tr>
                          ) : filteredCustomers.map(customer => (
                            <tr
                              key={customer.customer_id}
                              onClick={() => setSelectedCustomer(customer)}
                              className={`border-b border-slate-50 cursor-pointer ${selectedCustomer.customer_id === customer.customer_id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                            >
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-900">{customer.first_name} {customer.last_name}</div>
                                <div className="text-[11px] text-slate-500">{customer.price_level || 'Retail'}</div>
                              </td>
                              <td className="px-4 py-3 text-slate-600">{customer.phone || '—'}</td>
                              <td className="px-4 py-3 text-slate-500">{customer.address || '—'}</td>
                              <td className={`px-4 py-3 text-right font-bold ${Number(customer.credit_balance ?? 0) > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{formatCurrency(Number(customer.credit_balance ?? 0))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                      <h2 className="text-base font-bold text-slate-900">Selected Customer</h2>
                      <div className="mt-3 space-y-2 text-sm">
                        <div><span className="text-slate-500">Name:</span> <span className="font-semibold text-slate-900">{selectedCustomer.first_name} {selectedCustomer.last_name}</span></div>
                        <div><span className="text-slate-500">Phone:</span> <span className="text-slate-900">{selectedCustomer.phone || '—'}</span></div>
                        <div><span className="text-slate-500">Address:</span> <span className="text-slate-900">{selectedCustomer.address || '—'}</span></div>
                        <div><span className="text-slate-500">Outstanding:</span> <span className="font-bold text-amber-700">{formatCurrency(Number(selectedCustomer.credit_balance ?? 0))}</span></div>
                      </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                      <div className="px-5 py-4 border-b border-slate-100">
                        <h2 className="text-base font-bold text-slate-900">Credit Payment Module</h2>
                        <p className="text-xs text-slate-500 mt-1">Post payment for the selected customer balance.</p>
                      </div>
                      <div className="p-5 space-y-4">
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Amount</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={paymentForm.amount}
                            onChange={e => setPaymentForm(current => ({ ...current, amount: e.target.value }))}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Payment Method</label>
                          <select
                            value={paymentForm.paymentMethod}
                            onChange={e => setPaymentForm(current => ({ ...current, paymentMethod: e.target.value as 'cash' | 'gcash' }))}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="cash">Cash</option>
                            <option value="gcash">GCash</option>
                          </select>
                        </div>
                        {paymentForm.paymentMethod === 'gcash' ? (
                          <div>
                            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">GCash Account</label>
                            <select
                              value={paymentForm.accountId}
                              onChange={e => setPaymentForm(current => ({ ...current, accountId: e.target.value }))}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              {gcashAccounts.map(account => (
                                <option key={account.id} value={account.id}>{account.name}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">Cash payments are posted to <span className="font-bold text-slate-900">Cash Fund</span>.</div>
                        )}
                        <button
                          onClick={() => void handleSubmitPayment()}
                          disabled={saving || Number(selectedCustomer.credit_balance ?? 0) <= 0}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {saving ? 'Posting Payment...' : 'Post Customer Payment'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center text-slate-500">
              Select a customer to view their profile, ledger, and credit payment module.
            </div>
          )}
        </div>
      </div>
      {showCustomerManager && (
        <PosCustomerModal
          onClose={() => {
            setShowCustomerManager(false);
            void loadCustomers();
            void loadCustomerDetails(selectedCustomer);
          }}
          initialCustomer={selectedCustomer}
        />
      )}
    </div>
  );
}
