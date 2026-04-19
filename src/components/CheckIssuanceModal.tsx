import { useState, useEffect } from 'react';
import { X, Clock, AlertCircle, Link } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { BankAccount, Supplier, CheckStatus } from '../lib/types';
import { getTodayDateString } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import { getCheckLifecycleStatus, loadFinanceMonitoringSnapshot } from '../lib/financeMonitoring';
import { upsertSourceDisbursement } from '../lib/disbursements';

export type CheckIssuanceSource = 'checks' | 'bank' | 'disbursement';

export interface CheckIssuanceResult {
  checkId: string;
  checkNumber: string;
  amount: number;
  bankAccountId: string | null;
  supplierId: string | null;
  issuedDate: string;
  checkDate: string;
  notes: string;
  disbursementId?: string;
}

interface Props {
  source: CheckIssuanceSource;
  bankAccountId?: string;
  initialValues?: Partial<typeof EMPTY_FORM>;
  onClose: () => void;
  onSaved: (result: CheckIssuanceResult) => void;
}

const EMPTY_FORM = {
  check_number: '',
  bank_account_id: '',
  supplier_id: '',
  issued_date: getTodayDateString(),
  check_date: getTodayDateString(),
  status: 'outstanding' as CheckStatus,
  amount: '',
  payee: '',
  purpose: '',
  notes: '',
};

function getDefaultCheckBankId(bankAccounts: BankAccount[], preferredBankId?: string) {
  if (preferredBankId && bankAccounts.some(account => account.id === preferredBankId)) {
    return preferredBankId;
  }

  const chinabank = bankAccounts.find(account => account.name.trim().toLowerCase() === 'chinabank');
  return chinabank?.id ?? preferredBankId ?? '';
}

function deriveStatus(checkDate: string): CheckStatus {
  return getCheckLifecycleStatus(checkDate, false, 'outstanding');
}

function getManualStatusFlag(checkDate: string, status: CheckStatus) {
  return status !== deriveStatus(checkDate);
}

