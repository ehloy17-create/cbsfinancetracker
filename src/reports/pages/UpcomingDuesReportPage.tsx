import { useEffect, useState } from 'react';
import { exportToCsv } from '../lib/csvExport';
import {
  fetchUpcomingDuesReport,
  UpcomingDueReportRow,
} from '../lib/reportQueries';
import ReportShell from '../components/ReportShell';
import { Column, ReportTable } from '../components/ReportTable';

function fmt(value: number) {
  return value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function UpcomingDuesReportPage() {
  const [data, setData] = useState<UpcomingDueReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setData(await fetchUpcomingDuesReport());
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const columns: Column<UpcomingDueReportRow>[] = [
    { key: 'date', label: 'Date' },
    { key: 'kind', label: 'Type' },
    { key: 'label', label: 'Description' },
    { key: 'status', label: 'Status' },
    { key: 'amount', label: 'Amount', align: 'right', render: row => `₱${fmt(row.amount)}` },
  ];

  return (
    <ReportShell
      title="Upcoming Dues Report"
      subtitle="Checks, payables, and recurring obligations due in the next seven days"
      loading={loading}
      onRefresh={load}
      onExportCsv={() => exportToCsv('upcoming-dues-report.csv', columns.map(col => col.label), data.map(row => [
        row.date,
        row.kind,
        row.label,
        row.status,
        row.amount,
      ]))}
    >
      <ReportTable columns={columns} data={data} rowKey={(row, idx) => `${row.date}-${row.kind}-${idx}`} />
    </ReportShell>
  );
}
