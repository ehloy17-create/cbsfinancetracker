import { useState, useEffect } from 'react';
import { X, ArrowRightLeft, Wallet, Banknote, Building2, Receipt, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { processCashTransaction, upsertLinkedBankDepositRequest } from '../lib/cashTransactions';
import { Account, BankAccount } from '../lib/types';
import { formatCurrency, getTodayDateString, round2 } from '../lib/utils';
import { writeAuditLog } from '../lib/audit';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { createCashLedgerEntry } from '../lib/financeMonitoring';

interface PosShiftOption {
  shift_id: string;
  business_date: string;
  cashier_name: string;
}

interface RemittanceModalProps {
  gcashAccounts: Account[];
  bankAccounts: BankAccount[];
  posShifts?: PosShiftOption[];
  runningBalances?: Record<string, number>;
  onClose: () => void;
  onSuccess: () => void;
}

type SourceType = 'gcash' | 'pos_register' | 'cash_fund';
type DestType = 'cash_fund' | 'bank';

export default function RemittanceModal({ gcashAccounts, bankAccounts, posShifts = [], runningBalances = {}, onClose, onSuccess }: RemittanceModalProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);

  const [sourceType, setSourceType] = useState<SourceType>('gcash');
  const [sourceAccountId, setSourceAccountId] = useState<string>(gcashAccounts[0]?.id || '');
  const [destType, setDestType] = useState<DestType>('bank');
  const [destBankId, setDestBankId] = useState<string>(bankAccounts[0]?.id || '');
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [bankFee, setBankFee] = useState('');
  const [notes, setNotes] = useState('');
  const today = getTodayDateString();

  useEffect(() => {
    if (saving) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saving, onClose]);

  const parsedAmount = parseFloat(amount) || 0;
  const parsedFee = parseFloat(bankFee) || 0;
  const netDeposit = round2(parsedAmount - parsedFee);
  const fallbackRunningBalance = (accountId: string) => {
    const account = gcashAccounts.find(entry => entry.id === accountId) as (Account & { current_running_balance?: number }) | undefined;
    return Number(account?.current_running_balance ?? 0);
  };

  const canHaveBankFee = sourceType === 'gcash' && destType === 'bank';
  const destOptions: DestType[] = sourceType === 'pos_register'
    ? ['cash_fund', 'bank']
    : sourceType === 'cash_fund'
    ? ['bank']
    : ['cash_fund', 'bank'];

  function handleSourceChange(st: SourceType) {
    setSourceType(st);
    if (st === 'pos_register') setDestType('cash_fund');
    else if (st === 'cash_fund') setDestType('bank');
    setBankFee('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (parsedAmount <= 0) { showToast('Amount must be greater than zero', 'error'); return; }
    if (sourceType === 'gcash' && !sourceAccountId) { showToast('Select a GCash account', 'error'); return; }
    if (sourceType === 'pos_register' && !selectedShiftId) { showToast('Select the POS shift being remitted', 'error'); return; }
    if (destType === 'bank' && !destBankId) { showToast('Select a bank account', 'error'); return; }
      if (sourceType === 'gcash' && destType === 'bank') {
      const availableBalance = runningBalances[sourceAccountId] ?? fallbackRunningBalance(sourceAccountId);
      const totalDeduct = round2(parsedAmount + parsedFee);
      if (totalDeduct > availableBalance) {
        showToast(`Insufficient GCash balance. Available: ${formatCurrency(availableBalance)}, Required: ${formatCurrency(totalDeduct)}`, 'error');
        return;
      }
    }

    setSaving(true);
    try {
      if (sourceType === 'pos_register' && selectedShiftId) {
        const { data: existingShiftRemit } = await supabase
          .from('cashier_remittances')
          .select('id')
          .eq('shift_id', selectedShiftId)
          .eq('source_type', 'pos_register')
          .eq('destination_type', destType)
          .eq('is_deleted', false)
          .maybeSingle();
        if (existingShiftRemit) {
          showToast('This POS shift already has a remittance for the selected destination', 'error');
          setSaving(false);
          return;
        }
      }

      const remittancePayload = {
        date: today,
        source_type: sourceType,
        source_account_id: sourceType === 'gcash' ? sourceAccountId : null,
        shift_id: sourceType === 'pos_register' ? selectedShiftId : null,
        destination_type: destType,
        destination_bank_id: destType === 'bank' ? destBankId : null,
        amount: parsedAmount,
        bank_fee: canHaveBankFee ? parsedFee : 0,
        notes: notes.trim(),
        created_by: user?.id ?? null,
      };

      const { data: remit, error: remitErr } = await supabase
        .from('cashier_remittances')
        .insert(remittancePayload)
        .select('id')
        .single();

      if (remitErr) throw remitErr;

      let sourceTxId: string | null = null;
      let destinationTxId: string | null = null;

      if (sourceType === 'gcash') {
        const { transaction } = await processCashTransaction({
          date: today,
          account_id: sourceAccountId,
          type: 'CASH_OUT',
          cashout_type: destType === 'bank' ? 'move_to_bank' : 'regular',
          transaction_mode: canHaveBankFee && parsedFee > 0 ? 'fee_included' : 'standard',
          amount,
          fee: canHaveBankFee ? bankFee : '0',
          total_amount: canHaveBankFee ? round2(parsedAmount + parsedFee) : parsedAmount,
          source_account_type: destType === 'bank' ? 'bank' : 'cash_fund',
          bank_account_id: destType === 'bank' ? destBankId : null,
          description: `Remittance${notes ? ': ' + notes : ''}`,
          notes,
          created_by: user?.id ?? null,
          source_module: 'cashier_remittance',
        });
        sourceTxId = String(transaction.id ?? '');
      }

      if (sourceType === 'gcash' && destType === 'cash_fund') {
        const cashFundTx = await createCashLedgerEntry({
          date: today,
          transaction_type: 'cash_in',
          amount,
          description: `GCash remittance to cash fund${notes ? ': ' + notes : ''}`,
          notes: notes.trim(),
          created_by: user?.id ?? null,
        });
        if (cashFundTx?.id) destinationTxId = cashFundTx.id;
      }

      if (sourceType === 'pos_register' && destType === 'cash_fund') {
        const cashTx = await createCashLedgerEntry({
          date: today,
          transaction_type: 'pos_remittance',
          amount,
          notes: `POS remittance to cash fund${notes ? ': ' + notes : ''}`,
          created_by: user?.id ?? null,
        });
        if (cashTx?.id) {
          sourceTxId = cashTx.id;
          destinationTxId = cashTx.id;
        }
      }

      if (sourceType === 'cash_fund' && destType === 'bank') {
        const cashTx = await createCashLedgerEntry({
          date: today,
          transaction_type: 'bank_deposit',
          amount,
          notes: `Cash fund to bank remittance${notes ? ': ' + notes : ''}`,
          created_by: user?.id ?? null,
        });
        if (cashTx?.id) sourceTxId = cashTx.id;
      }

      if (destType === 'bank') {
        const depositDescription = sourceType === 'gcash'
          ? `GCash remittance to bank${notes ? ': ' + notes : ''}`
          : sourceType === 'pos_register'
          ? `POS register deposit${notes ? ': ' + notes : ''}`
          : `Cash fund remittance to bank${notes ? ': ' + notes : ''}`;

        destinationTxId = await upsertLinkedBankDepositRequest({
          bank_account_id: destBankId,
          date: today,
          amount: parsedAmount,
          source_transaction_id: sourceTxId || remit.id,
          source_type: sourceType === 'gcash' ? 'gcash_move' : 'cash_remittance',
          source_description: depositDescription,
          notes: notes.trim(),
          created_by: user?.id ?? null,
          source_module: 'cashier_remittance',
          cashier_remittance_id: remit?.id ?? null,
          status: 'deposited',
        });
      }

      await supabase.from('cashier_remittances').update({
        source_transaction_id: sourceTxId,
        destination_transaction_id: destinationTxId,
        updated_at: new Date().toISOString(),
      }).eq('id', remit.id);

      await writeAuditLog(user?.id ?? null, 'CREATE', 'CashierRemittances', remit?.id ?? null, {
        source_type: sourceType,
        destination_type: destType,
        amount: parsedAmount,
        bank_fee: parsedFee,
      });

      showToast('Remittance recorded successfully', 'success');
      onSuccess();
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : 'Failed to save remittance. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  const labelCls = 'block text-sm font-medium text-slate-700 mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !saving && onClose()} />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center">
              <ArrowRightLeft className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">Make Remittance</h3>
              <p className="text-xs text-slate-400">Transfer funds between accounts</p>
            </div>
          </div>
          <button onClick={onClose} disabled={saving} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Source */}
          <div>
            <label className={labelCls}>Source (From)</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'gcash', label: 'GCash Account', icon: Wallet },
                { value: 'pos_register', label: 'POS Register', icon: Receipt },
                { value: 'cash_fund', label: 'Cash Fund', icon: Banknote },
              ] as { value: SourceType; label: string; icon: React.ElementType }[]).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSourceChange(opt.value)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                    sourceType === opt.value
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <opt.icon className="w-4 h-4" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {sourceType === 'pos_register' && (
            <div>
              <label className={labelCls}>POS Shift <span className="text-red-500">*</span></label>
              <select
                value={selectedShiftId}
                onChange={e => setSelectedShiftId(e.target.value)}
                className={inputCls}
                required
              >
                <option value="">Select shift...</option>
                {posShifts.map(s => (
                  <option key={s.shift_id} value={s.shift_id}>
                    {s.business_date} — {s.cashier_name}
                  </option>
                ))}
              </select>
              {posShifts.length === 0 && (
                <p className="mt-1.5 text-xs text-amber-600">No closed shifts found for today.</p>
              )}
            </div>
          )}

          {/* GCash account selector */}
          {sourceType === 'gcash' && (
            <div>
              <label className={labelCls}>GCash Account</label>
              <select
                value={sourceAccountId}
                onChange={e => setSourceAccountId(e.target.value)}
                className={inputCls}
                required
              >
                <option value="">Select account...</option>
                {gcashAccounts.map(a => {
                  const bal = runningBalances[a.id] ?? fallbackRunningBalance(a.id);
                  return (
                    <option key={a.id} value={a.id}>
                      {a.name} — Balance: {formatCurrency(bal)}
                    </option>
                  );
                })}
              </select>
              {sourceAccountId && destType === 'bank' && (
                <p className="mt-1.5 text-xs text-slate-500">
                  Available: <span className="font-semibold text-blue-700">{formatCurrency(runningBalances[sourceAccountId] ?? fallbackRunningBalance(sourceAccountId))}</span>
                </p>
              )}
            </div>
          )}

          {/* Destination */}
          <div>
            <label className={labelCls}>Destination (To)</label>
            <div className={`grid gap-2 ${destOptions.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {destOptions.map(opt => {
                const Icon = opt === 'bank' ? Building2 : Banknote;
                const label = opt === 'bank' ? 'Bank Account' : 'Cash Fund';
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => { setDestType(opt); setBankFee(''); }}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all ${
                      destType === opt
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bank selector */}
          {destType === 'bank' && (
            <div>
              <label className={labelCls}>Bank Account</label>
              <select
                value={destBankId}
                onChange={e => setDestBankId(e.target.value)}
                className={inputCls}
                required
              >
                <option value="">Select bank...</option>
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name} {b.bank_name ? `— ${b.bank_name}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Amount & Bank Fee */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Amount *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                <input
                  type="number" inputMode="decimal"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0.01"
                  required
                  className={`${inputCls} pl-7`}
                />
              </div>
            </div>
            <div>
              <label className={`${labelCls} ${!canHaveBankFee ? 'text-slate-400' : ''}`}>
                Bank Fee {!canHaveBankFee && <span className="text-slate-400 font-normal">(N/A)</span>}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                <input
                  type="number" inputMode="decimal"
                  value={bankFee}
                  onChange={e => setBankFee(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  disabled={!canHaveBankFee}
                  className={`${inputCls} pl-7 ${!canHaveBankFee ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`}
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional reference or description..."
              className={`${inputCls} resize-none`}
            />
          </div>

          {/* Summary preview */}
          {parsedAmount > 0 && (
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Transaction Summary</p>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Remittance Amount</span>
                  <span className="font-semibold text-slate-800">{formatCurrency(parsedAmount)}</span>
                </div>
                {canHaveBankFee && parsedFee > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Bank Fee (deducted from GCash)</span>
                    <span className="font-semibold text-rose-600">-{formatCurrency(parsedFee)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-200 pt-1.5">
                  <span className="font-semibold text-slate-700">
                    {destType === 'bank' ? 'Net Deposited to Bank' : 'Added to Cash Fund'}
                  </span>
                  <span className="font-bold text-emerald-700">{formatCurrency(canHaveBankFee ? netDeposit : parsedAmount)}</span>
                </div>
                {sourceType === 'gcash' && (
                  <div className="flex justify-between text-xs text-slate-400 pt-0.5">
                    <span>Total deducted from GCash</span>
                    <span className="text-rose-500">-{formatCurrency(round2(parsedAmount + (canHaveBankFee ? parsedFee : 0)))}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {sourceType === 'pos_register' && (
            <div className="flex items-start gap-2 p-3 bg-teal-50 border border-teal-100 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-teal-700">POS Register to Cash Fund remittance has no bank fee. The full amount is added to Cash Fund.</p>
            </div>
          )}

          {sourceType === 'cash_fund' && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">Cash Fund to Bank remittance will deduct from Cash Fund and deposit to the selected bank account.</p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-3 border border-slate-300 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || parsedAmount <= 0}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <ArrowRightLeft className="w-4 h-4" />
                  Record Remittance
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
