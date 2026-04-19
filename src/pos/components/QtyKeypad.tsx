import { useState, useEffect, useRef } from 'react';
import { Delete, X, Check } from 'lucide-react';

interface Props {
  productName: string;
  currentQty: number;
  unitPrice: number;
  onConfirm: (qty: number) => void;
  onClose: () => void;
}

function fmt(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function QtyKeypad({ productName, currentQty, unitPrice, onConfirm, onClose }: Props) {
  const [display, setDisplay] = useState(String(currentQty));
  const inputRef = useRef<HTMLInputElement>(null);

  const parsedQty = parseFloat(display) || 0;
  const subtotal = parsedQty * unitPrice;
  const isValid = parsedQty > 0;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Enter' && isValid) {
        e.preventDefault();
        onConfirm(parsedQty);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isValid, parsedQty, onClose, onConfirm]);

  function handleDigit(d: string) {
    setDisplay(prev => {
      if (prev === '0') return d;
      if (prev.includes('.')) {
        const [, dec] = prev.split('.');
        if (dec && dec.length >= 3) return prev;
      }
      return prev + d;
    });
  }

  function handleDot() {
    setDisplay(prev => {
      if (prev.includes('.')) return prev;
      return prev + '.';
    });
  }

  function handleBackspace() {
    setDisplay(prev => prev.length > 1 ? prev.slice(0, -1) : '0');
  }

  function handleClear() {
    setDisplay('0');
    window.setTimeout(() => inputRef.current?.select(), 0);
  }

  const DIGITS = ['7', '8', '9', '4', '5', '6', '1', '2', '3'];

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-slate-700 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-0.5">Set Quantity</p>
            <p className="text-white font-semibold text-sm leading-snug truncate">{productName}</p>
            <p className="text-slate-500 text-xs font-mono mt-0.5">₱{fmt(unitPrice)} each</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors ml-3 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Display */}
        <div className="mx-4 mb-4 bg-slate-900 rounded-xl px-5 py-4 border border-slate-700">
          <div className="flex items-baseline justify-between">
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={display}
              onChange={e => {
                const next = e.target.value.replace(/[^0-9.]/g, '');
                const dotCount = next.split('.').length - 1;
                if (dotCount > 1) return;
                const [, decimals] = next.split('.');
                if (decimals && decimals.length > 3) return;
                setDisplay(next || '0');
              }}
              onFocus={e => e.currentTarget.select()}
              className="w-full bg-transparent text-4xl font-black text-white font-mono tracking-tight outline-none"
            />
            <span className="text-slate-500 text-sm">qty</span>
          </div>
          {parsedQty > 0 && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800">
              <span className="text-xs text-slate-500">Subtotal</span>
              <span className="text-emerald-400 font-bold font-mono text-sm">₱{fmt(subtotal)}</span>
            </div>
          )}
        </div>

        {/* Keypad */}
        <div className="px-4 pb-4 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {DIGITS.map(d => (
              <button
                key={d}
                onClick={() => { handleDigit(d); inputRef.current?.focus(); }}
                className="h-14 rounded-xl bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-white text-xl font-bold transition-colors"
              >
                {d}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={handleDot}
              disabled={display.includes('.')}
              className="h-14 rounded-xl bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-white text-xl font-bold transition-colors disabled:opacity-30"
            >
              .
            </button>
            <button
              onClick={() => { handleDigit('0'); inputRef.current?.focus(); }}
              className="h-14 rounded-xl bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-white text-xl font-bold transition-colors"
            >
              0
            </button>
            <button
              onClick={() => { handleBackspace(); inputRef.current?.focus(); }}
              className="h-14 rounded-xl bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-slate-300 transition-colors flex items-center justify-center"
            >
              <Delete className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={handleClear}
              className="h-14 rounded-xl bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-slate-300 text-sm font-semibold transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => isValid && onConfirm(parsedQty)}
              disabled={!isValid}
              className="h-14 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Check className="w-5 h-5" />
              Set Qty
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
