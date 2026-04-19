import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Search, UserPlus, Star, Phone, Mail, MapPin,
  ChevronLeft, Check, Edit2, User, BookOpen, Receipt, Wallet, Eye,
} from 'lucide-react';
import { CustomerPriceLevel, PosCustomer } from '../../lib/types';
import { searchCustomers, createCustomer } from '../lib/posCheckout';
import { supabase } from '../../lib/supabase';
import { formatCurrency, formatDateTime } from '../../lib/utils';
import ReceiptModal from './ReceiptModal';

interface Props {
  onClose: () => void;
  /** Optional: when opened from payment modal, selecting a customer calls this */
  onSelect?: (c: PosCustomer) => void;
  initialCustomer?: PosCustomer | null;
}

type View = 'list' | 'create' | 'edit' | 'detail';

type CustomerLedgerRow = {
  sale_id: string;
  receipt_no: string;
  total_amount: number;
  subtotal: number;
  discount_amount: number;
  created_at: string;
  sale_status: string;
  payment_method?: string | null;
  loyalty_points_earned?: number;
  loyalty_points_redeemed?: number;
};

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  address: '',
  priceLevel: 'Retail' as CustomerPriceLevel,
};

export default function PosCustomerModal({ onClose, onSelect, initialCustomer = null }: Props) {
  const [view, setView]         = useState<View>(initialCustomer ? 'detail' : 'list');
  const [q, setQ]               = useState('');
  const [results, setResults]   = useState<PosCustomer[]>([]);
  const [loading, setLoading]   = useState(false);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [saveErr, setSaveErr]   = useState('');
  const [editTarget, setEditTarget] = useState<PosCustomer | null>(null);
  const [detailTarget, setDetailTarget] = useState<PosCustomer | null>(initialCustomer);
  const [ledgerRows, setLedgerRows] = useState<CustomerLedgerRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [viewOrderSale, setViewOrderSale] = useState<{ saleId: string; receiptNo: string } | null>(null);
  const searchRef               = useRef<HTMLInputElement>(null);
  const timerRef                = useRef<ReturnType<typeof setTimeout>>();

  // Initial load: show all customers
  const loadAll = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('pos_customers')
      .select('*')
      .eq('is_active', true)
      .order('last_name')
      .limit(100);
    setResults((data as PosCustomer[]) || []);
    setLoading(false);
  }, []);

  const loadCustomerLedger = useCallback(async (customer: PosCustomer) => {
    setDetailTarget(customer);
    setDetailLoading(true);
    const { data, error } = await supabase
      .from('sales')
      .select('sale_id, receipt_no, total_amount, subtotal, discount_amount, created_at, sale_status, payment_method, loyalty_points_earned, loyalty_points_redeemed')
      .eq('customer_id', customer.customer_id)
      .order('created_at', { ascending: false })
      .limit(25);

    if (error) {
      setLedgerRows([]);
    } else {
      setLedgerRows(((data as CustomerLedgerRow[]) || []).map(row => ({
        ...row,
        total_amount: Number(row.total_amount ?? 0),
        subtotal: Number(row.subtotal ?? 0),
        discount_amount: Number(row.discount_amount ?? 0),
        loyalty_points_earned: Number(row.loyalty_points_earned ?? 0),
        loyalty_points_redeemed: Number(row.loyalty_points_redeemed ?? 0),
      })));
    }
    setDetailLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (initialCustomer?.customer_id) {
      setView('detail');
      void loadCustomerLedger(initialCustomer);
    }
  }, [initialCustomer, loadCustomerLedger]);

  // Live search
  useEffect(() => {
    clearTimeout(timerRef.current);
    if (q.trim().length < 2) {
      if (q.trim().length === 0) loadAll();
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      const res = await searchCustomers(q.trim());
      setResults(res);
      setLoading(false);
    }, 250);
  }, [q, loadAll]);

  // Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (view !== 'list') { setView('list'); setSaveErr(''); setForm(EMPTY_FORM); }
      else onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, onClose]);

  // Auto-focus search on open
  useEffect(() => {
    if (view === 'list') {
      window.requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [view]);

  async function handleCreate() {
    if (!form.firstName.trim()) { setSaveErr('First name is required'); return; }
    setSaveErr('');
    setSaving(true);
    try {
      const newC = await createCustomer(
        form.firstName.trim(),
        form.lastName.trim(),
        form.phone.trim() || undefined,
        form.priceLevel,
        {
          email: form.email.trim(),
          address: form.address.trim(),
        }
      );
      await loadAll();
      if (onSelect) onSelect(newC);
      setView('list');
      setForm(EMPTY_FORM);
    } catch {
      setSaveErr('Failed to create customer');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!editTarget) return;
    if (!form.firstName.trim()) { setSaveErr('First name is required'); return; }
    setSaveErr('');
    setSaving(true);
    try {
      await supabase.from('pos_customers').update({
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
        price_level: form.priceLevel,
      }).eq('customer_id', editTarget.customer_id);
      await loadAll();
      setView('list');
      setForm(EMPTY_FORM);
      setEditTarget(null);
    } catch {
      setSaveErr('Failed to update customer');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(c: PosCustomer) {
    setEditTarget(c);
    setForm({
      firstName: c.first_name,
      lastName: c.last_name,
      phone: c.phone,
      email: c.email,
      address: c.address ?? '',
      priceLevel: c.price_level ?? 'Retail',
    });
    setSaveErr('');
    setView('edit');
  }

  function openCreate() {
    setForm({ ...EMPTY_FORM, firstName: q.trim() });
    setSaveErr('');
    setView('create');
  }

  function openDetail(customer: PosCustomer) {
    setSaveErr('');
    setView('detail');
    void loadCustomerLedger(customer);
  }

  // ── Detail view (profile + ledger) ─────────────────────────────────────────
  if (view === 'detail' && detailTarget) {
    const completedRows = ledgerRows.filter(row => row.sale_status === 'completed');
    const lifetimeSpend = completedRows.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);
    const totalDiscounts = completedRows.reduce((sum, row) => sum + Number(row.discount_amount ?? 0), 0);
    const lastPurchaseAt = completedRows[0]?.created_at ?? null;

    return (
      <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <button onClick={() => setView('list')} className="text-slate-400 hover:text-slate-600 flex items-center gap-1.5 text-sm">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600" />
              Customer Profile & Ledger
            </h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_2fr]">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Customer</p>
                    <h3 className="text-xl font-bold text-slate-900 mt-1">{detailTarget.first_name} {detailTarget.last_name}</h3>
                    <p className="text-sm text-slate-500 mt-1">{detailTarget.email || 'No email saved'}</p>
                  </div>
                  <button
                    onClick={() => openEdit(detailTarget)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  >
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                    <span className="text-slate-500 flex items-center gap-2"><Phone className="w-4 h-4" /> Phone</span>
                    <span className="font-medium text-slate-800">{detailTarget.phone || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                    <span className="text-slate-500 flex items-center gap-2"><Mail className="w-4 h-4" /> Email</span>
                    <span className="font-medium text-slate-800 truncate ml-3">{detailTarget.email || '—'}</span>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <div className="text-slate-500 flex items-center gap-2 text-sm"><MapPin className="w-4 h-4" /> Address</div>
                    <div className="font-medium text-slate-800 mt-1 break-words">{detailTarget.address || '—'}</div>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                    <span className="text-slate-500">Price Level</span>
                    <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{detailTarget.price_level || 'Retail'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2">
                    <span className="text-amber-700 flex items-center gap-2"><Star className="w-4 h-4" /> Loyalty Points</span>
                    <span className="font-bold text-amber-700">{Number(detailTarget.loyalty_points ?? 0).toLocaleString()}</span>
                  </div>
                </div>

                {onSelect && (
                  <button
                    onClick={() => onSelect(detailTarget)}
                    className="mt-4 w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 transition-colors"
                  >
                    Use for Current Sale
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Transactions</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">{completedRows.length}</p>
                  <p className="text-xs text-slate-500 mt-1">Completed POS sales</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> Lifetime Sales</p>
                  <p className="mt-2 text-2xl font-black text-emerald-700">{formatCurrency(lifetimeSpend)}</p>
                  <p className="text-xs text-slate-500 mt-1">Total completed purchases</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Last Purchase</p>
                  <p className="mt-2 text-sm font-bold text-slate-900">{lastPurchaseAt ? formatDateTime(lastPurchaseAt) : 'No purchases yet'}</p>
                  <p className="text-xs text-slate-500 mt-1">Discount saved {formatCurrency(totalDiscounts)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Recent POS Ledger</h4>
                  <p className="text-xs text-slate-500">Latest 25 customer transactions</p>
                </div>
              </div>

              {detailLoading ? (
                <div className="px-5 py-10 text-sm text-slate-500">Loading customer ledger…</div>
              ) : ledgerRows.length === 0 ? (
                <div className="px-5 py-10 text-sm text-slate-500">No recorded POS transactions for this customer yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Receipt</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Payment</th>
                        <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerRows.map(row => (
                        <tr key={row.sale_id} className="border-b border-slate-50">
                          <td className="px-4 py-3 text-slate-600">{formatDateTime(row.created_at)}</td>
                          <td className="px-4 py-3 font-mono text-slate-800 flex items-center gap-2">
                            <Receipt className="w-3.5 h-3.5 text-slate-400" />
                            {row.receipt_no || '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${row.sale_status === 'completed' ? 'bg-emerald-50 text-emerald-700' : row.sale_status === 'voided' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
                              {row.sale_status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-600 uppercase">{row.payment_method || '—'}</td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatCurrency(Number(row.total_amount ?? 0))}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => setViewOrderSale({ saleId: row.sale_id, receiptNo: row.receipt_no })}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" /> View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {viewOrderSale && (
        <ReceiptModal
          saleId={viewOrderSale.saleId}
          receiptNo={viewOrderSale.receiptNo}
          onClose={() => setViewOrderSale(null)}
        />
      )}
    </>
  );
  }

  // ── Form view (create or edit) ──────────────────────────────────────────────
  if (view === 'create' || view === 'edit') {
    const isEdit = view === 'edit';
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <button onClick={() => { setView('list'); setSaveErr(''); }} className="text-slate-400 hover:text-slate-600 flex items-center gap-1.5 text-sm">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-600" />
              {isEdit ? 'Edit Customer' : 'New Customer'}
            </h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">First Name *</label>
                <input
                  type="text"
                  value={form.firstName}
                  onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && (isEdit ? handleUpdate() : handleCreate())}
                  placeholder="First name"
                  autoFocus
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Last Name</label>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && (isEdit ? handleUpdate() : handleCreate())}
                  placeholder="Last name"
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Phone</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && (isEdit ? handleUpdate() : handleCreate())}
                  placeholder="09xxxxxxxxx"
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Email <span className="text-slate-400 font-normal">(optional)</span></label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && (isEdit ? handleUpdate() : handleCreate())}
                  placeholder="email@example.com"
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Address <span className="text-slate-400 font-normal">(optional)</span></label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
                <textarea
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="House / street / barangay / city"
                  rows={3}
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Price Level</label>
              <select
                value={form.priceLevel}
                onChange={e => setForm(f => ({ ...f, priceLevel: e.target.value as CustomerPriceLevel }))}
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="Retail">Retail</option>
                <option value="Wholesale">Wholesale</option>
                <option value="Special">Special</option>
              </select>
            </div>
            {saveErr && <p className="text-xs text-red-600">{saveErr}</p>}
          </div>

          <div className="px-5 py-4 border-t border-slate-100">
            <button
              onClick={isEdit ? handleUpdate : handleCreate}
              disabled={saving || !form.firstName.trim()}
              className="w-full py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
            >
              {saving
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Check className="w-4 h-4" />
              }
              {isEdit ? 'Save Changes' : 'Create Customer'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── List view ───────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            <User className="w-4 h-4 text-blue-600" />
            Customers
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" /> New Customer
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-slate-100 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search by name or phone..."
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {loading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">Tap a customer to use them for the sale. Use the ledger icon to view profile and history.</p>
        </div>

        {/* Customer table */}
        <div className="flex-1 overflow-y-auto">
          {results.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
              <User className="w-10 h-10 opacity-30" />
              <p className="text-sm">{q.trim().length >= 2 ? `No customers found for "${q}"` : 'No customers yet'}</p>
              <button
                onClick={openCreate}
                className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                <UserPlus className="w-4 h-4" /> Create first customer
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Phone</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Price Level</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Points</th>
                  <th className="px-4 py-2.5 w-10" />
                </tr>
              </thead>
              <tbody>
                {results.map(c => (
                  <tr
                    key={c.customer_id}
                    className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <button
                        onClick={() => onSelect ? onSelect(c) : openDetail(c)}
                        className={`text-left ${onSelect ? 'hover:text-blue-700 cursor-pointer' : 'hover:text-blue-700 cursor-pointer'}`}
                      >
                        <p className="font-medium text-slate-800">{c.first_name} {c.last_name}</p>
                        {c.email && <p className="text-xs text-slate-400">{c.email}</p>}
                        {c.address && <p className="text-xs text-slate-400 truncate max-w-[220px]">{c.address}</p>}
                      </button>
                     </td>
                     <td className="px-4 py-3 text-slate-500">{c.phone || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {c.price_level}
                       </span>
                     </td>
                     <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                        <Star className="w-3 h-3" />
                        {c.loyalty_points.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openDetail(c)}
                          className="text-slate-400 hover:text-emerald-600 transition-colors"
                          title="Profile & Ledger"
                        >
                          <BookOpen className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEdit(c)}
                          className="text-slate-400 hover:text-blue-600 transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex-shrink-0 flex items-center justify-between">
          <p className="text-xs text-slate-400">{results.length} customer{results.length !== 1 ? 's' : ''}</p>
          <p className="text-xs text-slate-400">Press <kbd className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 font-mono">Esc</kbd> to close</p>
        </div>
      </div>
    </div>
  );
}
