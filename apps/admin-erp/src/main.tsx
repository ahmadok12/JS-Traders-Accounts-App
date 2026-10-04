import * as React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AccessProvider, initSupabase, useAccess } from "@jst/data-access";
import { AppShell } from "./layout/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { P } from "@jst/permissions";
import { EntityPage } from "./entity/EntityPage";
import { ALL_ENTITIES } from "./entities/config";
import { INV_DOCS } from "./inventory/docConfigs";
import "./index.css";

initSupabase(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

// Route-level code splitting for heavier admin screens (spec §5.3)
const UsersPage = React.lazy(() => import("./pages/UsersPage").then((m) => ({ default: m.UsersPage })));
const AuditPage = React.lazy(() => import("./pages/AuditPage").then((m) => ({ default: m.AuditPage })));
const StockOnHandPage = React.lazy(() => import("./inventory/StockPages").then((m) => ({ default: m.StockOnHandPage })));
const StockLedgerPage = React.lazy(() => import("./inventory/StockPages").then((m) => ({ default: m.StockLedgerPage })));
const CountsPage = React.lazy(() => import("./inventory/CountsPage").then((m) => ({ default: m.CountsPage })));
const ReservationsPage = React.lazy(() => import("./inventory/ReservationsPage").then((m) => ({ default: m.ReservationsPage })));
const DocPage = React.lazy(() => import("./inventory/DocPage").then((m) => ({ default: m.DocPage })));
const VouchersPage = React.lazy(() => import("./accounting/VouchersPage").then((m) => ({ default: m.VouchersPage })));
const StatementsPage = React.lazy(() => import("./accounting/Statements").then((m) => ({ default: m.StatementsPage })));
const AccReports = () => import("./accounting/Reports");
const ReceivablesPage = React.lazy(() => AccReports().then((m) => ({ default: () => <m.BalancesPage partyType="CUSTOMER" /> })));
const PayablesPage = React.lazy(() => AccReports().then((m) => ({ default: () => <m.BalancesPage partyType="SUPPLIER" /> })));
const BankBookPage = React.lazy(() => AccReports().then((m) => ({ default: m.BankBookPage })));
const TrialBalancePage = React.lazy(() => AccReports().then((m) => ({ default: m.TrialBalancePage })));
const PeriodsPage = React.lazy(() => AccReports().then((m) => ({ default: m.PeriodsPage })));
const RollsPage = React.lazy(() => import("./inventory/RollsPage").then((m) => ({ default: m.RollsPage })));
const AssemblyPage = React.lazy(() => import("./inventory/AssemblyPage").then((m) => ({ default: m.AssemblyPage })));
const SalesOrdersPage = React.lazy(() => import("./sales/SalesOrdersPage").then((m) => ({ default: m.SalesOrdersPage })));
const GdnPage = React.lazy(() => import("./sales/GdnPage").then((m) => ({ default: m.GdnPage })));
const QuotationsPage = React.lazy(() => import("./sales/QuotationsPage").then((m) => ({ default: m.QuotationsPage })));
const PickingPage = React.lazy(() => import("./picking/PickingPage").then((m) => ({ default: m.PickingPage })));
const StaffPage = React.lazy(() => import("./picking/StaffPage").then((m) => ({ default: m.StaffPage })));
/** Warehouse managers (no accounting / prices) land on their Warehouse Desk; everyone else on the dashboard. */
function HomePage() {
  const { can } = useAccess();
  if (can(P.pickingManage) && !can(P.journalsView) && !can(P.salesViewPrices)) return lazy(<WarehouseDeskPage />);
  return <DashboardPage />;
}
const HrPage = React.lazy(() => import("./hr/HrPage").then((m) => ({ default: m.HrPage })));
const PayrollPage = React.lazy(() => import("./hr/PayrollPage").then((m) => ({ default: m.PayrollPage })));
const PurchaseOrdersPage = React.lazy(() => import("./purchasing/PurchaseOrdersPage").then((m) => ({ default: m.PurchaseOrdersPage })));
const CostsPage = React.lazy(() => import("./purchasing/CostsPage").then((m) => ({ default: m.CostsPage })));
const BillsPage = React.lazy(() => import("./purchasing/BillsPage").then((m) => ({ default: m.BillsPage })));
const PricingPage = React.lazy(() => import("./pricing/PricingPage").then((m) => ({ default: m.PricingPage })));
const WarehouseDeskPage = React.lazy(() => import("./picking/WarehouseDesk").then((m) => ({ default: m.WarehouseDeskPage })));
const StaffApp = React.lazy(() => import("./picking/StaffApp").then((m) => ({ default: m.StaffApp })));
const InvoicesPage = React.lazy(() => import("./sales/InvoicesPage").then((m) => ({ default: m.InvoicesPage })));
const SettingsPage = React.lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
    mutations: { retry: 0 }, // never auto-retry writes
  },
});

