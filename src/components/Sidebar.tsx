import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowDownCircle,
  ArrowUpCircle,
  List,
  History,
  Settings,
  Users,
  ScrollText,
  LogOut,
  Wallet,
  X,
  Banknote,
  Building2,
  FileText,
  CreditCard,
  Truck,
  BarChart2,
  ChevronDown,
  ChevronRight,
  ArrowRightLeft,
  Package,
  Layers,
  Tag,
  Ruler,
  MapPin,
  LayoutList,
  BookOpen,
  ShoppingCart,
  Calendar,
  Receipt,
  ClipboardList,
  ScanLine,
  ShoppingBag,
  MonitorSmartphone,
  Clock,
  TrendingUp,
  AlertTriangle,
  Upload,
  RefreshCcw,
  Warehouse,
  UserCheck,
  CalendarDays,
  Fingerprint,
  Sun,
  PlayCircle,
  PieChart,
  Sliders,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import { canAccessPath, getUserRoleLabel } from '../lib/accessControl';
import { useCompanySettings } from '../contexts/CompanySettingsContext';
import { resolveApiBase } from '../lib/apiBase';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
}

interface NavSubGroup {
  label: string;
  icon: React.ElementType;
  items: NavItem[];
}

type NavChild = NavItem | NavSubGroup;

function isSubGroup(child: NavChild): child is NavSubGroup {
  return 'items' in child;
}

interface NavGroup {
  label: string;
  icon: React.ElementType;
  children: NavChild[];
}

function getAllItems(group: NavGroup): NavItem[] {
  return group.children.flatMap(c => (isSubGroup(c) ? c.items : [c]));
}

const topItems: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Overview' },
  { to: '/sales', icon: BarChart2, label: 'Sales Analytics' },
  { to: '/sales/manage', icon: Receipt, label: 'Daily Sales Entry' },
];

