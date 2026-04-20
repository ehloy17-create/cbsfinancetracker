import { UserRole } from './types';

export const ALL_USER_ROLES: UserRole[] = ['admin', 'accounting', 'staff', 'cashier'];

// ── Module definitions ────────────────────────────────────────────────────────

export type ModuleKey =
  | 'gcash_view'
  | 'gcash_transactions'
  | 'cash_ledger'
  | 'bank'
  | 'checks'
  | 'disbursements'
  | 'deposits'
  | 'suppliers'
  | 'owner_movements'
  | 'pos'
  | 'inventory'
  | 'reports'
  | 'payroll'
  | 'sales';

export interface ModuleDef {
  label: string;
  group: 'Finance' | 'Operations' | 'Management';
  description: string;
}

export const MODULE_DEFS: Record<ModuleKey, ModuleDef> = {
  gcash_view:         { label: 'GCash Dashboard',               group: 'Finance',     description: 'GCash balance overview and account summary' },
  gcash_transactions: { label: 'GCash Transactions',            group: 'Finance',     description: 'Cash-in, cash-out, remittances, transaction history' },
  cash_ledger:        { label: 'Cash Ledger',                   group: 'Finance',     description: 'Daily cash fund tracking and ledger entries' },
  bank:               { label: 'Bank & Reconciliation',         group: 'Finance',     description: 'Bank accounts, transfers, and reconciliation' },
  checks:             { label: 'Check Issuance',                group: 'Finance',     description: 'Issue and track checks to suppliers and payees' },
  disbursements:      { label: 'Disbursements',                 group: 'Finance',     description: 'Record expenses paid via cash, check, or GCash' },
  deposits:           { label: 'Deposits',                      group: 'Finance',     description: 'GCash-to-bank deposit tracking' },
  suppliers:          { label: 'Suppliers & Ledger',            group: 'Finance',     description: 'Supplier directory, payables, and ledger history' },
  owner_movements:    { label: 'Owner Movements & Obligations', group: 'Finance',     description: 'Owner fund movements and recurring obligations' },
  pos:                { label: 'POS / Cashier',                 group: 'Operations',  description: 'Point-of-sale, shifts, terminals, customer credit' },
  inventory:          { label: 'Inventory Management',          group: 'Operations',  description: 'Products, stock levels, purchase orders' },
  reports:            { label: 'Reports',                       group: 'Management',  description: 'P&L, cash flow, projected balance, and snapshots' },
  payroll:            { label: 'Payroll',                       group: 'Management',  description: 'Employee payroll, DTR, cutoffs, and payroll reports' },
  sales:              { label: 'Sales Analytics',               group: 'Management',  description: 'Daily sales entry and sales performance analytics' },
};

export const ALL_MODULE_KEYS = Object.keys(MODULE_DEFS) as ModuleKey[];

// Default modules each role can access when no per-user override is set
export const ROLE_DEFAULT_MODULES: Record<UserRole, ModuleKey[]> = {
  admin:      ALL_MODULE_KEYS,
  accounting: ['cash_ledger', 'bank', 'checks', 'disbursements', 'deposits', 'suppliers', 'owner_movements', 'reports'],
  staff:      ['gcash_view', 'gcash_transactions', 'cash_ledger'],
  cashier:    ['gcash_view', 'gcash_transactions', 'pos'],
};

// ── Path → module mapping ─────────────────────────────────────────────────────

function pathToModule(path: string): ModuleKey | null {
  // POS before inventory (more specific prefix)
  if (path === '/inventory/pos' || path === '/inventory/pos/open-shift' ||
      path === '/inventory/pos/customers' || path === '/inventory/pos/shifts' ||
      path === '/inventory/pos/terminals' || path.startsWith('/inventory/pos/session/')) {
    return 'pos';
  }
  if (path === '/inventory' || path.startsWith('/inventory/')) return 'inventory';

  if (path === '/gcash')                                          return 'gcash_view';
  if (['/cash-in', '/cash-out', '/transactions', '/history', '/remittances'].includes(path)) return 'gcash_transactions';
  if (path === '/cash-ledger')                                    return 'cash_ledger';
  if (path === '/bank' || path === '/bank-reconciliations')       return 'bank';
  if (path === '/checks')                                         return 'checks';
  if (path === '/disbursements')                                  return 'disbursements';
  if (path === '/finance-deposits')                               return 'deposits';
  if (path === '/suppliers' || path === '/supplier-ledger')       return 'suppliers';
  if (path === '/owner-movements' || path === '/recurring-obligations') return 'owner_movements';
  if (path === '/reports' || path.startsWith('/reports/'))        return 'reports';
  if (path === '/payroll' || path.startsWith('/payroll/'))        return 'payroll';
  if (path === '/sales' || path === '/sales/manage')              return 'sales';

  return null;
}

// Parse module_access JSON stored in the profile (null = use role defaults)
export function parseModuleAccess(raw: string | null | undefined): ModuleKey[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ModuleKey[];
  } catch { /* ignore */ }
  return null;
}

// ── Access helpers ────────────────────────────────────────────────────────────

export function isAdminRole(role: UserRole | null | undefined): role is 'admin' {
  return role === 'admin';
}

export function isAccountingRole(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'accounting';
}

export function getDefaultRouteForRole(role: UserRole | null | undefined) {
  if (role === 'admin')      return '/dashboard';
  if (role === 'accounting') return '/checks';
  if (role === 'cashier')    return '/dashboard';
  if (role === 'staff')      return '/dashboard';
  return '/gcash';
}

export function getUserRoleLabel(role: UserRole | null | undefined) {
  if (role === 'admin')      return 'Admin';
  if (role === 'accounting') return 'Accounting';
  if (role === 'cashier')    return 'Cashier';
  return 'Staff';
}

// Paths that are always accessible to any authenticated user
const ALWAYS_ALLOWED_EXACT = new Set([
  '/dashboard',
  '/timeclock',
  '/timeclock/app',
  '/price-checker',
  '/price-checker/kiosk',
  '/price-checker/app',
]);

// Paths not accessible to the accounting role specifically
const ACCOUNTING_BLOCKED_EXACT = new Set([
  '/timeclock',
  '/timeclock/app',
  '/price-checker',
  '/price-checker/kiosk',
  '/price-checker/app',
]);

// Paths that only admin can ever access (no module override possible)
const ADMIN_ONLY_EXACT = new Set([
  '/sales',
  '/sales/manage',
  '/historical-import',
  '/settings',
  '/users',
  '/audit-logs',
]);

function normalizePath(path: string) {
  if (!path) return '/';
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Returns true if `role` can access `rawPath`.
 * Pass `moduleAccess` (parsed from profile.module_access) for per-user overrides.
 * When null, falls back to ROLE_DEFAULT_MODULES for the role.
 */
export function canAccessPath(
  role: UserRole | null | undefined,
  rawPath: string,
  moduleAccess?: ModuleKey[] | null,
): boolean {
  if (!role) return false;
  if (role === 'admin') return true;

  const path = normalizePath(rawPath);

  if (role === 'accounting' && ACCOUNTING_BLOCKED_EXACT.has(path)) return false;
  if (ALWAYS_ALLOWED_EXACT.has(path)) return true;
  if (ADMIN_ONLY_EXACT.has(path))     return false;

  const allowed = moduleAccess ?? ROLE_DEFAULT_MODULES[role] ?? [];
  const mod = pathToModule(path);
  if (!mod) return false;
  return allowed.includes(mod);
}
