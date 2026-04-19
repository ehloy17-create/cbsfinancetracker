import { useState, useEffect, useCallback } from 'react';
import { History, Download, Filter } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { DailyHistory, Account } from '../lib/types';
import { formatCurrency, formatDate, getTodayDateString, objectsToCSV, downloadCSV, round2 } from '../lib/utils';
import { useToast } from '../contexts/ToastContext';

export default function HistoryPage() {
  const { showToast } = useToast();
  const [history, setHistory] = useState<DailyHistory[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAccount, setFilterAccount] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState(getTodayDateString());

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('daily_history')
      .select('*, accounts(id,name), profiles(name)')
      .order('date', { ascending: false });

    if (filterAccount) q = q.eq('account_id', filterAccount);
    if (filterFrom) q = q.gte('date', filterFrom);
    if (filterTo) q = q.lte('date', filterTo);

    const { data, error } = await q.limit(365);
    if (error) {
      showToast('Failed to load history', 'error');
    } else {
      setHistory((data as unknown as DailyHistory[]) || []);
    }
    setLoading(false);
  }, [filterAccount, filterFrom, filterTo, showToast]);

  useEffect(() => {
    supabase.from('accounts').select('*').eq('is_active', true).order('name').then(({ data }) => {
      if (data) setAccounts(data);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = history.reduce(
    (a, h) => {
      const hx = h as unknown as Record<string, number>;
      return {
        cash_in: round2(a.cash_in + Number(h.total_cash_in)),
        cash_out: round2(a.cash_out + Number(h.total_cash_out)),
        gcash_fees: round2(a.gcash_fees + Number(h.total_transaction_fee)),
        cash_fees: round2(a.cash_fees + Number(hx.total_cash_fees || 0)),
        pos_register: round2(a.pos_register + Number(hx.total_pos_register || 0)),
        product_payment: round2(a.product_payment + Number(hx.total_product_payment || 0)),
        delivery: round2(a.delivery + Number(h.total_delivery_fee)),
      };
    },
    { cash_in: 0, cash_out: 0, gcash_fees: 0, cash_fees: 0, pos_register: 0, product_payment: 0, delivery: 0 }
  );

  function exportCSV() {
    const rows = history.map(h => {
      const hx = h as unknown as Record<string, number>;
      return {
        Date: h.date,
        Account: (h.accounts as unknown as Account)?.name,
        'Beginning Balance': h.beginning_balance,
        'Cash In': h.total_cash_in,
        'Cash Out': h.total_cash_out,
        'POS Register': hx.total_pos_register || 0,
        'GCash Fee': h.total_transaction_fee,
        'Cash Fee': hx.total_cash_fees || 0,
        'Product Payment': hx.total_product_payment || 0,
        'Delivery Fee': h.total_delivery_fee,
        'Ending Balance': h.ending_balance,
        'Posted At': h.posted_at,
      };
    });
    downloadCSV(objectsToCSV(rows as unknown as Record<string, unknown>[]), `history_${getTodayDateString()}.csv`);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Daily History</h1>
          <p className="text-slate-500 text-sm mt-1">{history.length} records</p>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select
            value={filterAccount}
            onChange={e => setFilterAccount(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input
            type="date"
            value={filterFrom}
            onChange={e => setFilterFrom(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="From date"
          />
          <input
            type="date"
            value={filterTo}
            onChange={e => setFilterTo(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="To date"
          />
        </div>
      </div>

      {/* Summary Cards */}
      {history.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: 'Total Cash In', value: totals.cash_in, color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Total Cash Out', value: totals.cash_out, color: 'text-red-600 bg-red-50' },
            { label: 'POS Register', value: totals.pos_register, color: 'text-teal-600 bg-teal-50' },
            { label: 'GCash Fees', value: totals.gcash_fees, color: 'text-amber-600 bg-amber-50' },
            { label: 'Cash Fees', value: totals.cash_fees, color: 'text-orange-600 bg-orange-50' },
            { label: 'Product Payment', value: totals.product_payment, color: 'text-emerald-700 bg-emerald-50' },
            { label: 'Delivery Fees', value: totals.delivery, color: 'text-blue-600 bg-blue-50' },
          ].map(c => (
            <div key={c.label} className={`rounded-xl p-4 ${c.color}`}>
              <p className="text-xs font-medium opacity-70">{c.label}</p>
              <p className="text-xl font-bold mt-1">{formatCurrency(c.value)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>No history records found</p>
            <p className="text-xs mt-1">Records are created after daily closing</p>
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden divide-y divide-slate-100">
              {history.map(h => {
                const hx = h as unknown as Record<string, number>;
                return (
                  <div key={h.id} className="px-4 py-3">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-slate-800 text-sm">{formatDate(h.date)}</p>
                        <p className="text-xs text-slate-500">{(h.accounts as unknown as Account)?.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-400">Ending Balance</p>
                        <p className="font-bold text-slate-800">{formatCurrency(Number(h.ending_balance))}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div className="flex justify-between"><span className="text-slate-400">Beginning</span><span className="text-slate-600">{formatCurrency(Number(h.beginning_balance))}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Cash In</span><span className="text-emerald-600">+{formatCurrency(Number(h.total_cash_in))}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Cash Out</span><span className="text-red-600">-{formatCurrency(Number(h.total_cash_out))}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">POS Register</span><span className="text-teal-600">{formatCurrency(Number(hx.total_pos_register || 0))}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">GCash Fee</span><span className="text-amber-600">{formatCurrency(Number(h.total_transaction_fee))}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Cash Fee</span><span className="text-orange-600">{formatCurrency(Number(hx.total_cash_fees || 0))}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Product Pmt</span><span className="text-emerald-700">{formatCurrency(Number(hx.total_product_payment || 0))}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Del Fees</span><span className="text-blue-600">{formatCurrency(Number(h.total_delivery_fee))}</span></div>
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
                    {['Date', 'Account', 'Beginning', 'Cash In', 'Cash Out', 'POS Register', 'GCash Fee', 'Cash Fee', 'Product Pmt', 'Del Fees', 'Ending Balance'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {history.map(h => {
                    const hx = h as unknown as Record<string, number>;
                    return (
                      <tr key={h.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap font-medium">{formatDate(h.date)}</td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{(h.accounts as unknown as Account)?.name}</td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatCurrency(Number(h.beginning_balance))}</td>
                        <td className="px-4 py-3 text-emerald-600 font-medium whitespace-nowrap">+{formatCurrency(Number(h.total_cash_in))}</td>
                        <td className="px-4 py-3 text-red-600 font-medium whitespace-nowrap">-{formatCurrency(Number(h.total_cash_out))}</td>
                        <td className="px-4 py-3 text-teal-600 whitespace-nowrap">{formatCurrency(Number(hx.total_pos_register || 0))}</td>
                        <td className="px-4 py-3 text-amber-600 whitespace-nowrap">{formatCurrency(Number(h.total_transaction_fee))}</td>
                        <td className="px-4 py-3 text-orange-600 whitespace-nowrap">{formatCurrency(Number(hx.total_cash_fees || 0))}</td>
                        <td className="px-4 py-3 text-emerald-700 whitespace-nowrap">{formatCurrency(Number(hx.total_product_payment || 0))}</td>
                        <td className="px-4 py-3 text-blue-600 whitespace-nowrap">{formatCurrency(Number(h.total_delivery_fee))}</td>
                        <td className="px-4 py-3 font-bold text-slate-800 whitespace-nowrap">{formatCurrency(Number(h.ending_balance))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
