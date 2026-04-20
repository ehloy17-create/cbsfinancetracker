import { useState } from 'react';
import { X, ShieldCheck, RotateCcw, Lock } from 'lucide-react';
import { Profile } from '../lib/types';
import {
  ModuleKey, MODULE_DEFS, ALL_MODULE_KEYS,
  ROLE_DEFAULT_MODULES, parseModuleAccess, getUserRoleLabel,
} from '../lib/accessControl';

interface Props {
  user: Profile;
  onSave: (moduleAccess: string | null) => void;
  onClose: () => void;
}

const GROUP_ORDER = ['Finance', 'Operations', 'Management'] as const;

const GROUP_STYLES: Record<string, { header: string; badge: string }> = {
  Finance:    { header: 'bg-blue-50 text-blue-700 border-blue-100',    badge: 'bg-blue-100 text-blue-700' },
  Operations: { header: 'bg-emerald-50 text-emerald-700 border-emerald-100', badge: 'bg-emerald-100 text-emerald-700' },
  Management: { header: 'bg-purple-50 text-purple-700 border-purple-100',  badge: 'bg-purple-100 text-purple-700' },
};

export default function UserPermissionsModal({ user, onSave, onClose }: Props) {
  const isAdmin = user.role === 'admin';
  const roleDefaults = ROLE_DEFAULT_MODULES[user.role] ?? [];
  const [moduleAccess, setModuleAccess] = useState<ModuleKey[] | null>(
    parseModuleAccess(user.module_access)
  );

  const effective = moduleAccess ?? roleDefaults;
  const isCustom = moduleAccess !== null;

  const toggle = (key: ModuleKey) => {
    const current = moduleAccess ?? roleDefaults;
    const next = current.includes(key)
      ? current.filter(k => k !== key)
      : [...current, key];
    setModuleAccess(next);
  };

  const reset = () => setModuleAccess(null);

  const handleSave = () => {
    onSave(moduleAccess ? JSON.stringify(moduleAccess) : null);
  };

  const enabledCount = isAdmin ? ALL_MODULE_KEYS.length : effective.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-semibold text-slate-800">Module Permissions</h3>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {user.name}
              <span className="mx-1.5 text-slate-300">·</span>
              <span className="font-medium text-slate-600">{getUserRoleLabel(user.role)}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              <span className={isCustom ? 'text-amber-600 font-medium' : 'text-slate-400'}>
                {isAdmin ? 'Full access' : isCustom ? 'Custom overrides applied' : 'Using role defaults'}
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
            <span className="font-semibold text-slate-700">{enabledCount}</span> of {ALL_MODULE_KEYS.length} modules enabled
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
              <p className="text-sm mt-1">Module restrictions do not apply to the admin role.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="border-b border-slate-100">
                  <th className="w-10 px-4 py-2.5" />
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-600">Module</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-slate-600 hidden sm:table-cell">Description</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-slate-600 w-24">Role Default</th>
                </tr>
              </thead>
              <tbody>
                {GROUP_ORDER.map(group => {
                  const keys = ALL_MODULE_KEYS.filter(k => MODULE_DEFS[k].group === group);
                  const styles = GROUP_STYLES[group];
                  const enabledInGroup = keys.filter(k => effective.includes(k)).length;
                  return (
                    <>
                      <tr key={`group-${group}`} className={`border-y ${styles.header}`}>
                        <td colSpan={4} className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider">{group}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${styles.badge}`}>
                              {enabledInGroup}/{keys.length} enabled
                            </span>
                          </div>
                        </td>
                      </tr>
                      {keys.map(key => {
                        const def = MODULE_DEFS[key];
                        const isEnabled = effective.includes(key);
                        const isDefault = roleDefaults.includes(key);
                        const isOverridden = isCustom && isEnabled !== isDefault;

                        return (
                          <tr
                            key={key}
                            onClick={() => toggle(key)}
                            className={`border-b border-slate-50 cursor-pointer transition-colors ${
                              isEnabled ? 'hover:bg-slate-50' : 'bg-slate-50/60 hover:bg-slate-100/60'
                            }`}
                          >
                            <td className="px-4 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={isEnabled}
                                onChange={() => toggle(key)}
                                onClick={e => e.stopPropagation()}
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <span className={`font-medium ${isEnabled ? 'text-slate-700' : 'text-slate-400'}`}>
                                {def.label}
                              </span>
                              {isOverridden && (
                                <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                  overridden
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-slate-400 hidden sm:table-cell">
                              {def.description}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {isDefault ? (
                                <span className="inline-block w-4 h-4 rounded-full bg-emerald-400" title="Enabled by default for this role" />
                              ) : (
                                <span className="inline-block w-4 h-4 rounded-full bg-slate-200" title="Not enabled by default for this role" />
                              )}
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
          <div className="text-xs text-slate-400">
            <span className="inline-block w-3 h-3 rounded-full bg-emerald-400 mr-1 align-middle" />
            Role default &nbsp;
            <span className="inline-block w-3 h-3 rounded-full bg-slate-200 mr-1 align-middle" />
            Not in role default
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
