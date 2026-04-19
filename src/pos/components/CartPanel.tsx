import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import {
  Trash2, Minus, Plus, ShoppingCart, Tag, DollarSign, Ban,
  ChevronDown, AlertCircle,
} from 'lucide-react';
import { CartLine, CartTotals } from '../hooks/useCart';
import { PosPermissionRow, PosPermission } from '../../lib/types';
import QtyKeypad from './QtyKeypad';

export interface CartPanelHandle {
  openQtyKeypad: (idx: number) => void;
  focusQtyButton: (idx: number) => void;
  openDiscount: (idx: number) => void;
  openPriceOverride: (idx: number) => void;
}

interface Props {
  lines: CartLine[];
  totals: CartTotals;
  customerName?: string;
  permissions: Map<PosPermission, PosPermissionRow>;
  unitOptionsByProduct?: Record<string, Array<{ id: string; label: string }>>;
  selectedLineIdx?: number;
  onSelectLine?: (idx: number) => void;
  onUpdateQty: (idx: number, qty: number) => void;
  onUpdateUnit?: (idx: number, selectedUnitId: string) => void;
  onRemoveLine: (idx: number) => void;
  onVoidLine: (idx: number, reason: string) => void;
  onApplyDiscount: (idx: number, pct: number, fixed: number) => void;
  onOverridePrice: (idx: number, newPrice: number) => void;
  onQtyEditorClose?: () => void;
  seniorDiscountEnabled?: boolean;
}

interface KeypadTarget {
  lineIdx: number;
  productName: string;
  currentQty: number;
  unitPrice: number;
}

interface LineAction {
  lineIdx: number;
  type: 'discount' | 'price' | 'void';
}

