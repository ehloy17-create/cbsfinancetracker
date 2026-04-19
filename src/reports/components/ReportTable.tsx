interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  render?: (row: T) => React.ReactNode;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  emptyMessage?: string;
  footer?: React.ReactNode;
  rowKey?: (row: T, idx: number) => string;
}

export function ReportTable<T>({ columns, data, emptyMessage = 'No data available', footer, rowKey }: Props<T>) {
  if (!data.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <p className="text-slate-400 text-sm">{emptyMessage}</p>
      </div>
    );
  }

  const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider ${alignClass[col.align ?? 'left']} ${col.className ?? ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((row, idx) => (
              <tr key={rowKey ? rowKey(row, idx) : idx} className="hover:bg-slate-50 transition-colors">
                {columns.map(col => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-slate-700 ${alignClass[col.align ?? 'left']} ${col.className ?? ''}`}
                  >
                    {col.render ? col.render(row) : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && (
            <tfoot className="bg-slate-50 border-t-2 border-slate-200">
              {footer}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

export type { Column };
