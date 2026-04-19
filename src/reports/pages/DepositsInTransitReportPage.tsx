import { useEffect, useState } from 'react';
import { exportToCsv } from '../lib/csvExport';
import {
  DepositInTransitReportRow,
  fetchDepositsInTransitReport,
} from '../lib/reportQueries';
import ReportShell from '../components/ReportShell';
import { Column, ReportTable } from '../components/ReportTable';

function fmt(value: number) {
  return value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DepositsInTransitReportPage() {
  const [data, setData] = useState<DepositInTransitReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');

  async function load() {
    setLoading(true);
    setData(await fetchDepositsInTransitReport());
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const filtered = status === 'all' ? data : data.filter(row => row.status === status);
  const columns: Column<DepositInTransitReportRow>[] = [
    { key: 'date', label: 'Date' },
    { key: 'bank_name', label: 'Bank' },
    { key: 'source_type', label: 'Source Type' },
    { key: 'source_description', label: 'Description' },
    { key: 'status', label: 'Status' },
    { key: 'notes', label: 'Notes' },
    { key: 'amount', label: 'Amount', align: 'right', render: row => `₱${fmt(row.amount)}` },
  ];

  return (
    <ReportShell
      title="Deposits In Transit Report"
      subtitle="Pending, deposited, verified, and cancelled bank deposit workflow"
      loading={loading}
      onRefresh={load}
      onExportCsv={() => exportToCsv('deposits-in-transit-report.csv', columns.map(col => col.label), filtered.map(row => [
        row.date,
        row.bank_name,
        row.source_type,
        row.source_description,
        row.status,
        row.notes,
        row.amount,
      ]))}
      filters={(
        <select value={status} onChange={event => setStatus(event.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5">
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="deposited">Deposited</option>
          <option value="verified">Verified</option>
          <option value="cancelled">Cancelled</option>
        </select>
      )}
    >
      <ReportTable columns={columns} data={filtered} rowKey={(row, idx) => `${row.date}-${idx}`} />
    </ReportShell>
  );
}
