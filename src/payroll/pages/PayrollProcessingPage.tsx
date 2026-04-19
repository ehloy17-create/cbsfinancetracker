import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Play, Lock, RefreshCw, FileText, Download, Users, DollarSign, TrendingDown, Wallet, Banknote } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency } from '../../lib/utils';
import InvModal from '../../inventory/components/InvModal';

interface PayrollCutoff {
  cutoff_id: string;
  period_name: string;
  date_from: string;
  date_to: string;
  status: string;
  pay_frequency?: string;
}

interface PayrollRun {
  run_id: string;
  run_number: string;
  cutoff_id: string;
  total_employees: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  status: string;
  created_at: string;
}

interface PayrollRunItem {
  run_item_id: string;
  employee_code: string;
  employee_name: string;
  department: string;
  days_worked: number;
  basic_pay: number;
  overtime_pay: number;
  holiday_pay: number;
  allowances: number;
  gross_pay: number;
  sss_deduction: number;
  philhealth_deduction: number;
  pagibig_deduction: number;
  cash_advance_deduction: number;
  other_deductions: number;
  net_pay: number;
}

interface GCashAccount {
  id: string;
  name: string;
}

interface DisbursementForm {
  payment_source: 'gcash' | 'cash_fund' | 'pos_cash';
  account_id: string;
  amount: string;
  date: string;
  description: string;
  notes: string;
}

