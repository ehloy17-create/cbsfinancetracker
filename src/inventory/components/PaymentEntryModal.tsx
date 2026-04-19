import { useEffect, useState } from 'react';
import { DollarSign } from 'lucide-react';
import InvModal from './InvModal';
import { supabase } from '../../lib/supabase';
import { BankAccount, CheckIssued, FinanceOwner, Payable } from '../../lib/types';
import { formatCurrency, PAYMENT_METHOD_LABELS } from '../lib/payableUtils';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { createBankLedgerEntry, getCheckLifecycleStatus } from '../../lib/financeMonitoring';
import { createOwnerLedgerEntry, normalizeFinanceOwner } from '../../lib/ownerLedger';

interface Props {
  open: boolean;
  payable: Payable | null;
  onClose: () => void;
  onSaved: () => void;
}

const METHODS = ['cash', 'check', 'bank_transfer', 'gcash', 'owner_personal_fund', 'other'] as const;

export default function PaymentEntryModal({ open, payable, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [availableChecks, setAvailableChecks] = useState<CheckIssued[]>([]);
  const [owners, setOwners] = useState<FinanceOwner[]>([]);
  const [form, setForm] = useState({
    payment_date: new Date().toISOString().split('T')[0],
    amount: '',
    payment_method: 'cash',
    reference_number: '',
    remarks: '',
    owner_id: '',
    bank_account_id: '',
    check_id: '',
  });

  useEffect(() => {
    if (!open || !payable) return;
    const supplierId = payable.supplier_id;
    async function loadLookups() {
      const [{ data: banks }, { data: checks }, { data: ownerRows }] = await Promise.all([
        supabase.from('bank_accounts').select('id,name,bank_name,current_balance').eq('is_active', true).order('name'),
        supabase
          .from('checks_issued')
          .select('*')
          .eq('is_deleted', false)
          .eq('supplier_id', supplierId)
          .order('check_date', { ascending: false }),
        supabase.from('finance_owners').select('*').eq('is_active', true).order('name'),
      ]);
      setBankAccounts((banks as BankAccount[]) || []);
      setOwners((((ownerRows as Record<string, unknown>[]) || []).map(normalizeFinanceOwner)));
      setAvailableChecks(
        ((checks as CheckIssued[]) || []).map(check => ({
          ...check,
          status: getCheckLifecycleStatus(check.check_date, check.manually_set_status, check.status, check.cleared_date),
        }))
      );
    }
    void loadLookups();
  }, [open, payable]);

  function reset() {
    setForm({
      payment_date: new Date().toISOString().split('T')[0],
      amount: '',
      payment_method: 'cash',
        reference_number: '',
        remarks: '',
        owner_id: '',
        bank_account_id: '',
        check_id: '',
      });
  }

  function handleClose() {
    reset();
    onClose();
  }

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    if (!payable) return;
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) { showToast('Enter a valid payment amount', 'error'); return; }
    if (amt > Number(payable.balance_due) + 0.01) {
      showToast(`Amount exceeds balance due of ₱${formatCurrency(Number(payable.balance_due))}`, 'error');
      return;
    }
    const selectedCheck = availableChecks.find(check => check.id === form.check_id);
    if (form.payment_method === 'bank_transfer' && !form.bank_account_id) {
      showToast('Select the bank account used for this transfer', 'error');
      return;
    }
    if (form.payment_method === 'check' && !selectedCheck && !form.reference_number.trim()) {
      showToast('Select an issued check or enter the check reference number', 'error');
      return;
    }
    if (form.payment_method === 'owner_personal_fund' && !form.owner_id) {
      showToast('Select the owner who personally paid this bill', 'error');
      return;
    }
    if (selectedCheck && Math.abs(Number(selectedCheck.amount) - amt) > 0.01) {
      showToast('Linked check amount must match the payment amount', 'error');
      return;
    }

    setSaving(true);
    try {
      let bankTransactionId: string | null = null;
      if (form.payment_method === 'bank_transfer' && form.bank_account_id) {
        const bankTx = await createBankLedgerEntry({
          bank_account_id: form.bank_account_id,
          date: form.payment_date,
          tx_type: 'disbursement',
          amount: amt,
          description: payable.inv_suppliers?.name
            ? `Supplier payment - ${payable.inv_suppliers.name}`
            : `Supplier payment - ${payable.payable_number}`,
          ref_number: form.reference_number.trim(),
          direction: 'debit',
          notes: form.remarks.trim(),
          payable_id: payable.id,
          module_source: 'payable_payment',
          created_by: user?.id,
        });
        bankTransactionId = (bankTx as { id?: string } | null)?.id ?? null;
      }

      const { data: paymentRow, error } = await supabase.from('payable_payments').insert({
        payable_id: payable.id,
        payment_date: form.payment_date,
        amount: amt,
        payment_method: form.payment_method,
        reference_number: selectedCheck?.check_number || form.reference_number.trim(),
        remarks: form.remarks.trim(),
        owner_id: form.payment_method === 'owner_personal_fund' ? form.owner_id : null,
        bank_account_id: selectedCheck?.bank_account_id || form.bank_account_id || null,
        check_id: selectedCheck?.id || null,
        bank_transaction_id: bankTransactionId,
        created_by: user?.id,
        owner_ledger_id: null,
      }).select('id').single();

      if (error) {
        showToast(error.message, 'error');
        return;
      }
      if (form.payment_method === 'owner_personal_fund') {
        const ledger = await createOwnerLedgerEntry({
          owner_id: form.owner_id,
          transaction_date: form.payment_date,
          transaction_type: 'owner_paid_supplier_bill',
          reference_type: 'payable_payment',
          reference_id: paymentRow.id,
          source_module: 'payables',
          description: payable.inv_suppliers?.name
            ? `Owner paid supplier bill - ${payable.inv_suppliers.name}`
            : `Owner paid supplier bill - ${payable.payable_number}`,
          increase_amount: amt,
          source_account_type: 'owner_personal',
          source_account_id: null,
          reference_number: selectedCheck?.check_number || form.reference_number.trim(),
          remarks: form.remarks.trim(),
          created_by: user?.id ?? null,
        });
        await supabase
          .from('payable_payments')
          .update({ owner_ledger_id: ledger.id, updated_at: new Date().toISOString() })
          .eq('id', paymentRow.id);
      }
      showToast('Payment recorded successfully', 'success');
      reset();
      onSaved();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to record payment', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!payable) return null;

  const balance = Number(payable.balance_due);

  return (
    <InvModal open={open} onClose={handleClose} title="Record Payment" size="md">
      <div className="p-6 space-y-5">
        {/* Payable Summary */}
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Payable Details</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">Payable #</span>
            <span className="text-sm font-mono font-semibold text-slate-800">{payable.payable_number}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">Supplier</span>
            <span className="text-sm font-medium text-slate-800">{payable.inv_suppliers?.name ?? '—'}</span>
          </div>
          {payable.invoice_number && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Invoice</span>
              <span className="text-sm text-slate-700">{payable.invoice_number}</span>
            </div>
          )}
          <div className="border-t border-slate-200 pt-2 mt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Total Amount</span>
              <span className="text-sm font-medium text-slate-700">₱{formatCurrency(Number(payable.total_amount))}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-sm text-slate-600">Amount Paid</span>
              <span className="text-sm text-emerald-700">₱{formatCurrency(Number(payable.amount_paid))}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-sm font-semibold text-slate-800">Balance Due</span>
              <span className="text-base font-bold text-red-700">₱{formatCurrency(balance)}</span>
            </div>
          </div>
        </div>

        {/* Payment Form */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Payment Date <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={form.payment_date}
              onChange={e => setF('payment_date', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Amount <span className="text-red-500">*</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                max={balance}
                value={form.amount}
                onChange={e => setF('amount', e.target.value)}
                placeholder={formatCurrency(balance)}
                className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Payment Method <span className="text-red-500">*</span></label>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setF('payment_method', m)}
                className={`py-2 px-3 text-xs font-medium rounded-lg border transition-all ${
                  form.payment_method === m
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                }`}
              >
                {PAYMENT_METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Reference Number</label>
          <input
            type="text"
            value={form.reference_number}
            onChange={e => setF('reference_number', e.target.value)}
            placeholder="Check #, transfer ref, etc."
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {(form.payment_method === 'bank_transfer' || form.payment_method === 'check') && (
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {form.payment_method === 'bank_transfer' ? 'Bank Account' : 'Issued Check / Bank'}
            </label>
            {form.payment_method === 'check' && availableChecks.length > 0 && (
              <select
                value={form.check_id}
                onChange={e => {
                  const nextCheckId = e.target.value;
                  const nextCheck = availableChecks.find(check => check.id === nextCheckId);
                  setForm(current => ({
                    ...current,
                    check_id: nextCheckId,
                    bank_account_id: nextCheck?.bank_account_id || '',
                    reference_number: nextCheck?.check_number || current.reference_number,
                    amount: nextCheck ? String(Number(nextCheck.amount)) : current.amount,
                  }));
                }}
                className="w-full px-3 py-2 mb-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select existing issued check...</option>
                {availableChecks
                  .filter(check => check.status === 'pdc' || check.status === 'outstanding' || check.status === 'cleared')
                  .map(check => (
                    <option key={check.id} value={check.id}>
                      {check.check_number} - {PAYMENT_METHOD_LABELS.check} - ₱{formatCurrency(Number(check.amount))}
                    </option>
                  ))}
              </select>
            )}
            <select
              value={form.bank_account_id}
              onChange={e => setF('bank_account_id', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select bank account...</option>
              {bankAccounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.name}{account.bank_name ? ` - ${account.bank_name}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {form.payment_method === 'owner_personal_fund' && (
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Owner <span className="text-red-500">*</span></label>
            <select
              value={form.owner_id}
              onChange={e => setF('owner_id', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select owner...</option>
              {owners.map(owner => (
                <option key={owner.id} value={owner.id}>{owner.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Remarks</label>
          <input
            type="text"
            value={form.remarks}
            onChange={e => setF('remarks', e.target.value)}
            placeholder="Optional notes..."
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Quick fill */}
        {balance > 0 && (
          <button
            type="button"
            onClick={() => setF('amount', String(balance))}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
          >
            Fill full balance (₱{formatCurrency(balance)})
          </button>
        )}

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.amount || !form.payment_date}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <DollarSign className="w-4 h-4" />
            {saving ? 'Saving...' : 'Record Payment'}
          </button>
        </div>
      </div>
    </InvModal>
  );
}

