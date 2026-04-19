import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import PriceCheckerPage from './pages/PriceCheckerPage';
import GCashDashboardPage from './pages/GCashDashboardPage';
import BankPage from './pages/BankPage';
import CashInPage from './pages/CashInPage';
import CashOutPage from './pages/CashOutPage';
import TransactionsPage from './pages/TransactionsPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';
import AuditLogsPage from './pages/AuditLogsPage';
import CashLedgerPage from './pages/CashLedgerPage';
import ChecksPage from './pages/ChecksPage';
import DisbursementsPage from './pages/DisbursementsPage';
import SuppliersPage from './pages/SuppliersPage';
import FinanceSupplierLedgerPage from './pages/FinanceSupplierLedgerPage';
import SalesPage from './pages/SalesPage';
import SalesAnalyticsPage from './pages/SalesAnalyticsPage';
import RemittancePage from './pages/RemittancePage';
import FinanceDepositsPage from './pages/FinanceDepositsPage';
import FinanceOwnerMovementsPage from './pages/FinanceOwnerMovementsPage';
import RecurringObligationsPage from './pages/RecurringObligationsPage';
import BankReconciliationPage from './pages/BankReconciliationPage';
import InvDashboardPage from './inventory/pages/InvDashboardPage';
import InvProductsPage from './inventory/pages/InvProductsPage';
import InvSuppliersPage from './inventory/pages/InvSuppliersPage';
import InvLocationsPage from './inventory/pages/InvLocationsPage';
import InvCategoriesPage from './inventory/pages/InvCategoriesPage';
import InvBrandsPage from './inventory/pages/InvBrandsPage';
import InvUnitsPage from './inventory/pages/InvUnitsPage';
import InvStockListPage from './inventory/pages/InvStockListPage';
import InvStockLedgerPage from './inventory/pages/InvStockLedgerPage';
import InvOpeningBalancePage from './inventory/pages/InvOpeningBalancePage';
import PoListPage from './inventory/pages/PoListPage';
import PoDetailPage from './inventory/pages/PoDetailPage';
import PoFormPage from './inventory/pages/PoFormPage';
import ReceivingListPage from './inventory/pages/ReceivingListPage';
import ReceivingDetailPage from './inventory/pages/ReceivingDetailPage';
import ReceivingFormPage from './inventory/pages/ReceivingFormPage';
import ProductLotsPage from './inventory/pages/ProductLotsPage';
import PayablesListPage from './inventory/pages/PayablesListPage';
import PayableDetailPage from './inventory/pages/PayableDetailPage';
import SupplierLedgerPage from './inventory/pages/SupplierLedgerPage';
import StockTransferListPage from './inventory/pages/StockTransferListPage';
import StockTransferFormPage from './inventory/pages/StockTransferFormPage';
import StockTransferDetailPage from './inventory/pages/StockTransferDetailPage';
import AdjustmentListPage from './inventory/pages/AdjustmentListPage';
import AdjustmentFormPage from './inventory/pages/AdjustmentFormPage';
import AdjustmentDetailPage from './inventory/pages/AdjustmentDetailPage';
import AdjustmentDailySummaryPage from './inventory/pages/AdjustmentDailySummaryPage';
import PhysicalCountListPage from './inventory/pages/PhysicalCountListPage';
import PhysicalCountFormPage from './inventory/pages/PhysicalCountFormPage';
import InvImportPage from './inventory/pages/InvImportPage';
import PhysicalCountSheetPage from './inventory/pages/PhysicalCountSheetPage';
import PhysicalCountVariancePage from './inventory/pages/PhysicalCountVariancePage';
import PosLandingPage from './pos/pages/PosLandingPage';
import PosCustomersPage from './pos/pages/PosCustomersPage';
import PosTerminalsPage from './pos/pages/PosTerminalsPage';
import ShiftOpenPage from './pos/pages/ShiftOpenPage';
import ShiftListPage from './pos/pages/ShiftListPage';
import PosSessionPage from './pos/pages/PosSessionPage';
import PublicHoldSlipPage from './pos/pages/PublicHoldSlipPage';
import ReportsDashboardPage from './reports/pages/ReportsDashboardPage';
import DailySalesReportPage from './reports/pages/DailySalesReportPage';
import SalesDetailsSummaryReportPage from './reports/pages/SalesDetailsSummaryReportPage';
import ProductSummarySalesReportPage from './reports/pages/ProductSummarySalesReportPage';
import ProfitAndLossReportPage from './reports/pages/ProfitAndLossReportPage';
import CashierSalesReportPage from './reports/pages/CashierSalesReportPage';
import InventoryOnHandReportPage from './reports/pages/InventoryOnHandReportPage';
import StockMovementReportPage from './reports/pages/StockMovementReportPage';
import LowStockReportPage from './reports/pages/LowStockReportPage';
import NearExpiryReportPage from './reports/pages/NearExpiryReportPage';
import PoStatusReportPage from './reports/pages/PoStatusReportPage';
import ReceivingHistoryReportPage from './reports/pages/ReceivingHistoryReportPage';
import PayableAgingReportPage from './reports/pages/PayableAgingReportPage';
import TransferHistoryReportPage from './reports/pages/TransferHistoryReportPage';
import AdjustmentHistoryReportPage from './reports/pages/AdjustmentHistoryReportPage';
import PhysicalCountVarianceReportPage from './reports/pages/PhysicalCountVarianceReportPage';
import XZReadingReportPage from './reports/pages/XZReadingReportPage';
import ProjectedBalanceReportPage from './reports/pages/ProjectedBalanceReportPage';
import DepositsInTransitReportPage from './reports/pages/DepositsInTransitReportPage';
import OwnerMovementsReportPage from './reports/pages/OwnerMovementsReportPage';
import RecurringObligationsReportPage from './reports/pages/RecurringObligationsReportPage';
import UpcomingDuesReportPage from './reports/pages/UpcomingDuesReportPage';
import LiquiditySnapshotReportPage from './reports/pages/LiquiditySnapshotReportPage';
import BankReconciliationReportPage from './reports/pages/BankReconciliationReportPage';
import { ALL_USER_ROLES, getDefaultRouteForRole } from './lib/accessControl';
import { UserRole } from './lib/types';
import PayrollDashboardPage from './payroll/pages/PayrollDashboardPage';
import EmployeesPage from './payroll/pages/EmployeesPage';
import EmployeeFormPage from './payroll/pages/EmployeeFormPage';
import DepartmentsPage from './payroll/pages/DepartmentsPage';
import AttendancePage from './payroll/pages/AttendancePage';
import BiometricsImportPage from './payroll/pages/BiometricsImportPage';
import CutoffsPage from './payroll/pages/CutoffsPage';
import PayrollProcessingPage from './payroll/pages/PayrollProcessingPage';
import CashAdvancePage from './payroll/pages/CashAdvancePage';
import HolidaysPage from './payroll/pages/HolidaysPage';
import PayrollSettingsPage from './payroll/pages/PayrollSettingsPage';
import PayrollReportsPage from './payroll/pages/PayrollReportsPage';
import PayslipPrintPage from './payroll/pages/PayslipPrintPage';
import TimeClockPage from './payroll/pages/TimeClockPage';
import TimeLogsPage from './payroll/pages/TimeLogsPage';
// CompanySettingsPage is now embedded in SettingsPage's Global Settings tab
import { CompanySettingsProvider } from './contexts/CompanySettingsContext';

function RoleRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: UserRole[] }) {
  const { profile, loading } = useAuth();
  if (loading) return null;
  if (!profile?.role || !allowedRoles.includes(profile.role)) {
    return <Navigate to={getDefaultRouteForRole(profile?.role)} replace />;
  }
  return <>{children}</>;
}

function PrivateRoutes() {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  const defaultRedirect = getDefaultRouteForRole(profile?.role);

  return (
    <Routes>
        <Route element={<Layout />}>
        <Route path="/gcash" element={<RoleRoute allowedRoles={ALL_USER_ROLES}><GCashDashboardPage /></RoleRoute>} />
        <Route path="/cash-in" element={<RoleRoute allowedRoles={['admin', 'staff']}><CashInPage /></RoleRoute>} />
        <Route path="/cash-out" element={<RoleRoute allowedRoles={['admin', 'staff']}><CashOutPage /></RoleRoute>} />
        <Route path="/cash-ledger" element={<RoleRoute allowedRoles={['admin', 'staff']}><CashLedgerPage /></RoleRoute>} />
        <Route path="/transactions" element={<RoleRoute allowedRoles={['admin', 'staff']}><TransactionsPage /></RoleRoute>} />
        <Route path="/history" element={<RoleRoute allowedRoles={['admin', 'staff']}><HistoryPage /></RoleRoute>} />
        <Route path="/remittances" element={<RoleRoute allowedRoles={['admin', 'staff']}><RemittancePage /></RoleRoute>} />

        <Route path="/dashboard" element={<RoleRoute allowedRoles={ALL_USER_ROLES}><DashboardPage /></RoleRoute>} />
        <Route path="/price-checker/app" element={<RoleRoute allowedRoles={ALL_USER_ROLES}><PriceCheckerPage /></RoleRoute>} />
        <Route path="/timeclock/app" element={<RoleRoute allowedRoles={ALL_USER_ROLES}><TimeClockPage /></RoleRoute>} />
        <Route path="/sales" element={<RoleRoute allowedRoles={['admin']}><SalesAnalyticsPage /></RoleRoute>} />
        <Route path="/sales/manage" element={<RoleRoute allowedRoles={['admin']}><SalesPage /></RoleRoute>} />
        <Route path="/bank" element={<RoleRoute allowedRoles={['admin']}><BankPage /></RoleRoute>} />
        <Route path="/finance-deposits" element={<RoleRoute allowedRoles={['admin']}><FinanceDepositsPage /></RoleRoute>} />
        <Route path="/owner-movements" element={<RoleRoute allowedRoles={['admin']}><FinanceOwnerMovementsPage /></RoleRoute>} />
        <Route path="/recurring-obligations" element={<RoleRoute allowedRoles={['admin']}><RecurringObligationsPage /></RoleRoute>} />
        <Route path="/bank-reconciliations" element={<RoleRoute allowedRoles={['admin']}><BankReconciliationPage /></RoleRoute>} />
        <Route path="/checks" element={<RoleRoute allowedRoles={['admin']}><ChecksPage /></RoleRoute>} />
        <Route path="/disbursements" element={<RoleRoute allowedRoles={['admin']}><DisbursementsPage /></RoleRoute>} />
        <Route path="/suppliers" element={<RoleRoute allowedRoles={['admin']}><SuppliersPage /></RoleRoute>} />
        <Route path="/supplier-ledger" element={<RoleRoute allowedRoles={['admin']}><FinanceSupplierLedgerPage /></RoleRoute>} />
        <Route path="/settings" element={<RoleRoute allowedRoles={['admin']}><SettingsPage /></RoleRoute>} />
        <Route path="/settings/company" element={<Navigate to="/settings?tab=global" replace />} />
        <Route path="/users" element={<RoleRoute allowedRoles={['admin']}><UsersPage /></RoleRoute>} />
        <Route path="/audit-logs" element={<RoleRoute allowedRoles={['admin']}><AuditLogsPage /></RoleRoute>} />

        <Route path="/inventory" element={<RoleRoute allowedRoles={['admin']}><InvDashboardPage /></RoleRoute>} />
        <Route path="/inventory/products" element={<RoleRoute allowedRoles={['admin']}><InvProductsPage /></RoleRoute>} />
        <Route path="/inventory/suppliers" element={<RoleRoute allowedRoles={['admin']}><InvSuppliersPage /></RoleRoute>} />
        <Route path="/inventory/locations" element={<RoleRoute allowedRoles={['admin']}><InvLocationsPage /></RoleRoute>} />
        <Route path="/inventory/categories" element={<RoleRoute allowedRoles={['admin']}><InvCategoriesPage /></RoleRoute>} />
        <Route path="/inventory/brands" element={<RoleRoute allowedRoles={['admin']}><InvBrandsPage /></RoleRoute>} />
        <Route path="/inventory/units" element={<RoleRoute allowedRoles={['admin']}><InvUnitsPage /></RoleRoute>} />
        <Route path="/inventory/stock" element={<RoleRoute allowedRoles={['admin']}><InvStockListPage /></RoleRoute>} />
        <Route path="/inventory/ledger" element={<RoleRoute allowedRoles={['admin']}><InvStockLedgerPage /></RoleRoute>} />
        <Route path="/inventory/opening-balance" element={<RoleRoute allowedRoles={['admin']}><InvOpeningBalancePage /></RoleRoute>} />
        <Route path="/inventory/purchase-orders" element={<RoleRoute allowedRoles={['admin']}><PoListPage /></RoleRoute>} />
        <Route path="/inventory/purchase-orders/new" element={<RoleRoute allowedRoles={['admin']}><PoFormPage /></RoleRoute>} />
        <Route path="/inventory/purchase-orders/:id" element={<RoleRoute allowedRoles={['admin']}><PoDetailPage /></RoleRoute>} />
        <Route path="/inventory/purchase-orders/:id/edit" element={<RoleRoute allowedRoles={['admin']}><PoFormPage /></RoleRoute>} />
        <Route path="/inventory/receivings" element={<RoleRoute allowedRoles={['admin']}><ReceivingListPage /></RoleRoute>} />
        <Route path="/inventory/receivings/new" element={<RoleRoute allowedRoles={['admin']}><ReceivingFormPage /></RoleRoute>} />
        <Route path="/inventory/receivings/:id" element={<RoleRoute allowedRoles={['admin']}><ReceivingDetailPage /></RoleRoute>} />
        <Route path="/inventory/receivings/:id/edit" element={<RoleRoute allowedRoles={['admin']}><ReceivingFormPage /></RoleRoute>} />
        <Route path="/inventory/product-lots" element={<RoleRoute allowedRoles={['admin']}><ProductLotsPage /></RoleRoute>} />
        <Route path="/inventory/transfers" element={<RoleRoute allowedRoles={['admin']}><StockTransferListPage /></RoleRoute>} />
        <Route path="/inventory/transfers/new" element={<RoleRoute allowedRoles={['admin']}><StockTransferFormPage /></RoleRoute>} />
        <Route path="/inventory/transfers/:id" element={<RoleRoute allowedRoles={['admin']}><StockTransferDetailPage /></RoleRoute>} />
        <Route path="/inventory/transfers/:id/edit" element={<RoleRoute allowedRoles={['admin']}><StockTransferFormPage /></RoleRoute>} />
        <Route path="/inventory/payables" element={<RoleRoute allowedRoles={['admin']}><PayablesListPage /></RoleRoute>} />
        <Route path="/inventory/payables/supplier-ledger" element={<RoleRoute allowedRoles={['admin']}><SupplierLedgerPage /></RoleRoute>} />
        <Route path="/inventory/payables/:id" element={<RoleRoute allowedRoles={['admin']}><PayableDetailPage /></RoleRoute>} />
        <Route path="/inventory/adjustments" element={<RoleRoute allowedRoles={['admin']}><AdjustmentListPage /></RoleRoute>} />
        <Route path="/inventory/adjustments/summary" element={<RoleRoute allowedRoles={['admin']}><AdjustmentDailySummaryPage /></RoleRoute>} />
        <Route path="/inventory/adjustments/new" element={<RoleRoute allowedRoles={['admin']}><AdjustmentFormPage /></RoleRoute>} />
        <Route path="/inventory/adjustments/:id" element={<RoleRoute allowedRoles={['admin']}><AdjustmentDetailPage /></RoleRoute>} />
        <Route path="/inventory/adjustments/:id/edit" element={<RoleRoute allowedRoles={['admin']}><AdjustmentFormPage /></RoleRoute>} />
        <Route path="/inventory/physical-counts" element={<RoleRoute allowedRoles={['admin']}><PhysicalCountListPage /></RoleRoute>} />
        <Route path="/inventory/physical-counts/new" element={<RoleRoute allowedRoles={['admin']}><PhysicalCountFormPage /></RoleRoute>} />
        <Route path="/inventory/physical-counts/:id/sheet" element={<RoleRoute allowedRoles={['admin']}><PhysicalCountSheetPage /></RoleRoute>} />
        <Route path="/inventory/physical-counts/:id/variance" element={<RoleRoute allowedRoles={['admin']}><PhysicalCountVariancePage /></RoleRoute>} />
        <Route path="/inventory/physical-counts/:id" element={<RoleRoute allowedRoles={['admin']}><PhysicalCountSheetPage /></RoleRoute>} />
        <Route path="/inventory/import" element={<RoleRoute allowedRoles={['admin']}><InvImportPage /></RoleRoute>} />

        <Route path="/reports" element={<RoleRoute allowedRoles={['admin']}><ReportsDashboardPage /></RoleRoute>} />
        <Route path="/reports/daily-sales" element={<RoleRoute allowedRoles={['admin']}><DailySalesReportPage /></RoleRoute>} />
        <Route path="/reports/sales-details-summary" element={<RoleRoute allowedRoles={['admin']}><SalesDetailsSummaryReportPage /></RoleRoute>} />
        <Route path="/reports/product-summary-sales" element={<RoleRoute allowedRoles={['admin']}><ProductSummarySalesReportPage /></RoleRoute>} />
        <Route path="/reports/profit-loss" element={<RoleRoute allowedRoles={['admin']}><ProfitAndLossReportPage /></RoleRoute>} />
        <Route path="/reports/cashier-sales" element={<RoleRoute allowedRoles={['admin']}><CashierSalesReportPage /></RoleRoute>} />
        <Route path="/reports/inventory" element={<RoleRoute allowedRoles={['admin']}><InventoryOnHandReportPage /></RoleRoute>} />
        <Route path="/reports/stock-movement" element={<RoleRoute allowedRoles={['admin']}><StockMovementReportPage /></RoleRoute>} />
        <Route path="/reports/low-stock" element={<RoleRoute allowedRoles={['admin']}><LowStockReportPage /></RoleRoute>} />
        <Route path="/reports/near-expiry" element={<RoleRoute allowedRoles={['admin']}><NearExpiryReportPage /></RoleRoute>} />
        <Route path="/reports/po-status" element={<RoleRoute allowedRoles={['admin']}><PoStatusReportPage /></RoleRoute>} />
        <Route path="/reports/receivings" element={<RoleRoute allowedRoles={['admin']}><ReceivingHistoryReportPage /></RoleRoute>} />
        <Route path="/reports/payable-aging" element={<RoleRoute allowedRoles={['admin']}><PayableAgingReportPage /></RoleRoute>} />
        <Route path="/reports/projected-balance" element={<RoleRoute allowedRoles={['admin']}><ProjectedBalanceReportPage /></RoleRoute>} />
        <Route path="/reports/deposits-in-transit" element={<RoleRoute allowedRoles={['admin']}><DepositsInTransitReportPage /></RoleRoute>} />
        <Route path="/reports/owner-movements" element={<RoleRoute allowedRoles={['admin']}><OwnerMovementsReportPage /></RoleRoute>} />
        <Route path="/reports/recurring-obligations" element={<RoleRoute allowedRoles={['admin']}><RecurringObligationsReportPage /></RoleRoute>} />
        <Route path="/reports/upcoming-dues" element={<RoleRoute allowedRoles={['admin']}><UpcomingDuesReportPage /></RoleRoute>} />
        <Route path="/reports/liquidity-snapshot" element={<RoleRoute allowedRoles={['admin']}><LiquiditySnapshotReportPage /></RoleRoute>} />
        <Route path="/reports/bank-reconciliations" element={<RoleRoute allowedRoles={['admin']}><BankReconciliationReportPage /></RoleRoute>} />
        <Route path="/reports/transfers" element={<RoleRoute allowedRoles={['admin']}><TransferHistoryReportPage /></RoleRoute>} />
        <Route path="/reports/adjustments" element={<RoleRoute allowedRoles={['admin']}><AdjustmentHistoryReportPage /></RoleRoute>} />
        <Route path="/reports/physical-count-variance" element={<RoleRoute allowedRoles={['admin']}><PhysicalCountVarianceReportPage /></RoleRoute>} />
        <Route path="/reports/xz-reading" element={<RoleRoute allowedRoles={['admin']}><XZReadingReportPage /></RoleRoute>} />

        {/* Payroll Module */}
        <Route path="/payroll" element={<RoleRoute allowedRoles={['admin']}><PayrollDashboardPage /></RoleRoute>} />
        <Route path="/payroll/employees" element={<RoleRoute allowedRoles={['admin']}><EmployeesPage /></RoleRoute>} />
        <Route path="/payroll/employees/new" element={<RoleRoute allowedRoles={['admin']}><EmployeeFormPage /></RoleRoute>} />
        <Route path="/payroll/employees/:id/edit" element={<RoleRoute allowedRoles={['admin']}><EmployeeFormPage /></RoleRoute>} />
        <Route path="/payroll/departments" element={<RoleRoute allowedRoles={['admin']}><DepartmentsPage /></RoleRoute>} />
        <Route path="/payroll/attendance" element={<RoleRoute allowedRoles={['admin']}><AttendancePage /></RoleRoute>} />
        <Route path="/payroll/biometrics" element={<RoleRoute allowedRoles={['admin']}><BiometricsImportPage /></RoleRoute>} />
        <Route path="/payroll/cutoffs" element={<RoleRoute allowedRoles={['admin']}><CutoffsPage /></RoleRoute>} />
        <Route path="/payroll/processing" element={<RoleRoute allowedRoles={['admin']}><PayrollProcessingPage /></RoleRoute>} />
        <Route path="/payroll/cash-advances" element={<RoleRoute allowedRoles={['admin']}><CashAdvancePage /></RoleRoute>} />
        <Route path="/payroll/holidays" element={<RoleRoute allowedRoles={['admin']}><HolidaysPage /></RoleRoute>} />
        <Route path="/payroll/settings" element={<RoleRoute allowedRoles={['admin']}><PayrollSettingsPage /></RoleRoute>} />
        <Route path="/payroll/reports" element={<RoleRoute allowedRoles={['admin']}><PayrollReportsPage /></RoleRoute>} />
        <Route path="/payroll/timelogs" element={<RoleRoute allowedRoles={['admin']}><TimeLogsPage /></RoleRoute>} />
        <Route path="/payroll/payslip/:runItemId" element={<RoleRoute allowedRoles={['admin']}><PayslipPrintPage /></RoleRoute>} />

        <Route path="/inventory/pos" element={<RoleRoute allowedRoles={['admin', 'cashier']}><PosLandingPage /></RoleRoute>} />
        <Route path="/inventory/pos/customers" element={<RoleRoute allowedRoles={['admin', 'cashier']}><PosCustomersPage /></RoleRoute>} />
        <Route path="/inventory/pos/terminals" element={<RoleRoute allowedRoles={['admin']}><PosTerminalsPage /></RoleRoute>} />
        <Route path="/inventory/pos/shifts" element={<RoleRoute allowedRoles={['admin']}><ShiftListPage /></RoleRoute>} />
        <Route path="/inventory/pos/open-shift" element={<RoleRoute allowedRoles={['admin', 'cashier']}><ShiftOpenPage /></RoleRoute>} />

        <Route path="*" element={<Navigate to={defaultRedirect} replace />} />
      </Route>

      {/* POS Session — fullscreen, no sidebar layout */}
      <Route path="/inventory/pos/session/:shiftId" element={<RoleRoute allowedRoles={['admin', 'cashier']}><PosSessionPage /></RoleRoute>} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <CompanySettingsProvider>
            <Routes>
              <Route path="/hold-slip/:heldSaleId" element={<PublicHoldSlipPage />} />
              <Route path="/timeclock" element={<TimeClockPage kioskMode />} />
              <Route path="/timeclock/kiosk" element={<TimeClockPage kioskMode />} />
              <Route path="/price-checker" element={<PriceCheckerPage kioskMode />} />
              <Route path="/price-checker/kiosk" element={<PriceCheckerPage kioskMode />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/*" element={<PrivateRoutes />} />
            </Routes>
          </CompanySettingsProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
