import { useEffect, useState } from 'react';
import { exportToCsv } from '../lib/csvExport';
import {
  fetchRecurringObligationsReport,
  RecurringObligationReportRow,
} from '../lib/reportQueries';
import ReportShell from '../components/ReportShell';
import { Column, ReportTable } from '../components/ReportTable';

function fmt(value: number) {
  return value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function RecurringObligationsReportPage() {
  const [data, setData] = useState<RecurringObligationReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setData(await fetchRecurringObligationsReport());
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const columns: Column<RecurringObligationReportRow>[] = [
    { key: 'name', label: 'Obligation' },
    { key: 'category', label: 'Category' },
    { key: 'frequency', label: 'Frequency' },
    { key: 'next_due_date', label: 'Next Due Date' },
    { key: 'default_amount', label: 'Amount', align: 'right', render: row => `₱${fmt(row.default_amount)}` },
    { key: 'is_active', label: 'Status', render: row => row.is_active ? 'Active' : 'Inactive' },
    { key: 'remarks', label: 'Remarks' },
  ];

  return (
    <ReportShell
      title="Recurring Obligations Report"
      subtitle="Startup fixed dues and their next due dates"
      loading={loading}
      onRefresh={load}
      onExportCsv={() => exportToCsv('recurring-obligations-report.csv', columns.map(col => col.label), data.map(row => [
        row.name,
        row.category,
        row.frequency,
        row.next_due_date,
        row.default_amount,
        row.is_active ? 'Active' : 'Inactive',
        row.remarks,
      ]))}
    >
      <ReportTable columns={columns} data={data} rowKey={row => `${row.name}-${row.next_due_date}`} />
    </ReportShell>
  );
}