const entityRoutes = Object.values(ALL_ENTITIES)
  .filter((c) => c.key !== "branches")
  .map((c) => ({ path: c.key, element: <EntityPage key={c.key} config={c} /> }));

const lazy = (el: React.ReactNode) => <React.Suspense fallback={null}>{el}</React.Suspense>;

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/m", element: lazy(<StaffApp />) },
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      ...entityRoutes,
      { path: "stock", element: lazy(<StockOnHandPage />) },
      { path: "stock-ledger", element: lazy(<StockLedgerPage />) },
      { path: "stock-counts", element: lazy(<CountsPage />) },
      { path: "reservations", element: lazy(<ReservationsPage />) },
      { path: "assembly", element: lazy(<AssemblyPage />) },
      { path: "rolls", element: lazy(<RollsPage />) },
      { path: "vouchers", element: lazy(<VouchersPage />) },
      { path: "statements", element: lazy(<StatementsPage />) },
      { path: "receivables", element: lazy(<ReceivablesPage />) },
      { path: "payables", element: lazy(<PayablesPage />) },
      { path: "bank-book", element: lazy(<BankBookPage />) },
      { path: "trial-balance", element: lazy(<TrialBalancePage />) },
      { path: "periods", element: lazy(<PeriodsPage />) },
      { path: "sales-orders", element: lazy(<SalesOrdersPage />) },
      { path: "gdn", element: lazy(<GdnPage />) },
      { path: "quotations", element: lazy(<QuotationsPage />) },
      { path: "picking", element: lazy(<PickingPage />) },
      { path: "warehouse-staff", element: lazy(<StaffPage />) },
      { path: "warehouse-desk", element: lazy(<WarehouseDeskPage />) },
      { path: "pricing", element: lazy(<PricingPage />) },
      { path: "hr", element: lazy(<HrPage />) },
      { path: "purchase-orders", element: lazy(<PurchaseOrdersPage />) },
      { path: "purchase-costs", element: lazy(<CostsPage />) },
      { path: "supplier-bills", element: lazy(<BillsPage />) },
      { path: "payroll", element: lazy(<PayrollPage />) },
      { path: "invoices", element: lazy(<InvoicesPage />) },
      ...Object.values(INV_DOCS).map((c) => ({ path: c.route, element: lazy(<DocPage key={c.type} cfg={c} />) })),
      { path: "users", element: lazy(<UsersPage />) },
      { path: "audit", element: lazy(<AuditPage />) },
      { path: "settings", element: lazy(<SettingsPage />) },
      { path: "*", element: <div className="p-8 text-sm text-ink-muted">Page not found.</div> },
    ],
  },
]);

// Installable phone app (staff picking): register the service worker in production builds only
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AccessProvider>
        <RouterProvider router={router} />
        <Toaster position="top-center" offset={10} visibleToasts={3} duration={3000} closeButton toastOptions={{ className: "text-sm" }} />
      </AccessProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
