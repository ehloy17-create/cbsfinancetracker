import { UserRole } from './types';

export const ALL_USER_ROLES: UserRole[] = ['admin', 'accounting', 'staff', 'cashier'];

// ── Feature definitions ───────────────────────────────────────────────────────
// Each feature = one sidebar menu item (or closely-related pair of paths)

export type FeatureKey =
  // GCash
  | 'gcash_dashboard'
  | 'gcash_cash_in'
  | 'gcash_cash_out'
  | 'gcash_remittances'
  | 'gcash_transactions'
  | 'gcash_history'
  // Finance
  | 'cash_ledger'
  | 'bank'
  | 'finance_deposits'
  | 'owner_movements'
  | 'recurring_obligations'
  | 'checks'
  | 'disbursements'
  // Payroll
  | 'payroll'
  | 'payroll_employees'
  | 'payroll_departments'
  | 'payroll_timelogs'
  | 'payroll_attendance'
  | 'payroll_biometrics'
  | 'payroll_cutoffs'
  | 'payroll_processing'
  | 'payroll_cash_advances'
  | 'payroll_holidays'
  | 'payroll_settings'
  | 'payroll_reports'
  // POS
  | 'pos'
  | 'pos_customers'
  | 'timeclock'
  | 'price_checker'
  | 'pos_shifts'
  | 'pos_terminals'
  // Reports
  | 'reports'
  | 'reports_daily_sales'
  | 'reports_sales_details'
  | 'reports_product_sales'
  | 'reports_cashier_sales'
  | 'reports_xz_reading'
  | 'reports_inventory'
  | 'reports_stock_movement'
  | 'reports_low_stock'
  | 'reports_near_expiry'
  | 'reports_po_status'
  | 'reports_receivings'
  | 'reports_transfers'
  | 'reports_adjustments'
  | 'reports_physical_count'
  | 'reports_payable_aging'
  | 'reports_profit_loss'
  | 'reports_upcoming_dues'
  | 'reports_recurring_obligations'
  | 'reports_projected_balance'
  | 'reports_liquidity'
  | 'reports_deposits_transit'
  | 'reports_bank_reconciliation'
  | 'reports_owner_movements'
  // Inventory
  | 'inventory'
  | 'inventory_stock'
  | 'inventory_ledger'
  | 'inventory_purchase_orders'
  | 'inventory_receivings'
  | 'inventory_payables'
  | 'inventory_transfers'
  | 'inventory_adjustments'
  | 'inventory_physical_counts'
  | 'inventory_product_lots'
  | 'inventory_products'
  | 'inventory_categories'
  | 'inventory_brands'
  | 'inventory_units'
  // Suppliers
  | 'inventory_suppliers'
  | 'finance_suppliers';

export type FeatureSection =
  | 'GCash'
  | 'Finance'
  | 'Payroll'
  | 'POS'
  | 'Reports — Sales & POS'
  | 'Reports — Inventory'
  | 'Reports — Finance'
  | 'Inventory — Stock'
  | 'Inventory — Procurement'
  | 'Inventory — Operations'
  | 'Inventory — Catalog'
  | 'Suppliers';

export interface FeatureDef {
  label: string;
  section: FeatureSection;
  description: string;
}

