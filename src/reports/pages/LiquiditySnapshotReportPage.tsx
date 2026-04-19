import { useEffect, useState } from 'react';
import { exportToCsv } from '../lib/csvExport';
import {
  fetchLiquiditySnapshotReport,
  LiquiditySnapshotReportRow,
} from '../lib/reportQueries';
import ReportShell from '../components/ReportShell';
import { Column, ReportTable } from '../components/ReportTable';

function fmt(value: number) {
  return value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LiquiditySnapshotReportPage() {
  const [data, setData] = useState<LiquiditySnapshotReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setData(await fetchLiquiditySnapshotReport());
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const columns: Column<LiquiditySnapshotReportRow>[] = [
    { key: 'metric', label: 'Metric' },
    { key: 'amount', label: 'Amount', align: 'right', render: row => `₱${fmt(row.amount)}` },
  ];

  return (
    <ReportShell
      title="Liquidity Snapshot Report"
      subtitle="Daily liquidity summary for bank, GCash, cash fund, due checks, payables, and projected availability"
      loading={loading}
      onRefresh={load}
      onExportCsv={() => exportToCsv('liquidity-snapshot-report.csv', columns.map(col => col.label), data.map(row => [row.metric, row.amount]))}
    >
      <ReportTable columns={columns} data={data} rowKey={row => row.metric} />
    </ReportShell>
  );
}