const navGroups: NavGroup[] = [
  {
    label: 'GCash',
    icon: Wallet,
    children: [
      { to: '/gcash', icon: Wallet, label: 'GCash Dashboard' },
      { to: '/cash-in', icon: ArrowDownCircle, label: 'Cash In' },
      { to: '/cash-out', icon: ArrowUpCircle, label: 'Cash Out' },
      { to: '/cash-ledger', icon: Banknote, label: 'Cash Ledger' },
      { to: '/remittances', icon: ArrowRightLeft, label: 'Remittances' },
      { to: '/transactions', icon: List, label: 'Transactions' },
      { to: '/history', icon: History, label: 'Daily History' },
    ],
  },
  {
    label: 'Finance',
    icon: Building2,
    children: [
      { to: '/bank', icon: Building2, label: 'Bank' },
      { to: '/finance-deposits', icon: ArrowDownCircle, label: 'GCash Deposits' },
      { to: '/owner-movements', icon: Banknote, label: 'Owner Ledger' },
      { to: '/recurring-obligations', icon: Calendar, label: 'Recurring Dues' },
      { to: '/bank-reconciliations', icon: BookOpen, label: 'Reconciliation' },
      { to: '/checks', icon: FileText, label: 'Checks Issued' },
      { to: '/disbursements', icon: CreditCard, label: 'Disbursements' },
      { to: '/historical-import', icon: Upload, label: 'Historical Import' },
      {
        label: 'Payroll',
        icon: UserCheck,
        items: [
          { to: '/payroll', icon: LayoutDashboard, label: 'Payroll Dashboard' },
          { to: '/payroll/employees',    icon: Users,        label: 'Employees' },
          { to: '/payroll/departments',  icon: Building2,    label: 'Departments & Positions' },
          { to: '/payroll/timelogs',     icon: Clock,        label: 'Time Logs (DTR View)' },
          { to: '/payroll/attendance',   icon: ClipboardList, label: 'Manual DTR Override' },
          { to: '/payroll/biometrics',   icon: Fingerprint,  label: 'Biometrics Import' },
          { to: '/payroll/cutoffs',      icon: CalendarDays, label: 'Payroll Periods' },
          { to: '/payroll/processing',   icon: PlayCircle,   label: 'Process Payroll' },
          { to: '/payroll/cash-advances',icon: CreditCard,   label: 'Cash Advances' },
          { to: '/payroll/holidays',     icon: Sun,          label: 'Holidays' },
          { to: '/payroll/settings',     icon: Sliders,      label: 'Payroll Settings' },
          { to: '/payroll/reports',      icon: PieChart,     label: 'Payroll Reports' },
        ],
      },
    ],
  },
  {
    label: 'POS',
    icon: ShoppingBag,
    children: [
      { to: '/inventory/pos', icon: ShoppingBag, label: 'POS' },
      { to: '/price-checker', icon: ScanLine, label: 'Price Checker' },
      { to: '/inventory/pos/customers', icon: Users, label: 'Customer Ledger & Credit' },
      { to: '/timeclock/app', icon: Clock, label: 'Daily Time Record' },
      { to: '/inventory/pos/shifts', icon: Clock, label: 'POS Shifts' },
      { to: '/inventory/pos/terminals', icon: MonitorSmartphone, label: 'POS Terminals' },
    ],
  },
  {
    label: 'Reports',
    icon: TrendingUp,
    children: [
      { to: '/reports', icon: LayoutDashboard, label: 'Dashboard' },
      {
        label: 'Sales & POS',
        icon: TrendingUp,
        items: [
          { to: '/reports/daily-sales',           icon: TrendingUp, label: 'Daily Sales' },
          { to: '/reports/sales-details-summary', icon: Receipt,    label: 'Sales Details Summary' },
          { to: '/reports/product-summary-sales', icon: Package,    label: 'Product Summary Sales' },
          { to: '/reports/cashier-sales',         icon: BarChart2,  label: 'Cashier Sales' },
          { to: '/reports/xz-reading',            icon: BarChart2,  label: 'X/Z Reading' },
        ],
      },
      {
        label: 'Inventory & Purchasing',
        icon: Package,
        items: [
          { to: '/reports/inventory',               icon: Package,         label: 'Inventory On Hand' },
          { to: '/reports/stock-movement',          icon: BookOpen,        label: 'Stock Movement' },
          { to: '/reports/low-stock',               icon: AlertTriangle,   label: 'Low Stock' },
          { to: '/reports/near-expiry',             icon: Clock,           label: 'Near Expiry' },
          { to: '/reports/po-status',               icon: ShoppingCart,    label: 'PO Status' },
          { to: '/reports/receivings',              icon: ArrowDownCircle, label: 'Receiving History' },
          { to: '/reports/transfers',               icon: ArrowRightLeft,  label: 'Transfer History' },
          { to: '/reports/adjustments',             icon: ClipboardList,   label: 'Adjustments' },
          { to: '/reports/physical-count-variance', icon: ScanLine,        label: 'Count Variance' },
        ],
      },
      {
        label: 'Finance & Payables',
        icon: Building2,
        items: [
          { to: '/reports/payable-aging',         icon: Receipt,       label: 'Payable Aging' },
          { to: '/reports/profit-loss',          icon: TrendingUp,    label: 'Profit and Loss' },
          { to: '/reports/upcoming-dues',         icon: AlertTriangle, label: 'Upcoming Dues' },
          { to: '/reports/recurring-obligations', icon: Calendar,      label: 'Recurring Dues' },
          { to: '/reports/projected-balance',     icon: Building2,     label: 'Projected Balance' },
          { to: '/reports/liquidity-snapshot',    icon: TrendingUp,    label: 'Liquidity Snapshot' },
          { to: '/reports/deposits-in-transit',   icon: ArrowDownCircle, label: 'Deposits In Transit' },
          { to: '/reports/bank-reconciliations',  icon: BookOpen,      label: 'Bank Reconciliation' },
          { to: '/reports/owner-movements',       icon: Wallet,        label: 'Owner Ledger' },
        ],
      },
    ],
  },
  {
    label: 'Inventory',
    icon: Package,
    children: [
      { to: '/inventory', icon: LayoutDashboard, label: 'Overview' },
      {
        label: 'Stock',
        icon: Warehouse,
        items: [
          { to: '/inventory/stock',  icon: LayoutList, label: 'Stock List' },
          { to: '/inventory/ledger', icon: BookOpen,   label: 'Stock Ledger' },
        ],
      },
      {
        label: 'Procurement',
        icon: ShoppingCart,
        items: [
          { to: '/inventory/purchase-orders', icon: ShoppingCart,    label: 'Purchase Orders' },
          { to: '/inventory/receivings',       icon: ArrowDownCircle, label: 'Goods Receiving' },
          { to: '/inventory/payables',         icon: Receipt,         label: 'Accounts Payable' },
        ],
      },
      {
        label: 'Operations',
        icon: RefreshCcw,
        items: [
          { to: '/inventory/transfers',      icon: ArrowRightLeft, label: 'Stock Transfers' },
          { to: '/inventory/adjustments',    icon: ClipboardList,  label: 'Adjustments' },
          { to: '/inventory/physical-counts',icon: ScanLine,       label: 'Physical Count' },
          { to: '/inventory/product-lots',   icon: Calendar,       label: 'Product Lots' },
        ],
      },
      {
        label: 'Catalog',
        icon: Layers,
        items: [
          { to: '/inventory/products',    icon: Package, label: 'Products' },
          { to: '/inventory/categories',  icon: Layers,  label: 'Categories' },
          { to: '/inventory/brands',      icon: Tag,     label: 'Brands' },
          { to: '/inventory/units',       icon: Ruler,   label: 'Units' },
        ],
      },
    ],
  },
  {
    label: 'Suppliers',
    icon: Truck,
    children: [
      { to: '/inventory/suppliers', icon: Truck,     label: 'Supplier List' },
      { to: '/suppliers',           icon: FileText,  label: 'Finance Suppliers' },
      { to: '/supplier-ledger',     icon: BookOpen,  label: 'Supplier Ledger' },
    ],
  },
];

