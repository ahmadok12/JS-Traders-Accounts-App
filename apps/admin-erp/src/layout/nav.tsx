import {
  Calculator,
  Gauge,
  Banknote,
  BookOpen,
  Boxes,
  ClipboardList,
  FileText,
  FolderTree,
  Handshake,
  LayoutDashboard,
  Package,
  Receipt,
  Ruler,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Truck,
  Users,
  UsersRound,
  UserSquare2,
  Warehouse,
  History,
  ScrollText,
  Ship,
  Landmark,
  CalendarClock,
  PackagePlus,
  ArrowLeftRight,
  SlidersHorizontal,
  ClipboardCheck,
  Wrench,
  Cylinder,
  ReceiptText,
  BookText,
  HandCoins,
  Wallet,
  Scale,
  CalendarRange,
  Bookmark,
  FileSignature,
  ListChecks,
  Smartphone,
  Coins,
} from "lucide-react";
import type * as React from "react";
import { P } from "@jst/permissions";

export interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perms?: string[];
  /** not built yet — shown disabled with its development stage */
  soon?: string;
  /** optional feature key (Settings → Features); hidden while the feature is off */
  feature?: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Navigation follows the ERP module structure (spec §3.1), filtered by role. */
export const NAV: NavGroup[] = [
  { label: "", items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }, { to: "/warehouse-desk", label: "Warehouse Desk", icon: Gauge, perms: [P.pickingManage] }] },
  {
    label: "Sales",
    items: [
      { to: "/customers", label: "Customers", icon: Users, perms: [P.customersView, P.customersViewAssigned] },
      { to: "/customer-groups", label: "Customer Groups", icon: UsersRound, perms: [P.customersView] },
      { to: "/reservations", label: "Reserved Orders", icon: Bookmark, perms: [P.inventoryView, P.salesView] },
      { to: "/quotations", label: "Quotations", icon: FileSignature, perms: [P.salesViewPrices] },
      { to: "/sales-orders", label: "Sales Orders", icon: ShoppingCart, perms: [P.salesView] },
      { to: "/picking", label: "Picking", icon: ListChecks, perms: [P.pickingManage] },
      { to: "/warehouse-staff", label: "Warehouse Staff", icon: UsersRound, perms: [P.pickingManage] },
      { to: "/gdn", label: "Dispatch (GDN)", icon: Truck, perms: [P.salesView, P.inventoryView] },
      { to: "/pricing", label: "Pricing", icon: Tag, perms: [P.salesViewPrices, P.pricingEnter] },
      { to: "/invoices", label: "Sales Invoices", icon: Receipt, perms: [P.salesViewPrices, P.journalsView] },
    ],
  },
  {
    label: "Purchasing",
    items: [
      { to: "/suppliers", label: "Suppliers", icon: Truck, perms: [P.suppliersView] },
      { to: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList, perms: [P.purchasingView] },
      { to: "/purchase-costs", label: "Purchase Costs", icon: Calculator, perms: [P.purchasingCosts] },
      { to: "/supplier-bills", label: "Supplier Bills", icon: Receipt, perms: [P.purchasingCosts] },
      { to: "/shipments", label: "Shipments", icon: Ship, perms: [P.purchasingView] },
      { to: "/landed-costs", label: "Landed Cost", icon: Calculator, perms: [P.purchasingCosts] },
    ],
  },
  {
    label: "Inventory",
    items: [
      { to: "/stock", label: "Stock on Hand", icon: Boxes, perms: [P.inventoryView] },
      { to: "/goods-receipts", label: "Goods Receipts", icon: PackagePlus, perms: [P.inventoryView] },
      { to: "/stock-transfers", label: "Transfers", icon: ArrowLeftRight, perms: [P.inventoryView] },
      { to: "/stock-adjustments", label: "Adjustments & Opening", icon: SlidersHorizontal, perms: [P.inventoryView] },
      { to: "/stock-counts", label: "Stock Counts", icon: ClipboardCheck, perms: [P.inventoryView] },
      { to: "/assembly", label: "Assembly", icon: Wrench, perms: [P.inventoryView] },
      { to: "/rolls", label: "Rolls", icon: Cylinder, perms: [P.inventoryView] },
      { to: "/stock-ledger", label: "Stock Movements", icon: History, perms: [P.inventoryView] },
      { to: "/stock-valuation", label: "Stock Value", icon: Coins, perms: [P.inventoryValuation] },
      { to: "/m", label: "Phone app (picking)", icon: Smartphone, perms: [P.pickingPerform] },
    ],
  },
  {
    label: "Products & Warehouses",
    items: [
      { to: "/products", label: "Products", icon: Package, perms: [P.productsView] },
      { to: "/warehouses", label: "Warehouses", icon: Warehouse, perms: [P.warehousesView] },
      { to: "/categories", label: "Categories", icon: FolderTree, perms: [P.productsView] },
      { to: "/brands", label: "Brands", icon: Tag, perms: [P.productsView], feature: "products.brands" },
      { to: "/units", label: "Units of Measure", icon: Ruler, perms: [P.productsView] },
    ],
  },
  {
    label: "Accounting",
    items: [
      { to: "/chart-of-accounts", label: "Chart of Accounts", icon: BookOpen, perms: [P.accountsView] },
      { to: "/bank-accounts", label: "Bank & Cash", icon: Banknote, perms: [P.banksView] },
      { to: "/payment-agents", label: "Payment Agents", icon: Handshake, perms: [P.paymentAgentsView] },
      { to: "/vouchers", label: "Vouchers & Journals", icon: ReceiptText, perms: [P.journalsView] },
      { to: "/statements", label: "Statements", icon: BookText, perms: [P.journalsView] },
      { to: "/receivables", label: "Receivables", icon: HandCoins, perms: [P.journalsView] },
      { to: "/payables", label: "Payables", icon: Landmark, perms: [P.journalsView] },
      { to: "/bank-book", label: "Cash & Bank Book", icon: Wallet, perms: [P.journalsView] },
      { to: "/trial-balance", label: "Trial Balance", icon: Scale, perms: [P.journalsView] },
      { to: "/periods", label: "Accounting Periods", icon: CalendarRange, perms: [P.journalsView, P.periodsManage] },
      { to: "/pdc", label: "PDC & Reconciliation", icon: CalendarClock, soon: "Stage 10" },
    ],
  },
  {
    label: "People",
    items: [
      { to: "/employees", label: "Employees", icon: UserSquare2, perms: [P.employeesView] },
      { to: "/hr", label: "HR & Pay", icon: UserSquare2, perms: [P.payrollView] },
      { to: "/payroll", label: "Payroll", icon: FileText, perms: [P.payrollView] },
    ],
  },
  {
    label: "Administration",
    items: [
      { to: "/users", label: "Users & Access", icon: ShieldCheck, perms: [P.usersView, P.securityManage] },
      { to: "/audit", label: "Audit Log", icon: ScrollText, perms: [P.auditView] },
      { to: "/settings", label: "Settings", icon: Settings, perms: [P.settingsManage] },
    ],
  },
];
