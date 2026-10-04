/**
 * Permission codes mirrored from public.permissions.
 * The UI uses these only to hide controls; PostgreSQL RLS + definer RPCs are
 * the actual enforcement (spec §2.1 invariant 2, §6).
 */
export const P = {
  settingsManage: "settings.manage",
  securityManage: "security.manage",
  usersView: "users.view",
  auditView: "audit.view",
  customersView: "customers.view",
  customersViewAssigned: "customers.view_assigned",
  customersManage: "customers.manage",
  customersViewFinancial: "customers.view_financial",
  suppliersView: "suppliers.view",
  suppliersManage: "suppliers.manage",
  suppliersViewFinancial: "suppliers.view_financial",
  productsView: "products.view",
  productsManage: "products.manage",
  warehousesView: "warehouses.view",
  warehousesAll: "warehouses.all",
  warehousesManage: "warehouses.manage",
  accountsView: "accounts.view",
  accountsManage: "accounts.manage",
  banksView: "banks.view",
  banksManage: "banks.manage",
  paymentAgentsView: "payment_agents.view",
  paymentAgentsManage: "payment_agents.manage",
  employeesView: "employees.view",
  employeesManage: "employees.manage",
  employeesViewRestricted: "employees.view_restricted",
  attachmentsView: "attachments.view",
  attachmentsManage: "attachments.manage",
  inventoryView: "inventory.view",
  inventoryReceive: "inventory.receive",
  inventoryTransfer: "inventory.transfer",
  inventoryAdjust: "inventory.adjust",
  inventoryCount: "inventory.count",
  inventoryPost: "inventory.post",
  inventoryReserve: "inventory.reserve",
  inventoryAssemble: "inventory.assemble",
  journalsView: "journals.view",
  journalsCreate: "journals.create",
  journalsPost: "journals.post",
  periodsManage: "periods.manage",
  salesView: "sales.view",
  salesManage: "sales.manage",
  salesApprove: "sales.approve",
  salesDispatch: "sales.dispatch",
  salesInvoice: "sales.invoice",
  salesViewPrices: "sales.view_prices",
  pickingManage: "picking.manage",
  pickingPerform: "picking.perform",
  pricingEnter: "pricing.enter",
  pricingApprove: "pricing.approve",
  payrollView: "payroll.view",
  payrollManage: "payroll.manage",
  payrollApprove: "payroll.approve",
  labourSupervise: "labour.supervise",
} as const;

export type PermissionCode = (typeof P)[keyof typeof P];

export const ROLE_LABELS: Record<string, string> = {
  ADMINISTRATOR: "Administrator",
  OWNER: "Owner",
  ACCOUNTANT: "Accountant",
  WAREHOUSE_MANAGER: "Warehouse Manager",
  WAREHOUSE_STAFF: "Warehouse Staff",
  SALESPERSON: "Salesperson",
};

export function canAny(perms: Set<string>, ...codes: string[]) {
  return codes.some((c) => perms.has(c));
}
