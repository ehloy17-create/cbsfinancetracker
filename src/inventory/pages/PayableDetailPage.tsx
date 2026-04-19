import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CheckCircle, DollarSign, ReceiptText, Trash2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { BankAccount, CheckIssued, Payable, PayablePayment, Profile } from '../../lib/types';
import {
  PAYABLE_STATUS_COLORS,
  PAYABLE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  formatCurrency,
  formatDate,
  isOverdue,
} from '../lib/payableUtils';
import PaymentEntryModal from '../components/PaymentEntryModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { getCheckLifecycleStatus } from '../../lib/financeMonitoring';
import { archiveOwnerLedgerEntriesByReference } from '../../lib/ownerLedger';
import { getPayableSourceLabel, normalizePayable, normalizePayablePayment } from '../lib/payableData';

type PayableDetailRow = Payable & {
  inv_suppliers?: { id: string; name: string; code: string; contact_person?: string; phone?: string };
  receivings?: { id: string; receiving_number: string };
  purchase_orders?: { id: string; po_number: string };
  creator?: Profile | null;
};

function StatusBadge({ status }: { status: Payable['payment_status'] }) {
  const c = PAYABLE_STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
      {PAYABLE_STATUS_LABELS[status]}
    </span>
  );
}

export default function PayableDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { profile } = useAuth();

  const [payable, setPayable] = useState<PayableDetailRow | null>(null);
  const [payments, setPayments] = useState<PayablePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PayablePayment | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const [payRes, paymentsRes] = await Promise.all([
      supabase.from('payables').select('*').eq('id', id).maybeSingle(),
      supabase.from('payable_payments').select('*').eq('payable_id', id).order('payment_date', { ascending: true }),
    ]);

    if (payRes.error || !payRes.data) {
      showToast('Payable not found', 'error');
      navigate('/inventory/payables');
      return;
    }

    const normalizedPayable = normalizePayable(payRes.data as Record<string, unknown>);
    const normalizedPayments = ((paymentsRes.data ?? []) as Array<Record<string, unknown>>).map(normalizePayablePayment);
    const profileIds = Array.from(new Set([
      normalizedPayable.created_by,
      ...normalizedPayments.map((payment) => payment.created_by),
    ].filter(Boolean))) as string[];
    const bankIds = Array.from(new Set(normalizedPayments.map((payment) => payment.bank_account_id).filter(Boolean))) as string[];
    const checkIds = Array.from(new Set(normalizedPayments.map((payment) => payment.check_id).filter(Boolean))) as string[];

    const [supplierRes, receivingRes, profileRes, banksRes, checksRes] = await Promise.all([
      supabase.from('inv_suppliers').select('id, name, code, contact_person, phone').eq('id', normalizedPayable.supplier_id).maybeSingle(),
      normalizedPayable.receiving_id
        ? supabase.from('receivings').select('id, receiving_number, po_id').eq('id', normalizedPayable.receiving_id).maybeSingle()
        : Promise.resolve({ data: null }),
      profileIds.length > 0
        ? supabase.from('profiles').select('id, name').in('id', profileIds)
        : Promise.resolve({ data: [] }),
      bankIds.length > 0
        ? supabase.from('bank_accounts').select('id, name, bank_name').in('id', bankIds)
        : Promise.resolve({ data: [] }),
      checkIds.length > 0
        ? supabase.from('checks_issued').select('id, check_number, status, check_date, cleared_date, manually_set_status').in('id', checkIds)
        : Promise.resolve({ data: [] }),
    ]);

    const poRes = receivingRes.data?.po_id
      ? await supabase.from('purchase_orders').select('id, po_number').eq('id', receivingRes.data.po_id).maybeSingle()
      : { data: null };

    const profileMap = new Map(((profileRes.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row]));
    const bankMap = new Map(((banksRes.data ?? []) as BankAccount[]).map((bank) => [bank.id, bank]));
    const checkMap = new Map(
      ((checksRes.data ?? []) as CheckIssued[]).map((check) => [
        check.id,
        {
          ...check,
          status: getCheckLifecycleStatus(check.check_date, check.manually_set_status, check.status, check.cleared_date),
        },
      ])
    );

    setPayable({
      ...normalizedPayable,
      inv_suppliers: supplierRes.data ?? undefined,
      receivings: receivingRes.data ? { id: receivingRes.data.id, receiving_number: receivingRes.data.receiving_number } : undefined,
      purchase_orders: poRes.data ? { id: poRes.data.id, po_number: poRes.data.po_number } : undefined,
      creator: normalizedPayable.created_by ? { id: normalizedPayable.created_by, name: profileMap.get(normalizedPayable.created_by)?.name ?? '—' } as Profile : undefined,
    });

    setPayments(
      normalizedPayments.map((payment) => ({
        ...payment,
        profiles: payment.created_by ? { id: payment.created_by, name: profileMap.get(payment.created_by)?.name ?? '—' } as Profile : undefined,
        bank_accounts: payment.bank_account_id ? bankMap.get(payment.bank_account_id) : undefined,
        checks_issued: payment.check_id ? checkMap.get(payment.check_id) : undefined,
      }))
    );

    setLoading(false);
  }, [id, navigate, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleDeletePayment() {
    if (!deleteTarget) return;

    await archiveOwnerLedgerEntriesByReference('payable_payment', deleteTarget.id);
    const { error } = await supabase.from('payable_payments').delete().eq('id', deleteTarget.id);
    if (error) {
      showToast(error.message || 'Failed to delete payment', 'error');
    } else {
      showToast('Payment deleted', 'success');
      setDeleteTarget(null);
      await loadData();
      return;
    }
    setDeleteTarget(null);
  }

  const isAdmin = profile?.role === 'admin';
  const pctPaid = useMemo(() => {
    if (!payable || Number(payable.total_amount) <= 0) return 0;
    return Math.min(100, (Number(payable.amount_paid) / Number(payable.total_amount)) * 100);
  }, [payable]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!payable) return null;

  const sourceLabel = getPayableSourceLabel(payable);
  const overdue = isOverdue(payable);

  return (
    <>
      <div className="p-6 max-w-5xl">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Link to="/inventory/payables" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Accounts Payable
            </Link>
            <span className="text-slate-300">/</span>
            <span className="font-mono font-semibold text-slate-700">{payable.payable_number}</span>
          </div>
          {payable.payment_status !== 'paid' && payable.payment_status !== 'voided' && (
            <button
              onClick={() => setPayModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <DollarSign className="w-4 h-4" />
              Record Payment
            </button>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-4">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Payable</p>
              <h1 className="text-2xl font-bold text-slate-800 font-mono">{payable.payable_number}</h1>
              <p className="text-sm text-slate-500 mt-1">{sourceLabel}</p>
            </div>
            <StatusBadge status={payable.payment_status} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-slate-100">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Supplier</p>
              <p className="text-sm font-semibold text-slate-800">{payable.inv_suppliers?.name ?? 'Unknown supplier'}</p>
              <p className="text-xs text-slate-400 font-mono">{payable.inv_suppliers?.code ?? ''}</p>
              {payable.inv_suppliers?.contact_person && <p className="text-xs text-slate-500 mt-0.5">{payable.inv_suppliers.contact_person}</p>}
              {payable.inv_suppliers?.phone && <p className="text-xs text-slate-500">{payable.inv_suppliers.phone}</p>}
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Dates</p>
              <p className="text-sm text-slate-700">Payable Date: {formatDate(payable.invoice_date || payable.created_at)}</p>
              <p className={`text-sm ${overdue ? 'text-red-700 font-semibold' : 'text-slate-700'}`}>
                Due Date: {formatDate(payable.due_date)}
              </p>
              {payable.creator?.name && <p className="text-xs text-slate-500 mt-1">Created by: {payable.creator.name}</p>}
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">References</p>
              <p className="text-sm text-slate-700">Reference No.: {payable.invoice_number || '—'}</p>
              {payable.purchase_orders && (
                <Link to={`/inventory/purchase-orders/${payable.purchase_orders.id}`} className="block mt-1 text-sm font-mono text-blue-600 hover:underline">
                  PO: {payable.purchase_orders.po_number}
                </Link>
              )}
              {payable.receivings && (
                <Link to={`/inventory/receivings/${payable.receivings.id}`} className="block mt-1 text-sm font-mono text-blue-600 hover:underline">
                  GR: {payable.receivings.receiving_number}
                </Link>
              )}
            </div>
          </div>

          {payable.remarks && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Remarks</p>
              <p className="text-sm text-slate-600">{payable.remarks}</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {[
            { label: 'Original Amount', value: `₱${formatCurrency(Number(payable.total_amount))}`, color: 'text-slate-800' },
            { label: 'Payments Made', value: `₱${formatCurrency(Number(payable.amount_paid))}`, color: 'text-emerald-700' },
            { label: 'Remaining Balance', value: `₱${formatCurrency(Number(payable.balance_due))}`, color: Number(payable.balance_due) > 0 ? 'text-red-700' : 'text-slate-300' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
              <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-slate-700">Payment Progress</p>
            <p className="text-sm font-semibold text-slate-600">{pctPaid.toFixed(1)}%</p>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${pctPaid >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
              style={{ width: `${pctPaid}%` }}
            />
          </div>
          {payable.payment_status === 'paid' && (
            <div className="flex items-center gap-2 mt-2 text-emerald-700">
              <CheckCircle className="w-4 h-4" />
              <p className="text-xs font-medium">Fully paid</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Payment History ({payments.length})</h2>
              <p className="text-xs text-slate-400 mt-0.5">Cash, check, transfer, and owner-funded payments linked to this payable.</p>
            </div>
            {payable.payment_status !== 'paid' && payable.payment_status !== 'voided' && (
              <button
                onClick={() => setPayModalOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                <DollarSign className="w-3.5 h-3.5" />
                Add Payment
              </button>
            )}
          </div>

          {payments.length === 0 ? (
            <div className="py-12 text-center">
              <ReceiptText className="w-8 h-8 text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No payments recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Method</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Reference</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Check / Bank</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Remarks</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Recorded By</th>
                    {isAdmin && <th className="px-4 py-3 w-10" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((payment) => (
                    <tr key={payment.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-slate-700">{formatDate(payment.payment_date)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">₱{formatCurrency(Number(payment.amount))}</td>
                      <td className="px-4 py-3 text-slate-600">{PAYMENT_METHOD_LABELS[payment.payment_method] ?? payment.payment_method}</td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-600">{payment.reference_number || '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        <div className="space-y-0.5">
                          {payment.checks_issued?.check_number && (
                            <div className="font-mono text-blue-600">
                              {payment.checks_issued.check_number} · {payment.checks_issued.status}
                            </div>
                          )}
                          <div>
                            {payment.bank_accounts?.name
                              ? `${payment.bank_accounts.name}${payment.bank_accounts.bank_name ? ` - ${payment.bank_accounts.bank_name}` : ''}`
                              : '—'}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{payment.remarks || '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{payment.profiles?.name ?? '—'}</td>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setDeleteTarget(payment)}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {overdue && payable.payment_status !== 'paid' && payable.payment_status !== 'voided' && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700">This payable is overdue.</p>
              <p className="text-xs text-red-600 mt-0.5">Record a payment or update the due-date planning for this supplier obligation.</p>
            </div>
          </div>
        )}
      </div>

      <PaymentEntryModal
        open={payModalOpen}
        payable={payable}
        onClose={() => setPayModalOpen(false)}
        onSaved={() => {
          setPayModalOpen(false);
          void loadData();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Payment"
        message={`Delete payment of ₱${formatCurrency(Number(deleteTarget?.amount ?? 0))} made on ${formatDate(deleteTarget?.payment_date ?? '')}? This restores the payable balance.`}
        confirmLabel="Delete Payment"
        onConfirm={handleDeletePayment}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
