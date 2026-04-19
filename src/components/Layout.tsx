import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import ToastContainer from './ToastContainer';
import { useAuth } from '../contexts/AuthContext';
import { getTodayDateString, formatDate } from '../lib/utils';
import { getUserRoleLabel } from '../lib/accessControl';
import { useCompanySettings } from '../contexts/CompanySettingsContext';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { profile } = useAuth();
  const { settings: companySettings } = useCompanySettings();
  const displayTitle = companySettings.app_title?.trim() || companySettings.company_name || 'My Business';

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen min-w-0">
        <header className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 lg:hidden">
              <span className="font-semibold text-slate-800 text-sm">{displayTitle}</span>
            </div>
            <div className="hidden lg:flex items-center">
              <span className="text-sm text-slate-500">{formatDate(getTodayDateString())}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-slate-800">{profile?.name}</p>
                <p className="text-xs text-slate-500">{getUserRoleLabel(profile?.role)}</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-sm font-bold">
                  {profile?.name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      <ToastContainer />
    </div>
  );
}