function fmt(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type DiscountMode = 'pct' | 'fixed' | 'qty' | 'senior';

function DiscountDialog({
  line, maxPct, seniorEnabled, onConfirm, onClose,
}: {
  line: CartLine;
  maxPct: number | null;
  seniorEnabled?: boolean;
  onConfirm: (pct: number, fixed: number) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<DiscountMode>('qty');
  const [pctVal, setPctVal] = useState('');
  const [fixedVal, setFixedVal] = useState('');

  const lineTotal = line.qty * line.unitPrice;
  const pctNum   = parseFloat(pctVal)   || 0;
  const fixedNum = parseFloat(fixedVal) || 0;
  const cappedPct = maxPct !== null ? Math.min(pctNum, maxPct) : pctNum;

  const preview =
    mode === 'pct'    ? lineTotal * cappedPct / 100 :
    mode === 'fixed'  ? Math.min(fixedNum, lineTotal) :
    mode === 'qty'    ? Math.min(fixedNum * line.qty, lineTotal) :
    /* senior */        lineTotal * 0.20;

  function handleConfirm() {
    if (mode === 'pct')    onConfirm(cappedPct, 0);
    else if (mode === 'fixed') onConfirm(0, Math.min(fixedNum, lineTotal));
    else if (mode === 'qty')   onConfirm(0, Math.min(fixedNum * line.qty, lineTotal));
    else /* senior */          onConfirm(20, 0);
    onClose();
  }

  const modes: { key: DiscountMode; label: string }[] = [
    { key: 'qty',    label: 'Per Qty (₱)' },
    { key: 'pct',    label: 'Percent (%)' },
    { key: 'fixed',  label: 'Fixed (₱)'   },
    ...(seniorEnabled ? [{ key: 'senior' as DiscountMode, label: 'Senior (20%)' }] : []),
  ];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-slate-700 flex items-center gap-2">
          <Tag className="w-4 h-4 text-amber-400" />
          <h3 className="font-semibold text-white text-sm">Apply Discount</h3>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-400 truncate">{line.productName}</p>
          <div className="flex gap-1.5 flex-wrap">
            {modes.map(m => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors min-w-[5rem] ${
                  mode === m.key
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-slate-700 text-slate-400 border-slate-600 hover:border-slate-500'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === 'pct' && (
            <div className="relative">
              <input
                type="number" step="any" min="0" max={maxPct ?? 100}
                value={pctVal} onChange={e => setPctVal(e.target.value)}
                placeholder="0" autoFocus
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm pr-8 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
            </div>
          )}
          {mode === 'fixed' && (
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
              <input
                type="number" step="any" min="0"
                value={fixedVal} onChange={e => setFixedVal(e.target.value)}
                placeholder="0.00" autoFocus
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm pl-7 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          )}
          {mode === 'qty' && (
            <div>
              <p className="text-xs text-slate-500 mb-1.5">Amount per item (×{line.qty} qty)</p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
                <input
                  type="number" step="any" min="0"
                  value={fixedVal} onChange={e => setFixedVal(e.target.value)}
                  placeholder="0.00" autoFocus
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm pl-7 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          )}
          {mode === 'senior' && (
            <div className="px-3 py-3 bg-slate-700/60 border border-slate-600 rounded-lg text-center">
              <p className="text-sm text-slate-300">20% Senior Citizen Discount</p>
              <p className="text-xs text-slate-500 mt-1">Applies 20% off the line total</p>
            </div>
          )}

          {maxPct !== null && mode === 'pct' && pctNum > maxPct && (
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              Capped at {maxPct}% (your permission limit)
            </p>
          )}
          {preview > 0 && (
            <div className="px-3 py-2.5 bg-amber-950/50 border border-amber-800/50 rounded-lg space-y-1">
              {mode === 'qty' && fixedNum > 0 && (
                <div className="flex items-center justify-between text-xs text-amber-400">
                  <span>₱{fmt(fixedNum)} × {line.qty} items</span>
                  <span>= ₱{fmt(Math.min(fixedNum * line.qty, lineTotal))}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-amber-300">Total discount</span>
                <span className="font-mono font-semibold text-amber-300">-₱{fmt(preview)}</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-slate-700">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-slate-400 hover:text-slate-200 border border-slate-600 rounded-lg transition-colors">Cancel</button>
          <button onClick={handleConfirm} disabled={preview <= 0} className="flex-1 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 transition-colors">Apply</button>
        </div>
      </div>
    </div>
  );
}

function PriceDialog({
  line, onConfirm, onClose,
}: {
  line: CartLine;
  onConfirm: (newPrice: number) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(String(line.unitPrice));
  const parsed = parseFloat(val) || 0;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-slate-700 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-blue-400" />
          <h3 className="font-semibold text-white text-sm">Override Price</h3>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-400 truncate">{line.productName}</p>
          <div className="flex items-center justify-between text-xs px-3 py-2 bg-slate-700/60 rounded-lg">
            <span className="text-slate-400">Original price</span>
            <span className="font-mono text-slate-300">₱{fmt(line.originalUnitPrice)}</span>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">₱</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={val}
              onChange={e => setVal(e.target.value)}
              autoFocus
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm pl-7 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-slate-700">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-slate-400 hover:text-slate-200 border border-slate-600 rounded-lg transition-colors">Cancel</button>
          <button onClick={() => { onConfirm(parsed); onClose(); }} disabled={parsed <= 0} className="flex-1 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">Set Price</button>
        </div>
      </div>
    </div>
  );
}

function VoidLineDialog({
  line, onConfirm, onClose,
}: {
  line: CartLine;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-slate-700 flex items-center gap-2">
          <Ban className="w-4 h-4 text-red-400" />
          <h3 className="font-semibold text-white text-sm">Void Line</h3>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-400 truncate">{line.productName}</p>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            placeholder="Reason for voiding this line..."
            autoFocus
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-500 placeholder-slate-500"
          />
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-slate-700">
          <button onClick={onClose} className="flex-1 py-2 text-sm text-slate-400 hover:text-slate-200 border border-slate-600 rounded-lg transition-colors">Cancel</button>
          <button onClick={() => { onConfirm(reason); onClose(); }} disabled={!reason.trim()} className="flex-1 py-2 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors">Void Line</button>
        </div>
      </div>
    </div>
  );
}

const CartPanel = forwardRef<CartPanelHandle, Props>(function CartPanel({
  lines, totals, customerName, permissions, unitOptionsByProduct,
  selectedLineIdx, onSelectLine,
  onUpdateQty, onUpdateUnit, onRemoveLine, onVoidLine, onApplyDiscount, onOverridePrice, onQtyEditorClose,
  seniorDiscountEnabled = false,
}, ref) {
  const listRef = useRef<HTMLDivElement>(null);
  const qtyButtonRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [keypadTarget, setKeypadTarget] = useState<KeypadTarget | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [activeDialog, setActiveDialog] = useState<LineAction | null>(null);

  const canDiscount      = permissions.has('discount');
  const canPriceOverride = permissions.has('price_override');
  const canVoidLine      = permissions.has('void_line');
  const discountRow      = permissions.get('discount');

  useEffect(() => {
    if (listRef.current && lines.length > 0) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [lines.length]);

  function openKeypad(idx: number) {
    const line = lines[idx];
    if (!line || line.voided) return;
    onSelectLine?.(idx);
    setKeypadTarget({
      lineIdx: idx,
      productName: line.productName,
      currentQty: line.qty,
      unitPrice: line.unitPrice,
    });
  }

  useImperativeHandle(ref, () => ({
    openQtyKeypad: (idx: number) => openKeypad(idx),
    focusQtyButton: (idx: number) => qtyButtonRefs.current[idx]?.focus(),
    openDiscount: (idx: number) => {
      const line = lines[idx];
      if (!line || line.voided) return;
      onSelectLine?.(idx);
      setActiveDialog({ lineIdx: idx, type: 'discount' });
    },
    openPriceOverride: (idx: number) => {
      const line = lines[idx];
      if (!line || line.voided) return;
      onSelectLine?.(idx);
      setActiveDialog({ lineIdx: idx, type: 'price' });
    },
  }));

  function handleKeypadConfirm(qty: number) {
    if (!keypadTarget) return;
    onSelectLine?.(keypadTarget.lineIdx);
    onUpdateQty(keypadTarget.lineIdx, qty);
    setKeypadTarget(null);
    onQtyEditorClose?.();
  }

  const voidedCount = lines.filter(l => l.voided).length;

  return (
    <>
      <div className="flex h-full min-h-0 flex-col bg-slate-900">
        {/* Header */}
        <div className="px-3 py-2 border-b border-slate-700 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            {customerName && (
            <span className="max-w-[220px] truncate rounded-full border border-blue-800 bg-blue-950/40 px-2 py-0.5 text-xs font-medium text-blue-300">
                {customerName}
              </span>
            )}
            <ShoppingCart className="w-4 h-4 text-slate-400" />
            <span className="text-base font-semibold text-white">Cart</span>
            {voidedCount > 0 && (
                <span className="text-xs bg-red-950 text-red-400 border border-red-800 px-1.5 py-0.5 rounded font-medium">
                {voidedCount} voided
              </span>
            )}
          </div>
          {totals.activeLineCount > 0 && (
              <span className="text-xs text-slate-400 bg-slate-700/80 px-2 py-0.5 rounded-full font-mono">
                {totals.itemCount % 1 === 0 ? totals.itemCount : totals.itemCount.toFixed(3)} item{totals.itemCount !== 1 ? 's' : ''}
              </span>
            )}
        </div>

        {/* Column headings */}
        {lines.length > 0 && (
          <div className="grid grid-cols-[1.25rem_1fr_auto_4.25rem_4.75rem] gap-2 px-2.5 py-1.5 border-b border-slate-800 flex-shrink-0">
            <span className="text-[11px] text-slate-500 text-center font-semibold uppercase">#</span>
            <span className="text-[11px] text-slate-500 font-semibold uppercase">Product</span>
            <span className="text-[11px] text-slate-500 text-center font-semibold uppercase">Qty</span>
            <span className="text-[11px] text-slate-500 text-right font-semibold uppercase">Price</span>
            <span className="text-[11px] text-slate-500 text-right font-semibold uppercase">Total</span>
          </div>
        )}

        {/* Lines */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
              <ShoppingCart className="w-10 h-10 text-slate-700 mb-3" />
              <p className="text-slate-500 text-sm font-medium">Cart is empty</p>
              <p className="text-slate-600 text-xs mt-1">Search and tap a product to add</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {lines.map((line, idx) => (
                <div
                  key={line.lineId}
                  className={`${line.voided ? 'opacity-40' : ''} ${
                    selectedLineIdx === idx && !line.voided
                      ? 'ring-1 ring-inset ring-blue-500/50 bg-blue-950/20'
                      : ''
                  }`}
                  onClick={() => !line.voided && onSelectLine?.(idx)}
                >
                    <div className="grid grid-cols-[1.5rem_1fr_auto_5rem_5.75rem] gap-2 items-center px-2.5 py-2 hover:bg-slate-800/40 transition-colors">
                     <span className="text-xs text-slate-500 text-center font-mono tabular-nums">{idx + 1}</span>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {line.voided && <Ban className="w-3 h-3 text-red-400 flex-shrink-0" />}
                          <p className={`text-[15px] font-semibold leading-snug truncate ${line.voided ? 'line-through text-slate-500' : 'text-white'}`}>
                           {line.productName}
                         </p>
                       </div>
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                           <span className="text-xs text-slate-500 font-mono">{line.sku}</span>
                           <span className="text-xs rounded bg-slate-800 px-1 py-0.5 text-slate-300">
                            {line.selectedUnitName}
                          </span>
                          {!line.voided && (
                             <span className="text-xs bg-emerald-950/60 text-emerald-400 px-1 py-0.5 rounded">
                              {line.priceSource}
                            </span>
                          )}
                          {line.discountAmount > 0 && !line.voided && (
                              <span className="text-xs bg-amber-950/60 text-amber-400 px-1 py-0.5 rounded">
                               -{line.discountPct > 0 ? `${line.discountPct}%` : `₱${fmt(line.discountAmount)}`}
                          </span>
                        )}
                        {line.priceOverridden && !line.voided && (
                            <span className="text-xs bg-blue-950/60 text-blue-400 px-1 py-0.5 rounded">override</span>
                         )}
                        </div>
                        {!line.voided && line.pricingBreakdown && (
                           <p className="mt-1 text-xs text-cyan-400">
                            {line.pricingBreakdown}
                          </p>
                        )}
                        {!line.voided && !line.priceModeLocked && selectedLineIdx === idx && (unitOptionsByProduct?.[line.productId]?.length ?? 0) > 1 && onUpdateUnit && (
                          <div className="mt-1 max-w-[11rem]">
                           <select
                             value={line.selectedUnitId ?? ''}
                             onClick={e => e.stopPropagation()}
                             onChange={e => onUpdateUnit(idx, e.target.value)}
                              className="w-full rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                           >
                             {(unitOptionsByProduct?.[line.productId] ?? []).map(option => (
                               <option key={option.id} value={option.id}>{option.label}</option>
                             ))}
                           </select>
                            <p className="mt-1 text-xs text-slate-500">
                             Deducts {line.qtyInBaseUnitPerUnit.toLocaleString('en-PH', { maximumFractionDigits: 6 })} {line.baseUnitName} per unit
                           </p>
                         </div>
                       )}

                      {/* Actions row */}
                       {!line.voided && selectedLineIdx === idx && (canDiscount || canPriceOverride || canVoidLine) && (
                         <div className="mt-1">
                           <button
                             onClick={() => setExpandedLine(expandedLine === idx ? null : idx)}
                              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                           >
                             Actions
                             <ChevronDown className={`w-3 h-3 transition-transform ${expandedLine === idx ? 'rotate-180' : ''}`} />
                           </button>
                           {expandedLine === idx && (
                             <div className="flex items-center gap-1 mt-1 flex-wrap">
                              {canDiscount && (
                                <button
                                  onClick={() => setActiveDialog({ lineIdx: idx, type: 'discount' })}
                                   className="flex items-center gap-1 text-xs px-2 py-1 bg-amber-950/60 text-amber-400 border border-amber-800/60 rounded hover:bg-amber-900/40 transition-colors"
                                >
                                  <Tag className="w-3 h-3" />
                                  Discount
                                </button>
                              )}
                              {canPriceOverride && (
                                <button
                                  onClick={() => setActiveDialog({ lineIdx: idx, type: 'price' })}
                                   className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-950/60 text-blue-400 border border-blue-800/60 rounded hover:bg-blue-900/40 transition-colors"
                                >
                                  <DollarSign className="w-3 h-3" />
                                  Price
                                </button>
                              )}
                              {canVoidLine && (
                                <button
                                  onClick={() => setActiveDialog({ lineIdx: idx, type: 'void' })}
                                   className="flex items-center gap-1 text-xs px-2 py-1 bg-red-950/60 text-red-400 border border-red-800/60 rounded hover:bg-red-900/40 transition-colors"
                                >
                                  <Ban className="w-3 h-3" />
                                  Void
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Qty controls */}
                     <div className="flex items-center gap-1">
                       {!line.voided ? (
                         <>
                           <button
                            onClick={() => {
                              onSelectLine?.(idx);
                              onUpdateQty(idx, Math.max(0, line.qty - 1));
                            }}
                             className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 active:bg-slate-500 flex items-center justify-center transition-colors text-slate-300 flex-shrink-0"
                            >
                               <Minus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              ref={el => { qtyButtonRefs.current[idx] = el; }}
                              onClick={() => openKeypad(idx)}
                               className="w-12 h-8 text-center bg-slate-700 hover:bg-blue-900/60 active:bg-blue-900 text-white text-sm font-mono font-semibold rounded-lg border border-slate-600 hover:border-blue-600 transition-colors tabular-nums"
                            >
                             {line.qty % 1 === 0 ? line.qty : line.qty.toFixed(2)}
                            </button>
                            <button
                              onClick={() => {
                                onSelectLine?.(idx);
                                onUpdateQty(idx, line.qty + 1);
                              }}
                               className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 active:bg-slate-500 flex items-center justify-center transition-colors text-slate-300 flex-shrink-0"
                            >
                               <Plus className="w-3.5 h-3.5" />
                            </button>
                        </>
                      ) : (
                         <span className="w-[8.5rem] text-center text-sm text-slate-600 font-medium">voided</span>
                       )}
                     </div>

                     <div className="text-right">
                        <span className={`text-sm font-mono tabular-nums ${line.voided ? 'line-through text-slate-600' : line.priceOverridden ? 'text-blue-400' : 'text-slate-300'}`}>
                         ₱{fmt(line.unitPrice)}
                       </span>
                     </div>

                     {/* Total + delete */}
                     <div className="flex items-center justify-end gap-1.5">
                          <span className={`text-sm font-mono font-semibold tabular-nums ${line.voided ? 'line-through text-slate-600' : 'text-white'}`}>
                           ₱{fmt(line.subtotal)}
                         </span>
                         <button
                           onClick={() => onRemoveLine(idx)}
                           className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-950/40 transition-colors flex-shrink-0"
                         >
                           <Trash2 className="w-3.5 h-3.5" />
                         </button>
                     </div>
                   </div>
                 </div>
               ))}
            </div>
          )}
        </div>

        {/* Totals */}
        <div className="mt-auto border-t border-slate-700 flex-shrink-0 bg-slate-900 shadow-[0_-8px_24px_rgba(15,23,42,0.45)]">
          <div className="px-3 pt-2 pb-1 space-y-1">
            <div className="flex items-center justify-between text-base">
              <span className="text-slate-400">Subtotal</span>
              <span className="font-mono text-slate-300 tabular-nums">₱{fmt(totals.subtotal)}</span>
            </div>
            {totals.discountTotal > 0 && (
                <div className="flex items-center justify-between text-base">
                <span className="text-amber-400">Discount</span>
                <span className="font-mono text-amber-400 tabular-nums">-₱{fmt(totals.discountTotal)}</span>
              </div>
            )}
            {voidedCount > 0 && (
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>{voidedCount} voided line{voidedCount !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
          <div className="mx-3 mb-2 mt-1 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-600/60 px-3 py-2.5 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 font-mono">{totals.itemCount % 1 === 0 ? totals.itemCount : totals.itemCount.toFixed(3)} item{totals.itemCount !== 1 ? 's' : ''}</p>
              <p className="text-xs text-slate-500 font-mono">{totals.activeLineCount} line{totals.activeLineCount !== 1 ? 's' : ''}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Due</p>
              <p className="text-[3.48rem] font-black text-emerald-400 font-mono tracking-tight tabular-nums leading-none mt-0.5 text-right">
                ₱{fmt(totals.grandTotal)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Keypad */}
      {keypadTarget && (
        <QtyKeypad
          productName={keypadTarget.productName}
          currentQty={keypadTarget.currentQty}
          unitPrice={keypadTarget.unitPrice}
          onConfirm={handleKeypadConfirm}
          onClose={() => { setKeypadTarget(null); onQtyEditorClose?.(); }}
        />
      )}

      {/* Dialogs */}
      {activeDialog?.type === 'discount' && (
        <DiscountDialog
          line={lines[activeDialog.lineIdx]}
          maxPct={discountRow?.max_discount_pct ?? null}
          seniorEnabled={seniorDiscountEnabled}
          onConfirm={(pct, fixed) => { onApplyDiscount(activeDialog.lineIdx, pct, fixed); setExpandedLine(null); }}
          onClose={() => setActiveDialog(null)}
        />
      )}
      {activeDialog?.type === 'price' && (
        <PriceDialog
          line={lines[activeDialog.lineIdx]}
          onConfirm={newPrice => { onOverridePrice(activeDialog.lineIdx, newPrice); setExpandedLine(null); }}
          onClose={() => setActiveDialog(null)}
        />
      )}
      {activeDialog?.type === 'void' && (
        <VoidLineDialog
          line={lines[activeDialog.lineIdx]}
          onConfirm={reason => { onVoidLine(activeDialog.lineIdx, reason); setExpandedLine(null); }}
          onClose={() => setActiveDialog(null)}
        />
      )}
    </>
  );
});

export default CartPanel;
