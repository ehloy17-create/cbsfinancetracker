import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '../../lib/utils';
import { useToast } from '../../contexts/ToastContext';
import ReportShell from '../components/ReportShell';
import { Column, ReportTable } from '../components/ReportTable';
import { exportToCsv } from '../lib/csvExport';
import { getDefaultDateRange, getTodayDate } from '../lib/dateRanges';
import {
  fetchProfitAndLossReport,
  ProfitAndLossExpenseRow,
  ProfitAndLossExpenseSourceRow,
  ProfitAndLossReport,
  ProfitAndLossSalesSourceRow,
} from '../lib/reportQueries';

const EMPTY_REPORT: ProfitAndLossReport = {
  sales: 0,
  cost_of_sales: 0,
  gross_profit: 0,
  overhead_expenses: 0,
  net_profit: 0,
  covered_days: 0,
  expense_count: 0,
  sales_sources: [],
  expense_rows: [],
  expense_sources: [],
};

function getMonthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

export default function ProfitAndLossReportPage() {
  const { showToast } = useToast();
  const today = getTodayDate();
  const [dateFrom, setDateFrom] = useState(getMonthStart(today));
  const [dateTo, setDateTo] = useState(today);
  const [report, setReport] = useState<ProfitAndLossReport>(EMPTY_REPORT);
  const [loading, setLoading] = useState(true);

  const loadRange = useCallback(async (from: string, to: string) => {
    setLoading(true);
    try {
      setReport(await fetchProfitAndLossReport(from, to));
    } catch (error) {
      setReport(EMPTY_REPORT);
      showToast(error instanceof Error ? error.message : 'Failed to load profit and loss report', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadRange(getMonthStart(today), today);
  }, [loadRange, today]);

  const statementRows = useMemo(() => ([
    { label: 'Sales', amount: report.sales, tone: 'text-slate-800' },
    { label: 'Less: Cost of Sales', amount: report.cost_of_sales, tone: 'text-red-600' },
    { label: 'Gross Profit', amount: report.gross_profit, tone: report.gross_profit >= 0 ? 'text-emerald-700' : 'text-red-600' },
    { label: 'Less: Overhead Expenses', amount: report.overhead_expenses, tone: 'text-red-600' },
    { label: 'Net Profit / Loss', amount: report.net_profit, tone: report.net_profit >= 0 ? 'text-emerald-700' : 'text-red-600' },
  ]), [report]);

  const salesSourceColumns: Column<ProfitAndLossSalesSourceRow>[] = [
    { key: 'source_label', label: 'Sales Source', render: row => <span className="font-medium text-slate-800">{row.source_label}</span> },
    { key: 'days_count', label: 'Days', align: 'right', render: row => <span className="font-mono">{row.days_count.toLocaleString('en-PH')}</span> },
    { key: 'sales', label: 'Sales', align: 'right', render: row => <span className="font-mono">{formatCurrency(row.sales)}</span> },
    { key: 'cost_of_sales', label: 'Cost of Sales', align: 'right', render: row => <span className="font-mono">{formatCurrency(row.cost_of_sales)}</span> },
    { key: 'gross_profit', label: 'Gross Profit', align: 'right', render: row => <span className="font-mono">{formatCurrency(row.gross_profit)}</span> },
  ];

  const expenseSourceColumns: Column<ProfitAndLossExpenseSourceRow>[] = [
    { key: 'source_label', label: 'Expense Source', render: row => <span className="font-medium text-slate-800">{row.source_label}</span> },
    { key: 'entry_count', label: 'Entries', align: 'right', render: row => <span className="font-mono">{row.entry_count.toLocaleString('en-PH')}</span> },
    { key: 'amount', label: 'Amount', align: 'right', render: row => <span className="font-mono">{formatCurrency(row.amount)}</span> },
  ];

  const expenseColumns: Column<ProfitAndLossExpenseRow>[] = [
    { key: 'date', label: 'Date', className: 'whitespace-nowrap', render: row => <span className="font-medium text-slate-800">{row.date}</span> },
    { key: 'payee', label: 'Payee', render: row => <span className="font-medium text-slate-800">{row.payee}</span> },
    { key: 'purpose', label: 'Purpose', render: row => row.purpose || '--' },
    { key: 'payment_method', label: 'Payment Method', className: 'whitespace-nowrap', render: row => row.payment_method },
    { key: 'affects_cashflow', label: 'Cashflow', className: 'whitespace-nowrap', render: row => row.affects_cashflow ? 'Live' : 'Report Only' },
    { key: 'source_label', label: 'Source', className: 'whitespace-nowrap', render: row => row.source_label },
    { key: 'amount', label: 'Amount', align: 'right', render: row => <span className="font-mono">{formatCurrency(row.amount)}</span> },
  ];

  function handleApply() {
    void loadRange(dateFrom, dateTo);
  }

  function handleSetRange(from: string, to: string) {
    setDateFrom(from);
    setDateTo(to);
    void loadRange(from, to);
  }

  function handleReset() {
    const nextToday = getTodayDate();
    const nextFrom = getMonthStart(nextToday);
    handleSetRange(nextFrom, nextToday);
  }

  function handleExport() {
    exportToCsv(
      'profit-and-loss-report.csv',
      ['Section', 'Label', 'Date', 'Payee', 'Purpose', 'Payment Method', 'Cashflow', 'Source', 'Amount', 'Cost of Sales', 'Gross Profit'],
      [
        ['Statement', 'Sales', '', '', '', '', '', report.sales],
        ['Statement', 'Cost of Sales', '', '', '', '', '', report.cost_of_sales],
        ['Statement', 'Gross Profit', '', '', '', '', '', report.gross_profit],
        ['Statement', 'Overhead Expenses', '', '', '', '', '', report.overhead_expenses],
        ['Statement', 'Net Profit / Loss', '', '', '', '', '', report.net_profit],
        ...report.sales_sources.map(row => ([
          'Sales Source',
          row.source_label,
          '',
          '',
          '',
          '',
          '',
          '',
          row.sales,
          row.cost_of_sales,
          row.gross_profit,
        ])),
        ...report.expense_sources.map(row => ([
          'Expense Source',
          row.source_label,
          '',
          '',
          '',
          '',
          '',
          '',
          row.amount,
          '',
          '',
        ])),
        ...report.expense_rows.map(row => ([
          'Overhead Detail',
          '',
          row.date,
          row.payee,
          row.purpose,
          row.payment_method,
          row.affects_cashflow ? 'Live' : 'Report Only',
          row.source_label,
          row.amount,
          '',
          '',
        ])),
      ],
    );
  }

  return (
    <ReportShell
      title="Profit and Loss"
      subtitle={`${dateFrom} to ${dateTo}`}
      loading={loading}
      onRefresh={() => void loadRange(dateFrom, dateTo)}
      onExportCsv={handleExport}
      printTitle={`Profit and Loss Statement (${dateFrom} to ${dateTo})`}
      filters={
        <>
          <label className="text-xs font-medium text-slate-600">From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <label className="text-xs font-medium text-slate-600">To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={handleApply} className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Apply</button>
          <button onClick={handleReset} className="px-4 py-1.5 text-sm font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">Reset</button>
          <button
            onClick={() => {
              const todayRange = getTodayDate();
              handleSetRange(todayRange, todayRange);
            }}
            className="px-3 py-1.5 text-sm font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => {
              const range = getDefaultDateRange(6);
              handleSetRange(range.from, range.to);
            }}
            className="px-3 py-1.5 text-sm font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Last 7 Days
          </button>
          <button
            onClick={() => {
              const nextToday = getTodayDate();
              handleSetRange(getMonthStart(nextToday), nextToday);
            }}
            className="px-3 py-1.5 text-sm font-medium border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
          >
            This Month
          </button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-5 mb-4">
        <SummaryCard label="Sales" value={formatCurrency(report.sales)} />
        <SummaryCard label="Cost of Sales" value={formatCurrency(report.cost_of_sales)} />
        <SummaryCard label="Gross Profit" value={formatCurrency(report.gross_profit)} tone={report.gross_profit >= 0 ? 'text-emerald-700' : 'text-red-600'} />
        <SummaryCard label="Overhead Expenses" value={formatCurrency(report.overhead_expenses)} />
        <SummaryCard label="Net Profit / Loss" value={formatCurrency(report.net_profit)} tone={report.net_profit >= 0 ? 'text-emerald-700' : 'text-red-600'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr] mb-4">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-800">Profit and Loss Statement</h2>
              <p className="text-sm text-slate-500">Uses imported daily sales when available for a date, then falls back to POS-only dates. Overhead includes valid report-only historical disbursements.</p>
            </div>
          </div>
          <div className="space-y-3">
            {statementRows.map((row, index) => (
              <div
                key={row.label}
                className={`flex items-center justify-between gap-4 rounded-lg px-4 py-3 ${index === statementRows.length - 1 ? 'bg-slate-900 text-white' : index === 2 ? 'bg-emerald-50' : 'bg-slate-50'}`}
              >
                <span className={`font-medium ${index === statementRows.length - 1 ? 'text-white' : 'text-slate-700'}`}>{row.label}</span>
                <span className={`font-mono text-base font-semibold ${index === statementRows.length - 1 ? 'text-white' : row.tone}`}>{formatCurrency(row.amount)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-800">Range Highlights</h2>
          <div className="mt-4 space-y-3">
            <MetricRow label="Sales Days Covered" value={report.covered_days.toLocaleString('en-PH')} />
            <MetricRow label="Overhead Entries" value={report.expense_count.toLocaleString('en-PH')} />
            <MetricRow label="Largest Sales Source" value={report.sales_sources[0]?.source_label ?? '--'} />
            <MetricRow label="Largest Expense Source" value={report.expense_sources[0]?.source_label ?? '--'} />
            <MetricRow label="Largest Source Amount" value={formatCurrency(report.expense_sources[0]?.amount ?? 0)} />
            <MetricRow label="Expense Coverage" value={report.gross_profit === 0 ? '--' : `${((report.overhead_expenses / report.gross_profit) * 100).toLocaleString('en-PH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`} />
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div>
          <div className="mb-3">
            <h2 className="text-base font-semibold text-slate-800">Revenue Source Breakdown</h2>
            <p className="text-sm text-slate-500">Imported daily summaries override raw POS rows on overlapping dates so totals stay aligned per day.</p>
          </div>
          <ReportTable
            columns={salesSourceColumns}
            data={report.sales_sources}
            rowKey={row => row.source_label}
            emptyMessage="No sales found for the selected range."
            footer={
              <tr>
                <td className="px-4 py-3 font-bold text-slate-800">TOTAL</td>
                <td className="px-4 py-3 text-right font-mono font-bold">{report.covered_days.toLocaleString('en-PH')}</td>
                <td className="px-4 py-3 text-right font-mono font-bold">{formatCurrency(report.sales)}</td>
                <td className="px-4 py-3 text-right font-mono font-bold">{formatCurrency(report.cost_of_sales)}</td>
                <td className="px-4 py-3 text-right font-mono font-bold">{formatCurrency(report.gross_profit)}</td>
              </tr>
            }
          />
        </div>

        <div>
          <div className="mb-3">
            <h2 className="text-base font-semibold text-slate-800">Overhead Breakdown by Source</h2>
            <p className="text-sm text-slate-500">Expense categories are not stored on disbursements, so this groups by the recorded expense source.</p>
          </div>
          <ReportTable
            columns={expenseSourceColumns}
            data={report.expense_sources}
            rowKey={row => row.source_label}
            emptyMessage="No overhead expenses found for the selected range."
            footer={
              <tr>
                <td className="px-4 py-3 font-bold text-slate-800">TOTAL</td>
                <td className="px-4 py-3 text-right font-mono font-bold">{report.expense_count.toLocaleString('en-PH')}</td>
                <td className="px-4 py-3 text-right font-mono font-bold">{formatCurrency(report.overhead_expenses)}</td>
              </tr>
            }
          />
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-3">
            <h2 className="text-base font-semibold text-slate-800">Overhead Expense Details</h2>
            <p className="text-sm text-slate-500">Shows the real disbursement rows included in the selected P&amp;L period. Report-only historical entries are marked separately from live cashflow entries.</p>
          </div>
          <ReportTable
            columns={expenseColumns}
            data={report.expense_rows}
            rowKey={row => row.id}
            emptyMessage="No overhead expenses found for the selected range."
            footer={
              <tr>
                <td className="px-4 py-3 font-bold text-slate-800">TOTAL</td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 text-right font-mono font-bold">{formatCurrency(report.overhead_expenses)}</td>
              </tr>
            }
          />
        </div>
    </ReportShell>
  );
}

function SummaryCard({ label, value, tone = 'text-slate-800' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-lg font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-3">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value}</span>
    </div>
  );
}
