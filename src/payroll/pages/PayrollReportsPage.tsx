import { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Printer, Download } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency, formatDate } from '../../lib/utils';

type Tab = 'register' | 'contributions' | 'attendance';

interface PayrollCutoff {
  cutoff_id: string;
  period_name: string;
  date_from: string;
  date_to: string;
  status: string;
}

interface RegisterRow {
  employee_code: string;
  employee_name: string;
  department: string;
  gross_pay: number;
  sss_deduction: number;
  philhealth_deduction: number;
  pagibig_deduction: number;
  cash_advance_deduction: number;
  other_deductions: number;
  net_pay: number;
}

interface ContributionRow {
  employee_code: string;
  employee_name: string;
  monthly_basic: number;
  sss_contribution: number;
  philhealth_contribution: number;
  pagibig_contribution: number;
  total_statutory: number;
}

interface AttendanceRow {
  employee_code: string;
  employee_name: string;
  attendance_date: string;
  time_in: string;
  time_out: string;
  hours_worked: number;
  late_minutes: number;
  overtime_hours: number;
  is_holiday: number;
  is_absent: number;
}

interface HrEmployee {
  id: string;
  employee_code: string;
  full_name: string;
}

function n(v: unknown): number { return parseFloat(v as string) || 0; }

function handlePrint(title: string, contentHtml: string, extraStyles = '') {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
      th { background: #f5f5f5; font-weight: bold; }
      .text-right { text-align: right; }
      .font-bold { font-weight: bold; }
      .payslip-header { text-align: center; margin-bottom: 20px; }
      .payslip-row { display: flex; justify-content: space-between; padding: 3px 0; }
      .payslip-section { margin: 12px 0; }
      .payslip-section h4 { border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 8px; font-size: 11px; text-transform: uppercase; }
      .total-row { border-top: 2px solid #333; font-weight: bold; margin-top: 8px; padding-top: 8px; }
      ${extraStyles}
      @media print { body { padding: 8px; } }
    </style></head><body>${contentHtml}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 400);
}

function exportCsvData(headers: string[], rows: (string | number)[][], filename: string) {
  const csv = [headers, ...rows].map(r => r.map(c => `"${c ?? ''}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PayrollReportsPage() {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('register');

  const [cutoffs, setCutoffs] = useState<PayrollCutoff[]>([]);
  const [employees, setEmployees] = useState<HrEmployee[]>([]);

  // Register
  const [regCutoffId, setRegCutoffId] = useState('');
  const [regData, setRegData] = useState<RegisterRow[]>([]);
  const [regLoading, setRegLoading] = useState(false);

  // Contributions
  const [contCutoffId, setContCutoffId] = useState('');
  const [contData, setContData] = useState<ContributionRow[]>([]);
  const [contLoading, setContLoading] = useState(false);

  // Attendance
  const [attCutoffId, setAttCutoffId] = useState('');
  const [attEmployeeId, setAttEmployeeId] = useState('');
  const [attData, setAttData] = useState<AttendanceRow[]>([]);
  const [attLoading, setAttLoading] = useState(false);

  const didLoad = useRef(false);

  useEffect(() => {
    if (!didLoad.current) {
      didLoad.current = true;
      loadCutoffs();
      loadEmployees();
    }
  }, []);

  async function loadCutoffs() {
    const { data } = await supabase.from('payroll_cutoffs').select('*').order('date_from', { ascending: false });
    setCutoffs((data || []) as PayrollCutoff[]);
  }

  async function loadEmployees() {
    const { data } = await supabase.from('hr_employees').select('id, employee_code, full_name').eq('is_active', 1).order('full_name', { ascending: true });
    setEmployees((data || []) as HrEmployee[]);
  }

  const loadRegister = useCallback(async (cutoffId: string) => {
    if (!cutoffId) return;
    setRegLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_payroll_register_report', { cutoff_id: cutoffId });
      if (error) { showToast('Failed to load register', 'error'); return; }
      setRegData((Array.isArray(data) ? data : data?.data || []) as RegisterRow[]);
    } finally {
      setRegLoading(false);
    }
  }, []);

  const loadContributions = useCallback(async (cutoffId: string) => {
    if (!cutoffId) return;
    setContLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_contributions_report', { cutoff_id: cutoffId });
      if (error) { showToast('Failed to load contributions', 'error'); return; }
      setContData((Array.isArray(data) ? data : data?.data || []) as ContributionRow[]);
    } finally {
      setContLoading(false);
    }
  }, []);

  const loadAttendance = useCallback(async (cutoffId: string, employeeId: string) => {
    if (!cutoffId) return;
    setAttLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_attendance_report', { cutoff_id: cutoffId, employee_id: employeeId || null });
      if (error) { showToast('Failed to load attendance', 'error'); return; }
      setAttData((Array.isArray(data) ? data : data?.data || []) as AttendanceRow[]);
    } finally {
      setAttLoading(false);
    }
  }, []);

  // Register helpers
  const regTotals = regData.reduce(
    (acc, r) => ({
      gross: acc.gross + n(r.gross_pay),
      sss: acc.sss + n(r.sss_deduction),
      ph: acc.ph + n(r.philhealth_deduction),
      pi: acc.pi + n(r.pagibig_deduction),
      ca: acc.ca + n(r.cash_advance_deduction),
      other: acc.other + n(r.other_deductions),
      net: acc.net + n(r.net_pay),
    }),
    { gross: 0, sss: 0, ph: 0, pi: 0, ca: 0, other: 0, net: 0 }
  );

  function printRegister() {
    const thead = `<tr><th>Employee</th><th>Dept</th><th class="text-right">Gross</th><th class="text-right">SSS</th><th class="text-right">PhilHealth</th><th class="text-right">PagIBIG</th><th class="text-right">CA</th><th class="text-right">Other</th><th class="text-right">Net Pay</th></tr>`;
    const tbody = regData.map(r => `<tr>
      <td>${r.employee_name} (${r.employee_code})</td>
      <td>${r.department || ''}</td>
      <td class="text-right">${formatCurrency(n(r.gross_pay))}</td>
      <td class="text-right">${formatCurrency(n(r.sss_deduction))}</td>
      <td class="text-right">${formatCurrency(n(r.philhealth_deduction))}</td>
      <td class="text-right">${formatCurrency(n(r.pagibig_deduction))}</td>
      <td class="text-right">${formatCurrency(n(r.cash_advance_deduction))}</td>
      <td class="text-right">${formatCurrency(n(r.other_deductions))}</td>
      <td class="text-right font-bold">${formatCurrency(n(r.net_pay))}</td>
    </tr>`).join('');
    const tfoot = `<tr class="font-bold"><td colspan="2">TOTALS</td><td class="text-right">${formatCurrency(regTotals.gross)}</td><td class="text-right">${formatCurrency(regTotals.sss)}</td><td class="text-right">${formatCurrency(regTotals.ph)}</td><td class="text-right">${formatCurrency(regTotals.pi)}</td><td class="text-right">${formatCurrency(regTotals.ca)}</td><td class="text-right">${formatCurrency(regTotals.other)}</td><td class="text-right">${formatCurrency(regTotals.net)}</td></tr>`;
    const html = `<h2 style="margin-bottom:12px;">Payroll Register</h2><table><thead>${thead}</thead><tbody>${tbody}</tbody><tfoot>${tfoot}</tfoot></table>`;
    handlePrint('Payroll Register', html);
  }

  function exportRegisterCsv() {
    exportCsvData(
      ['Code', 'Name', 'Dept', 'Gross', 'SSS', 'PhilHealth', 'PagIBIG', 'CA', 'Other', 'Net Pay'],
      regData.map(r => [r.employee_code, r.employee_name, r.department, n(r.gross_pay), n(r.sss_deduction), n(r.philhealth_deduction), n(r.pagibig_deduction), n(r.cash_advance_deduction), n(r.other_deductions), n(r.net_pay)]),
      'payroll_register.csv'
    );
  }

  // Contributions helpers
  const contTotals = contData.reduce(
    (acc, r) => ({
      basic: acc.basic + n(r.monthly_basic),
      sss: acc.sss + n(r.sss_contribution),
      ph: acc.ph + n(r.philhealth_contribution),
      pi: acc.pi + n(r.pagibig_contribution),
      total: acc.total + n(r.total_statutory),
    }),
    { basic: 0, sss: 0, ph: 0, pi: 0, total: 0 }
  );

  function printContributions() {
    const thead = `<tr><th>Employee</th><th class="text-right">Basic Rate</th><th class="text-right">SSS</th><th class="text-right">PhilHealth</th><th class="text-right">PagIBIG</th><th class="text-right">Total Statutory</th></tr>`;
    const tbody = contData.map(r => `<tr>
      <td>${r.employee_name} (${r.employee_code})</td>
      <td class="text-right">${formatCurrency(n(r.monthly_basic))}</td>
      <td class="text-right">${formatCurrency(n(r.sss_contribution))}</td>
      <td class="text-right">${formatCurrency(n(r.philhealth_contribution))}</td>
      <td class="text-right">${formatCurrency(n(r.pagibig_contribution))}</td>
      <td class="text-right font-bold">${formatCurrency(n(r.total_statutory))}</td>
    </tr>`).join('');
    const tfoot = `<tr class="font-bold"><td>TOTALS</td><td class="text-right">${formatCurrency(contTotals.basic)}</td><td class="text-right">${formatCurrency(contTotals.sss)}</td><td class="text-right">${formatCurrency(contTotals.ph)}</td><td class="text-right">${formatCurrency(contTotals.pi)}</td><td class="text-right">${formatCurrency(contTotals.total)}</td></tr>`;
    const html = `<h2 style="margin-bottom:12px;">Government Contributions</h2><table><thead>${thead}</thead><tbody>${tbody}</tbody><tfoot>${tfoot}</tfoot></table>`;
    handlePrint('Government Contributions', html);
  }

  function exportContributionsCsv() {
    exportCsvData(
      ['Code', 'Name', 'Basic Rate', 'SSS', 'PhilHealth', 'PagIBIG', 'Total Statutory'],
      contData.map(r => [r.employee_code, r.employee_name, n(r.monthly_basic), n(r.sss_contribution), n(r.philhealth_contribution), n(r.pagibig_contribution), n(r.total_statutory)]),
      'government_contributions.csv'
    );
  }

  function exportAttendanceCsv() {
    exportCsvData(
      ['Code', 'Name', 'Date', 'Time In', 'Time Out', 'Hours', 'Late (min)', 'OT Hours', 'Holiday', 'Absent'],
      attData.map(r => [r.employee_code, r.employee_name, r.attendance_date, r.time_in || '', r.time_out || '', n(r.hours_worked), n(r.late_minutes), n(r.overtime_hours), r.is_holiday ? 'Yes' : 'No', r.is_absent ? 'Yes' : 'No']),
      'attendance_summary.csv'
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'register', label: 'Payroll Register' },
    { key: 'contributions', label: 'Government Contributions' },
    { key: 'attendance', label: 'Attendance Summary' },
  ];

  const finalizedCutoffs = cutoffs.filter(c => c.status === 'Finalized');

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="w-5 h-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800">Payroll Reports</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Payroll Register */}
      {activeTab === 'register' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cutoff Period</label>
              <select
                value={regCutoffId}
                onChange={e => { setRegCutoffId(e.target.value); setRegData([]); }}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Select Cutoff --</option>
                {finalizedCutoffs.map(c => (
                  <option key={c.cutoff_id} value={c.cutoff_id}>{c.period_name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => loadRegister(regCutoffId)}
              disabled={!regCutoffId || regLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {regLoading ? 'Loading...' : 'Generate'}
            </button>
            {regData.length > 0 && (
              <>
                <button onClick={printRegister} className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                  <Printer className="w-4 h-4" /> Print
                </button>
                <button onClick={exportRegisterCsv} className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                  <Download className="w-4 h-4" /> CSV
                </button>
              </>
            )}
          </div>

          {regData.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Employee</th>
                    <th className="px-4 py-3 text-left">Dept</th>
                    <th className="px-4 py-3 text-right">Gross</th>
                    <th className="px-4 py-3 text-right">SSS</th>
                    <th className="px-4 py-3 text-right">PhilHealth</th>
                    <th className="px-4 py-3 text-right">PagIBIG</th>
                    <th className="px-4 py-3 text-right">CA</th>
                    <th className="px-4 py-3 text-right">Other</th>
                    <th className="px-4 py-3 text-right">Net Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {regData.map((row, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <span className="font-medium">{row.employee_name}</span>
                        <span className="block text-xs text-slate-400 font-mono">{row.employee_code}</span>
                      </td>
                      <td className="px-4 py-2 text-slate-500">{row.department}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(n(row.gross_pay))}</td>
                      <td className="px-4 py-2 text-right text-red-600">{formatCurrency(n(row.sss_deduction))}</td>
                      <td className="px-4 py-2 text-right text-red-600">{formatCurrency(n(row.philhealth_deduction))}</td>
                      <td className="px-4 py-2 text-right text-red-600">{formatCurrency(n(row.pagibig_deduction))}</td>
                      <td className="px-4 py-2 text-right text-red-600">{formatCurrency(n(row.cash_advance_deduction))}</td>
                      <td className="px-4 py-2 text-right text-red-600">{formatCurrency(n(row.other_deductions))}</td>
                      <td className="px-4 py-2 text-right font-bold text-green-700">{formatCurrency(n(row.net_pay))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-semibold text-xs">
                  <tr>
                    <td className="px-4 py-2" colSpan={2}>TOTALS</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(regTotals.gross)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(regTotals.sss)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(regTotals.ph)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(regTotals.pi)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(regTotals.ca)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(regTotals.other)}</td>
                    <td className="px-4 py-2 text-right text-green-700">{formatCurrency(regTotals.net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {regCutoffId && !regLoading && regData.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
              No data. Click Generate to load the report.
            </div>
          )}
        </div>
      )}

      {/* Government Contributions */}
      {activeTab === 'contributions' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cutoff Period</label>
              <select
                value={contCutoffId}
                onChange={e => { setContCutoffId(e.target.value); setContData([]); }}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Select Cutoff --</option>
                {finalizedCutoffs.map(c => (
                  <option key={c.cutoff_id} value={c.cutoff_id}>{c.period_name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => loadContributions(contCutoffId)}
              disabled={!contCutoffId || contLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {contLoading ? 'Loading...' : 'Generate'}
            </button>
            {contData.length > 0 && (
              <>
                <button onClick={printContributions} className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                  <Printer className="w-4 h-4" /> Print
                </button>
                <button onClick={exportContributionsCsv} className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                  <Download className="w-4 h-4" /> CSV
                </button>
              </>
            )}
          </div>

          {contData.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Employee</th>
                    <th className="px-4 py-3 text-right">Basic Rate</th>
                    <th className="px-4 py-3 text-right">SSS</th>
                    <th className="px-4 py-3 text-right">PhilHealth</th>
                    <th className="px-4 py-3 text-right">PagIBIG</th>
                    <th className="px-4 py-3 text-right">Total Statutory</th>
                  </tr>
                </thead>
                <tbody>
                  {contData.map((row, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <span className="font-medium">{row.employee_name}</span>
                        <span className="block text-xs text-slate-400 font-mono">{row.employee_code}</span>
                      </td>
                      <td className="px-4 py-2 text-right">{formatCurrency(n(row.monthly_basic))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(n(row.sss_contribution))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(n(row.philhealth_contribution))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(n(row.pagibig_contribution))}</td>
                      <td className="px-4 py-2 text-right font-bold text-blue-700">{formatCurrency(n(row.total_statutory))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-semibold text-xs">
                  <tr>
                    <td className="px-4 py-2">TOTALS</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(contTotals.basic)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(contTotals.sss)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(contTotals.ph)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(contTotals.pi)}</td>
                    <td className="px-4 py-2 text-right text-blue-700">{formatCurrency(contTotals.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {contCutoffId && !contLoading && contData.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
              No data. Click Generate to load the report.
            </div>
          )}
        </div>
      )}

      {/* Attendance Summary */}
      {activeTab === 'attendance' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cutoff Period</label>
              <select
                value={attCutoffId}
                onChange={e => { setAttCutoffId(e.target.value); setAttData([]); }}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- Select Cutoff --</option>
                {cutoffs.map(c => (
                  <option key={c.cutoff_id} value={c.cutoff_id}>{c.period_name} ({c.status})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Employee (optional)</label>
              <select
                value={attEmployeeId}
                onChange={e => setAttEmployeeId(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Employees</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => loadAttendance(attCutoffId, attEmployeeId)}
              disabled={!attCutoffId || attLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {attLoading ? 'Loading...' : 'Generate'}
            </button>
            {attData.length > 0 && (
              <button onClick={exportAttendanceCsv} className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">
                <Download className="w-4 h-4" /> CSV
              </button>
            )}
          </div>

          {attData.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-3 text-left">Employee</th>
                    <th className="px-3 py-3 text-left">Date</th>
                    <th className="px-3 py-3 text-left">Time In</th>
                    <th className="px-3 py-3 text-left">Time Out</th>
                    <th className="px-3 py-3 text-right">Hours</th>
                    <th className="px-3 py-3 text-right">Late (min)</th>
                    <th className="px-3 py-3 text-right">OT Hrs</th>
                    <th className="px-3 py-3 text-center">Holiday</th>
                    <th className="px-3 py-3 text-center">Absent</th>
                  </tr>
                </thead>
                <tbody>
                  {attData.map((row, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <span className="font-medium">{row.employee_name}</span>
                        <span className="block text-xs text-slate-400 font-mono">{row.employee_code}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.attendance_date)}</td>
                      <td className="px-3 py-2">{row.time_in || '—'}</td>
                      <td className="px-3 py-2">{row.time_out || '—'}</td>
                      <td className="px-3 py-2 text-right">{n(row.hours_worked).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">{n(row.late_minutes)}</td>
                      <td className="px-3 py-2 text-right">{n(row.overtime_hours).toFixed(2)}</td>
                      <td className="px-3 py-2 text-center">
                        {row.is_holiday ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Yes</span> : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.is_absent ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Yes</span> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {attCutoffId && !attLoading && attData.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
              No attendance records. Click Generate to load.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