export default function CheckIssuanceModal({ source, bankAccountId, initialValues, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initialValues, bank_account_id: initialValues?.bank_account_id || bankAccountId || '' });
  const [saving, setSaving] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    async function loadLookups() {
      const [{ bank_accounts: accs }, { data: sups }] = await Promise.all([
        loadFinanceMonitoringSnapshot(),
        supabase.from('suppliers').select('id,name').eq('is_active', true).order('name'),
      ]);
      const nextBankAccounts = (accs as unknown as BankAccount[]) || [];
      setBankAccounts(nextBankAccounts);
      setSuppliers((sups as unknown as Supplier[]) || []);
      setForm(prev => ({
        ...prev,
        bank_account_id: prev.bank_account_id || getDefaultCheckBankId(nextBankAccounts, bankAccountId),
      }));
    }
    loadLookups();
  }, [bankAccountId]);

  const isValid =
    form.check_number.trim() &&
    form.amount &&
    form.check_date &&
    form.issued_date &&
    form.bank_account_id &&
    (source !== 'disbursement' || form.purpose.trim());

  useEffect(() => {
    if (saving) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'Enter') {
        if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
        e.preventDefault();
        if (isValid) void handleSave();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saving, onClose, isValid]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedSupplier = suppliers.find(s => s.id === form.supplier_id);
  const selectedBank = bankAccounts.find(a => a.id === form.bank_account_id);
  const status = form.status;

  async function handleSave() {
    if (!isValid) return;
    setSaving(true);
    try {
      const amount = parseFloat(form.amount);
      const payeeName = selectedSupplier?.name || form.payee.trim() || `Check #${form.check_number}`;
      const selectedStatus = form.status;
      const manuallySetStatus = getManualStatusFlag(form.check_date, selectedStatus);

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
          description: form.purpose.trim() || form.notes.trim() || `Check #${form.check_number}`,
          amount,
          notes: form.notes.trim(),
          status: selectedStatus,
          manually_set_status: manuallySetStatus,
          created_by: user?.id,
        })
        .select()
        .single();

      if (checkError) throw checkError;

      let disbursementId: string | undefined;

      if (source === 'disbursement') {
        const { data: disbData, error: disbError } = await supabase
          .from('disbursements')
          .insert({
            date: form.issued_date,
            payee: payeeName,
            purpose: form.purpose.trim() || form.notes.trim() || `Check #${form.check_number}`,
            description: form.purpose.trim() || form.notes.trim() || `Check #${form.check_number}`,
            amount,
            affects_cashflow: true,
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
        disbursementId = disbData.id;

        await supabase.from('checks_issued').update({ disbursement_id: disbData.id }).eq('id', checkData.id);
      } else {
        await upsertSourceDisbursement({
          source_module: 'check_issuance',
          source_reference_id: checkData.id,
          source_account_type: 'bank',
          source_account_id: form.bank_account_id,
          disbursement_type: 'check_issuance_pending',
          date: form.issued_date,
          payee: payeeName,
          purpose: form.purpose.trim() || form.notes.trim() || `Check #${form.check_number}`,
          description: form.purpose.trim() || form.notes.trim() || `Check #${form.check_number}`,
          amount,
          payment_method: 'check',
          supplier_id: form.supplier_id || null,
          check_id: checkData.id,
          check_number: form.check_number.trim(),
          notes: form.notes.trim(),
          created_by: user?.id ?? null,
        });
      }

      await writeAuditLog(user?.id ?? null, 'INSERT', 'ChecksIssued', checkData.id, {
        check_number: form.check_number,
        source,
        auto_disbursement: disbursementId,
      });

      showToast(
        source === 'disbursement'
          ? 'Check issued and disbursement recorded'
          : 'Check issued successfully',
        'success'
      );

      onSaved({
        checkId: checkData.id,
        checkNumber: form.check_number.trim(),
        amount,
        bankAccountId: form.bank_account_id || null,
        supplierId: form.supplier_id || null,
        issuedDate: form.issued_date,
        checkDate: form.check_date,
        notes: form.notes.trim(),
        disbursementId,
      });
    } catch {
      showToast('Failed to issue check', 'error');
    } finally {
      setSaving(false);
    }
  }

  const title = source === 'bank'
    ? 'Issue Check (Bank)'
    : source === 'disbursement'
    ? 'Issue Check for Disbursement'
    : 'Issue Check';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
            {source === 'bank' && (
              <p className="text-xs text-slate-500 mt-0.5">Data will be saved to Checks Issued</p>
            )}
            {source === 'disbursement' && (
              <p className="text-xs text-slate-500 mt-0.5">Check + linked disbursement will be created</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
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

          <div className="grid grid-cols-2 gap-3">
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
              onChange={e => setForm(p => ({ ...p, supplier_id: e.target.value, payee: '' }))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">None / Manual entry</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {!form.supplier_id && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Payee Name</label>
              <input
                type="text"
                value={form.payee}
                onChange={e => setForm(p => ({ ...p, payee: e.target.value }))}
                placeholder="Who is this check for?"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Bank Account *</label>
            <select
              value={form.bank_account_id}
              onChange={e => setForm(p => ({ ...p, bank_account_id: e.target.value }))}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select bank account</option>
              {bankAccounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.bank_name ? ` — ${a.bank_name}` : ''}
                </option>
              ))}
            </select>
            {!form.bank_account_id && (
              <p className="text-xs text-red-600 mt-1">Bank account is required to issue a check.</p>
            )}
            {selectedBank && (
              <p className="text-xs text-slate-400 mt-1">
                Current balance: <span className="font-medium text-slate-600">₱{Number(selectedBank.actual_balance ?? selectedBank.current_balance).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                {form.amount && Number(form.amount) > Number(selectedBank.actual_balance ?? selectedBank.current_balance) && (
                  <span className="ml-2 text-red-600 font-medium">— Insufficient balance!</span>
                )}
              </p>
            )}
          </div>

          {source === 'disbursement' && (
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
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes / Remarks</label>
            <input
              type="text"
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="Optional"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {form.check_date && (
            <div className={`flex items-center gap-2 p-3 rounded-lg text-xs font-medium ${
              status === 'pdc' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
            }`}>
              {status === 'pdc'
                ? <><Clock className="w-3.5 h-3.5 flex-shrink-0" /> This entry will be recorded as PDC.</>
                : <><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> This entry will be recorded as Outstanding.</>
              }
            </div>
          )}

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-500 flex items-start gap-2">
            <Link className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
            {source === 'bank'
              ? 'This check will appear in Checks Issued. When cleared, the bank ledger will be updated automatically.'
              : source === 'disbursement'
              ? 'A check record and a disbursement entry will be created and linked. Bank ledger updates when check is cleared.'
              : 'A disbursement entry will be automatically created and linked. Bank ledger updates when check is cleared.'}
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isValid}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Issue Check'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
