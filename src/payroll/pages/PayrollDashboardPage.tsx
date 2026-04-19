import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Calendar, CreditCard, TrendingUp, Play, ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatCurrency, formatDate } from '../../lib/utils';

interface PayrollRun {
  run_id: string;
  run_number: string;
  cutoff_id: string;
  total_employees: number;
  total_gross: number;
  total_net: number;
  status: string;
  created_at: string;
}

interface PayrollCutoff {
  cutoff_id: string;
  period_name: string;
  date_from: string;
  date_to: string;
  status: string;
}

export default function PayrollDashboardPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeEmployees, setActiveEmployees] = useState(0);
  const [openCutoffs, setOpenCutoffs] = useState(0);
  const [totalCashAdvances, setTotalCashAdvances] = useState(0);
  const [upcomingCutoff, setUpcomingCutoff] = useState<PayrollCutoff | null>(null);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [cutoffsMap, setCutoffsMap] = useState<Record<string, PayrollCutoff>>({});

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    try {
      const [empRes, cutoffRes, caRes, runsRes, cutoffsRes] = await Promise.all([
        supabase.from('hr_employees').select('id').eq('is_active', 1),
        supabase.from('payroll_cutoffs').select('*').eq('status', 'Open').order('date_from', { ascending: true }),
        supabase.from('payroll_cash_advances').select('balance').eq('status', 'Active'),
        supabase.from('payroll_runs').select('*').order('created_at', { ascending: false }).limit(10),
        supabase.from('payroll_cutoffs').select('*'),
      ]);

      setActiveEmployees((empRes.data || []).length);
      setOpenCutoffs((cutoffRes.data || []).length);
      if (cutoffRes.data && cutoffRes.data.length > 0) {
        setUpcomingCutoff(cutoffRes.data[0] as PayrollCutoff);
      }

      const caSum = (caRes.data || []).reduce((s: number, r: { balance: unknown }) => s + (parseFloat(r.balance as string) || 0), 0);
      setTotalCashAdvances(caSum);

      setRuns((runsRes.data || []) as PayrollRun[]);

      const map: Record<string, PayrollCutoff> = {};
      for (const c of (cutoffsRes.data || []) as PayrollCutoff[]) {
        map[c.cutoff_id] = c;
      }
      setCutoffsMap(map);
    } finally {
      setLoading(false);
    }
  }

  function statusBadge(status: string) {
    const map: Record<string, string> = {
      Draft: 'bg-yellow-100 text-yellow-700',
      Finalized: 'bg-green-100 text-green-700',
      Cancelled: 'bg-red-100 text-red-700',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? 'bg-slate-100 text-slate-600'}`}>
        {status}
      </span>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Payroll Dashboard</h1>
        <button
          onClick={loadDashboard}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-sm text-slate-500">Active Employees</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{loading ? '—' : activeEmployees}</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-sm text-slate-500">Open Cutoffs</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{loading ? '—' : openCutoffs}</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-red-600" />
            </div>
            <span className="text-sm text-slate-500">Active Cash Advances</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{loading ? '—' : formatCurrency(totalCashAdvances)}</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <span className="text-sm text-slate-500">Upcoming Payroll</span>
          </div>
          <p className="text-sm font-semibold text-slate-800">
            {loading ? '—' : upcomingCutoff ? formatDate(upcomingCutoff.date_from) : 'None scheduled'}
          </p>
          {upcomingCutoff && (
            <p className="text-xs text-slate-500 mt-0.5">{upcomingCutoff.period_name}</p>
          )}
        </div>
      </div>

      {/* Quick Links */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => navigate('/payroll/employees/new')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <Users className="w-4 h-4" /> Add Employee
          </button>
          <button
            onClick={() => navigate('/payroll/cutoffs')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-800"
          >
            <Calendar className="w-4 h-4" /> Add Cutoff
          </button>
          <button
            onClick={() => navigate('/payroll/processing')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
          >
            <Play className="w-4 h-4" /> Process Payroll
          </button>
          <button
            onClick={() => navigate('/payroll/biometrics')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700"
          >
            <CreditCard className="w-4 h-4" /> Import Biometrics
          </button>
        </div>
      </div>

      {/* Recent Runs */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">Recent Payroll Runs</h2>
          <button
            onClick={() => navigate('/payroll/processing')}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            View All <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Loading...</div>
        ) : runs.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No payroll runs yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Run #</th>
                  <th className="px-4 py-3 text-left">Period</th>
                  <th className="px-4 py-3 text-right">Employees</th>
                  <th className="px-4 py-3 text-right">Gross</th>
                  <th className="px-4 py-3 text-right">Net Pay</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map(run => {
                  const cutoff = cutoffsMap[run.cutoff_id];
                  return (
                    <tr key={run.run_id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">{run.run_number}</td>
                      <td className="px-4 py-3">
                        {cutoff ? (
                          <span>
                            {cutoff.period_name}
                            <span className="block text-xs text-slate-400">
                              {formatDate(cutoff.date_from)} – {formatDate(cutoff.date_to)}
                            </span>
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">{run.total_employees ?? 0}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(parseFloat(run.total_gross as unknown as string) || 0)}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatCurrency(parseFloat(run.total_net as unknown as string) || 0)}</td>
                      <td className="px-4 py-3">{statusBadge(run.status)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => navigate(`/payroll/processing?cutoff_id=${run.cutoff_id}`)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
