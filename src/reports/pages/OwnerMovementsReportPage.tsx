import { useEffect, useMemo, useState } from 'react';
import { exportToCsv } from '../lib/csvExport';
import ReportShell from '../components/ReportShell';
import { Column, ReportTable } from '../components/ReportTable';
import { loadFinanceMonitoringSnapshot } from '../../lib/financeMonitoring';
import { OWNER_LEDGER_TRANSACTION_LABELS } from '../../lib/ownerLedger';
import { supabase } from '../../lib/supabase';
import { formatCurrency, formatDate } from '../../lib/utils';

interface OwnerLedgerReportRow {
  date: string;
  owner_name: string;
  transaction_type: string;
  source_module: string;
  source_key: string;
  source_account: string;
  description: string;
  reference_number: string;
  increase_amount: number;
  decrease_amount: number;
  running_balance: number;
}

function getMonthRange() {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export default function OwnerMovementsReportPage() {
  const [rows, setRows] = useState<OwnerLedgerReportRow[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [sources, setSources] = useState<Array<{ key: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const monthRange = getMonthRange();
  const [dateFrom, setDateFrom] = useState(monthRange.from);
  const [dateTo, setDateTo] = useState(monthRange.to);
  const [ownerFilter, setOwnerFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  async function load() {
    setLoading(true);
    const [snapshot, { data: gcashRows }] = await Promise.all([
      loadFinanceMonitoringSnapshot(),
      supabase.from('accounts').select('id, name').eq('is_active', true).order('name'),
    ]);

    const ownerMap = new Map(snapshot.finance_owners.map(owner => [owner.id, owner.name]));
    const bankMap = new Map(snapshot.bank_accounts.map(account => [account.id, account.name]));
    const gcashMap = new Map((((gcashRows as { id: string; name: string }[]) || []).map(account => [account.id, account.name])));
    const sourceList = new Map<string, string>();

    const nextRows = snapshot.owner_ledger.map(entry => {
      const sourceLabel = entry.source_account_type === 'bank'
        ? bankMap.get(entry.source_account_id ?? '') ?? 'Bank'
        : entry.source_account_type === 'gcash'
        ? gcashMap.get(entry.source_account_id ?? '') ?? 'GCash'
        : entry.source_account_type === 'cash_fund'
        ? 'Cash Fund'
        : entry.source_account_type === 'owner_personal'
        ? 'Owner Personal Fund'
        : 'Adjustment';
      const sourceKey = `${entry.source_account_type ?? ''}:${entry.source_account_id ?? ''}`;
      sourceList.set(sourceKey, sourceLabel);
      return {
        date: entry.transaction_date,
        owner_name: ownerMap.get(entry.owner_id) ?? 'Owner',
        transaction_type: OWNER_LEDGER_TRANSACTION_LABELS[entry.transaction_type],
        source_module: entry.source_module,
        source_key: sourceKey,
        source_account: sourceLabel,
        description: entry.description,
        reference_number: entry.reference_number,
        increase_amount: Number(entry.increase_amount),
        decrease_amount: Number(entry.decrease_amount),
        running_balance: Number(entry.running_balance),
      };
    });

    setRows(nextRows);
    setOwners([...new Set(nextRows.map(row => row.owner_name))].sort((left, right) => left.localeCompare(right)));
    setModules([...new Set(nextRows.map(row => row.source_module).filter(Boolean))].sort((left, right) => left.localeCompare(right)));
    setSources([...sourceList.entries()].map(([key, label]) => ({ key, label })).sort((left, right) => left.label.localeCompare(right.label)));
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => rows.filter(row => {
    return row.date >= dateFrom
      && row.date <= dateTo
      && (!ownerFilter || row.owner_name === ownerFilter)
      && (!typeFilter || row.transaction_type === typeFilter)
      && (!moduleFilter || row.source_module === moduleFilter)
      && (!sourceFilter || row.source_key === sourceFilter);
  }), [rows, dateFrom, dateTo, ownerFilter, typeFilter, moduleFilter, sourceFilter]);

  const columns: Column<OwnerLedgerReportRow>[] = [
    { key: 'date', label: 'Date', render: row => formatDate(row.date) },
    { key: 'owner_name', label: 'Owner' },
    { key: 'transaction_type', label: 'Transaction Type' },
    { key: 'source_module', label: 'Source Module' },
    { key: 'source_account', label: 'Source Account' },
    { key: 'description', label: 'Description' },
    { key: 'reference_number', label: 'Reference' },
    { key: 'increase_amount', label: 'Increase', align: 'right', render: row => row.increase_amount > 0 ? `₱${formatCurrency(row.increase_amount)}` : '—' },
    { key: 'decrease_amount', label: 'Decrease', align: 'right', render: row => row.decrease_amount > 0 ? `₱${formatCurrency(row.decrease_amount)}` : '—' },
    { key: 'running_balance', label: 'Running Balance', align: 'right', render: row => `₱${formatCurrency(row.running_balance)}` },
  ];

  return (
    <ReportShell
      title="Owner Ledger Report"
      subtitle="Per-owner due-to-owner balance movements from funding, owner-paid business costs, settlements, and adjustments"
      loading={loading}
      onRefresh={load}
      onExportCsv={() => exportToCsv(
        'owner-ledger-report.csv',
        columns.map(col => col.label),
        filtered.map(row => [
          row.date,
          row.owner_name,
          row.transaction_type,
          row.source_module,
          row.source_account,
          row.description,
          row.reference_number,
          row.increase_amount,
          row.decrease_amount,
          row.running_balance,
        ])
      )}
      filters={(
        <>
          <input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="px-3 py-2 text-sm border border-slate-200 rounded-lg" />
          <input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} className="px-3 py-2 text-sm border border-slate-200 rounded-lg" />
          <select value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)} className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
            <option value="">All Owners</option>
            {owners.map(owner => <option key={owner} value={owner}>{owner}</option>)}
          </select>
          <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
            <option value="">All Transaction Types</option>
            {Object.values(OWNER_LEDGER_TRANSACTION_LABELS).map(label => <option key={label} value={label}>{label}</option>)}
          </select>
          <select value={moduleFilter} onChange={event => setModuleFilter(event.target.value)} className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
            <option value="">All Source Modules</option>
            {modules.map(module => <option key={module} value={module}>{module}</option>)}
          </select>
          <select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
            <option value="">All Source Accounts</option>
            {sources.map(source => <option key={source.key} value={source.key}>{source.label}</option>)}
          </select>
        </>
      )}
    >
      <ReportTable
        columns={columns}
        data={filtered}
        emptyMessage="No owner ledger entries found for the selected filters."
        rowKey={(row, idx) => `${row.date}-${row.owner_name}-${row.reference_number}-${idx}`}
      />
    </ReportShell>
  );
}
