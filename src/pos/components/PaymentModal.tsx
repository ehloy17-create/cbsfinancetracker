import { useState, useEffect, useRef } from 'react';
import { useCompanySettings } from '../../contexts/CompanySettingsContext';
import { resolveApiBase } from '../../lib/apiBase';
import {
  X, Banknote, Smartphone, Wallet,
  AlertTriangle, CheckCircle2, Plus, Trash2,
  User, Gift, Star,
} from 'lucide-react';
import { SalePaymentMethod, PosCustomer } from '../../lib/types';
import { CartLine, CartTotals } from '../hooks/useCart';
import { formatCurrency, PAYMENT_METHOD_LABELS } from '../lib/posUtils';
import { processCashTransaction } from '../../lib/cashTransactions';
import { supabase } from '../../lib/supabase';
import { getTodayDateString } from '../../lib/utils';
import {
  checkStock, postSale, StockWarning, CheckoutPayload,
  updateLoyaltyPoints,
} from '../lib/posCheckout';
import PosCustomerSearch from './PosCustomerSearch';

const LOYALTY_EARN_RATE  = 1;
const LOYALTY_REDEEM_RATE = 1;

interface Props {
  lines: CartLine[];
  totals: CartTotals;
  shiftId: string;
  terminalId: string;
  locationId: string;
  cashierId: string;
  allowNegativeQty: boolean;
  initialCustomer?: PosCustomer | null;
  initialCustomerSnapshot?: string;
  customerLocked?: boolean;
  onCustomerChange?: (customer: PosCustomer | null) => void;
  onSuccess: (saleId: string, receiptNo: string) => void;
  onClose: () => void;
}

const METHOD_ICONS: Record<SalePaymentMethod, React.ReactNode> = {
  cash: <Banknote className="w-5 h-5" />,
  gcash: <Smartphone className="w-5 h-5" />,
  charge: <Wallet className="w-5 h-5" />,
};

const METHODS: SalePaymentMethod[] = ['gcash', 'cash', 'charge'];

type Stage = 'method' | 'pay' | 'stock_warning' | 'posting';

function fmt(n: number) { return `₱${formatCurrency(n)}`; }
function formatTenderedValue(amount: number) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

interface SplitEntry {
  method: SalePaymentMethod;
  amount: string;
  referenceNo: string;
}

