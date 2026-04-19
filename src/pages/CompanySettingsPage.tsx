import { useState, useEffect, useRef } from 'react';
import { Save, Upload, Building2, Printer, Info, Eye, EyeOff } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { useCompanySettings } from '../contexts/CompanySettingsContext';
import { saveCompanySettings, CompanySettings } from '../lib/companySettings';
import { resolveApiBase } from '../lib/apiBase';

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800 mb-5">
        <Icon className="w-5 h-5 text-blue-600" />
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
const textareaClass = `${inputClass} resize-none`;

export default function CompanySettingsPage() {
  const { settings, refresh } = useCompanySettings();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<CompanySettings>(settings);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showLogo, setShowLogo] = useState(true);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  function set<K extends keyof CompanySettings>(key: K, value: CompanySettings[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.company_name.trim()) {
      showToast('Company Name is required', 'warning');
      return;
    }
    setSaving(true);
    try {
      await saveCompanySettings({ ...form, id: 1 });
      await refresh();
      showToast('Settings saved successfully', 'success');
    } catch (e: unknown) {
      showToast((e as Error).message || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      showToast('Logo must be under 5 MB', 'warning');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const apiBase = resolveApiBase();
      const res = await fetch(`${apiBase}/upload/logo`, { method: 'POST', body: fd, credentials: 'include' });
      let body: { url?: string; error?: string } = {};
      try { body = await res.json() as typeof body; } catch { /* ignore */ }
      if (!res.ok) throw new Error(body.error || 'Upload failed');
      set('logo_url', body.url ?? '/uploads/company-logo.png');
      showToast('Logo uploaded', 'success');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to upload logo', 'error');
    } finally {
      setUploading(false);
    }
  }

  const logoSrc = form.logo_url
    ? form.logo_url.startsWith('http') ? form.logo_url : `${resolveApiBase()}${form.logo_url}`
    : null;

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Company Setup</h1>
          <p className="text-sm text-slate-500 mt-0.5">Configure company identity used across the app and printed documents</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {/* Company Information */}
      <Section title="Company Information" icon={Building2}>
        <Field label="Company Name" required>
          <input className={inputClass} value={form.company_name} onChange={e => set('company_name', e.target.value)} placeholder="My Business" />
        </Field>
        <Field label="Company Address" hint="Used in printed receipts, reports, and payslips">
          <textarea className={textareaClass} rows={3} value={form.company_address ?? ''} onChange={e => set('company_address', e.target.value || null)} placeholder="Street, City, Province, ZIP" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Contact Number">
            <input className={inputClass} value={form.contact_number} onChange={e => set('contact_number', e.target.value)} placeholder="+63 xxx xxx xxxx" />
          </Field>
          <Field label="Email" >
            <input className={inputClass} type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="info@company.com" />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Website">
            <input className={inputClass} value={form.website} onChange={e => set('website', e.target.value)} placeholder="www.company.com" />
          </Field>
          <Field label="TIN">
            <input className={inputClass} value={form.tin} onChange={e => set('tin', e.target.value)} placeholder="000-000-000-000" />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Business Type">
            <input className={inputClass} value={form.business_type} onChange={e => set('business_type', e.target.value)} placeholder="e.g. Sole Proprietorship" />
          </Field>
          <Field label="Branch Name">
            <input className={inputClass} value={form.branch_name} onChange={e => set('branch_name', e.target.value)} placeholder="Main Branch" />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Default Currency">
            <input className={inputClass} value={form.default_currency} onChange={e => set('default_currency', e.target.value)} placeholder="PHP" />
          </Field>
          <Field label="App Title" hint="Overrides Company Name in the app header if set">
            <input className={inputClass} value={form.app_title} onChange={e => set('app_title', e.target.value)} placeholder="Same as Company Name" />
          </Field>
        </div>
      </Section>

      {/* Branding */}
      <Section title="Branding & Logo" icon={Upload}>
        <div className="flex items-start gap-6">
          <div className="flex-1 space-y-3">
            <Field label="Company Logo" hint="PNG or JPG, max 5 MB">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60"
                >
                  <Upload className="w-4 h-4" />
                  {uploading ? 'Uploading…' : 'Upload Logo'}
                </button>
                {form.logo_url && (
                  <button
                    type="button"
                    onClick={() => set('logo_url', '')}
                    className="px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleLogoUpload(file);
                  e.target.value = '';
                }}
              />
            </Field>
            {form.logo_url && (
              <Field label="">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.show_logo_in_reports}
                    onChange={e => set('show_logo_in_reports', e.target.checked)}
                    className="rounded"
                  />
                  Show logo in printed reports & receipts
                </label>
              </Field>
            )}
          </div>
          {logoSrc && (
            <div className="flex-shrink-0">
              <div className="flex items-center gap-1 mb-1">
                <p className="text-xs text-slate-500">Preview</p>
                <button type="button" onClick={() => setShowLogo(s => !s)} className="text-slate-400 hover:text-slate-600">
                  {showLogo ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
              {showLogo && (
                <div className="w-28 h-28 border border-slate-200 rounded-xl overflow-hidden bg-slate-50 flex items-center justify-center">
                  <img src={logoSrc} alt="Logo preview" className="max-w-full max-h-full object-contain p-2" />
                </div>
              )}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.show_company_header_in_reports}
            onChange={e => set('show_company_header_in_reports', e.target.checked)}
            className="rounded"
          />
          Show company header (name, address, contact) in printed reports
        </label>
      </Section>

      {/* Print Settings */}
      <Section title="Print & Receipt Settings" icon={Printer}>
        <Field label="Receipt Printer Name" hint="Exact Windows printer name for thermal receipt printing and cash drawer. Default: XPrinter 58IIH">
          <input className={inputClass} value={form.receipt_printer_name ?? ''} onChange={e => set('receipt_printer_name', e.target.value)} placeholder="XPrinter 58IIH" />
        </Field>
        <Field label="Receipt / Order Slip Footer Note" hint="Shown at the bottom of POS receipts">
          <textarea className={textareaClass} rows={2} value={form.receipt_notes ?? ''} onChange={e => set('receipt_notes', e.target.value || null)} placeholder="Thank you for your business!" />
        </Field>
        <Field label="Report Footer Note" hint="Shown at the bottom of printed reports">
          <textarea className={textareaClass} rows={2} value={form.footer_notes ?? ''} onChange={e => set('footer_notes', e.target.value || null)} placeholder="Confidential — for internal use only" />
        </Field>
        <Field label="Payslip Footer Note" hint="Shown at the bottom of payslips">
          <textarea className={textareaClass} rows={2} value={form.payslip_footer_notes ?? ''} onChange={e => set('payslip_footer_notes', e.target.value || null)} placeholder="This payslip is computer-generated and requires no signature." />
        </Field>
      </Section>

      {/* System Info */}
      <Section title="System Information" icon={Info}>
        <div className="space-y-2 text-sm text-slate-600">
          <div className="flex items-center justify-between py-2 border-b border-slate-100">
            <span className="font-medium text-slate-700">Publisher</span>
            <span className="text-slate-500">{form.publisher || 'Cebu DigiBox'}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-slate-100">
            <span className="font-medium text-slate-700">Current Company Name</span>
            <span className="text-slate-500">{settings.company_name}</span>
          </div>
          <p className="text-xs text-slate-400 pt-1">
            Publisher information is read-only and set by Cebu DigiBox.
          </p>
        </div>
      </Section>
    </div>
  );
}
