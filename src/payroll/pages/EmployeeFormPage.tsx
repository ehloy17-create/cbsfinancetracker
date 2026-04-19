import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, ArrowLeft, History } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency, formatDate } from '../../lib/utils';

interface Department {
  id: string;
  name: string;
}

interface Position {
  id: string;
  department_id: string;
  name: string;
}

interface RateHistory {
  id: string;
  effective_date: string;
  old_monthly_rate: number;
  new_monthly_rate: number;
  reason: string;
  updated_by: string;
}

interface EmployeeForm {
  id: string | null;
  employee_code: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  gender: string;
  birthdate: string;
  civil_status: string;
  address: string;
  mobile: string;
  email: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  date_hired: string;
  employment_status: string;
  department_id: string;
  position_id: string;
  branch: string;
  is_active: boolean;
  payroll_type: string;
  basic_monthly_rate: string;
  daily_rate: string;
  hourly_rate: string;
  rest_day: string;
  tax_type: string;
  sss_number: string;
  philhealth_number: string;
  pagibig_number: string;
  tin: string;
  bank_account: string;
  payment_method: string;
  overtime_eligible: boolean;
  holiday_pay_eligible: boolean;
  fixed_allowance: string;
  notes: string;
}

const EMPTY_FORM: EmployeeForm = {
  id: null,
  employee_code: '',
  first_name: '',
  middle_name: '',
  last_name: '',
  gender: '',
  birthdate: '',
  civil_status: '',
  address: '',
  mobile: '',
  email: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  date_hired: '',
  employment_status: 'Regular',
  department_id: '',
  position_id: '',
  branch: '',
  is_active: true,
  payroll_type: 'Monthly',
  basic_monthly_rate: '',
  daily_rate: '',
  hourly_rate: '',
  rest_day: 'Sunday',
  tax_type: 'Taxable',
  sss_number: '',
  philhealth_number: '',
  pagibig_number: '',
  tin: '',
  bank_account: '',
  payment_method: 'Cash',
  overtime_eligible: true,
  holiday_pay_eligible: true,
  fixed_allowance: '',
  notes: '',
};

