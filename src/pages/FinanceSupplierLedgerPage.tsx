import { useState, useEffect, useCallback } from 'react';
import { BookOpen, ChevronDown, TrendingDown, TrendingUp, Wallet, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Supplier, CheckIssued, Disbursement } from '../lib/types';
import { formatCurrency, formatDate } from '../lib/utils';
import { useToast } from '../contexts/ToastContext';
import { getCheckLifecycleStatus } from '../lib/financeMonitoring';

type LedgerEntry = {
  id: string;
  date: string;
  type: 'check' | 'disbursement';
  reference: string;
  description: string;
  amount: number;
  status?: string;
};

const STATUS_COLORS: Record<string, string> = {
  pdc: 'bg-blue-100 text-blue-700',
  outstanding: 'bg-amber-100 text-amber-700',
  cleared: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function FinanceSupplierLedgerPage() {
  const { showToast } = useToast();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [checks, setChecks] = useState<CheckIssued[]>([]);
  const [disbursements, setDisbursements] = useState<Disbursement[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);

  // Load active suppliers
  useEffect(() => {
    supabase
      .from('suppliers')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (error) { showToast('Failed to load suppliers', 'error'); return; }
        setSuppliers((data ?? []) as Supplier[]);
        setLoadingSuppliers(false);
      });
  }, [showToast]);

  const loadLedger = useCallback(async (sid: string) => {
    if (!sid) return;
    setLoading(true);
    try {
      const [checksRes, disbRes] = await Promise.all([
        supabase
          .from('checks_issued')
          .select('*')
          .eq('supplier_id', sid)
          .eq('is_deleted', false)
          .order('check_date', { ascending: true }),
        supabase
          .from('disbursements')
          .select('*')
          .eq('supplier_id', sid)
          .eq('is_deleted', false)
          .order('date', { ascending: true }),
      ]);
      if (checksRes.error) throw new Error(checksRes.error.message);
      if (disbRes.error) throw new Error(disbRes.error.message);
      setChecks(
        (((checksRes.data ?? []) as CheckIssued[]).map(check => ({
          ...check,
          status: getCheckLifecycleStatus(check.check_date, check.manually_set_status, check.status, check.cleared_date),
        })))
      );
      setDisbursements((disbRes.data ?? []) as Disbursement[]);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load ledger', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  function handleSupplierChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    setSupplierId(val);
    setChecks([]);
    setDisbursements([]);
    if (val) loadLedger(val);
  }

  // Build combined chronological ledger
  const entries: LedgerEntry[] = [
    ...checks.map(c => ({
      id: c.id,
      date: c.check_date,
      type: 'check' as const,
      reference: `Check #${c.check_number}`,
      description: c.notes || `Issued ${formatDate(c.issued_date)}`,
      amount: c.amount,
      status: c.status,
    })),
    ...disbursements.map(d => ({
      id: d.id,
      date: d.date,
      type: 'disbursement' as const,
      reference: d.check_number ? `Chk #${d.check_number}` : d.payment_method?.toUpperCase() ?? '—',
      description: d.purpose || d.payee,
      amount: d.amount,
    })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Summary
  const totalChecks = checks
    .filter(c => c.status !== 'cancelled')
    .reduce((s, c) => s + Number(c.amount), 0);
  const totalDisbursed = disbursements.reduce((s, d) => s + Number(d.amount), 0);
  const netBalance = totalChecks - totalDisbursed;

  const selectedSupplier = suppliers.find(s => s.id === supplierId);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-blue-600" />
          Supplier Ledger
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          View checks issued and disbursements per supplier. Balance = checks issued − disbursements made.
        </p>
      </div>

      {/* Supplier selector */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Select Supplier</label>
        <div className="relative max-w-sm">
          <select
            value={supplierId}
            onChange={handleSupplierChange}
            disabled={loadingSuppliers}
            className="w-full appearance-none border border-gray-300 rounded-lg px-3 py-2 pr-9 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Choose a supplier —</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
        {selectedSupplier && (
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
            {selectedSupplier.contact_person && <span>Contact: <span className="text-gray-700">{selectedSupplier.contact_person}</span></span>}
            {selectedSupplier.phone && <span>Phone: <span className="text-gray-700">{selectedSupplier.phone}</span></span>}
          </div>
        )}
      </div>

      {supplierId && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <TrendingUp className="w-4 h-4 text-blue-500" />
                Total Checks Issued
              </div>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalChecks)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{checks.filter(c => c.status !== 'cancelled').length} active checks</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <TrendingDown className="w-4 h-4 text-emerald-500" />
                Total Disbursed
              </div>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalDisbursed)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{disbursements.length} disbursements</p>
            </div>

            <div className={`border rounded-lg p-4 ${netBalance > 0 ? 'bg-red-50 border-red-200' : netBalance < 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
              <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                <Wallet className="w-4 h-4" />
                Net Balance
              </div>
              <p className={`text-2xl font-bold ${netBalance > 0 ? 'text-red-700' : netBalance < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                {formatCurrency(Math.abs(netBalance))}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {netBalance > 0 ? 'Undisbursed checks' : netBalance < 0 ? 'Over-disbursed' : 'Fully settled'}
              </p>
            </div>
          </div>

          {/* Ledger Table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">Transaction History</h3>
              <button
                onClick={() => loadLedger(supplierId)}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Loading ledger…
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <BookOpen className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">No transactions found for this supplier</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {entries.map(entry => (
                      <tr key={`${entry.type}-${entry.id}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(entry.date)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                            entry.type === 'check'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-teal-100 text-teal-700'
                          }`}>
                            {entry.type === 'check' ? 'Check' : 'Disbursement'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 font-mono text-xs">{entry.reference}</td>
                        <td className="px-4 py-3 text-gray-600 max-w-[240px] truncate" title={entry.description}>
                          {entry.description || '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">
                          {formatCurrency(entry.amount)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {entry.status ? (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[entry.status] ?? 'bg-gray-100 text-gray-600'}`}>
                              {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-gray-700">
                        Checks Issued Total
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{formatCurrency(totalChecks)}</td>
                      <td />
                    </tr>
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-sm font-semibold text-gray-700">
                        Disbursements Total
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-700">{formatCurrency(totalDisbursed)}</td>
                      <td />
                    </tr>
                    <tr className="border-t border-gray-300">
                      <td colSpan={4} className="px-4 py-3 text-sm font-bold text-gray-900">
                        Net Balance
                      </td>
                      <td className={`px-4 py-3 text-right font-bold text-lg ${netBalance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                        {formatCurrency(Math.abs(netBalance))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
