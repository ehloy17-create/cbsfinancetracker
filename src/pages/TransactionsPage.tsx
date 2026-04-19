import { useState, useEffect, useCallback } from 'react';
import { Search, Filter, CreditCard as Edit2, Trash2, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Download, X, Building2, ArrowDownCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { calculateGcashNetChange } from '../lib/cashTransactions';
import { Transaction, Account } from '../lib/types';
import { formatCurrency, formatDate, formatDateTime, getTodayDateString, objectsToCSV, downloadCSV } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import ConfirmDialog from '../components/ConfirmDialog';

type SortKey = 'date' | 'amount' | 'created_at';
type SortDir = 'asc' | 'desc';

function isPosProtectedTransaction(txn: Pick<Transaction, 'transaction_type' | 'cash_in_mode' | 'cash_out_type' | 'reversal_of_transaction_id'>) {
  return (
    (txn.transaction_type === 'cash_in' && txn.cash_in_mode === 'payment')
    || txn.cash_out_type === 'void_reversal'
    || Boolean(txn.reversal_of_transaction_id)
  );
}

export default function TransactionsPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState(getTodayDateString());
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Transaction | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editFee, setEditFee] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('transactions')
      .select('*, accounts(id,name), profiles(name), bank_accounts(id,name,bank_name)')
      .eq('is_deleted', false)
      .eq('is_closed', false)
      .order(sortKey, { ascending: sortDir === 'asc' })
      .order('created_at', { ascending: sortDir === 'asc' });

    if (filterType) q = q.eq('transaction_type', filterType);
    if (filterAccount) q = q.eq('account_id', filterAccount);
    if (filterFrom) q = q.gte('date', filterFrom);
    if (filterTo) q = q.lte('date', filterTo);

    const { data } = await q.limit(500);
    setTxns((data as unknown as Transaction[]) || []);
    setLoading(false);
  }, [sortKey, sortDir, filterType, filterAccount, filterFrom, filterTo]);

  useEffect(() => {
    supabase.from('accounts').select('*').eq('is_active', true).order('name').then(({ data }) => {
      if (data) setAccounts(data);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = txns
    .filter(t => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        t.notes?.toLowerCase().includes(q) ||
        (t.accounts as unknown as Account)?.name?.toLowerCase().includes(q) ||
        t.amount.toString().includes(q)
      );
    })
    .sort((left, right) => {
      const direction = sortDir === 'asc' ? 1 : -1;

      if (sortKey === 'amount') {
        return (Number(left.amount) - Number(right.amount)) * direction;
      }

      const leftPrimary = String((sortKey === 'created_at' ? left.created_at : left.date) ?? '');
      const rightPrimary = String((sortKey === 'created_at' ? right.created_at : right.date) ?? '');
      const primaryCompare = leftPrimary.localeCompare(rightPrimary);
      if (primaryCompare !== 0) {
        return primaryCompare * direction;
      }

      return String(left.created_at ?? '').localeCompare(String(right.created_at ?? '')) * direction;
    });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  async function handleDelete(id: string) {
    const target = txns.find(txn => txn.id === id) ?? null;
    if (target && isPosProtectedTransaction(target)) {
      showToast('This POS-linked transaction can only be reversed by voiding the sale in POS', 'warning');
      setDeleteTarget(null);
      return;
    }
    const { error } = await supabase
      .from('transactions')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      showToast('Failed to delete transaction', 'error');
    } else {
      await writeAuditLog(user?.id ?? null, 'DELETE', 'Transactions', id, {});
      showToast('Transaction deleted', 'success');
      setDeleteTarget(null);
      load();
    }
  }

  async function handleEdit() {
    if (!editTarget) return;
    const { error } = await supabase
      .from('transactions')
      .update({
        notes: editNotes,
        transaction_fee: parseFloat(editFee) || 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editTarget.id);
    if (error) {
      showToast('Failed to update transaction', 'error');
    } else {
      await writeAuditLog(user?.id ?? null, 'UPDATE', 'Transactions', editTarget.id, {
        notes: editNotes,
        transaction_fee: editFee,
      });
      showToast('Transaction updated', 'success');
      setEditTarget(null);
      load();
    }
  }

  function exportCSV() {
    const rows = filtered.map(t => ({
      Date: t.date,
      Account: (t.accounts as unknown as Account)?.name,
      Type: t.transaction_type,
      Mode: t.cash_in_mode || '',
      Amount: t.amount,
      'Transaction Fee': t.transaction_fee,
      'Delivery Fee': t.delivery_fee || 0,
      Notes: t.notes,
      'Created At': t.created_at,
    }));
    downloadCSV(objectsToCSV(rows as unknown as Record<string, unknown>[]), `transactions_${getTodayDateString()}.csv`);
  }

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Transactions</h1>
          <p className="text-slate-500 text-sm mt-1">{filtered.length} records</p>
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-600">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="col-span-2 md:col-span-1 lg:col-span-2 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Types</option>
            <option value="cash_in">Cash In</option>
            <option value="cash_out">Cash Out</option>
          </select>
          <select
            value={filterAccount}
            onChange={e => setFilterAccount(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="flex gap-2 col-span-2 md:col-span-1">
            <input
              type="date"
              value={filterFrom}
              onChange={e => setFilterFrom(e.target.value)}
              className="flex-1 px-2 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="From"
            />
            <input
              type="date"
              value={filterTo}
              onChange={e => setFilterTo(e.target.value)}
              className="flex-1 px-2 py-2 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="To"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>No transactions found</p>
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden divide-y divide-slate-100">
              {filtered.map(t => {
                const isCashIn = t.transaction_type === 'cash_in';
                const netEffect = calculateGcashNetChange(t);
                const protectedTxn = isPosProtectedTransaction(t);
                return (
                  <div key={t.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${isCashIn ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {isCashIn ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {isCashIn ? 'Cash In' : 'Cash Out'}
                          </span>
                          <span className="text-xs text-slate-500">{(t.accounts as unknown as Account)?.name}</span>
                        </div>
                        <p className="text-xs text-slate-400">{formatDate(t.date)} · {t.cash_in_mode || '—'}</p>
                        {t.notes && <p className="text-xs text-slate-400 mt-0.5 truncate">{t.notes}</p>}
                        {(Number(t.transaction_fee) > 0 || Number(t.delivery_fee) > 0) && (
                          <p className="text-xs text-amber-600 mt-0.5">
                            {Number(t.transaction_fee) > 0 && `Fee: ${formatCurrency(Number(t.transaction_fee))}`}
                            {Number(t.delivery_fee) > 0 && ` · Del: ${formatCurrency(Number(t.delivery_fee))}`}
                          </p>
                        )}
                        {t.cash_out_type === 'move_to_bank' && (t as unknown as { bank_accounts?: { name: string; bank_name: string } }).bank_accounts && (
                          <div className="flex items-center gap-1.5 mt-1 px-2 py-1 bg-blue-50 rounded-lg border border-blue-100 w-fit">
                            <ArrowDownCircle className="w-3 h-3 text-blue-500 shrink-0" />
                            <span className="text-xs text-blue-700 font-medium">
                              To bank: {(t as unknown as { bank_accounts?: { name: string; bank_name: string } }).bank_accounts?.name}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <p className={`font-bold ${netEffect >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {netEffect >= 0 ? '+' : ''}{formatCurrency(netEffect)}
                        </p>
                        {profile?.role === 'admin' && (
                          <div className="flex items-center gap-1">
                            <button onClick={() => { if (!protectedTxn) { setEditTarget(t); setEditNotes(t.notes || ''); setEditFee(String(t.transaction_fee)); } }}
                              disabled={protectedTxn}
                              title={protectedTxn ? 'POS-linked transactions are managed from POS and GCash detail screens' : 'Edit transaction'}
                              className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-400 disabled:hover:bg-transparent">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setDeleteTarget(t.id)} disabled={protectedTxn} title={protectedTxn ? 'Reverse this transaction by voiding the related POS sale' : 'Delete transaction'} className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-400 disabled:hover:bg-transparent">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700" onClick={() => toggleSort('date')}>
                      <span className="flex items-center gap-1">Date <SortIcon col="date" /></span>
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Account</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Mode</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700" onClick={() => toggleSort('amount')}>
                      <span className="flex items-center justify-end gap-1">Amount <SortIcon col="amount" /></span>
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Txn Fee</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Del Fee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Created</th>
                    {profile?.role === 'admin' && (
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map(t => {
                    const netEffect = calculateGcashNetChange(t);
                    const protectedTxn = isPosProtectedTransaction(t);
                    return (
                      <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatDate(t.date)}</td>
                        <td className="px-4 py-3 text-slate-700 font-medium whitespace-nowrap">{(t.accounts as unknown as Account)?.name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${t.transaction_type === 'cash_in' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {t.transaction_type === 'cash_in' ? <><TrendingUp className="w-3 h-3" /> Cash In</> : <><TrendingDown className="w-3 h-3" /> Cash Out</>}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                          {t.cash_out_type === 'move_to_bank' && (t as unknown as { bank_accounts?: { name: string } }).bank_accounts ? (
                            <div className="flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              <span className="text-xs text-blue-700 font-medium">{(t as unknown as { bank_accounts?: { name: string } }).bank_accounts?.name}</span>
                            </div>
                          ) : (
                            <span className="capitalize">{t.cash_in_mode || (t.cash_out_type?.replace(/_/g, ' ') || '—')}</span>
                          )}
                        </td>
                        <td className={`px-4 py-3 font-semibold text-right whitespace-nowrap ${netEffect >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {netEffect >= 0 ? '+' : ''}{formatCurrency(netEffect)}
                        </td>
                        <td className="px-4 py-3 text-amber-600 text-right whitespace-nowrap">{Number(t.transaction_fee) > 0 ? formatCurrency(Number(t.transaction_fee)) : '—'}</td>
                        <td className="px-4 py-3 text-blue-600 text-right whitespace-nowrap">{Number(t.delivery_fee) > 0 ? formatCurrency(Number(t.delivery_fee)) : '—'}</td>
                        <td className="px-4 py-3 text-slate-500 max-w-[120px] truncate">{t.notes || '—'}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{formatDateTime(t.created_at)}</td>
                        {profile?.role === 'admin' && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button onClick={() => { if (!protectedTxn) { setEditTarget(t); setEditNotes(t.notes || ''); setEditFee(String(t.transaction_fee)); } }} disabled={protectedTxn} className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-400 disabled:hover:bg-transparent" title={protectedTxn ? 'POS-linked transactions are managed from POS and GCash detail screens' : 'Edit'}>
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setDeleteTarget(t.id)} disabled={protectedTxn} className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-400 disabled:hover:bg-transparent" title={protectedTxn ? 'Reverse this transaction by voiding the related POS sale' : 'Delete'}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Transaction"
        message="Are you sure you want to delete this transaction? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Edit Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditTarget(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">Edit Transaction</h3>
              <button onClick={() => setEditTarget(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Transaction Fee (₱)</label>
                <input
                  type="number" inputMode="decimal"
                  value={editFee}
                  onChange={e => setEditFee(e.target.value)}
                  step="0.01"
                  min="0"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditTarget(null)}
                  className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEdit}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