export default function EmployeeFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const { showToast } = useToast();

  const [form, setForm] = useState<EmployeeForm>(EMPTY_FORM);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [rateHistory, setRateHistory] = useState<RateHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const filteredPositions = form.department_id
    ? positions.filter(p => String(p.department_id) === String(form.department_id))
    : positions;

  useEffect(() => {
    const loadRef = async () => {
      const [deptRes, posRes] = await Promise.all([
        supabase.from('hr_departments').select('*').eq('is_active', 1).order('name'),
        supabase.from('hr_positions').select('*').eq('is_active', 1).order('name'),
      ]);
      if (deptRes.data) setDepartments(deptRes.data as Department[]);
      if (posRes.data) setPositions(posRes.data as Position[]);
    };
    loadRef();
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    const loadEmployee = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_employee', { employee_id: id });
        if (error) throw error;
        // get_employee returns { employee: {...}, rate_history: [...] }
        const result = data as { employee: Record<string, unknown>; rate_history: RateHistory[] } | null;
        const emp = result?.employee;
        if (!emp) throw new Error('Employee not found');
        setForm({
          id: String(emp.id ?? ''),
          employee_code: String(emp.employee_code ?? ''),
          first_name: String(emp.first_name ?? ''),
          middle_name: String(emp.middle_name ?? ''),
          last_name: String(emp.last_name ?? ''),
          gender: String(emp.gender ?? 'Male'),
          birthdate: String(emp.birthdate ?? '').slice(0, 10),
          civil_status: String(emp.civil_status ?? 'Single'),
          address: String(emp.address ?? ''),
          mobile: String(emp.mobile ?? ''),
          email: String(emp.email ?? ''),
          emergency_contact_name: String(emp.emergency_contact_name ?? ''),
          emergency_contact_phone: String(emp.emergency_contact_phone ?? ''),
          date_hired: String(emp.date_hired ?? '').slice(0, 10),
          employment_status: String(emp.employment_status ?? 'Regular'),
          department_id: emp.department_id ? String(emp.department_id) : '',
          position_id: emp.position_id ? String(emp.position_id) : '',
          branch: String(emp.branch ?? ''),
          is_active: emp.is_active === 1 || emp.is_active === true,
          payroll_type: String(emp.payroll_type ?? 'Monthly'),
          basic_monthly_rate: emp.basic_monthly_rate != null ? String(parseFloat(String(emp.basic_monthly_rate)) || 0) : '',
          daily_rate: emp.daily_rate != null ? String(parseFloat(String(emp.daily_rate)) || 0) : '',
          hourly_rate: emp.hourly_rate != null ? String(parseFloat(String(emp.hourly_rate)) || 0) : '',
          rest_day: String(emp.rest_day ?? 'Sunday'),
          tax_type: String(emp.tax_type ?? 'Taxable'),
          sss_number: String(emp.sss_number ?? ''),
          philhealth_number: String(emp.philhealth_number ?? ''),
          pagibig_number: String(emp.pagibig_number ?? ''),
          tin: String(emp.tin ?? ''),
          bank_account: String(emp.bank_account ?? ''),
          payment_method: String(emp.payment_method ?? 'Cash'),
          overtime_eligible: emp.overtime_eligible === 1 || emp.overtime_eligible === true,
          holiday_pay_eligible: emp.holiday_pay_eligible === 1 || emp.holiday_pay_eligible === true,
          fixed_allowance: emp.fixed_allowance != null ? String(parseFloat(String(emp.fixed_allowance)) || 0) : '',
          notes: String(emp.notes ?? ''),
        });
        if (Array.isArray(result?.rate_history)) {
          setRateHistory(result.rate_history);
        }
      } catch (err: unknown) {
        showToast((err as Error).message ?? 'Failed to load employee', 'error');
        navigate('/payroll/employees');
      } finally {
        setLoading(false);
      }
    };
    loadEmployee();
  }, [id, isEdit, navigate, showToast]);

  const set = (field: keyof EmployeeForm, value: unknown) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      showToast('First name and last name are required', 'error');
      return;
    }
    if (!form.employee_code.trim()) {
      showToast('Employee code is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        department_id: form.department_id || null,
        position_id: form.position_id || null,
        basic_monthly_rate: parseFloat(form.basic_monthly_rate) || 0,
        daily_rate: parseFloat(form.daily_rate) || 0,
        hourly_rate: parseFloat(form.hourly_rate) || 0,
        fixed_allowance: parseFloat(form.fixed_allowance) || 0,
        is_active: form.is_active ? 1 : 0,
        overtime_eligible: form.overtime_eligible ? 1 : 0,
        holiday_pay_eligible: form.holiday_pay_eligible ? 1 : 0,
        birthdate: form.birthdate || null,
        date_hired: form.date_hired || null,
      };
      const { error } = await supabase.rpc('save_employee', { employee: payload, updated_by: 'admin' });
      if (error) throw error;
      showToast(`Employee ${isEdit ? 'updated' : 'created'} successfully`, 'success');
      navigate('/payroll/employees');
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to save employee', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/payroll/employees')}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">
                {isEdit ? 'Edit Employee' : 'New Employee'}
              </h1>
              {isEdit && (
                <p className="text-sm text-slate-500 mt-0.5">{form.employee_code}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/payroll/employees')}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save Employee'}
            </button>
          </div>
        </div>

        {/* Section A: Personal Info */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4 border-b pb-2">
            Personal Information
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Employee Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.employee_code}
                onChange={e => set('employee_code', e.target.value)}
                readOnly={isEdit}
                className={`w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${isEdit ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`}
                placeholder="e.g. EMP-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Date Hired</label>
              <input
                type="date"
                value={form.date_hired}
                onChange={e => set('date_hired', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.first_name}
                onChange={e => set('first_name', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Middle Name</label>
              <input
                type="text"
                value={form.middle_name}
                onChange={e => set('middle_name', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.last_name}
                onChange={e => set('last_name', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Gender</label>
              <select
                value={form.gender}
                onChange={e => set('gender', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select…</option>
                <option>Male</option>
                <option>Female</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Birthdate</label>
              <input
                type="date"
                value={form.birthdate}
                onChange={e => set('birthdate', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Civil Status</label>
              <select
                value={form.civil_status}
                onChange={e => set('civil_status', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select…</option>
                <option>Single</option>
                <option>Married</option>
                <option>Widowed</option>
                <option>Separated</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
            <textarea
              rows={2}
              value={form.address}
              onChange={e => set('address', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Mobile</label>
              <input
                type="text"
                value={form.mobile}
                onChange={e => set('mobile', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Emergency Contact Name</label>
              <input
                type="text"
                value={form.emergency_contact_name}
                onChange={e => set('emergency_contact_name', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Emergency Contact Phone</label>
              <input
                type="text"
                value={form.emergency_contact_phone}
                onChange={e => set('emergency_contact_phone', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Employment Status</label>
              <select
                value={form.employment_status}
                onChange={e => set('employment_status', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>Regular</option>
                <option>Probationary</option>
                <option>Contractual</option>
                <option>Part-time</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Branch</label>
              <input
                type="text"
                value={form.branch}
                onChange={e => set('branch', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Department</label>
              <select
                value={form.department_id}
                onChange={e => { set('department_id', e.target.value); set('position_id', ''); }}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select Department…</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Position</label>
              <select
                value={form.position_id}
                onChange={e => set('position_id', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select Position…</option>
                {filteredPositions.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={form.is_active}
              onChange={e => set('is_active', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="is_active" className="text-sm font-medium text-slate-700">Active</label>
          </div>
        </div>

        {/* Section B: Payroll Info */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4 border-b pb-2">
            Payroll Information
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Payroll Type</label>
              <select
                value={form.payroll_type}
                onChange={e => set('payroll_type', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>Monthly</option>
                <option>Daily</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tax Type</label>
              <select
                value={form.tax_type}
                onChange={e => set('tax_type', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>Taxable</option>
                <option>Non-taxable</option>
                <option>Minimum Wage</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Basic Monthly Rate</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.basic_monthly_rate}
                onChange={e => set('basic_monthly_rate', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Daily Rate</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.daily_rate}
                onChange={e => set('daily_rate', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
              <p className="text-xs text-slate-400 mt-1">Leave 0 to auto-compute from monthly ÷ 26</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Hourly Rate</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.hourly_rate}
                onChange={e => set('hourly_rate', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Rest Day</label>
              <select
                value={form.rest_day}
                onChange={e => set('rest_day', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(d => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Fixed Allowance</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.fixed_allowance}
                onChange={e => set('fixed_allowance', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
              <select
                value={form.payment_method}
                onChange={e => set('payment_method', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>Cash</option>
                <option>ATM</option>
                <option>Bank</option>
                <option>GCash</option>
                <option>Check</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Bank Account</label>
              <input
                type="text"
                value={form.bank_account}
                onChange={e => set('bank_account', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">SSS Number</label>
              <input
                type="text"
                value={form.sss_number}
                onChange={e => set('sss_number', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">PhilHealth Number</label>
              <input
                type="text"
                value={form.philhealth_number}
                onChange={e => set('philhealth_number', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Pag-IBIG Number</label>
              <input
                type="text"
                value={form.pagibig_number}
                onChange={e => set('pagibig_number', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">TIN</label>
              <input
                type="text"
                value={form.tin}
                onChange={e => set('tin', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="overtime_eligible"
                checked={form.overtime_eligible}
                onChange={e => set('overtime_eligible', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="overtime_eligible" className="text-sm font-medium text-slate-700">Overtime Eligible</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="holiday_pay_eligible"
                checked={form.holiday_pay_eligible}
                onChange={e => set('holiday_pay_eligible', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="holiday_pay_eligible" className="text-sm font-medium text-slate-700">Holiday Pay Eligible</label>
            </div>
          </div>
        </div>

        {/* Section C: Other Info */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4 border-b pb-2">
            Other Information
          </h3>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              rows={4}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Any additional notes about the employee…"
            />
          </div>
        </div>

        {/* Rate History (edit only) */}
        {isEdit && (
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4 border-b pb-2 flex items-center gap-2">
              <History className="w-4 h-4" />
              Rate History
            </h3>
            {rateHistory.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No rate history recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Effective Date</th>
                      <th className="px-4 py-2 text-right">Old Rate</th>
                      <th className="px-4 py-2 text-right">New Rate</th>
                      <th className="px-4 py-2 text-left">Reason</th>
                      <th className="px-4 py-2 text-left">Updated By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rateHistory.map(h => (
                      <tr key={h.id} className="border-b border-slate-100">
                        <td className="px-4 py-2">{formatDate(h.effective_date)}</td>
                        <td className="px-4 py-2 text-right text-slate-500">{formatCurrency(parseFloat(String(h.old_monthly_rate)) || 0)}</td>
                        <td className="px-4 py-2 text-right font-medium text-slate-800">{formatCurrency(parseFloat(String(h.new_monthly_rate)) || 0)}</td>
                        <td className="px-4 py-2 text-slate-600">{h.reason ?? '—'}</td>
                        <td className="px-4 py-2 text-slate-600">{h.updated_by ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Bottom Save */}
        <div className="flex justify-end gap-2 pb-6">
          <button
            onClick={() => navigate('/payroll/employees')}
            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Employee'}
          </button>
        </div>
      </div>
    </div>
  );
}
