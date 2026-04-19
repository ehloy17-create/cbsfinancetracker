import { UserRole } from './types';

export const ALL_USER_ROLES: UserRole[] = ['admin', 'staff', 'cashier'];

const GCASH_DASHBOARD_ROLES: UserRole[] = ['admin', 'staff', 'cashier'];
const GCASH_MODULE_ROLES: UserRole[] = ['admin', 'staff'];
const POS_WORKSPACE_ROLES: UserRole[] = ['admin', 'cashier'];

const GCASH_MODULE_PATHS = [
  '/gcash',
  '/cash-in',
  '/cash-out',
  '/cash-ledger',
  '/transactions',
  '/history',
  '/remittances',
] as const;

const POS_WORKSPACE_PATHS = [
  '/inventory/pos',
  '/inventory/pos/open-shift',
  '/inventory/pos/customers',
] as const;

const TIME_CLOCK_PATHS = [
  '/timeclock',
  '/timeclock/app',
] as const;

const PRICE_CHECKER_PATHS = [
  '/price-checker',
  '/price-checker/kiosk',
  '/price-checker/app',
] as const;

const POS_ADMIN_PATHS = [
  '/inventory/pos/shifts',
  '/inventory/pos/terminals',
] as const;

const ADMIN_ONLY_EXACT_PATHS = [
  '/dashboard',
  '/sales',
  '/sales/manage',
  '/bank',
  '/finance-deposits',
  '/owner-movements',
  '/recurring-obligations',
  '/bank-reconciliations',
  '/checks',
  '/disbursements',
  '/suppliers',
  '/supplier-ledger',
  '/settings',
  '/users',
  '/audit-logs',
] as const;

const ADMIN_ONLY_PREFIX_PATHS = [
  '/inventory',
  '/reports',
  '/payroll',
] as const;

export function isAdminRole(role: UserRole | null | undefined): role is 'admin' {
  return role === 'admin';
}

export function getDefaultRouteForRole(role: UserRole | null | undefined) {
  if (role === 'admin' || role === 'cashier' || role === 'staff') return '/dashboard';
  return '/gcash';
}

export function getUserRoleLabel(role: UserRole | null | undefined) {
  if (role === 'admin') return 'Admin';
  if (role === 'cashier') return 'Cashier';
  return 'Staff';
}

function normalizePath(path: string) {
  if (!path) return '/';
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function hasAccess(role: UserRole | null | undefined, allowedRoles: readonly UserRole[]) {
  return !!role && allowedRoles.includes(role);
}

export function canAccessPath(role: UserRole | null | undefined, rawPath: string) {
  const path = normalizePath(rawPath);

  if (path === '/dashboard') return hasAccess(role, ALL_USER_ROLES);
  if (path === '/gcash') return hasAccess(role, GCASH_DASHBOARD_ROLES);
  if (GCASH_MODULE_PATHS.slice(1).includes(path as (typeof GCASH_MODULE_PATHS)[number])) {
    return hasAccess(role, GCASH_MODULE_ROLES);
  }

  if (POS_WORKSPACE_PATHS.includes(path as (typeof POS_WORKSPACE_PATHS)[number]) || path.startsWith('/inventory/pos/session/')) {
    return hasAccess(role, POS_WORKSPACE_ROLES);
  }

  if (POS_ADMIN_PATHS.includes(path as (typeof POS_ADMIN_PATHS)[number])) {
    return hasAccess(role, ['admin']);
  }

  if (TIME_CLOCK_PATHS.includes(path as (typeof TIME_CLOCK_PATHS)[number])) {
    return hasAccess(role, ALL_USER_ROLES);
  }

  if (PRICE_CHECKER_PATHS.includes(path as (typeof PRICE_CHECKER_PATHS)[number])) {
    return hasAccess(role, ALL_USER_ROLES);
  }

  if (ADMIN_ONLY_EXACT_PATHS.includes(path as (typeof ADMIN_ONLY_EXACT_PATHS)[number])) {
    return hasAccess(role, ['admin']);
  }

  if (ADMIN_ONLY_PREFIX_PATHS.some(prefix => path === prefix || path.startsWith(prefix))) {
    return hasAccess(role, ['admin']);
  }

  return false;
}