export default function PaymentModal({
  lines, totals, shiftId, terminalId, locationId, cashierId,
  allowNegativeQty, initialCustomer = null, initialCustomerSnapshot = '', customerLocked = false, onCustomerChange,
  onSuccess, onClose,
}: Props) {
  const { settings: companySettings } = useCompanySettings();
  const [stage, setStage]               = useState<Stage>('method');
  const [method, setMethod]             = useState<SalePaymentMethod>('cash');
  const [tendered, setTendered]         = useState('');
  const [refNo, setRefNo]               = useState('');
  const [stockWarnings, setStockWarn]   = useState<StockWarning[]>([]);
  const [error, setError]               = useState('');
  const tenderedRef = useRef<HTMLInputElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const methodButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Mutable ref so keyboard handlers always call the latest handlePost closure
  const handlePostRef = useRef<() => void>(() => {});

  const [splitMode, setSplitMode]       = useState(false);
  const [splits, setSplits]             = useState<SplitEntry[]>([
    { method: 'cash', amount: '', referenceNo: '' },
  ]);
  const splitInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const [customer, setCustomer]         = useState<PosCustomer | null>(initialCustomer);
  const [redeemPts, setRedeemPts]       = useState(false);
  const [ptsToRedeem, setPtsToRedeem]   = useState('');

  // GCash integration
  const [gcashAccounts, setGcashAccounts] = useState<{id: string; name: string}[]>([]);
  const [gcashAccountId, setGcashAccountId] = useState('');
  const [deliveryFee, setDeliveryFee]   = useState('');
  const displayCustomerName = customer
    ? `${customer.first_name} ${customer.last_name}`.trim()
    : initialCustomerSnapshot.trim();

  const loyaltyDiscount = redeemPts
    ? Math.min(parseFloat(ptsToRedeem) || 0, customer?.loyalty_points ?? 0) * LOYALTY_REDEEM_RATE
    : 0;
  const adjustedTotal = Math.max(0, totals.grandTotal - loyaltyDiscount);

  const [chargeTendered, setChargeTendered] = useState('');

  const tenderedNum = parseFloat(tendered) || 0;
  const chargeTenderedNum = parseFloat(chargeTendered) || 0;
  const changeAmt   = Math.max(0, tenderedNum - adjustedTotal);
  const chargeCredit = !splitMode && method === 'charge' && chargeTenderedNum > adjustedTotal
    ? Math.round((chargeTenderedNum - adjustedTotal) * 100) / 100
    : 0;
  const isExact     = method !== 'cash' && method !== 'charge';

  const splitTotal  = splits.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  const splitChange = Math.max(0, splitTotal - adjustedTotal);
  const splitRemaining = Math.max(0, adjustedTotal - splitTotal);
  const chargeInputValid = method === 'charge'
    ? (chargeTendered === '' || chargeTenderedNum >= adjustedTotal - 0.005)
    : true;
  const splitReady  = splitMode
    ? splitTotal >= adjustedTotal - 0.005
    : (isExact || tenderedNum >= adjustedTotal || (method === 'charge' && chargeInputValid));
  const needsCustomerForCharge = splitMode
    ? splits.some(entry => entry.method === 'charge')
    : method === 'charge';
  const isLargeCashEntry = stage === 'pay' && !splitMode && method === 'cash';

  useEffect(() => {
    setCustomer(initialCustomer);
  }, [initialCustomer]);

  function handleCustomerSelect(nextCustomer: PosCustomer | null) {
    if (onCustomerChange) {
      onCustomerChange(nextCustomer);
      return;
    }
    setCustomer(nextCustomer);
  }

  useEffect(() => {
    if (stage !== 'method') return;
    window.requestAnimationFrame(() => {
      const idx = METHODS.indexOf(method);
      if (idx >= 0) methodButtonRefs.current[idx]?.focus();
      else continueButtonRef.current?.focus();
    });
  }, [stage]);

  useEffect(() => {
    if (stage !== 'pay') return;

    if (!splitMode && method === 'cash') {
      setTendered(formatTenderedValue(adjustedTotal));
      window.setTimeout(() => {
        tenderedRef.current?.focus();
        tenderedRef.current?.select();
      }, 0);
      return;
    }

    tenderedRef.current?.focus();
  }, [adjustedTotal, method, splitMode, stage]);

  useEffect(() => {
    if (stage !== 'pay') return;

    function handlePayKeys(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setStage('method');
        return;
      }
      // F1 = confirm GCash payment (non-cash, non-split) or any ready payment
      if (e.key === 'F1') {
        e.preventDefault();
        handlePostRef.current();
      }
    }

    window.addEventListener('keydown', handlePayKeys);
    return () => window.removeEventListener('keydown', handlePayKeys);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'method') return;

    function handleMethodEnter(e: KeyboardEvent) {
      if (e.key === 'F2') {
        e.preventDefault();
        toggleSplitMode();
        return;
      }
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;

      e.preventDefault();
      void handleCheckStock();
    }

    window.addEventListener('keydown', handleMethodEnter);
    return () => window.removeEventListener('keydown', handleMethodEnter);
  }, [allowNegativeQty, lines, locationId, stage]);

  useEffect(() => {
    if (!splitMode || splits.length < 2) return;
    const lastRef = splitInputRefs.current[splits.length - 1];
    if (lastRef) { lastRef.focus(); lastRef.select(); }
  }, [splits.length, splitMode]);

  // Load active GCash accounts
  useEffect(() => {
    supabase.from('accounts').select('id, name').eq('is_active', true).order('name').then(({ data }) => {
      if (data && data.length > 0) {
        setGcashAccounts(data as {id: string; name: string}[]);
        setGcashAccountId((data as {id: string; name: string}[])[0].id);
      }
    });
  }, []);

  function toggleSplitMode() {
    if (!splitMode) {
      setSplits([{ method: 'gcash', amount: formatTenderedValue(adjustedTotal), referenceNo: '' }]);
      setSplitMode(true);
      window.setTimeout(() => {
        const firstRef = splitInputRefs.current[0];
        if (firstRef) { firstRef.focus(); firstRef.select(); }
      }, 0);
    } else {
      setSplitMode(false);
      setSplits([{ method: 'cash', amount: '', referenceNo: '' }]);
    }
  }

  function updateSplit(idx: number, field: keyof SplitEntry, val: string) {
    setSplits(prev => prev.map((e, i) => i === idx ? { ...e, [field]: val } : e));
  }

  function addSplitRow() {
    const usedMethods = splits.map(s => s.method);
    const priority: SalePaymentMethod[] = ['gcash', ...METHODS.filter(m => m !== 'gcash')];
    const nextMethod = priority.find(m => !usedMethods.includes(m)) ?? 'cash';
    const currentSum = splits.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const remaining  = Math.max(0, adjustedTotal - currentSum);
    setSplits(prev => [...prev, {
      method: nextMethod,
      amount: remaining > 0 ? formatTenderedValue(remaining) : '',
      referenceNo: '',
    }]);
  }

  function removeSplitRow(idx: number) {
    setSplits(prev => prev.filter((_, i) => i !== idx));
  }

  const deliveryFeeNum = parseFloat(deliveryFee) || 0;
  const needsCustomerForDelivery = deliveryFeeNum > 0 && !customer?.customer_id;

  async function handleCheckStock() {
    setError('');
    if (needsCustomerForCharge && !customer?.customer_id) {
      setError('Select a customer before using Charge to Account.');
      return;
    }
    if (needsCustomerForDelivery) {
      setError('A customer name is required when a delivery fee is entered.');
      return;
    }
    if (allowNegativeQty) {
      setStage('pay');
      return;
    }
    const warnings = await checkStock(lines, locationId);
    if (warnings.length > 0) { setStockWarn(warnings); setStage('stock_warning'); }
    else { setStage('pay'); }
  }

  async function handlePost() {
    handlePostRef.current = handlePost; // keep ref current for keyboard handlers
    if (!splitReady) return;
    if (needsCustomerForCharge && !customer?.customer_id) {
      setError('Select a customer before using Charge to Account.');
      setStage('method');
      return;
    }
    if (needsCustomerForDelivery) {
      setError('A customer name is required when a delivery fee is entered.');
      setStage('method');
      return;
    }
    setError('');
    setStage('posting');
    try {
      const ptsRedeemedNum = redeemPts ? Math.min(parseFloat(ptsToRedeem) || 0, customer?.loyalty_points ?? 0) : 0;
      const ptsEarned = Math.floor(adjustedTotal / 100) * LOYALTY_EARN_RATE;

      const primaryMethod = splitMode ? splits[0].method : method;
      const primaryRef    = splitMode ? splits[0].referenceNo : refNo;
      const amtTendered   = splitMode ? splitTotal
        : method === 'cash' ? tenderedNum
        : method === 'charge' && chargeTenderedNum > 0 ? chargeTenderedNum
        : adjustedTotal;

      const payload: CheckoutPayload = {
        shiftId, terminalId, locationId, cashierId,
        subtotal: totals.subtotal,
        discountAmount: totals.discountTotal + loyaltyDiscount,
        totalAmount: adjustedTotal,
        amountTendered: amtTendered,
        changeAmount: splitMode ? splitChange : changeAmt,
        paymentMethod: primaryMethod,
        referenceNo: primaryRef,
        lines,
        customerId: customer?.customer_id ?? null,
        loyaltyPointsEarned: ptsEarned,
        loyaltyPointsRedeemed: ptsRedeemedNum,
        chargeAdvanceAmount: chargeCredit > 0 ? chargeCredit : 0,
        payments: splitMode ? splits.map(s => ({
          method: s.method,
          amount: parseFloat(s.amount) || 0,
          referenceNo: s.referenceNo,
        })) : undefined,
      };

      const { saleId, receiptNo } = await postSale(payload);

      // Trigger cash drawer for any sale that includes a cash payment
      const hasCash = splitMode
        ? splits.some(s => s.method === 'cash')
        : method === 'cash';
      if (hasCash) {
        const printerName = companySettings.receipt_printer_name || 'XPrinter 58IIH';
        fetch(`${resolveApiBase()}/rpc/open_cash_drawer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ printer_name: printerName }),
        }).catch(() => {}); // fire-and-forget — don't block on drawer failure
      }

      if (customer) {
        if (ptsRedeemedNum > 0) {
          await updateLoyaltyPoints(customer.customer_id, -ptsRedeemedNum, 'redeem', saleId, cashierId);
        }
        if (ptsEarned > 0) {
          await updateLoyaltyPoints(customer.customer_id, ptsEarned, 'earn', saleId, cashierId);
        }
      }

      // Create GCash transaction in GCash module for any gcash payment
      if (gcashAccountId) {
        const gcashPayments = splitMode
          ? splits.filter(s => s.method === 'gcash').map(s => ({
              amount: parseFloat(s.amount) || 0,
              referenceNo: s.referenceNo,
            }))
          : method === 'gcash'
            ? [{ amount: adjustedTotal, referenceNo: refNo }]
            : [];

        for (const gp of gcashPayments) {
          const appliedDeliveryFee = gp === gcashPayments[0] ? deliveryFeeNum : 0;
          await processCashTransaction({
            date: getTodayDateString(),
            account_id: gcashAccountId,
            type: 'CASH_IN',
            cashin_type: 'product_payment',
            transaction_mode: 'fee_included',
            amount: gp.amount,
            fee: 0,
            total_amount: gp.amount + appliedDeliveryFee,
            delivery_fee: appliedDeliveryFee,
            source_account_type: 'pos_register',
            pos_reference_id: receiptNo,
            source_sale_id: saleId,
            reference_number: gp.referenceNo || receiptNo,
            description: displayCustomerName ? `POS Sale - ${receiptNo} | ${displayCustomerName}` : `POS Sale - ${receiptNo}`,
            notes: displayCustomerName ? `POS Sale - ${receiptNo} | ${displayCustomerName}` : `POS Sale - ${receiptNo}`,
            created_by: cashierId,
            source_module: 'pos_payment',
          });
        }
      }

      onSuccess(saleId, receiptNo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to post sale');
      setStage('pay');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full max-h-[92vh] flex flex-col ${isLargeCashEntry ? 'max-w-2xl md:max-w-[50vw]' : 'max-w-md'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="font-semibold text-slate-800">
            {stage === 'method'       && 'Select Payment Method'}
            {stage === 'pay'          && 'Enter Payment'}
            {stage === 'stock_warning'&& 'Stock Warnings'}
            {stage === 'posting'      && 'Processing...'}
          </h2>
          {stage !== 'posting' && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Method Selection ── */}
          {stage === 'method' && (
            <div className="p-5 space-y-5">
              {/* Customer */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Customer (optional)
                </label>
                {customer || displayCustomerName ? (
                  <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-slate-400" />
                      <div>
                        <p className="text-sm font-medium text-slate-800">{displayCustomerName}</p>
                        <p className="text-xs text-slate-500">
                          {customer?.price_level ?? 'Retail'}
                          {customer?.phone ? ` • ${customer.phone}` : ''}
                        </p>
                        {customer && (
                          <p className="text-[11px] font-semibold text-amber-700">
                            Credit balance: {fmt(Number(customer.credit_balance ?? 0))}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {customer && (
                        <>
                          <div className="flex items-center gap-1 text-amber-600 text-sm font-semibold">
                            <Star className="w-3.5 h-3.5" />
                            {customer.loyalty_points.toLocaleString()} pts
                          </div>
                          {!customerLocked && (
                            <button onClick={() => { handleCustomerSelect(null); setRedeemPts(false); setPtsToRedeem(''); }} className="text-slate-400 hover:text-slate-600">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <PosCustomerSearch onSelect={handleCustomerSelect} />
                )}
              </div>

              {/* Loyalty redemption */}
              {customer && customer.loyalty_points > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gift className="w-4 h-4 text-amber-500" />
                      <span className="text-sm font-medium text-amber-800">Redeem Loyalty Points</span>
                    </div>
                    <button
                      onClick={() => { setRedeemPts(v => !v); setPtsToRedeem(''); }}
                      className={`relative w-10 h-5 rounded-full transition-colors ${redeemPts ? 'bg-amber-500' : 'bg-slate-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${redeemPts ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                  {redeemPts && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number" step="1" inputMode="numeric"
                        min="1"
                        max={customer.loyalty_points}
                        value={ptsToRedeem}
                        onChange={e => setPtsToRedeem(e.target.value)}
                        placeholder={`Max ${customer.loyalty_points}`}
                        className="flex-1 px-3 py-1.5 text-sm border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      <span className="text-xs text-amber-700 font-medium">pts = {fmt(loyaltyDiscount)} off</span>
                    </div>
                  )}
                </div>
              )}

              {/* Order summary */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Subtotal</span>
                  <span className="font-mono text-slate-700">{fmt(totals.subtotal)}</span>
                </div>
                {totals.discountTotal > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-amber-600">Discount</span>
                    <span className="font-mono text-amber-600">-{fmt(totals.discountTotal)}</span>
                  </div>
                )}
                {loyaltyDiscount > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-amber-600">Loyalty Redemption</span>
                    <span className="font-mono text-amber-600">-{fmt(loyaltyDiscount)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                  <span className="font-bold text-slate-800">Total Due</span>
                  <span className="font-black text-xl text-slate-800 font-mono">{fmt(adjustedTotal)}</span>
                </div>
              </div>

              {/* Split toggle */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Split Payment <span className="text-xs text-slate-400 font-normal">[F2]</span></span>
                <button
                  onClick={() => toggleSplitMode()}
                  className={`relative w-10 h-5 rounded-full transition-colors ${splitMode ? 'bg-blue-500' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${splitMode ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {needsCustomerForCharge && !customer && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                  Select a customer first to use Charge to Account.
                </div>
              )}

              {splitMode ? (
                <div className="space-y-2">
                  {splits.map((entry, idx) => {
                    const otherSum = splits.reduce((s, e, i) => i !== idx ? s + (parseFloat(e.amount) || 0) : s, 0);
                    const needed   = Math.max(0, adjustedTotal - otherSum);
                    const rowChange = entry.method === 'cash' ? Math.max(0, (parseFloat(entry.amount) || 0) - needed) : 0;
                    return (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center gap-2">
                      <select
                        value={entry.method}
                        onChange={e => updateSplit(idx, 'method', e.target.value as SalePaymentMethod)}
                        className="text-sm border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {METHODS
                          .filter(m => m === entry.method || !splits.some((s, i) => i !== idx && s.method === m))
                          .map(m => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
                      </select>
                      <input
                        ref={el => { splitInputRefs.current[idx] = el; }}
                        type="number"
                        min="0"
                        step="0.01"
                        value={entry.amount}
                        onChange={e => updateSplit(idx, 'amount', e.target.value)}
                        onKeyDown={e => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          const usedMethods = splits.map(s => s.method);
                          const hasUnused = METHODS.some(m => !usedMethods.includes(m));
                          if (hasUnused && splitRemaining > 0.005) addSplitRow();
                        }}
                        placeholder="Amount"
                        className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                      {splits.length > 1 && (
                        <button onClick={() => removeSplitRow(idx)} className="text-slate-400 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      </div>
                      {rowChange > 0.005 && (
                        <div className="flex items-center justify-between px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 font-medium">
                          <span>Cash Change</span>
                          <span className="font-mono font-bold">{fmt(rowChange)}</span>
                        </div>
                      )}
                    </div>
                    );
                  })}
                  <button
                    onClick={addSplitRow}
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add payment row
                  </button>
                  <div className={`flex items-center justify-between text-sm px-3 py-2 rounded-lg ${
                    splitChange > 0.005 ? 'bg-emerald-50 text-emerald-700' :
                    splitRemaining < 0.005 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}>
                    <span>{splitChange > 0.005 ? 'Change (Cash)' : splitRemaining < 0.005 ? 'Fully covered' : 'Remaining'}</span>
                    <span className="font-mono font-semibold">
                      {splitChange > 0.005 ? fmt(splitChange) : splitRemaining < 0.005 ? '' : fmt(splitRemaining)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {METHODS.map((m, idx) => (
                    <button
                      key={m}
                      ref={el => { methodButtonRefs.current[idx] = el; }}
                      onClick={() => setMethod(m)}
                      onKeyDown={e => {
                        // 2 items in one row — Left/Right/Up/Down all toggle
                        const next = idx === 0 ? 1 : 0;
                        if (['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(e.key)) {
                          e.preventDefault();
                          setMethod(METHODS[next]);
                          methodButtonRefs.current[next]?.focus();
                        }
                      }}
                      className={`flex items-center gap-2.5 px-4 py-3.5 rounded-xl border-2 transition-all ${
                        method === m
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {METHOD_ICONS[m]}
                      <span className="text-sm font-semibold">{PAYMENT_METHOD_LABELS[m]}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* GCash account selector + delivery fee (shown whenever gcash is involved) */}
              {(() => {
                const hasGcash = splitMode
                  ? splits.some(s => s.method === 'gcash')
                  : method === 'gcash';
                if (!hasGcash || gcashAccounts.length === 0) return null;
                const gcashSplitAmt = splitMode
                  ? parseFloat(splits.find(s => s.method === 'gcash')?.amount ?? '0') || 0
                  : adjustedTotal;
                return (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
                    <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5" /> GCash Details
                    </p>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">GCash Account</label>
                      <select
                        value={gcashAccountId}
                        onChange={e => setGcashAccountId(e.target.value)}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {gcashAccounts.map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Delivery Fee <span className="text-slate-400 font-normal">(optional)</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-semibold">₱</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={deliveryFee}
                          onChange={e => setDeliveryFee(e.target.value)}
                          placeholder="0.00"
                          className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                        />
                      </div>
                      {deliveryFeeNum > 0 && !customer?.customer_id && (
                        <p className="mt-1 text-xs text-red-600 font-medium">
                          Customer name required for delivery fee.
                        </p>
                      )}
                      {deliveryFeeNum > 0 && customer?.customer_id && (
                        <p className="mt-1 text-xs text-blue-600">
                          GCash total collected: {fmt(gcashSplitAmt + deliveryFeeNum)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* ── Payment Entry (non-split, cash) ── */}
          {stage === 'pay' && !splitMode && (
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                {METHOD_ICONS[method]}
                <div>
                  <p className="text-xs text-slate-500">{PAYMENT_METHOD_LABELS[method]}</p>
                  <p className="font-bold text-slate-800 text-lg font-mono">{fmt(adjustedTotal)}</p>
                </div>
              </div>

              {method === 'cash' ? (
                <div className="min-h-[48vh] flex flex-col items-center justify-center gap-6 py-2">
                  <div className="text-center">
                    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Amount Due</p>
                    <p className="mt-2 text-4xl md:text-6xl font-black text-slate-800 font-mono tracking-tight">{fmt(adjustedTotal)}</p>
                  </div>

                  <div className="w-full max-w-xl">
                    <label className="block text-center text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Cash Tendered</label>
                    <div className="relative">
                      <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-2xl md:text-3xl">₱</span>
                      <input
                        ref={tenderedRef}
                        type="text"
                        inputMode="decimal"
                        value={tendered}
                        onChange={e => setTendered(e.target.value)}
                        onFocus={e => e.currentTarget.select()}
                        onKeyDown={e => e.key === 'Enter' && splitReady && handlePost()}
                        placeholder="0.00"
                        autoComplete="off"
                        className="w-full rounded-2xl border border-slate-200 px-16 py-5 md:py-6 text-4xl md:text-6xl font-mono font-bold text-center text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap justify-center">
                    {[20, 50, 100, 200, 500, 1000].map(denom => (
                      <button
                        key={denom}
                        onClick={() => setTendered(String(denom))}
                        className={`px-4 py-2 text-sm font-mono font-semibold rounded-xl border transition-colors ${
                          tenderedNum === denom
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-slate-100 hover:bg-blue-100 text-slate-700 hover:text-blue-700 border-slate-200'
                        }`}
                      >
                        ₱{denom}
                      </button>
                    ))}
                    <button
                      onClick={() => setTendered(formatTenderedValue(adjustedTotal))}
                      className={`px-4 py-2 text-sm font-mono font-semibold rounded-xl border transition-colors ${
                        Math.abs(tenderedNum - adjustedTotal) < 0.005
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-slate-100 hover:bg-emerald-100 text-slate-700 hover:text-emerald-700 border-slate-200'
                      }`}
                    >
                      Exact
                    </button>
                  </div>

                  {tenderedNum > 0 && (
                    <div className={`w-full max-w-lg flex items-center justify-between p-4 rounded-2xl ${tenderedNum >= adjustedTotal ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                      <span className={`text-base font-semibold ${tenderedNum >= adjustedTotal ? 'text-emerald-700' : 'text-red-700'}`}>Change</span>
                      <span className={`font-mono font-black text-2xl md:text-3xl ${tenderedNum >= adjustedTotal ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(changeAmt)}</span>
                    </div>
                  )}
                </div>
              ) : method === 'charge' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Amount Tendered <span className="text-slate-400 font-normal text-xs">(optional — leave blank for exact)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-sm">₱</span>
                      <input
                        ref={tenderedRef}
                        type="number"
                        min={adjustedTotal}
                        step="0.01"
                        value={chargeTendered}
                        onChange={e => setChargeTendered(e.target.value)}
                        onFocus={e => e.currentTarget.select()}
                        onKeyDown={e => e.key === 'Enter' && chargeInputValid && handlePost()}
                        placeholder={String(adjustedTotal.toFixed(2))}
                        className="w-full pl-8 pr-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                    </div>
                    {!chargeInputValid && (
                      <p className="mt-1 text-xs text-red-600">Amount must be at least {fmt(adjustedTotal)}</p>
                    )}
                    {chargeCredit > 0 && (
                      <div className="mt-2 flex items-center justify-between p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                        <span className="text-sm font-semibold text-emerald-700">Advance Credit</span>
                        <span className="font-mono font-bold text-emerald-700">{fmt(chargeCredit)}</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Charge Notes / Reference</label>
                    <input
                      type="text"
                      value={refNo}
                      onChange={e => setRefNo(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && chargeInputValid && handlePost()}
                      placeholder="Optional account note"
                      className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Reference / Transaction No.
                  </label>
                  <input
                    ref={tenderedRef}
                    type="text"
                    value={refNo}
                    onChange={e => setRefNo(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handlePost()}
                    placeholder="Optional"
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* ── Split confirm ── */}
          {stage === 'pay' && splitMode && (
            <div className="p-5 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                {splits.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{PAYMENT_METHOD_LABELS[s.method]}</span>
                    <span className="font-mono font-medium text-slate-800">{fmt(parseFloat(s.amount) || 0)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-sm font-bold">
                  <span className="text-slate-800">Total Tendered</span>
                  <span className="font-mono text-slate-800">{fmt(splitTotal)}</span>
                </div>
                {splitChange > 0.005 && (
                  <div className="flex items-center justify-between text-sm text-emerald-700 font-semibold">
                    <span>Change (Cash)</span>
                    <span className="font-mono">{fmt(splitChange)}</span>
                  </div>
                )}
              </div>
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* ── Stock Warning ── */}
          {stage === 'stock_warning' && (
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-700">Some items exceed available stock. You may still proceed or go back to adjust quantities.</p>
              </div>
              <div className="space-y-2">
                {stockWarnings.map(w => (
                  <div key={w.productId} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{w.productName}</p>
                      <p className="text-xs text-slate-500">
                        Requested: {w.requested} {w.baseUnitName ?? ''} · Available: {w.available} {w.baseUnitName ?? ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Posting ── */}
          {stage === 'posting' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-500 text-sm">Posting sale...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex-shrink-0">
          {stage === 'method' && (
            <button
              ref={continueButtonRef}
              onClick={handleCheckStock}
              className="w-full py-3.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              Continue
            </button>
          )}

          {stage === 'pay' && (
            <div className="flex gap-3">
              <button
                onClick={() => setStage('method')}
                className="px-4 py-3 rounded-xl text-sm text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 transition-colors"
              >
                Back
              </button>
              <button
                disabled={!splitReady}
                onClick={handlePost}
                className="flex-1 py-3 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-5 h-5" />
                Confirm Sale
              </button>
            </div>
          )}

          {stage === 'stock_warning' && (
            <div className="flex gap-3">
              <button onClick={() => setStage('method')} className="flex-1 py-3 rounded-xl text-sm text-slate-600 border border-slate-200 hover:border-slate-300 transition-colors">Back</button>
              <button onClick={() => setStage('pay')} className="flex-1 py-3 rounded-xl font-bold text-white bg-amber-500 hover:bg-amber-600 transition-colors">Proceed Anyway</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
