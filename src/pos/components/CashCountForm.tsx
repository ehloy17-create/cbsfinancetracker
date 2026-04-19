import { formatCurrency } from '../lib/posUtils';

export const CASH_DENOMINATIONS = [1, 5, 10, 20, 50, 100, 200, 500, 1000] as const;

export type CashDenomination = (typeof CASH_DENOMINATIONS)[number];
export type CashCountState = Record<CashDenomination, string>;

export function createEmptyCashCountState(): CashCountState {
  return {
    1: '',
    5: '',
    10: '',
    20: '',
    50: '',
    100: '',
    200: '',
    500: '',
    1000: '',
  };
}

export function calculateCashCountTotal(counts: CashCountState): number {
  return CASH_DENOMINATIONS.reduce((sum, denomination) => {
    const pieces = Number.parseInt(counts[denomination] || '0', 10);
    return sum + denomination * (Number.isNaN(pieces) ? 0 : Math.max(0, pieces));
  }, 0);
}

export function hasCashCountEntry(counts: CashCountState): boolean {
  return CASH_DENOMINATIONS.some(denomination => (counts[denomination] || '').trim() !== '');
}

interface Props {
  counts: CashCountState;
  onChange: (counts: CashCountState) => void;
  accentRingClass: string;
  autoFocus?: boolean;
}

export default function CashCountForm({ counts, onChange, accentRingClass, autoFocus = false }: Props) {
  const total = calculateCashCountTotal(counts);
  const middleIndex = Math.ceil(CASH_DENOMINATIONS.length / 2);
  const columns = [
    CASH_DENOMINATIONS.slice(0, middleIndex),
    CASH_DENOMINATIONS.slice(middleIndex),
  ] as const;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {columns.map((denominations, columnIndex) => (
          <div key={columnIndex} className="overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[1fr,90px,110px] gap-2 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span>Denomination</span>
              <span className="text-center">Count</span>
              <span className="text-right">Amount</span>
            </div>
            {denominations.map((denomination, index) => {
              const pieces = Number.parseInt(counts[denomination] || '0', 10);
              const safePieces = Number.isNaN(pieces) ? 0 : Math.max(0, pieces);
              const lineTotal = denomination * safePieces;
              const isFirstInput = columnIndex === 0 && index === 0;

              return (
                <div
                  key={denomination}
                  className="grid grid-cols-[1fr,90px,110px] items-center gap-2 border-t border-slate-100 px-3 py-2"
                >
                  <span className="font-mono text-sm font-semibold text-slate-800">₱{denomination}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={counts[denomination]}
                    onChange={e => {
                      const nextValue = e.target.value.replace(/[^\d]/g, '');
                      onChange({ ...counts, [denomination]: nextValue });
                    }}
                    placeholder="0"
                    autoFocus={autoFocus && isFirstInput}
                    className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-right font-mono text-sm focus:outline-none focus:ring-2 ${accentRingClass}`}
                  />
                  <span className="text-right font-mono text-sm text-slate-700">₱{formatCurrency(lineTotal)}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-white">
        <span className="text-sm font-semibold">Total Actual Cash Count</span>
        <span className="font-mono text-lg font-bold">₱{formatCurrency(total)}</span>
      </div>
    </div>
  );
}