export const FEATURE_DEFS: Record<FeatureKey, FeatureDef> = {
  // GCash
  gcash_dashboard:    { label: 'GCash Dashboard',          section: 'GCash',    description: 'GCash balance overview and account summary' },
  gcash_cash_in:      { label: 'Cash In',                  section: 'GCash',    description: 'Record incoming GCash transactions' },
  gcash_cash_out:     { label: 'Cash Out',                 section: 'GCash',    description: 'Record outgoing GCash transactions' },
  gcash_remittances:  { label: 'Remittances',              section: 'GCash',    description: 'GCash remittance records' },
  gcash_transactions: { label: 'Transactions',             section: 'GCash',    description: 'Full GCash transaction list' },
  gcash_history:      { label: 'Daily History',            section: 'GCash',    description: 'Day-by-day GCash transaction history' },
  // Finance
  cash_ledger:        { label: 'Cash Ledger',              section: 'Finance',  description: 'Daily cash fund tracking and ledger entries' },
  bank:               { label: 'Bank',                     section: 'Finance',  description: 'Bank accounts and reconciliation' },
  finance_deposits:   { label: 'GCash Deposits',           section: 'Finance',  description: 'GCash-to-bank deposit tracking' },
  owner_movements:    { label: 'Owner Ledger',             section: 'Finance',  description: 'Owner fund movements' },
  recurring_obligations: { label: 'Recurring Dues',        section: 'Finance',  description: 'Recurring payment obligations' },
  checks:             { label: 'Checks Issued',            section: 'Finance',  description: 'Issue and track checks to payees' },
  disbursements:      { label: 'Disbursements',            section: 'Finance',  description: 'Record expenses paid via cash, check, or GCash' },
  // Payroll
  payroll:              { label: 'Payroll Dashboard',      section: 'Payroll',  description: 'Payroll overview and summary' },
  payroll_employees:    { label: 'Employees',              section: 'Payroll',  description: 'Employee records and profiles' },
  payroll_departments:  { label: 'Departments & Positions',section: 'Payroll',  description: 'Organizational structure' },
  payroll_timelogs:     { label: 'Time Logs (DTR)',        section: 'Payroll',  description: 'View employee time logs and DTR' },
  payroll_attendance:   { label: 'Manual DTR Override',    section: 'Payroll',  description: 'Manually adjust attendance records' },
  payroll_biometrics:   { label: 'Biometrics Import',      section: 'Payroll',  description: 'Import biometric attendance data' },
  payroll_cutoffs:      { label: 'Payroll Periods',        section: 'Payroll',  description: 'Manage payroll cutoff periods' },
  payroll_processing:   { label: 'Process Payroll',        section: 'Payroll',  description: 'Run and finalize payroll computation' },
  payroll_cash_advances:{ label: 'Cash Advances',          section: 'Payroll',  description: 'Employee cash advance records' },
  payroll_holidays:     { label: 'Holidays',               section: 'Payroll',  description: 'Holiday calendar management' },
  payroll_settings:     { label: 'Payroll Settings',       section: 'Payroll',  description: 'Configure payroll rules and rates' },
  payroll_reports:      { label: 'Payroll Reports',        section: 'Payroll',  description: 'Payroll and compensation reports' },
  // POS
  pos:              { label: 'POS Terminal',               section: 'POS',      description: 'Point-of-sale cashier interface' },
  pos_customers:    { label: 'Customer Ledger & Credit',   section: 'POS',      description: 'Customer accounts and credit management' },
  timeclock:        { label: 'Daily Time Record',          section: 'POS',      description: 'Employee time-in/time-out kiosk' },
  price_checker:    { label: 'Price Checker',              section: 'POS',      description: 'Product price lookup kiosk' },
  pos_shifts:       { label: 'POS Shifts',                 section: 'POS',      description: 'POS shift history and management' },
  pos_terminals:    { label: 'POS Terminals',              section: 'POS',      description: 'Manage POS terminal devices' },
  // Reports — Sales & POS
  reports:                    { label: 'Reports Dashboard',       section: 'Reports — Sales & POS', description: 'Main reports overview' },
  reports_daily_sales:        { label: 'Daily Sales',             section: 'Reports — Sales & POS', description: 'Daily sales totals and breakdown' },
  reports_sales_details:      { label: 'Sales Details Summary',   section: 'Reports — Sales & POS', description: 'Detailed sales transaction summary' },
  reports_product_sales:      { label: 'Product Summary Sales',   section: 'Reports — Sales & POS', description: 'Sales performance per product' },
  reports_cashier_sales:      { label: 'Cashier Sales',           section: 'Reports — Sales & POS', description: 'Sales breakdown per cashier' },
  reports_xz_reading:         { label: 'X/Z Reading',             section: 'Reports — Sales & POS', description: 'POS X and Z reading reports' },
  // Reports — Inventory
  reports_inventory:          { label: 'Inventory On Hand',       section: 'Reports — Inventory',   description: 'Current stock levels' },
  reports_stock_movement:     { label: 'Stock Movement',          section: 'Reports — Inventory',   description: 'Stock in/out movement history' },
  reports_low_stock:          { label: 'Low Stock',               section: 'Reports — Inventory',   description: 'Items below reorder level' },
  reports_near_expiry:        { label: 'Near Expiry',             section: 'Reports — Inventory',   description: 'Products approaching expiry' },
  reports_po_status:          { label: 'PO Status',               section: 'Reports — Inventory',   description: 'Purchase order status tracker' },
  reports_receivings:         { label: 'Receiving History',       section: 'Reports — Inventory',   description: 'Goods receiving history' },
  reports_transfers:          { label: 'Transfer History',        section: 'Reports — Inventory',   description: 'Stock transfer records' },
  reports_adjustments:        { label: 'Adjustments',             section: 'Reports — Inventory',   description: 'Inventory adjustment history' },
  reports_physical_count:     { label: 'Count Variance',          section: 'Reports — Inventory',   description: 'Physical count variance report' },
  // Reports — Finance
  reports_payable_aging:      { label: 'Payable Aging',           section: 'Reports — Finance',     description: 'Aging schedule of payables' },
  reports_profit_loss:        { label: 'Profit and Loss',         section: 'Reports — Finance',     description: 'P&L statement' },
  reports_upcoming_dues:      { label: 'Upcoming Dues',           section: 'Reports — Finance',     description: 'Upcoming payment obligations' },
  reports_recurring_obligations: { label: 'Recurring Dues Report',section: 'Reports — Finance',     description: 'Recurring obligations report' },
  reports_projected_balance:  { label: 'Projected Balance',       section: 'Reports — Finance',     description: 'Future cash position projections' },
  reports_liquidity:          { label: 'Liquidity Snapshot',      section: 'Reports — Finance',     description: 'Current liquidity position' },
  reports_deposits_transit:   { label: 'Deposits In Transit',     section: 'Reports — Finance',     description: 'Uncleared GCash deposits' },
  reports_bank_reconciliation:{ label: 'Bank Reconciliation',     section: 'Reports — Finance',     description: 'Bank reconciliation report' },
  reports_owner_movements:    { label: 'Owner Ledger Report',     section: 'Reports — Finance',     description: 'Owner movement history report' },
  // Inventory — Stock
  inventory:          { label: 'Inventory Overview',      section: 'Inventory — Stock',       description: 'Inventory dashboard' },
  inventory_stock:    { label: 'Stock List',               section: 'Inventory — Stock',       description: 'All products and stock levels' },
  inventory_ledger:   { label: 'Stock Ledger',             section: 'Inventory — Stock',       description: 'Per-product stock movement ledger' },
  // Inventory — Procurement
  inventory_purchase_orders: { label: 'Purchase Orders',   section: 'Inventory — Procurement', description: 'Create and manage purchase orders' },
  inventory_receivings:      { label: 'Goods Receiving',   section: 'Inventory — Procurement', description: 'Record received goods from suppliers' },
  inventory_payables:        { label: 'Accounts Payable',  section: 'Inventory — Procurement', description: 'Track amounts owed to suppliers' },
  // Inventory — Operations
  inventory_transfers:       { label: 'Stock Transfers',   section: 'Inventory — Operations',  description: 'Transfer stock between locations' },
  inventory_adjustments:     { label: 'Adjustments',       section: 'Inventory — Operations',  description: 'Manual stock adjustments' },
  inventory_physical_counts: { label: 'Physical Count',    section: 'Inventory — Operations',  description: 'Physical stock count sessions' },
  inventory_product_lots:    { label: 'Product Lots',      section: 'Inventory — Operations',  description: 'Lot and expiry tracking' },
  // Inventory — Catalog
  inventory_products:   { label: 'Products',               section: 'Inventory — Catalog',     description: 'Product catalog management' },
  inventory_categories: { label: 'Categories',             section: 'Inventory — Catalog',     description: 'Product category management' },
  inventory_brands:     { label: 'Brands',                 section: 'Inventory — Catalog',     description: 'Brand management' },
  inventory_units:      { label: 'Units of Measure',       section: 'Inventory — Catalog',     description: 'Units of measure management' },
  // Suppliers
  inventory_suppliers: { label: 'Supplier List',           section: 'Suppliers',               description: 'Inventory supplier directory' },
  finance_suppliers:   { label: 'Finance Suppliers & Ledger', section: 'Suppliers',            description: 'Finance supplier list and ledger' },
};

