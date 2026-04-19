import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Printer, ArrowLeft, FileText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useCompanySettings } from '../../contexts/CompanySettingsContext';
import { resolveApiBase } from '../../lib/apiBase';

interface PayslipLine {
  line_id: string;
  line_type: 'Earning' | 'Deduction';
  description: string;
  amount: number;
  sort_order: number;
}

interface PayslipData {
  run_item_id: string;
  employee_code: string;
  employee_name: string;
  department: string;
  position: string;
  employment_type: string;
  sss_number: string;
  philhealth_number: string;
  pagibig_number: string;
  period_name: string;
  date_from: string;
  date_to: string;
  days_in_period: number;
  days_worked: number;
  absent_days: number;
  overtime_hours: number;
  basic_pay: number;
  overtime_pay: number;
  holiday_pay: number;
  allowances: number;
  gross_pay: number;
  sss_deduction: number;
  philhealth_deduction: number;
  pagibig_deduction: number;
  cash_advance_deduction: number;
  late_deduction: number;
  other_deductions: number;
  total_deductions: number;
  net_pay: number;
  run_status: string;
  lines: PayslipLine[];
}

function n(val: unknown): number {
  return parseFloat(val as string) || 0;
}

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

export default function PayslipPrintPage() {
  const { runItemId } = useParams<{ runItemId: string }>();
  const navigate = useNavigate();
  const { settings: companySettings } = useCompanySettings();
  const apiBase = resolveApiBase();
  const logoSrc = companySettings.logo_url
    ? companySettings.logo_url.startsWith('http') ? companySettings.logo_url : `${apiBase}${companySettings.logo_url}`
    : null;
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [payslip, setPayslip] = useState<PayslipData | null>(null);

  useEffect(() => {
    if (runItemId) loadPayslip(runItemId);
  }, [runItemId]);

  async function loadPayslip(id: string) {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_payslip', { run_item_id: id });
      if (error || !data) {
        showToast('Failed to load payslip', 'error');
        return;
      }
      setPayslip(data as PayslipData);
    } finally {
      setLoading(false);
    }
  }

  function handlePrintClick() {
    if (!payslip) return;
    const earnings = (payslip.lines || []).filter(l => l.line_type === 'Earning');
    const deductions = (payslip.lines || []).filter(l => l.line_type === 'Deduction');

    const earningsRows = earnings.length > 0
      ? earnings.map(l => `<div class="payslip-row"><span>${l.description}</span><span>${formatCurrency(n(l.amount))}</span></div>`).join('')
      : [
          { label: 'Basic Pay', val: payslip.basic_pay },
          { label: 'Overtime Pay', val: payslip.overtime_pay },
          { label: 'Holiday Pay', val: payslip.holiday_pay },
          { label: 'Allowances', val: payslip.allowances },
        ].map(r => `<div class="payslip-row"><span>${r.label}</span><span>${formatCurrency(n(r.val))}</span></div>`).join('');

    const deductionRows = deductions.length > 0
      ? deductions.map(l => `<div class="payslip-row"><span>${l.description}</span><span>${formatCurrency(n(l.amount))}</span></div>`).join('')
      : [
          { label: 'SSS Contribution', val: payslip.sss_deduction },
          { label: 'PhilHealth Contribution', val: payslip.philhealth_deduction },
          { label: 'Pag-IBIG Contribution', val: payslip.pagibig_deduction },
          { label: 'Cash Advance', val: payslip.cash_advance_deduction },
          { label: 'Late/Tardiness', val: payslip.late_deduction },
          { label: 'Other Deductions', val: payslip.other_deductions },
        ].map(r => `<div class="payslip-row"><span>${r.label}</span><span>${formatCurrency(n(r.val))}</span></div>`).join('');

    const companyNameHtml = companySettings.company_name || 'My Business';
    const logoHtml = (companySettings.show_logo_in_reports && logoSrc)
      ? `<div style="text-align:center;margin-bottom:6px;"><img src="${logoSrc}" alt="Logo" style="max-height:50px;object-fit:contain;" /></div>`
      : '';
    const footerHtml = companySettings.payslip_footer_notes
      ? `<div style="margin-top:14px;padding:8px;border-top:1px solid #ddd;font-size:11px;color:#555;text-align:center;">${companySettings.payslip_footer_notes}</div>`
      : '';

    const html = `
      <div class="payslip-header">
        ${logoHtml}
        <h2 style="margin:0;font-size:16px;">${companyNameHtml}</h2>
        ${companySettings.company_address ? `<p style="margin:2px 0;font-size:11px;color:#555;">${companySettings.company_address}</p>` : ''}
        ${companySettings.contact_number ? `<p style="margin:2px 0;font-size:11px;color:#555;">${companySettings.contact_number}</p>` : ''}
        <h3 style="margin:4px 0 0;font-size:14px;">PAYSLIP</h3>
        <p style="margin:4px 0 0;font-size:12px;">${payslip.period_name}</p>
        <p style="margin:2px 0 0;font-size:11px;color:#555;">${formatDate(payslip.date_from)} – ${formatDate(payslip.date_to)}</p>
      </div>
      <div style="border:1px solid #ddd;padding:10px;margin-bottom:12px;">
        <div class="payslip-row"><span><strong>Employee:</strong> ${payslip.employee_name}</span><span><strong>Code:</strong> ${payslip.employee_code}</span></div>
        <div class="payslip-row"><span><strong>Department:</strong> ${payslip.department || '—'}</span><span><strong>Position:</strong> ${payslip.position || '—'}</span></div>
        <div class="payslip-row"><span><strong>Type:</strong> ${payslip.employment_type || '—'}</span></div>
        <div class="payslip-row"><span><strong>SSS:</strong> ${payslip.sss_number || '—'}</span><span><strong>PhilHealth:</strong> ${payslip.philhealth_number || '—'}</span><span><strong>Pag-IBIG:</strong> ${payslip.pagibig_number || '—'}</span></div>
      </div>
      <div style="display:flex;gap:20px;">
        <div style="flex:1;">
          <div class="payslip-section">
            <h4>Earnings</h4>
            ${earningsRows}
            <div class="payslip-row total-row"><span>GROSS PAY</span><span>${formatCurrency(n(payslip.gross_pay))}</span></div>
          </div>
        </div>
        <div style="flex:1;">
          <div class="payslip-section">
            <h4>Deductions</h4>
            ${deductionRows}
            <div class="payslip-row total-row"><span>TOTAL DEDUCTIONS</span><span>${formatCurrency(n(payslip.total_deductions))}</span></div>
          </div>
        </div>
      </div>
      <div style="border:2px solid #333;padding:10px;text-align:right;font-size:14px;font-weight:bold;margin-top:8px;">
        NET PAY: ${formatCurrency(n(payslip.net_pay))}
      </div>
      <div style="border:1px solid #eee;padding:8px;margin-top:10px;font-size:11px;color:#555;">
        Days in Period: ${payslip.days_in_period ?? '—'} &nbsp;|&nbsp;
        Days Worked: ${payslip.days_worked ?? '—'} &nbsp;|&nbsp;
        Absent: ${payslip.absent_days ?? 0} &nbsp;|&nbsp;
        OT Hours: ${payslip.overtime_hours ?? 0}
      </div>
      ${footerHtml}
    `;
    handlePrint(`Payslip – ${payslip.employee_name}`, html);
  }

  if (loading) {
    return (
      <div className="p-10 text-center text-slate-400 text-sm">Loading payslip...</div>
    );
  }

  if (!payslip) {
    return (
      <div className="p-10 text-center">
        <p className="text-slate-500 text-sm mb-4">Payslip not found.</p>
        <button onClick={() => navigate(-1)} className="text-sm text-blue-600 hover:underline">Go back</button>
      </div>
    );
  }

  const earnings = (payslip.lines || []).filter(l => l.line_type === 'Earning');
  const deductions = (payslip.lines || []).filter(l => l.line_type === 'Deduction');

  const earningRows = earnings.length > 0 ? earnings : [
    { description: 'Basic Pay', amount: payslip.basic_pay },
    { description: 'Overtime Pay', amount: payslip.overtime_pay },
    { description: 'Holiday Pay', amount: payslip.holiday_pay },
    { description: 'Allowances', amount: payslip.allowances },
  ];

  const deductionRows = deductions.length > 0 ? deductions : [
    { description: 'SSS Contribution', amount: payslip.sss_deduction },
    { description: 'PhilHealth Contribution', amount: payslip.philhealth_deduction },
    { description: 'Pag-IBIG Contribution', amount: payslip.pagibig_deduction },
    { description: 'Cash Advance', amount: payslip.cash_advance_deduction },
    { description: 'Late/Tardiness', amount: payslip.late_deduction },
    { description: 'Other Deductions', amount: payslip.other_deductions },
  ];

  function statusBadge(status: string) {
    if (status === 'Finalized') return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Finalized</span>;
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Draft</span>;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-800"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2">
          {statusBadge(payslip.run_status)}
          <button
            onClick={handlePrintClick}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      {/* Payslip Card */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-slate-800 text-white text-center py-5 px-6">
          <div className="flex items-center justify-center gap-2 mb-1">
            {logoSrc && companySettings.show_logo_in_reports ? (
              <img src={logoSrc} alt="Logo" className="h-8 object-contain" />
            ) : (
              <FileText className="w-5 h-5 opacity-70" />
            )}
            <span className="text-base font-semibold">{companySettings.company_name || 'My Business'}</span>
          </div>
          <h2 className="text-lg font-bold tracking-wide">PAYSLIP</h2>
          <p className="text-sm opacity-80 mt-1">{payslip.period_name}</p>
          <p className="text-xs opacity-60">{formatDate(payslip.date_from)} – {formatDate(payslip.date_to)}</p>
        </div>

        {/* Employee Info */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div><span className="text-slate-500">Employee:</span> <span className="font-semibold">{payslip.employee_name}</span></div>
          <div><span className="text-slate-500">Code:</span> <span className="font-mono">{payslip.employee_code}</span></div>
          <div><span className="text-slate-500">Department:</span> {payslip.department || '—'}</div>
          <div><span className="text-slate-500">Position:</span> {payslip.position || '—'}</div>
          <div><span className="text-slate-500">Type:</span> {payslip.employment_type || '—'}</div>
          <div />
          <div><span className="text-slate-500">SSS:</span> {payslip.sss_number || '—'}</div>
          <div><span className="text-slate-500">PhilHealth:</span> {payslip.philhealth_number || '—'}</div>
          <div><span className="text-slate-500">Pag-IBIG:</span> {payslip.pagibig_number || '—'}</div>
        </div>

        {/* Earnings & Deductions */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
          {/* Earnings */}
          <div className="px-6 py-4">
            <h3 className="text-xs font-semibold uppercase text-slate-500 border-b border-slate-200 pb-2 mb-3">Earnings</h3>
            <div className="space-y-1.5 text-sm">
              {earningRows.map((row, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-slate-600">{row.description}</span>
                  <span>{formatCurrency(n(row.amount))}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm font-bold mt-3 pt-2 border-t border-slate-300">
              <span>GROSS PAY</span>
              <span className="text-green-700">{formatCurrency(n(payslip.gross_pay))}</span>
            </div>
          </div>

          {/* Deductions */}
          <div className="px-6 py-4">
            <h3 className="text-xs font-semibold uppercase text-slate-500 border-b border-slate-200 pb-2 mb-3">Deductions</h3>
            <div className="space-y-1.5 text-sm">
              {deductionRows.map((row, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-slate-600">{row.description}</span>
                  <span className="text-red-600">{formatCurrency(n(row.amount))}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm font-bold mt-3 pt-2 border-t border-slate-300">
              <span>TOTAL DEDUCTIONS</span>
              <span className="text-red-700">{formatCurrency(n(payslip.total_deductions))}</span>
            </div>
          </div>
        </div>

        {/* Net Pay */}
        <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center">
          <span className="text-sm font-semibold tracking-wide">NET PAY</span>
          <span className="text-2xl font-bold">{formatCurrency(n(payslip.net_pay))}</span>
        </div>

        {/* Attendance Summary */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <span>Days in Period: <strong className="text-slate-700">{payslip.days_in_period ?? '—'}</strong></span>
          <span>Days Worked: <strong className="text-slate-700">{payslip.days_worked ?? '—'}</strong></span>
          <span>Absent: <strong className="text-slate-700">{payslip.absent_days ?? 0}</strong></span>
          <span>OT Hours: <strong className="text-slate-700">{payslip.overtime_hours ?? 0}</strong></span>
        </div>
      </div>
    </div>
  );
}
