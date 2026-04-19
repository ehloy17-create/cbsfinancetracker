import { supabase } from './supabase';

export interface CompanySettings {
  id: number;
  company_name: string;
  company_address: string | null;
  contact_number: string;
  email: string;
  website: string;
  tin: string;
  business_type: string;
  branch_name: string;
  default_currency: string;
  app_title: string;
  show_company_header_in_reports: boolean;
  show_logo_in_reports: boolean;
  logo_url: string;
  footer_notes: string | null;
  receipt_notes: string | null;
  payslip_footer_notes: string | null;
  publisher: string;
  receipt_printer_name: string;
}

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  id: 1,
  company_name: 'My Business',
  company_address: null,
  contact_number: '',
  email: '',
  website: '',
  tin: '',
  business_type: '',
  branch_name: '',
  default_currency: 'PHP',
  app_title: '',
  show_company_header_in_reports: true,
  show_logo_in_reports: true,
  logo_url: '',
  footer_notes: null,
  receipt_notes: null,
  payslip_footer_notes: null,
  publisher: 'Cebu DigiBox',
  receipt_printer_name: 'XPrinter 58IIH',
};

export async function fetchCompanySettings(): Promise<CompanySettings> {
  const { data, error } = await supabase
    .from('company_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return DEFAULT_COMPANY_SETTINGS;
  return {
    ...DEFAULT_COMPANY_SETTINGS,
    ...data,
    show_company_header_in_reports: Boolean(data.show_company_header_in_reports ?? 1),
    show_logo_in_reports: Boolean(data.show_logo_in_reports ?? 1),
  };
}

export async function saveCompanySettings(settings: Partial<CompanySettings>): Promise<void> {
  const { error } = await supabase
    .from('company_settings')
    .update(settings)
    .eq('id', 1);
  if (error) throw new Error(error.message || 'Failed to save settings');
}

export function getDisplayTitle(settings: CompanySettings): string {
  return settings.app_title?.trim() || settings.company_name || 'My Business';
}

export async function fetchPublicCompanySettings(): Promise<Pick<CompanySettings, 'company_name' | 'app_title' | 'logo_url' | 'publisher'>> {
  try {
    const apiBase = (window as unknown as { __API_BASE__?: string }).__API_BASE__ ?? '';
    const res = await fetch(`${apiBase}/public/company-settings`);
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    return {
      company_name: String(data.company_name ?? 'My Business'),
      app_title: String(data.app_title ?? ''),
      logo_url: String(data.logo_url ?? ''),
      publisher: String(data.publisher ?? 'Cebu DigiBox'),
    };
  } catch {
    return { company_name: 'My Business', app_title: '', logo_url: '', publisher: 'Cebu DigiBox' };
  }
}
