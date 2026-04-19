import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { CompanySettings, DEFAULT_COMPANY_SETTINGS, fetchCompanySettings } from '../lib/companySettings';
import { useAuth } from './AuthContext';

interface CompanySettingsContextValue {
  settings: CompanySettings;
  loading: boolean;
  refresh: () => Promise<void>;
}

const CompanySettingsContext = createContext<CompanySettingsContextValue>({
  settings: DEFAULT_COMPANY_SETTINGS,
  loading: true,
  refresh: async () => {},
});

export function CompanySettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await fetchCompanySettings();
      setSettings(data);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  return (
    <CompanySettingsContext.Provider value={{ settings, loading, refresh: load }}>
      {children}
    </CompanySettingsContext.Provider>
  );
}

export function useCompanySettings() {
  return useContext(CompanySettingsContext);
}
