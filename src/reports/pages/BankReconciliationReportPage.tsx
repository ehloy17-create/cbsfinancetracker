import { useEffect, useState } from 'react';
import { exportToCsv } from '../lib/csvExport';
import {
  BankReconciliationReportRow,
  fetchBankReconciliationReport,
} from '../lib/reportQueries';
import ReportShell from '../components/ReportShell';
import { Column, ReportTable } from '../components/ReportTable';

function fmt(value: number) {
  return value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BankReconciliationReportPage() {
  const [data, setData] = useState<BankReconciliationReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setData(await fetchBankReconciliationReport());
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const columns: Column<BankReconciliationReportRow>[] = [
    { key: 'bank_name', label: 'Bank' },
    { key: 'statement_date', label: 'Statement Date' },
    { key: 'statement_ending_balance', label: 'Statement', align: 'right', render: row => `₱${fmt(row.statement_ending_balance)}` },
    { key: 'system_book_balance', label: 'Book', align: 'right', render: row => `₱${fmt(row.system_book_balance)}` },
    { key: 'uncleared_checks_total', label: 'Uncleared Checks', align: 'right', render: row => `₱${fmt(row.uncleared_checks_total)}` },
    { key: 'deposits_in_transit_total', label: 'In Transit', align: 'right', render: row => `₱${fmt(row.deposits_in_transit_total)}` },
    { key: 'adjusted_balance', label: 'Adjusted', align: 'right', render: row => `₱${fmt(row.adjusted_balance)}` },
    { key: 'variance', label: 'Variance', align: 'right', render: row => `₱${fmt(row.variance)}` },
    { key: 'status', label: 'Status' },
  ];

  return (
    <ReportShell
      title="Bank Reconciliation Report"
      subtitle="Statement-to-book comparison with uncleared checks and deposits in transit"
      loading={loading}
      onRefresh={load}
      onExportCsv={() => exportToCsv('bank-reconciliation-report.csv', columns.map(col => col.label), data.map(row => [
        row.bank_name,
        row.statement_date,
        row.statement_ending_balance,
        row.system_book_balance,
        row.uncleared_checks_total,
        row.deposits_in_transit_total,
        row.adjusted_balance,
        row.variance,
        row.status,
      ]))}
    >
      <ReportTable columns={columns} data={data} rowKey={(row, idx) => `${row.bank_name}-${row.statement_date}-${idx}`} />
    </ReportShell>
  );
}