export const ALL_FEATURE_KEYS = Object.keys(FEATURE_DEFS) as FeatureKey[];

export const SECTION_ORDER: FeatureSection[] = [
  'GCash',
  'Finance',
  'Payroll',
  'POS',
  'Reports — Sales & POS',
  'Reports — Inventory',
  'Reports — Finance',
  'Inventory — Stock',
  'Inventory — Procurement',
  'Inventory — Operations',
  'Inventory — Catalog',
  'Suppliers',
];

// Default features per role (admin always bypasses this — gets everything)
export const ROLE_DEFAULT_FEATURES: Record<UserRole, FeatureKey[]> = {
  admin: ALL_FEATURE_KEYS,
  accounting: ALL_FEATURE_KEYS,
  staff: [
    'gcash_dashboard', 'gcash_cash_in', 'gcash_cash_out',
    'gcash_remittances', 'gcash_transactions', 'gcash_history',
    'cash_ledger',
  ],
  cashier: [
    'gcash_dashboard', 'gcash_cash_in', 'gcash_cash_out',
    'gcash_transactions', 'gcash_history',
    'pos', 'pos_customers', 'timeclock', 'price_checker',
  ],
};

// ── Path → feature mapping ────────────────────────────────────────────────────

function pathToFeature(path: string): FeatureKey | null {
  // GCash
  if (path === '/gcash')          return 'gcash_dashboard';
  if (path === '/cash-in')        return 'gcash_cash_in';
  if (path === '/cash-out')       return 'gcash_cash_out';
  if (path === '/remittances')    return 'gcash_remittances';
  if (path === '/transactions')   return 'gcash_transactions';
  if (path === '/history')        return 'gcash_history';
  // Finance
  if (path === '/cash-ledger')    return 'cash_ledger';
  if (path === '/bank' || path === '/bank-reconciliations') return 'bank';
  if (path === '/finance-deposits') return 'finance_deposits';
  if (path === '/owner-movements')  return 'owner_movements';
  if (path === '/recurring-obligations') return 'recurring_obligations';
  if (path === '/checks')         return 'checks';
  if (path === '/disbursements')  return 'disbursements';
  // Payroll
  if (path === '/payroll')                   return 'payroll';
  if (path === '/payroll/employees')         return 'payroll_employees';
  if (path === '/payroll/departments')       return 'payroll_departments';
  if (path === '/payroll/timelogs')          return 'payroll_timelogs';
  if (path === '/payroll/attendance')        return 'payroll_attendance';
  if (path === '/payroll/biometrics')        return 'payroll_biometrics';
  if (path === '/payroll/cutoffs')           return 'payroll_cutoffs';
  if (path === '/payroll/processing')        return 'payroll_processing';
  if (path === '/payroll/cash-advances')     return 'payroll_cash_advances';
  if (path === '/payroll/holidays')          return 'payroll_holidays';
  if (path === '/payroll/settings')          return 'payroll_settings';
  if (path === '/payroll/reports')           return 'payroll_reports';
  // POS
  if (path === '/inventory/pos' || path === '/inventory/pos/open-shift' ||
      path.startsWith('/inventory/pos/session/')) return 'pos';
  if (path === '/inventory/pos/customers')   return 'pos_customers';
  if (path === '/timeclock' || path === '/timeclock/app') return 'timeclock';
  if (path === '/price-checker' || path === '/price-checker/kiosk' ||
      path === '/price-checker/app') return 'price_checker';
  if (path === '/inventory/pos/shifts')      return 'pos_shifts';
  if (path === '/inventory/pos/terminals')   return 'pos_terminals';
  // Reports
  if (path === '/reports')                           return 'reports';
  if (path === '/reports/daily-sales')               return 'reports_daily_sales';
  if (path === '/reports/sales-details-summary')     return 'reports_sales_details';
  if (path === '/reports/product-summary-sales')     return 'reports_product_sales';
  if (path === '/reports/cashier-sales')             return 'reports_cashier_sales';
  if (path === '/reports/xz-reading')                return 'reports_xz_reading';
  if (path === '/reports/inventory')                 return 'reports_inventory';
  if (path === '/reports/stock-movement')            return 'reports_stock_movement';
  if (path === '/reports/low-stock')                 return 'reports_low_stock';
  if (path === '/reports/near-expiry')               return 'reports_near_expiry';
  if (path === '/reports/po-status')                 return 'reports_po_status';
  if (path === '/reports/receivings')                return 'reports_receivings';
  if (path === '/reports/transfers')                 return 'reports_transfers';
  if (path === '/reports/adjustments')               return 'reports_adjustments';
  if (path === '/reports/physical-count-variance')   return 'reports_physical_count';
  if (path === '/reports/payable-aging')             return 'reports_payable_aging';
  if (path === '/reports/profit-loss')               return 'reports_profit_loss';
  if (path === '/reports/upcoming-dues')             return 'reports_upcoming_dues';
  if (path === '/reports/recurring-obligations')     return 'reports_recurring_obligations';
  if (path === '/reports/projected-balance')         return 'reports_projected_balance';
  if (path === '/reports/liquidity-snapshot')        return 'reports_liquidity';
  if (path === '/reports/deposits-in-transit')       return 'reports_deposits_transit';
  if (path === '/reports/bank-reconciliations')      return 'reports_bank_reconciliation';
  if (path === '/reports/owner-movements')           return 'reports_owner_movements';
  // Inventory
  if (path === '/inventory')                        return 'inventory';
  if (path === '/inventory/stock')                  return 'inventory_stock';
  if (path === '/inventory/ledger')                 return 'inventory_ledger';
  if (path === '/inventory/purchase-orders')        return 'inventory_purchase_orders';
  if (path === '/inventory/receivings')             return 'inventory_receivings';
  if (path === '/inventory/payables')               return 'inventory_payables';
  if (path === '/inventory/transfers')              return 'inventory_transfers';
  if (path === '/inventory/adjustments')            return 'inventory_adjustments';
  if (path === '/inventory/physical-counts')        return 'inventory_physical_counts';
  if (path === '/inventory/product-lots')           return 'inventory_product_lots';
  if (path === '/inventory/products')               return 'inventory_products';
  if (path === '/inventory/categories')             return 'inventory_categories';
  if (path === '/inventory/brands')                 return 'inventory_brands';
  if (path === '/inventory/units')                  return 'inventory_units';
  // Suppliers
  if (path === '/inventory/suppliers')              return 'inventory_suppliers';
  if (path === '/suppliers' || path === '/supplier-ledger') return 'finance_suppliers';

  return null;
}

