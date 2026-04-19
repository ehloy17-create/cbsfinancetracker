import { useEffect, useState } from 'react';
import { exportToCsv } from '../lib/csvExport';
import {
  fetchProjectedBalanceReport,
  ProjectedBalanceReportRow,
} from '../lib/reportQueries';
import ReportShell from '../components/ReportShell';
import { Column, ReportTable } from '../components/ReportTable';

function fmt(value: number) {
  return value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ProjectedBalanceReportPage() {
  const [data, setData] = useState<ProjectedBalanceReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setData(await fetchProjectedBalanceReport());
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const columns: Column<ProjectedBalanceReportRow>[] = [
    { key: 'bank_name', label: 'Bank' },
    { key: 'current_balance', label: 'Current', align: 'right', render: row => `₱${fmt(row.current_balance)}` },
    { key: 'due_today', label: 'Due Today', align: 'right', render: row => `₱${fmt(row.due_today)}` },
    { key: 'due_tomorrow', label: 'Due Tomorrow', align: 'right', render: row => `₱${fmt(row.due_tomorrow)}` },
    { key: 'overdue_amount', label: 'Overdue', align: 'right', render: row => `₱${fmt(row.overdue_amount)}` },
    { key: 'deposits_in_transit', label: 'In Transit', align: 'right', render: row => `₱${fmt(row.deposits_in_transit)}` },
    { key: 'projected_available_balance', label: 'Projected', align: 'right', render: row => `₱${fmt(row.projected_available_balance)}` },
    { key: 'projected_after_tomorrow', label: 'After Tomorrow', align: 'right', render: row => `₱${fmt(row.projected_after_tomorrow)}` },
    { key: 'reconciliation_status', label: 'Reconciliation' },
  ];

  return (
    <ReportShell
      title="Projected Balance Report"
      subtitle="Per-bank actual and projected available balances"
      loading={loading}
      onRefresh={load}
      onExportCsv={() => exportToCsv('projected-balance-report.csv', columns.map(col => col.label), data.map(row => [
        row.bank_name,
        row.current_balance,
        row.due_today,
        row.due_tomorrow,
        row.overdue_amount,
        row.deposits_in_transit,
        row.projected_available_balance,
        row.projected_after_tomorrow,
        row.reconciliation_status,
      ]))}
    >
      <ReportTable columns={columns} data={data} rowKey={row => row.bank_name} />
    </ReportShell>
  );
}
