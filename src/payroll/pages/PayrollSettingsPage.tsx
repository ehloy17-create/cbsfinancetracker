import { useState, useEffect } from 'react';
import { Settings, Edit2, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency } from '../../lib/utils';
import InvModal from '../../inventory/components/InvModal';

type Tab = 'sss' | 'philhealth' | 'pagibig' | 'types';

interface SSSRow {
  id: number;
  range_from: number;
  range_to: number;
  monthly_salary_credit: number;
  employee_share: number;
  employer_share: number;
  total_contribution: number;
  is_active: number;
}

interface PhilHealthRow {
  id: number;
  year: number;
  rate_percent: number;
  min_monthly_basic: number;
  max_monthly_basic: number;
  min_contribution: number;
  max_contribution: number;
  employee_share_percent: number;
}

interface PagIBIGRow {
  id: number;
  year: number;
  employee_rate_percent: number;
  employer_rate_percent: number;
  max_employee_contribution: number;
  max_employer_contribution: number;
}

interface EarningType {
  id: number;
  code: string;
  name: string;
  is_taxable: number;
  is_system: number;
  sort_order: number;
  is_active: number;
}

interface DeductionType {
  id: number;
  code: string;
  name: string;
  is_statutory: number;
  is_system: number;
  sort_order: number;
  is_active: number;
}

function n(v: unknown): number { return parseFloat(v as string) || 0; }