// Parse feature access JSON stored in module_access column (null = use role defaults)
export function parseModuleAccess(raw: string | null | undefined): FeatureKey[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as FeatureKey[];
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

// Paths always accessible to any authenticated user (no feature key needed)
const ALWAYS_ALLOWED_EXACT = new Set(['/dashboard']);

// Paths only admin can ever access
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
 * Pass `featureAccess` (parsed from profile.module_access) for per-user overrides.
 * When null, falls back to ROLE_DEFAULT_FEATURES for the role.
 */
export function canAccessPath(
  role: UserRole | null | undefined,
  rawPath: string,
  featureAccess?: FeatureKey[] | null,
): boolean {
  if (!role) return false;
  if (role === 'admin') return true;

  const path = normalizePath(rawPath);

  if (ALWAYS_ALLOWED_EXACT.has(path)) return true;
  if (ADMIN_ONLY_EXACT.has(path))     return false;

  const allowed = featureAccess ?? ROLE_DEFAULT_FEATURES[role] ?? [];
  const feature = pathToFeature(path);
  if (!feature) return false;
  return allowed.includes(feature);
}

// ── Legacy aliases (keep existing callers working) ────────────────────────────
export type ModuleKey = FeatureKey;
export const MODULE_DEFS = FEATURE_DEFS as any;
export const ALL_MODULE_KEYS = ALL_FEATURE_KEYS;
export const ROLE_DEFAULT_MODULES = ROLE_DEFAULT_FEATURES;