function exportCsv(items: PayrollRunItem[]) {
  const headers = ['Code', 'Name', 'Dept', 'Days', 'Basic', 'OT', 'Holiday', 'Allow', 'Gross', 'SSS', 'PhilHealth', 'PagIBIG', 'CA', 'Other Ded', 'Net Pay'];
  const rows = items.map(i => [
    i.employee_code, i.employee_name, i.department,
    i.days_worked, i.basic_pay, i.overtime_pay, i.holiday_pay, i.allowances, i.gross_pay,
    i.sss_deduction, i.philhealth_deduction, i.pagibig_deduction, i.cash_advance_deduction, i.other_deductions, i.net_pay,
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'payroll.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function n(val: unknown): number {
  return parseFloat(val as string) || 0;
}

export default function PayrollProcessingPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();

  const [cutoffs, setCutoffs] = useState<PayrollCutoff[]>([]);
  const [selectedCutoffId, setSelectedCutoffId] = useState(searchParams.get('cutoff_id') || '');
  const [selectedCutoff, setSelectedCutoff] = useState<PayrollCutoff | null>(null);
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [items, setItems] = useState<PayrollRunItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);

  // Disbursement shortcut state
  const [showDisbursementModal, setShowDisbursementModal] = useState(false);
  const [gcashAccounts, setGcashAccounts] = useState<GCashAccount[]>([]);
  const [disbForm, setDisbForm] = useState<DisbursementForm>({
    payment_source: 'cash_fund',
    account_id: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    description: '',
    notes: '',
  });
  const [disbSaving, setDisbSaving] = useState(false);

  useEffect(() => {
    loadCutoffs();
  }, []);

  useEffect(() => {
    if (selectedCutoffId) {
      const c = cutoffs.find(x => x.cutoff_id === selectedCutoffId) || null;
      setSelectedCutoff(c);
      loadRun(selectedCutoffId);
      setSearchParams({ cutoff_id: selectedCutoffId }, { replace: true });
    } else {
      setSelectedCutoff(null);
      setRun(null);
      setItems([]);
    }
  }, [selectedCutoffId, cutoffs]);

  async function loadCutoffs() {
    const { data, error } = await supabase.rpc('search_payroll_cutoffs', { status: '', page_size: 100 });
    if (error) {
      showToast('Failed to load cutoffs', 'error');
      return;
    }
    const list = (Array.isArray(data) ? data : data?.data || []) as PayrollCutoff[];
    setCutoffs(list.filter(c => c.status === 'Open' || c.status === 'Processing'));
  }

  const loadRun = useCallback(async (cutoffId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_payroll_run', { cutoff_id: cutoffId });
      if (error || !data) {
        setRun(null);
        setItems([]);
        return;
      }
      const result = data as { run: PayrollRun; items: PayrollRunItem[] };
      setRun(result.run || null);
      setItems(result.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleProcess() {
    if (!selectedCutoffId) return;
    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('process_payroll', {
        cutoff_id: selectedCutoffId,
        processed_by: 'admin',
        run_id: run?.run_id || undefined,
      });
      if (error || !data?.success) {
        showToast(error?.message || 'Processing failed', 'error');
        return;
      }
      showToast('Payroll processed successfully', 'success');
      await loadRun(selectedCutoffId);
    } finally {
      setProcessing(false);
    }
  }

  async function handleFinalize() {
    if (!run) return;
    setFinalizing(true);
    try {
      const { data, error } = await supabase.rpc('finalize_payroll', {
        run_id: run.run_id,
        finalized_by: 'admin',
      });
      if (error || !data?.success) {
        showToast(error?.message || 'Finalize failed', 'error');
        return;
      }
      showToast('Payroll finalized', 'success');
      setShowFinalizeModal(false);
      await loadRun(selectedCutoffId);
    } finally {
      setFinalizing(false);
    }
  }

  async function openDisbursementModal() {
    // Load GCash accounts
    try {
      const { data } = await supabase.from('accounts').select('id,name').eq('is_active', true).order('name');
      setGcashAccounts((data as GCashAccount[]) || []);
    } catch { setGcashAccounts([]); }
    setDisbForm({
      payment_source: 'cash_fund',
      account_id: '',
      amount: run ? String(n(run.total_net)) : '',
      date: new Date().toISOString().slice(0, 10),
      description: selectedCutoff ? `Payroll payout – ${selectedCutoff.period_name}` : 'Payroll Disbursement',
      notes: '',
    });
    setShowDisbursementModal(true);
  }

  async function handleRecordDisbursement() {
    if (!run?.run_id) return;
    const amount = parseFloat(disbForm.amount);
    if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }
    if (disbForm.payment_source === 'gcash' && !disbForm.account_id) {
      showToast('Select a GCash account', 'error'); return;
    }
    setDisbSaving(true);
    try {
      const { data, error } = await supabase.rpc('record_payroll_disbursement', {
        run_id: run.run_id,
        amount,
        payment_source: disbForm.payment_source,
        account_id: disbForm.account_id || null,
        date: disbForm.date,
        description: disbForm.description,
        notes: disbForm.notes || null,
        created_by: 'admin',
      });
      if (error || !(data as { success?: boolean })?.success) {
        showToast(error?.message || 'Disbursement failed', 'error'); return;
      }
      showToast('Payroll disbursement recorded successfully', 'success');
      setShowDisbursementModal(false);
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Disbursement failed', 'error');
    } finally {
      setDisbSaving(false);
    }
  }

  const totals = items.reduce(
    (acc, i) => ({
      days: acc.days + n(i.days_worked),
      basic: acc.basic + n(i.basic_pay),
      ot: acc.ot + n(i.overtime_pay),
      holiday: acc.holiday + n(i.holiday_pay),
      allow: acc.allow + n(i.allowances),
      gross: acc.gross + n(i.gross_pay),
      sss: acc.sss + n(i.sss_deduction),
      ph: acc.ph + n(i.philhealth_deduction),
      pi: acc.pi + n(i.pagibig_deduction),
      ca: acc.ca + n(i.cash_advance_deduction),
      other: acc.other + n(i.other_deductions),
      net: acc.net + n(i.net_pay),
    }),
    { days: 0, basic: 0, ot: 0, holiday: 0, allow: 0, gross: 0, sss: 0, ph: 0, pi: 0, ca: 0, other: 0, net: 0 }
  );

  const isFinalized = run?.status === 'Finalized';
  const isDraft = run?.status === 'Draft';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Payroll Processing</h1>
      </div>

      {/* Cutoff Selection */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-slate-600 mb-1">Select Cutoff Period</label>
            <select
              value={selectedCutoffId}
              onChange={e => setSelectedCutoffId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Select a cutoff --</option>
              {cutoffs.map(c => (
                <option key={c.cutoff_id} value={c.cutoff_id}>
                  {c.period_name} ({c.status})
                </option>
              ))}
            </select>
          </div>

          {selectedCutoff && (
            <div className="text-sm text-slate-500">
              <span className="font-medium text-slate-700">{selectedCutoff.date_from}</span>
              {' – '}
              <span className="font-medium text-slate-700">{selectedCutoff.date_to}</span>
              <span className="ml-3 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                {selectedCutoff.status}
              </span>
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            {selectedCutoffId && !isFinalized && (
              <button
                onClick={handleProcess}
                disabled={processing}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
              >
                {processing ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {run ? 'Re-Process' : 'Process Payroll'}
              </button>
            )}

            {isDraft && (
              <button
                onClick={() => setShowFinalizeModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
              >
                <Lock className="w-4 h-4" /> Finalize Payroll
              </button>
            )}

            {run && (
              <button
                onClick={openDisbursementModal}
                className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700"
              >
                <Banknote className="w-4 h-4" /> Record Disbursement
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {run && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Employees', value: run.total_employees, icon: <Users className="w-5 h-5 text-blue-600" />, bg: 'bg-blue-50', fmt: false },
            { label: 'Total Gross', value: n(run.total_gross), icon: <DollarSign className="w-5 h-5 text-green-600" />, bg: 'bg-green-50', fmt: true },
            { label: 'Total Deductions', value: n(run.total_deductions), icon: <TrendingDown className="w-5 h-5 text-red-600" />, bg: 'bg-red-50', fmt: true },
            { label: 'Total Net Pay', value: n(run.total_net), icon: <Wallet className="w-5 h-5 text-purple-600" />, bg: 'bg-purple-50', fmt: true },
          ].map(card => (
            <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg ${card.bg} flex items-center justify-center`}>{card.icon}</div>
                <span className="text-xs text-slate-500">{card.label}</span>
              </div>
              <p className="text-xl font-bold text-slate-800">
                {card.fmt ? formatCurrency(card.value as number) : card.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Run Table */}
      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm">
          Loading...
        </div>
      ) : items.length > 0 ? (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Payroll Run Detail
              {run && (
                <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                  {run.status}
                </span>
              )}
            </h2>
            <button
              onClick={() => exportCsv(items)}
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-300 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Code</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Name</th>
                  <th className="px-3 py-3 text-left whitespace-nowrap">Dept</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Days</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Basic</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">OT</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Holiday</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Allow</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Gross</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">SSS</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">PhilHealth</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">PagIBIG</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">CA</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Other</th>
                  <th className="px-3 py-3 text-right whitespace-nowrap">Net Pay</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.run_item_id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs">{item.employee_code}</td>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{item.employee_name}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{item.department}</td>
                    <td className="px-3 py-2 text-right">{n(item.days_worked)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(n(item.basic_pay))}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(n(item.overtime_pay))}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(n(item.holiday_pay))}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(n(item.allowances))}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(n(item.gross_pay))}</td>
                    <td className="px-3 py-2 text-right text-red-600">{formatCurrency(n(item.sss_deduction))}</td>
                    <td className="px-3 py-2 text-right text-red-600">{formatCurrency(n(item.philhealth_deduction))}</td>
                    <td className="px-3 py-2 text-right text-red-600">{formatCurrency(n(item.pagibig_deduction))}</td>
                    <td className="px-3 py-2 text-right text-red-600">{formatCurrency(n(item.cash_advance_deduction))}</td>
                    <td className="px-3 py-2 text-right text-red-600">{formatCurrency(n(item.other_deductions))}</td>
                    <td className="px-3 py-2 text-right font-bold text-green-700">{formatCurrency(n(item.net_pay))}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => navigate(`/payroll/payslip/${item.run_item_id}`)}
                        className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                      >
                        Payslip
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-semibold text-xs">
                <tr>
                  <td className="px-3 py-2" colSpan={3}>TOTALS</td>
                  <td className="px-3 py-2 text-right">{totals.days}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(totals.basic)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(totals.ot)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(totals.holiday)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(totals.allow)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(totals.gross)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(totals.sss)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(totals.ph)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(totals.pi)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(totals.ca)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(totals.other)}</td>
                  <td className="px-3 py-2 text-right text-green-700">{formatCurrency(totals.net)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : selectedCutoffId && !loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm">
          No payroll run for this cutoff yet. Click "Process Payroll" to generate.
        </div>
      ) : null}

      {/* Finalize Confirm Modal */}
      <InvModal
        open={showFinalizeModal}
        onClose={() => setShowFinalizeModal(false)}
        title="Finalize Payroll"
        size="md"
      >
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-700">
            Are you sure you want to finalize this payroll run? This action <strong>cannot be undone</strong> and the run will be locked.
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowFinalizeModal(false)}
              className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleFinalize}
              disabled={finalizing}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-60"
            >
              {finalizing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Finalize
            </button>
          </div>
        </div>
      </InvModal>

      {/* Record Disbursement Modal */}
      <InvModal
        open={showDisbursementModal}
        onClose={() => setShowDisbursementModal(false)}
        title="Record Payroll Disbursement"
        size="lg"
      >
        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-500">
            Record the payment of net payroll from your chosen source. This will create a disbursement record linked to this payroll run.
          </p>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payment Source <span className="text-red-500">*</span></label>
            <div className="grid grid-cols-3 gap-2">
              {(['gcash', 'cash_fund', 'pos_cash'] as const).map(src => (
                <button
                  key={src}
                  onClick={() => setDisbForm(f => ({ ...f, payment_source: src, account_id: '' }))}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    disbForm.payment_source === src
                      ? 'bg-purple-600 text-white border-purple-600'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {src === 'gcash' ? 'GCash' : src === 'cash_fund' ? 'Cash Fund' : 'POS Cash'}
                </button>
              ))}
            </div>
          </div>

          {disbForm.payment_source === 'gcash' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">GCash Account <span className="text-red-500">*</span></label>
              <select
                value={disbForm.account_id}
                onChange={e => setDisbForm(f => ({ ...f, account_id: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="">Select GCash account…</option>
                {gcashAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Amount <span className="text-red-500">*</span></label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={disbForm.amount}
                onChange={e => setDisbForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="0.00"
              />
              {run && (
                <p className="text-xs text-slate-400 mt-1">Total net: {formatCurrency(n(run.total_net))}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
              <input
                type="date"
                value={disbForm.date}
                onChange={e => setDisbForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <input
              type="text"
              value={disbForm.description}
              onChange={e => setDisbForm(f => ({ ...f, description: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              value={disbForm.notes}
              onChange={e => setDisbForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Optional notes…"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowDisbursementModal(false)}
              className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleRecordDisbursement}
              disabled={disbSaving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-60"
            >
              {disbSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
              {disbSaving ? 'Recording…' : 'Record Disbursement'}
            </button>
          </div>
        </div>
      </InvModal>
    </div>
  );
}
