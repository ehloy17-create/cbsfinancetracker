import { useState, useEffect } from 'react';
import { fetchPayableAgingReport, PayableAgingRow } from '../lib/reportQueries';
import { exportToCsv } from '../lib/csvExport';
import ReportShell from '../components/ReportShell';
import { ReportTable, Column } from '../components/ReportTable';

function fmt(n: number) { return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const BUCKET_COLORS: Record<string, string> = {
  'current': 'bg-emerald-100 text-emerald-700',
  '1-30':    'bg-amber-100 text-amber-700',
  '31-60':   'bg-orange-100 text-orange-700',
  '61-90':   'bg-red-100 text-red-700',
  '90+':     'bg-red-200 text-red-800',
};

export default function PayableAgingReportPage() {
  const [data, setData]       = useState<PayableAgingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket]   = useState<string>('all');

  async function load() {
    setLoading(true);
    setData(await fetchPayableAgingReport());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = bucket === 'all' ? data : data.filter(r => r.bucket === bucket);
  const totals = filtered.reduce((acc, r) => ({
    total_amount: acc.total_amount + r.total_amount,
    amount_paid:  acc.amount_paid  + r.amount_paid,
    balance_due:  acc.balance_due  + r.balance_due,
  }), { total_amount: 0, amount_paid: 0, balance_due: 0 });

  const bucketSummary = data.reduce<Record<string, { total: number; count: number }>>((acc, row) => {
    const current = acc[row.bucket] ?? { total: 0, count: 0 };
    current.total += row.balance_due;
    current.count += 1;
    acc[row.bucket] = current;
    return acc;
  }, {});

  const bucketTotals = ['current', '1-30', '31-60', '61-90', '90+'].map(b => ({
    bucket: b,
    total: bucketSummary[b]?.total ?? 0,
    count: bucketSummary[b]?.count ?? 0,
  }));

  const columns: Column<PayableAgingRow>[] = [
    { key: 'payable_number', label: 'Payable #',   render: r => <span className="font-mono text-xs text-blue-600">{r.payable_number}</span> },
    { key: 'supplier_name',  label: 'Supplier',    render: r => <span className="font-medium text-slate-800">{r.supplier_name}</span> },
    { key: 'invoice_number', label: 'Invoice #',   render: r => <span className="font-mono text-xs">{r.invoice_number || '—'}</span> },
    { key: 'invoice_date',   label: 'Invoice Date' },
    { key: 'due_date',       label: 'Due Date',    render: r => <span className={r.days_overdue > 0 ? 'text-red-600 font-medium' : ''}>{r.due_date || '—'}</span> },
    { key: 'days_overdue',   label: 'Days Overdue', align: 'right', render: r => (
      <span className={`font-mono ${r.days_overdue > 0 ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
        {r.days_overdue || '—'}
      </span>
    )},
    { key: 'total_amount',   label: 'Invoice Amt', align: 'right', render: r => <span className="font-mono">₱{fmt(r.total_amount)}</span> },
    { key: 'amount_paid',    label: 'Paid',        align: 'right', render: r => <span className="font-mono text-emerald-600">₱{fmt(r.amount_paid)}</span> },
    { key: 'balance_due',    label: 'Balance Due', align: 'right', render: r => <span className="font-mono font-bold text-red-600">₱{fmt(r.balance_due)}</span> },
    { key: 'bucket',         label: 'Aging',       render: r => (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${BUCKET_COLORS[r.bucket]}`}>{r.bucket}</span>
    )},
  ];

  function handleExport() {
    exportToCsv('payable-aging.csv',
      ['Payable #', 'Supplier', 'Invoice #', 'Invoice Date', 'Due Date', 'Days Overdue', 'Invoice Amt', 'Paid', 'Balance Due', 'Aging Bucket'],
      filtered.map(r => [r.payable_number, r.supplier_name, r.invoice_number, r.invoice_date, r.due_date, r.days_overdue, r.total_amount, r.amount_paid, r.balance_due, r.bucket])
    );
  }

  return (
    <ReportShell
      title="Payable Aging Report"
      subtitle="Outstanding accounts payable by aging bucket"
      loading={loading}
      onRefresh={load}
      onExportCsv={handleExport}
      filters={
        <select value={bucket} onChange={e => setBucket(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">All Aging</option>
          <option value="current">Current</option>
          <option value="1-30">1–30 days</option>
          <option value="31-60">31–60 days</option>
          <option value="61-90">61–90 days</option>
          <option value="90+">90+ days</option>
        </select>
      }
    >
      <div className="grid grid-cols-5 gap-3 mb-6">
        {bucketTotals.map(b => (
          <button
            key={b.bucket}
            onClick={() => setBucket(prev => prev === b.bucket ? 'all' : b.bucket)}
            className={`rounded-xl border p-4 text-left transition-all hover:shadow-md ${bucket === b.bucket ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'}`}
          >
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{b.bucket}</p>
            <p className="text-lg font-bold text-slate-800 mt-1 font-mono">₱{fmt(b.total)}</p>
            <p className="text-xs text-slate-400 mt-0.5">{b.count} invoice{b.count !== 1 ? 's' : ''}</p>
          </button>
        ))}
      </div>

      <ReportTable
        columns={columns}
        data={filtered}
        rowKey={r => r.payable_number}
        footer={
          <tr>
            <td colSpan={6} className="px-4 py-3 font-bold text-slate-800">TOTAL</td>
            <td className="px-4 py-3 text-right font-mono font-bold">₱{fmt(totals.total_amount)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">₱{fmt(totals.amount_paid)}</td>
            <td className="px-4 py-3 text-right font-mono font-bold text-red-600">₱{fmt(totals.balance_due)}</td>
            <td />
          </tr>
        }
      />
    </ReportShell>
  );
}
