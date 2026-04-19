import { BarChart2 } from 'lucide-react';
import { formatCurrency } from '../lib/utils';
import { SalesAnalyticsRow } from '../lib/salesAnalytics';

interface Props {
  rows: SalesAnalyticsRow[];
}

export default function SalesAnalyticsChart({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-slate-400">
        <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
        <p className="text-sm font-medium">No sales analytics data yet.</p>
      </div>
    );
  }

  const maxValue = Math.max(...rows.map(row => row.totalSales), 1);

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-end gap-2 min-w-[640px] h-64">
        {rows.map(row => {
          const height = maxValue > 0 ? Math.max((row.totalSales / maxValue) * 180, row.totalSales > 0 ? 8 : 2) : 2;
          return (
            <div key={row.key} className="flex-1 min-w-[72px] flex flex-col items-center justify-end gap-2 group">
              <div className="w-full flex flex-col items-center">
                <span className="text-[11px] text-slate-400 mb-2">{formatCurrency(row.totalSales)}</span>
                <div
                  className="w-full rounded-t-xl bg-gradient-to-t from-blue-600 to-sky-400 transition-all group-hover:from-blue-700 group-hover:to-sky-500"
                  style={{ height }}
                  title={`${row.rangeLabel}: ${formatCurrency(row.totalSales)}`}
                />
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold text-slate-700">{row.label}</p>
                <p className="text-[11px] text-slate-400">{row.entryCount} record{row.entryCount !== 1 ? 's' : ''}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