const adminItems: NavItem[] = [
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/audit-logs', icon: ScrollText, label: 'Audit Logs' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar({ open, onClose }: SidebarProps) {
  const { profile, signOut, user } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const { settings: companySettings } = useCompanySettings();

  const role = profile?.role;

  const visibleTopItems = topItems.filter(item => canAccessPath(role, item.to));
  const visibleNavGroups = navGroups
    .map(group => ({
      ...group,
      children: group.children
        .map(child => {
          if (isSubGroup(child)) {
            const items = child.items.filter(item => canAccessPath(role, item.to));
            return items.length > 0 ? { ...child, items } : null;
          }
          return canAccessPath(role, child.to) ? child : null;
        })
        .filter((child): child is NavChild => child !== null),
    }))
    .filter(group => group.children.length > 0);
  const visibleAdminItems = adminItems.filter(item => canAccessPath(role, item.to));

  const groupIsActive = (group: NavGroup) =>
    getAllItems(group).some(item => location.pathname === item.to);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    navGroups.forEach(g => {
      init[g.label] = getAllItems(g).some(item => location.pathname === item.to);
      g.children.forEach(c => {
        if (isSubGroup(c)) {
          init[`${g.label}:${c.label}`] = c.items.some(item => location.pathname === item.to);
        }
      });
    });
    return init;
  });

  function toggleGroup(key: string) {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSignOut() {
    await writeAuditLog(user?.id ?? null, 'LOGOUT', 'Auth');
    await signOut();
    showToast('Signed out successfully', 'success');
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
      isActive
        ? 'bg-blue-600 text-white shadow-sm'
        : 'text-slate-300 hover:bg-slate-700 hover:text-white'
    }`;

  const subLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 pl-9 pr-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
      isActive
        ? 'bg-blue-600 text-white shadow-sm'
        : 'text-slate-400 hover:bg-slate-700 hover:text-white'
    }`;

  const subGroupHeaderClass = (isActive: boolean, isExpanded: boolean) =>
    `w-full flex items-center gap-3 pl-7 pr-4 py-2 rounded-lg text-sm font-medium transition-all ${
      isActive && !isExpanded
        ? 'text-blue-400 bg-slate-800'
        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
    }`;

  const subSubLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 pl-12 pr-4 py-2 rounded-lg text-sm transition-all ${
      isActive
        ? 'bg-blue-600 text-white shadow-sm'
        : 'text-slate-400 hover:bg-slate-700 hover:text-white'
    }`;

  const logoSrc = companySettings.logo_url
    ? (companySettings.logo_url.startsWith('http') ? companySettings.logo_url : `${resolveApiBase()}${companySettings.logo_url}`)
    : '/app-logo.png';

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-slate-900 z-30 flex flex-col transition-transform duration-300 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center overflow-hidden shadow-sm">
              <img src={logoSrc} alt="App logo" className="w-full h-full object-contain" />
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-none">{companySettings.app_title?.trim() || companySettings.company_name || 'My Business'}</p>
              <p className="text-slate-400 text-xs mt-0.5">{companySettings.branch_name?.trim() || 'Business Manager'}</p>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {/* Top-level items — admin only */}
          {visibleTopItems.map(item => (
            <NavLink key={item.to} to={item.to} className={linkClass} onClick={onClose}>
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </NavLink>
          ))}

          {visibleNavGroups.map(group => {
            const expanded = !!expandedGroups[group.label];
            const active = groupIsActive(group);
            return (
              <div key={group.label}>
                <button
                  onClick={() => toggleGroup(group.label)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                    active && !expanded
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <group.icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 text-left">{group.label}</span>
                  {expanded
                    ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                  }
                </button>

                {expanded && (
                  <div className="mt-1 space-y-0.5">
                    {group.children.map(child => {
                      if (isSubGroup(child)) {
                        const subKey = `${group.label}:${child.label}`;
                        const subExpanded = !!expandedGroups[subKey];
                        const subActive = child.items.some(i => location.pathname === i.to);
                        return (
                          <div key={child.label}>
                            <button
                              onClick={() => toggleGroup(subKey)}
                              className={subGroupHeaderClass(subActive, subExpanded)}
                            >
                              <child.icon className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="flex-1 text-left">{child.label}</span>
                              {subExpanded
                                ? <ChevronDown className="w-3 h-3 text-slate-600" />
                                : <ChevronRight className="w-3 h-3 text-slate-600" />
                              }
                            </button>
                            {subExpanded && (
                              <div className="mt-0.5 space-y-0.5">
                                {child.items.map(item => (
                                  <NavLink key={item.to} to={item.to} className={subSubLinkClass} onClick={onClose}>
                                    <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
                                    {item.label}
                                  </NavLink>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }
                      return (
                        <NavLink key={child.to} to={child.to} className={subLinkClass} onClick={onClose}>
                          <child.icon className="w-3.5 h-3.5 flex-shrink-0" />
                          {child.label}
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Admin */}
          {visibleAdminItems.length > 0 && (
            <>
              <div className="pt-4 pb-2 px-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Admin</p>
              </div>
              {visibleAdminItems.map(item => (
                <NavLink key={item.to} to={item.to} className={linkClass} onClick={onClose}>
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-sm font-bold">
                {profile?.name?.charAt(0)?.toUpperCase() || '?'}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-medium truncate">{profile?.name}</p>
              <p className="text-slate-400 text-xs">{getUserRoleLabel(profile?.role)}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-all"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
