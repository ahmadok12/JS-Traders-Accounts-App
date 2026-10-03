import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BellRing, CheckCircle2, ClipboardCheck, ClipboardList, Gauge, PackageCheck, Radio, ShieldAlert, ShoppingCart, Smartphone, Truck, TriangleAlert } from "lucide-react";
import { Card, EmptyState, PageHeader, Skeleton, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDateTime } from "@jst/utilities";
import { useWarehouses } from "../sales/common";
import { usePickingRealtime } from "./realtime";

interface Desk {
  so_to_approve: number; so_to_pick: number; picking_open: number; picking_unassigned: number; picking_unseen: number; shortages: number;
  gdn_due: number; gdn_drafts: number; counts_open: number; counts_to_approve: number; receipts_draft: number; receipts_checked: number;
  staff: { user_id: string; name: string; warehouse_ids: string[]; open_tasks: number; open_jobs: number; last_seen: string | null; on_duty: boolean }[];
}

/** The warehouse manager's desk: everything waiting for a decision, and who is on duty right now. */
export function WarehouseDeskPage() {
  const { can, companyId } = useAccess();
  const navigate = useNavigate();
  const allowed = can(P.pickingManage);
  const live = usePickingRealtime(allowed);
  const whs = useWarehouses();
  const desk = useQuery({
    queryKey: ["warehouse-desk", companyId],
    enabled: allowed && !!companyId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await sb().rpc("warehouse_desk", { p_company_id: companyId });
      if (error) throw error;
      return data as Desk;
    },
  });
  if (!allowed) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" /></Card>;
  const d = desk.data;
  const code = (id: string) => whs.data?.find((w) => w.id === id)?.code ?? "";
  type Tone = "red" | "amber" | "blue" | "green" | "grey";
  interface Tile { label: string; value: number | undefined; hint?: string; tone: Tone; icon: React.ReactNode; to: string; show?: boolean }
  const tiles: Tile[] = d ? ([
    { label: "Shortages to decide", value: d.shortages, tone: "red", icon: <TriangleAlert className="h-5 w-5" />, to: "/picking?f=1" },
    { label: "Orders awaiting approval", value: d.so_to_approve, tone: "amber", icon: <ShoppingCart className="h-5 w-5" />, to: "/sales-orders?f=1", show: can(P.salesApprove) },
    { label: "Orders to send to pickers", value: d.so_to_pick, tone: "amber", icon: <BellRing className="h-5 w-5" />, to: "/sales-orders?f=2" },
    { label: "Picking in progress", value: d.picking_open, hint: [d.picking_unassigned ? `${d.picking_unassigned} without picker` : "", d.picking_unseen ? `${d.picking_unseen} not seen yet` : ""].filter(Boolean).join(" · "), tone: d.picking_unassigned || d.picking_unseen ? "red" : "blue", icon: <ClipboardList className="h-5 w-5" />, to: "/picking" },
    { label: "Picked — make GDN", value: d.gdn_due, tone: "green", icon: <Truck className="h-5 w-5" />, to: "/picking?f=2" },
    { label: "GDNs to dispatch", value: d.gdn_drafts, tone: "green", icon: <Truck className="h-5 w-5" />, to: "/gdn" },
    { label: "Counts to approve", value: d.counts_to_approve, hint: d.counts_open ? `${d.counts_open} still counting` : "", tone: "amber", icon: <ClipboardCheck className="h-5 w-5" />, to: "/stock-counts" },
    { label: "Receipts checked — post", value: d.receipts_checked, hint: d.receipts_draft ? `${d.receipts_draft} other draft receipt(s)` : "", tone: "amber", icon: <PackageCheck className="h-5 w-5" />, to: "/goods-receipts" },
  ] as Tile[]).filter((t) => t.show !== false) : [];
  const toneCls = {
    red: "border-red-200 bg-red-50 text-red-700", amber: "border-amber-200 bg-amber-50 text-amber-700", blue: "border-sky-200 bg-sky-50 text-sky-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700", grey: "border-line bg-subtle text-ink-muted",
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <PageHeader title="Warehouse Desk" icon={<Gauge className="h-4 w-4" />}
        description="Everything waiting for you in the warehouses you manage — updates live."
        actions={<span className={cn("flex items-center gap-1 text-xs", live ? "text-success" : "text-ink-faint")}><Radio className="h-3.5 w-3.5" />{live ? "Live" : "Connecting…"}</span>} />
      {desk.isLoading ? <Skeleton className="h-40" /> : desk.error ? <p className="text-sm text-danger">{friendlyError(desk.error)}</p> : d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {tiles.map((t) => {
              const zero = !t.value;
              return (
                <button key={t.label} onClick={() => navigate(t.to)}
                  className={cn("flex items-start gap-3 rounded-card border p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-pop", zero ? toneCls.grey : toneCls[t.tone])}>
                  <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-control", zero ? "bg-white text-ink-faint" : "bg-white/80")}>{zero ? <CheckCircle2 className="h-5 w-5" /> : t.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-3xl font-semibold tabular-nums leading-none">{t.value ?? 0}</span>
                    <span className="mt-1 block text-sm font-medium">{t.label}</span>
                    {t.hint && <span className="block text-xs opacity-80">{t.hint}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <Card className="p-0">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3"><Smartphone className="h-4 w-4 text-ink-muted" /><span className="text-sm font-semibold">Warehouse staff</span>
              <span className="text-xs text-ink-muted">{d.staff.filter((s) => s.on_duty).length} of {d.staff.length} on duty (Android app)</span></div>
            {d.staff.length === 0 ? <p className="p-4 text-sm text-ink-muted">No warehouse staff yet — add them in Warehouse Staff.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted"><th className="h-8 px-4">Name</th><th className="px-4">Warehouses</th><th className="px-4 text-right">Picking</th><th className="px-4 text-right">Counts / receiving</th><th className="px-4">Phone</th></tr></thead>
                <tbody>
                  {d.staff.map((s) => (
                    <tr key={s.user_id} className="border-t border-line/70">
                      <td className="px-4 py-2 font-medium">{s.name}</td>
                      <td className="px-4 font-mono text-xs">{s.warehouse_ids.map(code).join(", ")}</td>
                      <td className="px-4 text-right tabular-nums">{s.open_tasks || <span className="text-ink-faint">—</span>}</td>
                      <td className="px-4 text-right tabular-nums">{s.open_jobs || <span className="text-ink-faint">—</span>}</td>
                      <td className="px-4 text-xs">{s.on_duty ? <span className="inline-flex items-center gap-1 font-medium text-success"><span className="h-2 w-2 rounded-full bg-success" /> On duty</span>
                        : s.last_seen ? <span className="text-ink-muted">Off · last seen {formatDateTime(s.last_seen)}</span> : <span className="text-ink-faint">App not installed</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