export default function PayrollSettingsPage() {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('sss');

  // SSS
  const [sssRows, setSssRows] = useState<SSSRow[]>([]);
  const [sssLoading, setSssLoading] = useState(false);
  const [sssEdit, setSssEdit] = useState<SSSRow | null>(null);
  const [sssForm, setSssForm] = useState({ monthly_salary_credit: '', employee_share: '', employer_share: '' });
  const [sssSaving, setSssSaving] = useState(false);

  // PhilHealth
  const [ph, setPh] = useState<PhilHealthRow | null>(null);
  const [phForm, setPhForm] = useState<Partial<PhilHealthRow>>({});
  const [phSaving, setPhSaving] = useState(false);

  // PagIBIG
  const [pi, setPi] = useState<PagIBIGRow | null>(null);
  const [piForm, setPiForm] = useState<Partial<PagIBIGRow>>({});
  const [piSaving, setPiSaving] = useState(false);

  // Types
  const [earningTypes, setEarningTypes] = useState<EarningType[]>([]);
  const [deductionTypes, setDeductionTypes] = useState<DeductionType[]>([]);
  const [etModal, setEtModal] = useState(false);
  const [dtModal, setDtModal] = useState(false);
  const [etEdit, setEtEdit] = useState<EarningType | null>(null);
  const [dtEdit, setDtEdit] = useState<DeductionType | null>(null);
  const [etForm, setEtForm] = useState({ code: '', name: '', is_taxable: 1, sort_order: 0, is_active: 1 });
  const [dtForm, setDtForm] = useState({ code: '', name: '', is_statutory: 0, sort_order: 0, is_active: 1 });
  const [typeSaving, setTypeSaving] = useState(false);

  useEffect(() => {
    if (activeTab === 'sss') loadSSS();
    else if (activeTab === 'philhealth') loadPhilHealth();
    else if (activeTab === 'pagibig') loadPagIBIG();
    else if (activeTab === 'types') loadTypes();
  }, [activeTab]);

  async function loadSSS() {
    setSssLoading(true);
    const { data } = await supabase.from('sss_table').select('*').eq('is_active', 1).order('range_from', { ascending: true });
    setSssRows((data || []) as SSSRow[]);
    setSssLoading(false);
  }

  async function loadPhilHealth() {
    const { data } = await supabase.from('philhealth_table').select('*').order('year', { ascending: false }).limit(1);
    const row = (data || [])[0] as PhilHealthRow | undefined;
    if (row) { setPh(row); setPhForm(row); }
  }

  async function loadPagIBIG() {
    const { data } = await supabase.from('pagibig_table').select('*').order('year', { ascending: false }).limit(1);
    const row = (data || [])[0] as PagIBIGRow | undefined;
    if (row) { setPi(row); setPiForm(row); }
  }

  async function loadTypes() {
    const [et, dt] = await Promise.all([
      supabase.from('payroll_earnings_types').select('*').order('sort_order', { ascending: true }),
      supabase.from('payroll_deduction_types').select('*').order('sort_order', { ascending: true }),
    ]);
    setEarningTypes((et.data || []) as EarningType[]);
    setDeductionTypes((dt.data || []) as DeductionType[]);
  }

  // SSS Edit
  function openSssEdit(row: SSSRow) {
    setSssEdit(row);
    setSssForm({
      monthly_salary_credit: String(row.monthly_salary_credit),
      employee_share: String(row.employee_share),
      employer_share: String(row.employer_share),
    });
  }

  async function saveSss() {
    if (!sssEdit) return;
    setSssSaving(true);
    const { error } = await supabase.from('sss_table').update({
      monthly_salary_credit: n(sssForm.monthly_salary_credit),
      employee_share: n(sssForm.employee_share),
      employer_share: n(sssForm.employer_share),
    }).eq('id', sssEdit.id);
    setSssSaving(false);
    if (error) { showToast('Save failed', 'error'); return; }
    showToast('SSS row updated', 'success');
    setSssEdit(null);
    loadSSS();
  }

  // PhilHealth Save
  async function savePhilHealth() {
    if (!ph) return;
    setPhSaving(true);
    const { error } = await supabase.from('philhealth_table').update({
      rate_percent: n(phForm.rate_percent),
      min_monthly_basic: n(phForm.min_monthly_basic),
      max_monthly_basic: n(phForm.max_monthly_basic),
      min_contribution: n(phForm.min_contribution),
      max_contribution: n(phForm.max_contribution),
      employee_share_percent: n(phForm.employee_share_percent),
    }).eq('id', ph.id);
    setPhSaving(false);
    if (error) { showToast('Save failed', 'error'); return; }
    showToast('PhilHealth settings saved', 'success');
  }

  // PagIBIG Save
  async function savePagIBIG() {
    if (!pi) return;
    setPiSaving(true);
    const { error } = await supabase.from('pagibig_table').update({
      employee_rate_percent: n(piForm.employee_rate_percent),
      employer_rate_percent: n(piForm.employer_rate_percent),
      max_employee_contribution: n(piForm.max_employee_contribution),
      max_employer_contribution: n(piForm.max_employer_contribution),
    }).eq('id', pi.id);
    setPiSaving(false);
    if (error) { showToast('Save failed', 'error'); return; }
    showToast('Pag-IBIG settings saved', 'success');
  }

  // Earning Types
  function openEtAdd() { setEtEdit(null); setEtForm({ code: '', name: '', is_taxable: 1, sort_order: 0, is_active: 1 }); setEtModal(true); }
  function openEtEdit(row: EarningType) { setEtEdit(row); setEtForm({ code: row.code, name: row.name, is_taxable: row.is_taxable, sort_order: row.sort_order, is_active: row.is_active }); setEtModal(true); }
  async function saveEt() {
    setTypeSaving(true);
    if (etEdit) {
      const { error } = await supabase.from('payroll_earnings_types').update(etForm).eq('id', etEdit.id);
      if (error) { showToast('Save failed', 'error'); setTypeSaving(false); return; }
    } else {
      const { error } = await supabase.from('payroll_earnings_types').insert({ ...etForm, is_system: 0 });
      if (error) { showToast('Save failed', 'error'); setTypeSaving(false); return; }
    }
    setTypeSaving(false);
    showToast('Earning type saved', 'success');
    setEtModal(false);
    loadTypes();
  }

  // Deduction Types
  function openDtAdd() { setDtEdit(null); setDtForm({ code: '', name: '', is_statutory: 0, sort_order: 0, is_active: 1 }); setDtModal(true); }
  function openDtEdit(row: DeductionType) { setDtEdit(row); setDtForm({ code: row.code, name: row.name, is_statutory: row.is_statutory, sort_order: row.sort_order, is_active: row.is_active }); setDtModal(true); }
  async function saveDt() {
    setTypeSaving(true);
    if (dtEdit) {
      const { error } = await supabase.from('payroll_deduction_types').update(dtForm).eq('id', dtEdit.id);
      if (error) { showToast('Save failed', 'error'); setTypeSaving(false); return; }
    } else {
      const { error } = await supabase.from('payroll_deduction_types').insert({ ...dtForm, is_system: 0 });
      if (error) { showToast('Save failed', 'error'); setTypeSaving(false); return; }
    }
    setTypeSaving(false);
    showToast('Deduction type saved', 'success');
    setDtModal(false);
    loadTypes();
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'sss', label: 'SSS Table' },
    { key: 'philhealth', label: 'PhilHealth' },
    { key: 'pagibig', label: 'Pag-IBIG' },
    { key: 'types', label: 'Earnings & Deductions' },
  ];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800">Payroll Settings</h1>
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

      {/* SSS Table */}
      {activeTab === 'sss' && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">SSS Contribution Table</h2>
            <p className="text-xs text-slate-400 mt-0.5">Rates based on 2024 SSS contribution schedule</p>
          </div>
          {sssLoading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-right">Range From</th>
                    <th className="px-4 py-3 text-right">Range To</th>
                    <th className="px-4 py-3 text-right">Monthly Salary Credit</th>
                    <th className="px-4 py-3 text-right">Employee Share</th>
                    <th className="px-4 py-3 text-right">Employer Share</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {sssRows.map(row => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 text-right">{formatCurrency(n(row.range_from))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(n(row.range_to))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(n(row.monthly_salary_credit))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(n(row.employee_share))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(n(row.employer_share))}</td>
                      <td className="px-4 py-2 text-right font-medium">{formatCurrency(n(row.employee_share) + n(row.employer_share))}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => openSssEdit(row)} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
                          <Edit2 className="w-3 h-3" /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* PhilHealth */}
      {activeTab === 'philhealth' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">PhilHealth Settings</h2>
          {!ph ? (
            <p className="text-sm text-slate-400">No PhilHealth settings found.</p>
          ) : (
            <div className="space-y-3">
              {[
                { label: 'Year', key: 'year' as keyof PhilHealthRow, type: 'number' },
                { label: 'Rate (%)', key: 'rate_percent' as keyof PhilHealthRow, type: 'number' },
                { label: 'Min Monthly Basic', key: 'min_monthly_basic' as keyof PhilHealthRow, type: 'number' },
                { label: 'Max Monthly Basic', key: 'max_monthly_basic' as keyof PhilHealthRow, type: 'number' },
                { label: 'Min Contribution', key: 'min_contribution' as keyof PhilHealthRow, type: 'number' },
                { label: 'Max Contribution', key: 'max_contribution' as keyof PhilHealthRow, type: 'number' },
                { label: 'Employee Share (%)', key: 'employee_share_percent' as keyof PhilHealthRow, type: 'number' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{f.label}</label>
                  <input
                    type={f.type}
                    value={phForm[f.key] ?? ''}
                    onChange={e => setPhForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              <button
                onClick={savePhilHealth}
                disabled={phSaving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
              >
                {phSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* PagIBIG */}
      {activeTab === 'pagibig' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Pag-IBIG Settings</h2>
          {!pi ? (
            <p className="text-sm text-slate-400">No Pag-IBIG settings found.</p>
          ) : (
            <div className="space-y-3">
              {[
                { label: 'Year', key: 'year' as keyof PagIBIGRow },
                { label: 'Employee Rate (%)', key: 'employee_rate_percent' as keyof PagIBIGRow },
                { label: 'Employer Rate (%)', key: 'employer_rate_percent' as keyof PagIBIGRow },
                { label: 'Max Employee Contribution', key: 'max_employee_contribution' as keyof PagIBIGRow },
                { label: 'Max Employer Contribution', key: 'max_employer_contribution' as keyof PagIBIGRow },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{f.label}</label>
                  <input
                    type="number"
                    value={piForm[f.key] ?? ''}
                    onChange={e => setPiForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              <button
                onClick={savePagIBIG}
                disabled={piSaving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
              >
                {piSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Earnings & Deductions Types */}
      {activeTab === 'types' && (
        <div className="space-y-6">
          {/* Earnings */}
          <div className="bg-white rounded-xl border border-slate-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">Earnings Types</h2>
              <button onClick={openEtAdd} className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700">
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Code</th>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Taxable</th>
                    <th className="px-4 py-3 text-left">System</th>
                    <th className="px-4 py-3 text-left">Active</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {earningTypes.map(row => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-xs">{row.code}</td>
                      <td className="px-4 py-2">{row.name}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.is_taxable ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {row.is_taxable ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {row.is_system ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">System</span> : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {row.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {!row.is_system && (
                          <button onClick={() => openEtEdit(row)} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
                            <Edit2 className="w-3 h-3" /> Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Deductions */}
          <div className="bg-white rounded-xl border border-slate-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">Deduction Types</h2>
              <button onClick={openDtAdd} className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700">
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Code</th>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Statutory</th>
                    <th className="px-4 py-3 text-left">System</th>
                    <th className="px-4 py-3 text-left">Active</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {deductionTypes.map(row => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-xs">{row.code}</td>
                      <td className="px-4 py-2">{row.name}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.is_statutory ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                          {row.is_statutory ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {row.is_system ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">System</span> : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {row.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {!row.is_system && (
                          <button onClick={() => openDtEdit(row)} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">
                            <Edit2 className="w-3 h-3" /> Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SSS Edit Modal */}
      <InvModal open={!!sssEdit} onClose={() => setSssEdit(null)} title="Edit SSS Bracket" size="sm">
        <div className="p-4 space-y-3">
          {sssEdit && (
            <p className="text-xs text-slate-500">
              Range: {formatCurrency(n(sssEdit.range_from))} – {formatCurrency(n(sssEdit.range_to))}
            </p>
          )}
          {[
            { label: 'Monthly Salary Credit', key: 'monthly_salary_credit' as keyof typeof sssForm },
            { label: 'Employee Share', key: 'employee_share' as keyof typeof sssForm },
            { label: 'Employer Share', key: 'employer_share' as keyof typeof sssForm },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-slate-600 mb-1">{f.label}</label>
              <input
                type="number"
                value={sssForm[f.key]}
                onChange={e => setSssForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setSssEdit(null)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={saveSss} disabled={sssSaving} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {sssSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </InvModal>

      {/* Earning Type Modal */}
      <InvModal open={etModal} onClose={() => setEtModal(false)} title={etEdit ? 'Edit Earning Type' : 'Add Earning Type'} size="sm">
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Code</label>
            <input value={etForm.code} onChange={e => setEtForm(p => ({ ...p, code: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
            <input value={etForm.name} onChange={e => setEtForm(p => ({ ...p, name: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Taxable</label>
            <select value={etForm.is_taxable} onChange={e => setEtForm(p => ({ ...p, is_taxable: Number(e.target.value) }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value={1}>Yes</option>
              <option value={0}>No</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Sort Order</label>
            <input type="number" value={etForm.sort_order} onChange={e => setEtForm(p => ({ ...p, sort_order: Number(e.target.value) }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Active</label>
            <select value={etForm.is_active} onChange={e => setEtForm(p => ({ ...p, is_active: Number(e.target.value) }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value={1}>Yes</option>
              <option value={0}>No</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setEtModal(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={saveEt} disabled={typeSaving} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {typeSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </InvModal>

      {/* Deduction Type Modal */}
      <InvModal open={dtModal} onClose={() => setDtModal(false)} title={dtEdit ? 'Edit Deduction Type' : 'Add Deduction Type'} size="sm">
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Code</label>
            <input value={dtForm.code} onChange={e => setDtForm(p => ({ ...p, code: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
            <input value={dtForm.name} onChange={e => setDtForm(p => ({ ...p, name: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Statutory</label>
            <select value={dtForm.is_statutory} onChange={e => setDtForm(p => ({ ...p, is_statutory: Number(e.target.value) }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value={1}>Yes</option>
              <option value={0}>No</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Sort Order</label>
            <input type="number" value={dtForm.sort_order} onChange={e => setDtForm(p => ({ ...p, sort_order: Number(e.target.value) }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Active</label>
            <select value={dtForm.is_active} onChange={e => setDtForm(p => ({ ...p, is_active: Number(e.target.value) }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value={1}>Yes</option>
              <option value={0}>No</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setDtModal(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={saveDt} disabled={typeSaving} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60">
              {typeSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </InvModal>
    </div>
  );
}
