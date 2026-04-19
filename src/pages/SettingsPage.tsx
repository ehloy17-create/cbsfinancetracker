import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Settings2, Globe, Database, Upload, MapPin } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { formatDateTime } from '../lib/utils';
import BackupRestorePage from './BackupRestorePage';
import {
  getBooleanSystemState,
  POS_ALLOW_NEGATIVE_QTY_KEY,
  POS_SENIOR_DISCOUNT_KEY,
  setBooleanSystemState,
} from '../lib/systemState';
import { PosShift, PosZReadingReset } from '../lib/types';
import { enrichShifts } from '../pos/lib/shiftData';
import CompanySettingsPage from './CompanySettingsPage';
import InvImportPage from '../inventory/pages/InvImportPage';
import InvLocationsPage from '../inventory/pages/InvLocationsPage';

type GCashAccountSetting = {
  id: string;
  name: string;
  current_beginning_balance: number;
  current_running_balance: number;
  is_active: boolean;
};

export default function SettingsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTabParam = searchParams.get('tab');
  const VALID_TABS = ['app', 'global', 'locations', 'import', 'backup'] as const;
  type SettingsTab = typeof VALID_TABS[number];
  const activeTab: SettingsTab = VALID_TABS.includes(activeTabParam as SettingsTab) ? (activeTabParam as SettingsTab) : 'app';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [accounts, setAccounts] = useState<GCashAccountSetting[]>([]);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [newAccountName, setNewAccountName] = useState('');
  const [newBeginningBalance, setNewBeginningBalance] = useState('0');
  const [deactivateTarget, setDeactivateTarget] = useState<GCashAccountSetting | null>(null);
  const [allowNegativeQty, setAllowNegativeQty] = useState(false);
  const [seniorDiscountEnabled, setSeniorDiscountEnabled] = useState(false);
  const [lockedShifts, setLockedShifts] = useState<PosShift[]>([]);
  const [recentZResets, setRecentZResets] = useState<PosZReadingReset[]>([]);
  const [resetUserNames, setResetUserNames] = useState<Record<string, string>>({});
  const [resetTarget, setResetTarget] = useState<PosShift | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetReason, setResetReason] = useState('');

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data, error }, allowNegativeQtyValue, seniorDiscountValue] = await Promise.all([
        supabase
          .from('accounts')
          .select('id, name, current_beginning_balance, current_running_balance, is_active')
          .eq('is_active', true)
          .order('name'),
        getBooleanSystemState(POS_ALLOW_NEGATIVE_QTY_KEY, false),
        getBooleanSystemState(POS_SENIOR_DISCOUNT_KEY, false),
      ]);

      if (error) {
        showToast('Failed to load GCash settings', 'error');
        setLoading(false);
        return;
      }

      const rows = (data || []) as GCashAccountSetting[];
      setAccounts(rows);

      const nextBalances: Record<string, string> = {};
      for (const acc of rows) {
        nextBalances[acc.id] = String(Number(acc.current_beginning_balance || 0));
      }
      setBalances(nextBalances);
      setAllowNegativeQty(allowNegativeQtyValue);
      setSeniorDiscountEnabled(seniorDiscountValue);

      if (profile?.role === 'admin') {
        const [{ data: shiftRows }, { data: resetRows }] = await Promise.all([
          supabase.from('pos_shifts').select('*').order('opened_at', { ascending: false }),
          supabase.from('pos_zreading_resets').select('*').order('reset_at', { ascending: false }).limit(10),
        ]);

        const enrichedLocked = await enrichShifts(
          ((shiftRows ?? []) as Record<string, unknown>[]).filter(row => Boolean(row.z_reading_posted_at))
        );
        setLockedShifts(enrichedLocked);

        const resetEntries = (resetRows ?? []) as PosZReadingReset[];
        setRecentZResets(resetEntries);

        const resetByIds = Array.from(new Set(resetEntries.map(row => row.reset_by).filter(Boolean)));
        if (resetByIds.length > 0) {
          const { data: users } = await supabase.from('profiles').select('id, name').in('id', resetByIds);
          setResetUserNames(
            Object.fromEntries(((users ?? []) as Array<{ id: string; name: string }>).map(user => [user.id, user.name]))
          );
        } else {
          setResetUserNames({});
        }
      } else {
        setLockedShifts([]);
        setRecentZResets([]);
        setResetUserNames({});
      }
    } catch {
      showToast('Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [profile?.role, showToast]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);

    try {
      for (const acc of accounts) {
        const parsed = Number(balances[acc.id]);
        if (Number.isNaN(parsed) || parsed < 0) {
          showToast(`Invalid beginning balance for ${acc.name}`, 'warning');
          setSaving(false);
          return;
        }
      }

      const results = await Promise.all(
        accounts.map((acc) => {
          const newBeginning = Number(balances[acc.id]) || 0;
          return supabase
            .from('accounts')
            .update({
              current_beginning_balance: newBeginning,
              updated_at: new Date().toISOString(),
            })
            .eq('id', acc.id);
        })
      );

      const failed = results.find((r) => r.error);
      if (failed?.error) {
        showToast('Failed to save one or more GCash balances', 'error');
        setSaving(false);
        return;
      }

      await setBooleanSystemState(POS_ALLOW_NEGATIVE_QTY_KEY, allowNegativeQty);
      await setBooleanSystemState(POS_SENIOR_DISCOUNT_KEY, seniorDiscountEnabled);

      showToast('Settings updated', 'success');
      await loadAccounts();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;

    const name = newAccountName.trim();
    const beginning = Number(newBeginningBalance);

    if (!name) {
      showToast('GCash account name is required', 'warning');
      return;
    }
    if (Number.isNaN(beginning) || beginning < 0) {
      showToast('Beginning balance must be 0 or greater', 'warning');
      return;
    }

    setCreating(true);
    const { error } = await supabase
      .from('accounts')
      .insert({
        name,
        is_active: true,
        current_beginning_balance: beginning,
        current_running_balance: beginning,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      showToast(error.message || 'Failed to create GCash account', 'error');
      setCreating(false);
      return;
    }

    showToast('GCash account created', 'success');
    setNewAccountName('');
    setNewBeginningBalance('0');
    await loadAccounts();
    setCreating(false);
  }

  async function handleDeactivateAccount() {
    if (!deactivateTarget) return;

    const { error } = await supabase
      .from('accounts')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', deactivateTarget.id);

    if (error) {
      showToast(error.message || 'Failed to deactivate GCash account', 'error');
      return;
    }

    showToast(`GCash account "${deactivateTarget.name}" deactivated`, 'success');
    setDeactivateTarget(null);
    await loadAccounts();
  }

  function openResetModal(target: PosShift) {
    setResetTarget(target);
    setResetPassword('');
    setResetReason('');
  }

  function closeResetModal() {
    setResetTarget(null);
    setResetPassword('');
    setResetReason('');
  }

  async function handleResetZReading() {
    if (!resetTarget) return;
    if (!resetPassword) {
      showToast('Admin password is required', 'warning');
      return;
    }
    if (!resetReason.trim()) {
      showToast('Reset reason is required', 'warning');
      return;
    }

    setResetting(true);
    try {
      const { error } = await supabase.rpc('reset_z_reading', {
        p_shift_id: resetTarget.shift_id,
        p_admin_password: resetPassword,
        p_reason: resetReason.trim(),
      });
      if (error) throw error;

      showToast('Z Reading reset. Register transactions are unlocked again.', 'success');
      closeResetModal();
      await loadAccounts();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to reset Z Reading', 'error');
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
        <p className="text-slate-500 text-sm mt-1">Manage application behavior, company identity, and global configuration.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setSearchParams({ tab: 'app' })}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
            activeTab === 'app'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          <Settings2 className="w-4 h-4" />
          App Settings
        </button>
        <button
          type="button"
          onClick={() => setSearchParams({ tab: 'global' })}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
            activeTab === 'global'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          <Globe className="w-4 h-4" />
          Global Settings
        </button>
        <button
          type="button"
          onClick={() => setSearchParams({ tab: 'locations' })}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
            activeTab === 'locations'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          <MapPin className="w-4 h-4" />
          Locations
        </button>
        <button
          type="button"
          onClick={() => setSearchParams({ tab: 'import' })}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
            activeTab === 'import'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          <Upload className="w-4 h-4" />
          Import
        </button>
        {profile?.role === 'admin' && (
          <button
            type="button"
            onClick={() => setSearchParams({ tab: 'backup' })}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              activeTab === 'backup'
                ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                : 'border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            <Database className="w-4 h-4" />
            Backup & Restore
          </button>
        )}
      </div>

      {/* Global Settings tab */}
      {activeTab === 'global' && <CompanySettingsPage />}

      {/* Locations tab */}
      {activeTab === 'locations' && <InvLocationsPage />}

      {/* Import tab */}
      {activeTab === 'import' && <InvImportPage />}

      {/* Backup Settings tab */}
      {activeTab === 'backup' && profile?.role === 'admin' && <BackupRestorePage />}

      {/* App Settings tab */}
      {activeTab === 'app' && (<>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (<>

      <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-800">Application Controls</h2>
          <p className="text-sm text-slate-500">Settings here affect app-wide POS and finance behavior.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-800">POS Settings</h3>
            <p className="text-xs text-slate-500 mt-1">Control validation rules during checkout and tendering.</p>
          </div>
          <div className="p-4 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowNegativeQty}
                  onChange={(e) => setAllowNegativeQty(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-800">Allow tendering with negative qty</p>
                  <p className="mt-1 text-sm text-slate-500">
                    When enabled, POS can proceed to the tender screen and complete checkout even when stock goes below zero.
                  </p>
                </div>
              </label>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={seniorDiscountEnabled}
                  onChange={(e) => setSeniorDiscountEnabled(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-800">Enable Senior Citizen Discount (20%)</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Shows a Senior Discount option in the POS discount dialog. Applies a 20% discount per line. Enable only for food & beverage businesses — not applicable for general retail.
                  </p>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-800">GCash Settings</h3>
            <p className="text-xs text-slate-500 mt-1">Configure balances used by the finance and POS modules.</p>
          </div>
          <div className="p-4 space-y-4">
            {accounts.length === 0 ? (
              <p className="text-sm text-slate-500">No active GCash accounts found. Create one below first.</p>
            ) : (
              accounts.map((acc) => (
                <div key={acc.id} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">GCash Account</label>
                    <input
                      type="text"
                      value={acc.name}
                      readOnly
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Beginning Balance</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={balances[acc.id] ?? ''}
                      onChange={(e) => setBalances((prev) => ({ ...prev, [acc.id]: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Current Running Balance</label>
                    <input
                      type="text"
                      value={Number(acc.current_running_balance || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                      readOnly
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
                    />
                  </div>
                  <div className="md:col-span-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setDeactivateTarget(acc)}
                      className="px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm font-medium hover:bg-red-100"
                    >
                      Deactivate Account
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>

      {profile?.role === 'admin' && (
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-800">POS Z Reading Reset</h2>
            <p className="text-sm text-slate-500">
              Reopen a register/day only when Z Reading was posted by mistake. Admin password and reason are required.
            </p>
          </div>

          {lockedShifts.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No locked Z Reading shifts found.
            </div>
          ) : (
            <div className="space-y-3">
              {lockedShifts.map((shift) => {
                const terminal = shift.pos_terminals as { terminal_name?: string } | undefined;
                const location = shift.inv_locations as { name?: string; code?: string } | undefined;
                const cashier = shift.cashier as { name?: string } | undefined;
                return (
                  <div key={shift.shift_id} className="rounded-xl border border-red-200 bg-red-50/60 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="space-y-1 text-sm text-slate-700">
                        <p className="font-semibold text-slate-800">
                          {terminal?.terminal_name ?? shift.terminal_id}{location ? ` · [${location.code}] ${location.name}` : ''}
                        </p>
                        <p>Business Date: <span className="font-medium">{shift.business_date}</span></p>
                        <p>Cashier: <span className="font-medium">{cashier?.name ?? shift.cashier_id}</span></p>
                        <p>Shift ID: <span className="font-mono text-xs">{shift.shift_id}</span></p>
                        <p>Z Posted: <span className="font-medium">{shift.z_reading_posted_at ? formatDateTime(shift.z_reading_posted_at) : '--'}</span></p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openResetModal(shift)}
                        className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
                      >
                        Reset Z Reading
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-800">Recent Reset Activity</h3>
            </div>
            {recentZResets.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">No reset actions logged yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Timestamp</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Shift</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Register / Day</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Admin</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentZResets.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-3 text-slate-600">{formatDateTime(row.reset_at)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.shift_id}</td>
                        <td className="px-4 py-3 text-slate-700">
                          <div>{row.terminal_id}</div>
                          <div className="text-xs text-slate-500">{row.business_date}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{resetUserNames[row.reset_by] ?? row.reset_by}</td>
                        <td className="px-4 py-3 text-slate-600">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      <form onSubmit={handleCreateAccount} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-800">Add GCash Account</h2>
          <p className="text-sm text-slate-500">Create new app accounts used in GCash balances and POS balance display.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Account Name</label>
            <input
              type="text"
              value={newAccountName}
              onChange={(e) => setNewAccountName(e.target.value)}
              placeholder="e.g., Main GCash"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Beginning Balance</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={newBeginningBalance}
              onChange={(e) => setNewBeginningBalance(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div>
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-60"
          >
            {creating ? 'Creating...' : 'Add GCash Account'}
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={!!deactivateTarget}
        title="Deactivate GCash Account"
        message={deactivateTarget
          ? `This will deactivate ${deactivateTarget.name}. Existing transactions and history will be kept.`
          : 'This will deactivate this account.'}
        confirmLabel="Deactivate"
        danger
        onConfirm={handleDeactivateAccount}
        onCancel={() => setDeactivateTarget(null)}
      />

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={closeResetModal} />
          <div className="relative bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Reset Z Reading</h3>
              <p className="mt-2 text-sm text-slate-600">
                This reopens the selected register/day, unlocks POS transactions, and keeps all existing sales records intact. Use this only for accidental Z Reading posts.
              </p>
            </div>

            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-medium">Register/day reference</p>
              <p className="mt-1">Shift ID: <span className="font-mono text-xs">{resetTarget.shift_id}</span></p>
              <p>Business Date: {resetTarget.business_date}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Admin password</label>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your password to confirm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Reason / notes</label>
              <textarea
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Explain why this Z Reading is being reopened"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeResetModal}
                disabled={resetting}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetZReading}
                disabled={resetting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60"
              >
                {resetting ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
      </>)}
      </>)}
    </div>
  );
}
