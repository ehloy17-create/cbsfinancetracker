import { useState } from 'react';
import { X, ShieldCheck, RotateCcw, Lock } from 'lucide-react';
import { Profile } from '../lib/types';
import {
  FeatureKey, FEATURE_DEFS, ALL_FEATURE_KEYS, SECTION_ORDER,
  ROLE_DEFAULT_FEATURES, parseModuleAccess, getUserRoleLabel,
} from '../lib/accessControl';

interface Props {
  user: Profile;
  onSave: (moduleAccess: string | null) => void;
  onClose: () => void;
}

const SECTION_STYLES: Record<string, string> = {
  'GCash':                    'bg-sky-50    text-sky-700    border-sky-100',
  'Finance':                  'bg-blue-50   text-blue-700   border-blue-100',
  'Payroll':                  'bg-indigo-50 text-indigo-700 border-indigo-100',
  'POS':                      'bg-emerald-50 text-emerald-700 border-emerald-100',
  'Reports — Sales & POS':    'bg-amber-50  text-amber-700  border-amber-100',
  'Reports — Inventory':      'bg-orange-50 text-orange-700 border-orange-100',
  'Reports — Finance':        'bg-rose-50   text-rose-700   border-rose-100',
  'Inventory — Stock':        'bg-teal-50   text-teal-700   border-teal-100',
  'Inventory — Procurement':  'bg-cyan-50   text-cyan-700   border-cyan-100',
  'Inventory — Operations':   'bg-lime-50   text-lime-700   border-lime-100',
  'Inventory — Catalog':      'bg-violet-50 text-violet-700 border-violet-100',
  'Suppliers':                'bg-purple-50 text-purple-700 border-purple-100',
};

export default function UserPermissionsModal({ user, onSave, onClose }: Props) {
  const isAdmin = user.role === 'admin';
  const roleDefaults = ROLE_DEFAULT_FEATURES[user.role] ?? [];

  const [featureAccess, setFeatureAccess] = useState<FeatureKey[] | null>(
    parseModuleAccess(user.module_access)
  );

  const effective = featureAccess ?? roleDefaults;
  const isCustom  = featureAccess !== null;

  const toggle = (key: FeatureKey) => {
    const current = featureAccess ?? roleDefaults;
    const next = current.includes(key)
      ? current.filter(k => k !== key)
      : [...current, key];
    setFeatureAccess(next);
  };

  const toggleSection = (keys: FeatureKey[]) => {
    const allOn = keys.every(k => effective.includes(k));
    const current = featureAccess ?? roleDefaults;
    const next = allOn
      ? current.filter(k => !keys.includes(k))
      : [...new Set([...current, ...keys])];
    setFeatureAccess(next);
  };

  const reset = () => setFeatureAccess(null);

  const handleSave = () => {
    onSave(featureAccess ? JSON.stringify(featureAccess) : null);
  };

  const enabledCount = isAdmin ? ALL_FEATURE_KEYS.length : effective.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-semibold text-slate-800">Feature Permissions</h3>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {user.name}
              <span className="mx-1.5 text-slate-300">·</span>
              <span className="font-medium text-slate-600">{getUserRoleLabel(user.role)}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              <span className={isCustom ? 'text-amber-600 font-medium' : 'text-slate-400'}>
                {isAdmin ? 'Full access — no restrictions' : isCustom ? 'Custom overrides applied' : 'Using role defaults'}
              </span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 mt-0.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 px-6 py-2.5 bg-slate-50 border-b border-slate-100 text-sm">
          <span className="text-slate-500">
            <span className="font-semibold text-slate-700">{enabledCount}</span>
            <span className="text-slate-400"> / {ALL_FEATURE_KEYS.length}</span>
            {' '}features enabled
          </span>
          {!isAdmin && isCustom && (
            <button
              onClick={reset}
              className="ml-auto flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg hover:bg-amber-100 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Reset to role defaults
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          {isAdmin ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Lock className="w-10 h-10 mb-3 text-slate-300" />
              <p className="font-medium text-slate-600">Admin has full access</p>
              <p className="text-sm mt-1">Feature restrictions do not apply to the admin role.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white z-10 shadow-sm">
                <tr className="border-b border-slate-100">
                  <th className="w-10 px-4 py-2.5" />
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-600">Feature / Menu Item</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-600 hidden md:table-cell">Description</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-slate-600 w-20 whitespace-nowrap">Role Default</th>
                </tr>
              </thead>
              <tbody>
                {SECTION_ORDER.map(section => {
                  const keys = ALL_FEATURE_KEYS.filter(k => FEATURE_DEFS[k].section === section);
                  if (keys.length === 0) return null;
                  const styles = SECTION_STYLES[section] ?? 'bg-slate-50 text-slate-600 border-slate-200';
                  const enabledInSection = keys.filter(k => effective.includes(k)).length;
                  const allOn = enabledInSection === keys.length;

                  return (
                    <>
                      {/* Section header row — click to toggle all */}
                      <tr
                        key={`section-${section}`}
                        className={`border-y cursor-pointer select-none ${styles}`}
                        onClick={() => toggleSection(keys)}
                      >
                        <td className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={allOn}
                            onChange={() => toggleSection(keys)}
                            onClick={e => e.stopPropagation()}
                            className="w-4 h-4 rounded border-current cursor-pointer"
                          />
                        </td>
                        <td colSpan={3} className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider">{section}</span>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/60">
                              {enabledInSection}/{keys.length}
                            </span>
                          </div>
                        </td>
                      </tr>

                      {/* Feature rows */}
                      {keys.map(key => {
                        const def = FEATURE_DEFS[key];
                        const isEnabled  = effective.includes(key);
                        const isDefault  = roleDefaults.includes(key);
                        const isOverridden = isCustom && isEnabled !== isDefault;

                        return (
                          <tr
                            key={key}
                            onClick={() => toggle(key)}
                            className={`border-b border-slate-50 cursor-pointer transition-colors ${
                              isEnabled ? 'hover:bg-slate-50' : 'bg-slate-50/50 hover:bg-slate-100/60'
                            }`}
                          >
                            <td className="px-4 py-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={isEnabled}
                                onChange={() => toggle(key)}
                                onClick={e => e.stopPropagation()}
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`font-medium ${isEnabled ? 'text-slate-700' : 'text-slate-400'}`}>
                                {def.label}
                              </span>
                              {isOverridden && (
                                <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                  overridden
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-slate-400 text-xs hidden md:table-cell">
                              {def.description}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span
                                className={`inline-block w-3 h-3 rounded-full ${isDefault ? 'bg-emerald-400' : 'bg-slate-200'}`}
                                title={isDefault ? 'Enabled by role default' : 'Not in role default'}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100">
          <div className="text-xs text-slate-400 flex items-center gap-3">
            <span><span className="inline-block w-3 h-3 rounded-full bg-emerald-400 mr-1 align-middle" />Role default on</span>
            <span><span className="inline-block w-3 h-3 rounded-full bg-slate-200 mr-1 align-middle" />Role default off</span>
          </div>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={handleSave}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              Save Permissions
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
