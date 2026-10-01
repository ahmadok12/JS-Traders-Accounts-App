import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Package, Truck, Users, Warehouse } from "lucide-react";
import { Card, PageHeader, SectionTitle, Skeleton, cn } from "@jst/ui";
import { sb, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";

function useCount(table: string, companyId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["count", table, companyId],
    enabled: !!companyId && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await sb().from(table).select("id", { count: "exact", head: true }).eq("company_id", companyId!).eq("is_active", true);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

const STAGES = [
  { n: "1", label: "Platform foundation — auth, roles, RLS, audit, numbering", done: true },
  { n: "2", label: "Master data — customers, suppliers, products, warehouses, COA, banks, agents, employees", done: true },
  { n: "3", label: "Inventory engine — stock movements, receipts, transfers, counts, reservations", done: true },
  { n: "4", label: "Accounting engine — journals, ledgers, periods, reversals", done: false },
  { n: "5–6", label: "Sales → GDN → pricing → invoice → receipt", done: false },
  { n: "6.5", label: "Employees, payroll, advances, assembly labour", done: false },
  { n: "7–9", label: "Purchasing, shipments, landed cost, FX & payment agents", done: false },
  { n: "10–12", label: "PDC, bank reconciliation, reports, configuration engine", done: false },
];

export function DashboardPage() {
  const { companyId, company, can } = useAccess();
  const kpis = [
    { label: "Active customers", icon: Users, to: "/customers", q: useCount("customers", companyId, can(P.customersView) || can(P.customersViewAssigned)) },
    { label: "Active suppliers", icon: Truck, to: "/suppliers", q: useCount("suppliers", companyId, can(P.suppliersView)) },
    { label: "Active products", icon: Package, to: "/products", q: useCount("products", companyId, can(P.productsView)) },
    { label: "Warehouses", icon: Warehouse, to: "/warehouses", q: useCount("warehouses", companyId, can(P.warehousesView)) },
  ];

  return (
    <div>
      <PageHeader title="Dashboard" description={company?.company_name} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Link key={k.label} to={k.to}>
            <Card className="p-4 transition-colors hover:border-line-strong">
              <div className="flex items-center justify-between text-xs text-ink-muted">
                {k.label}
                <k.icon className="h-4 w-4 text-ink-faint" />
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-ink">
                {k.q.isLoading ? <Skeleton className="h-7 w-12" /> : k.q.isError || k.q.data === undefined ? "—" : k.q.data.toLocaleString()}
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <SectionTitle>Operational queues</SectionTitle>
          {can(P.inventoryView) ? <InventoryQueues companyId={companyId} /> : <p className="text-sm text-ink-muted">No operational queues for your role yet.</p>}
          <p className="mt-3 text-2xs text-ink-faint">GDNs awaiting price, PDCs due and approvals will join this list as the sales and accounting stages go live.</p>
        </Card>
        <Card className="p-4">
          <SectionTitle>Build progress</SectionTitle>
          <ol className="space-y-1.5">
            {STAGES.map((s) => (
              <li key={s.n} className="flex items-start gap-2 text-xs">
                {s.done ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-success" /> : <Circle className="mt-px h-3.5 w-3.5 shrink-0 text-ink-faint" />}
                <span className={cn(s.done ? "text-ink" : "text-ink-muted")}>
                  <span className="font-medium">Stage {s.n}:</span> {s.label}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

function useHeadCount(key: string, companyId: string | null, build: () => PromiseLike<{ count: number | null; error: unknown }>) {
  return useQuery({ queryKey: ["dash", key, companyId], enabled: !!companyId, staleTime: 30_000, queryFn: async () => { const r = await build(); if (r.error) throw r.error; return r.count ?? 0; } });
}

function InventoryQueues({ companyId }: { companyId: string | null }) {
  const c = companyId!;
  const head = (t: string) => sb().from(t).select("id", { count: "exact", head: true }).eq("company_id", c);
  const items = [
    { label: "Draft receipts", to: "/goods-receipts?f=1", q: useHeadCount("grn", companyId, () => head("goods_receipts").eq("status", "DRAFT")) },
    { label: "Draft transfers", to: "/stock-transfers?f=1", q: useHeadCount("trf", companyId, () => head("stock_transfers").eq("status", "DRAFT")) },
    { label: "Adjustments awaiting approval", to: "/stock-adjustments?f=1", q: useHeadCount("adj", companyId, () => head("stock_adjustments").eq("status", "DRAFT")) },
    { label: "Receipts with cost pending", to: "/goods-receipts?f=2", q: useHeadCount("cost", companyId, () => head("goods_receipts").eq("status", "POSTED").eq("cost_status", "PENDING")) },
    { label: "Open stock counts", to: "/stock-counts", q: useHeadCount("cnt", companyId, () => head("stock_counts").eq("status", "OPEN")) },
    { label: "Negative stock items", to: "/stock?f=2", q: useHeadCount("neg", companyId, () => head("stock_on_hand").eq("is_negative", true)), danger: true },
    { label: "Low stock items", to: "/stock?f=1", q: useHeadCount("low", companyId, () => head("stock_on_hand").eq("is_low", true)), warn: true },
  ];
  return (
    <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
      {items.map((i) => {
        const n = i.q.data ?? 0;
        return (
          <Link key={i.label} to={i.to} className="flex items-center justify-between border-b border-line/70 py-2 text-sm hover:text-ink">
            <span className="text-ink-2">{i.label}</span>
            {i.q.isLoading ? <Skeleton className="h-4 w-6" /> : (
              <span className={cn("min-w-[28px] rounded-full px-2 text-center text-xs font-semibold tabular-nums", n === 0 ? "bg-field text-ink-faint" : i.danger ? "bg-danger-soft text-danger" : i.warn ? "bg-warning-soft text-warning" : "bg-info-soft text-info")}>{n}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
