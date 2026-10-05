/**
 * Contextual report shortcuts (spec §20.1). Which buttons appear on a voucher comes from the
 * report_shortcuts table (configurable in Settings → Report shortcuts), filtered by permission and by
 * the context the voucher can supply. Quick views open in a side dialog — the voucher underneath
 * keeps its unsaved data. Read-only.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BarChart3, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, ErpDialog, Input, PageHeader, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { REPORT, REPORTS, canSee, paramsFromContext, type Context, type ContextKey, type Params } from "./registry";
import { QuickReport, paramsToSearch } from "./ReportView";

export type VoucherType = "SALES_INVOICE" | "SALES_ORDER" | "QUOTATION" | "GDN" | "SUPPLIER_BILL" | "PURCHASE_ORDER" | "GOODS_RECEIPT" | "BANK_RECEIPT" | "BANK_PAYMENT" | "JOURNAL" | "PDC" | "CUSTOMER" | "SUPPLIER" | "PRODUCT";
const VOUCHERS: VoucherType[] = ["SALES_INVOICE", "SALES_ORDER", "QUOTATION", "GDN", "SUPPLIER_BILL", "PURCHASE_ORDER", "GOODS_RECEIPT", "BANK_RECEIPT", "BANK_PAYMENT", "JOURNAL", "PDC", "CUSTOMER", "SUPPLIER", "PRODUCT"];
const CONTEXTS: ContextKey[] = ["CUSTOMER", "SUPPLIER", "PRODUCT", "BANK_ACCOUNT", "PARTY", "VOUCHER"];
const humanize = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

interface Shortcut { id: string; report_code: string; voucher_type: VoucherType; context_type: ContextKey; label: string; view_mode: "QUICK_VIEW" | "FULL_REPORT";
  parameter_mapping: Record<string, string>; placement: string; sort_order: number; enabled: boolean; required_permission: string | null }

function useShortcuts(voucher: VoucherType | null) {
  const { companyId } = useAccess();
  return useQuery({ queryKey: ["report-shortcuts", companyId, voucher], enabled: !!companyId, staleTime: 5 * 60_000, queryFn: async () => {
    let q = sb().from("report_shortcuts").select("*").eq("company_id", companyId!).order("voucher_type").order("sort_order");
    if (voucher) q = q.eq("voucher_type", voucher).eq("enabled", true);
    const { data, error } = await q; if (error) throw error;
    return (data ?? []) as Shortcut[];
  } });
}

/** Buttons for the current voucher. Hidden when the needed context (e.g. the customer) isn't chosen yet. */
export function ReportShortcuts({ voucher, context, className }: { voucher: VoucherType; context: Context; className?: string }) {
  const { can } = useAccess();
  const navigate = useNavigate();
  const sc = useShortcuts(voucher);
  const [open, setOpen] = React.useState<{ s: Shortcut; p: Params } | null>(null);
  const items = (sc.data ?? []).flatMap((s) => {
    const def = REPORT[s.report_code];
    if (!def || !canSee(def, can) || (s.required_permission && !can(s.required_permission))) return [];
    const p = paramsFromContext(def, s.parameter_mapping ?? {}, context);
    return p ? [{ s, p }] : [];
  });
  if (!items.length) return null;
  const full = (code: string, p: Params) => navigate(`/reports/${code}?${new URLSearchParams(paramsToSearch(p)).toString()}`);
  return (
    <>
      <div className={cn("flex flex-wrap items-center gap-1", className)}>
        <BarChart3 className="h-3.5 w-3.5 text-ink-faint" />
        {items.map(({ s, p }) => (
          <button key={s.id} type="button" className="rounded-control border border-line bg-surface px-2 py-0.5 text-xs text-ink-2 hover:border-line-strong hover:text-ink"
            onClick={() => (s.view_mode === "FULL_REPORT" ? window.open(`/reports/${s.report_code}?${new URLSearchParams(paramsToSearch(p)).toString()}`, "_blank") : setOpen({ s, p }))}>
            {s.label}
          </button>
        ))}
      </div>
      {open && (
        <ErpDialog open onRequestClose={() => setOpen(null)} size="lg" icon={<BarChart3 className="h-4 w-4" />} title={open.s.label} subtitle={REPORT[open.s.report_code].title}
          footer={<><div className="flex-1" /><Button onClick={() => setOpen(null)}>Close</Button></>}>
          <QuickReport def={REPORT[open.s.report_code]} params={open.p} onFull={() => full(open.s.report_code, open.p)} />
        </ErpDialog>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- configuration screen */
const MAPPABLE: Record<string, ContextKey[]> = { party: ["CUSTOMER", "SUPPLIER", "PARTY"], customer: ["CUSTOMER"], supplier: ["SUPPLIER"], bank: ["BANK_ACCOUNT"] };
function mappingFor(code: string, ctx: ContextKey): Record<string, string> | null {
  const def = REPORT[code];
  for (const p of def?.params ?? []) if (MAPPABLE[p]?.includes(ctx)) return { [p]: ctx };
  return null;
}

export function ShortcutSettingsPage() {
  const { can, companyId } = useAccess();
  const qc = useQueryClient();
  const sc = useShortcuts(null);
  const [voucher, setVoucher] = React.useState<VoucherType>("SALES_INVOICE");
  const [add, setAdd] = React.useState({ code: "", ctx: "CUSTOMER" as ContextKey, label: "", mode: "QUICK_VIEW" as "QUICK_VIEW" | "FULL_REPORT" });
  const manage = can("settings.manage");
  const rows = (sc.data ?? []).filter((s) => s.voucher_type === voucher);
  const upd = async (id: string, patch: Partial<Shortcut>) => {
    const r = await sb().from("report_shortcuts").update(patch).eq("id", id);
    if (r.error) toast.error(friendlyError(r.error)); else qc.invalidateQueries({ queryKey: ["report-shortcuts"] });
  };
  const del = async (id: string) => { const r = await sb().from("report_shortcuts").delete().eq("id", id); if (r.error) toast.error(friendlyError(r.error)); else qc.invalidateQueries({ queryKey: ["report-shortcuts"] }); };
  const move = async (i: number, dir: -1 | 1) => {
    const a = rows[i], b = rows[i + dir]; if (!a || !b) return;
    await Promise.all([upd(a.id, { sort_order: b.sort_order === a.sort_order ? a.sort_order + dir : b.sort_order }), upd(b.id, { sort_order: a.sort_order })]);
  };
  const mapping = add.code ? mappingFor(add.code, add.ctx) : null;
  const doAdd = async () => {
    if (!add.code || !mapping) return;
    const r = await sb().from("report_shortcuts").insert({ company_id: companyId, report_code: add.code, voucher_type: voucher, context_type: add.ctx, label: add.label.trim() || REPORT[add.code].title,
      view_mode: add.mode, parameter_mapping: mapping, sort_order: (rows.at(-1)?.sort_order ?? 0) + 1, required_permission: REPORT[add.code].perms[0] });
    if (r.error) toast.error(friendlyError(r.error)); else { toast.success("Shortcut added"); setAdd((s) => ({ ...s, code: "", label: "" })); qc.invalidateQueries({ queryKey: ["report-shortcuts"] }); }
  };
  if (!manage) return <Card><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No access" description="Only administrators can change report shortcuts." /></Card>;
  const choosable = REPORTS.filter((r) => r.run && (r.params ?? []).some((p) => MAPPABLE[p]?.includes(add.ctx)));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Report shortcuts" icon={<BarChart3 className="h-4 w-4" />}
        description="Buttons shown on vouchers that open a report for the current customer / supplier / bank without leaving the voucher. Add, rename, reorder, switch off, or choose quick view vs full report." />
      <div className="mb-3 flex flex-wrap gap-1">{VOUCHERS.map((v) => (
        <button key={v} onClick={() => setVoucher(v)} className={cn("rounded-control border px-2.5 py-1 text-xs", voucher === v ? "border-primary bg-primary text-white" : "border-line bg-surface hover:border-line-strong")}>
          {humanize(v)} <span className="opacity-70">({(sc.data ?? []).filter((s) => s.voucher_type === v).length})</span></button>))}</div>
      <Card className="mb-3 overflow-hidden">
        {rows.length === 0 ? <p className="p-4 text-sm text-ink-muted">No shortcuts on this voucher yet.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted"><tr><th className="h-8 px-3">Order</th><th className="px-3">Button label</th><th className="px-3">Report</th><th className="px-3">Uses</th><th className="px-3">Opens as</th><th className="px-3">On</th><th /></tr></thead>
            <tbody>{rows.map((s, i) => (
              <tr key={s.id} className="border-t border-line/70">
                <td className="px-3 py-1.5 whitespace-nowrap"><Button size="icon-sm" variant="ghost" disabled={i === 0} onClick={() => void move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button size="icon-sm" variant="ghost" disabled={i === rows.length - 1} onClick={() => void move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button></td>
                <td className="px-3"><Input className="h-control-sm" defaultValue={s.label} onBlur={(e) => e.target.value.trim() && e.target.value !== s.label && void upd(s.id, { label: e.target.value.trim() })} /></td>
                <td className="px-3">{REPORT[s.report_code]?.title ?? <span className="text-danger">{s.report_code} (unknown)</span>}</td>
                <td className="px-3"><Badge>{humanize(s.context_type)}</Badge></td>
                <td className="px-3"><select className="h-control-sm rounded-control border border-line bg-surface px-2 text-xs" value={s.view_mode} onChange={(e) => void upd(s.id, { view_mode: e.target.value as Shortcut["view_mode"] })}>
                  <option value="QUICK_VIEW">Quick view</option><option value="FULL_REPORT">Full report (new tab)</option></select></td>
                <td className="px-3"><input type="checkbox" checked={s.enabled} onChange={(e) => void upd(s.id, { enabled: e.target.checked })} /></td>
                <td className="px-3 text-right"><Button size="icon-sm" variant="destructive-ghost" onClick={() => void del(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
      <Card className="p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Add a shortcut to {humanize(voucher)}</div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-control rounded-control border border-line bg-surface px-2 text-sm" value={add.ctx} onChange={(e) => setAdd((s) => ({ ...s, ctx: e.target.value as ContextKey, code: "" }))}>
            {CONTEXTS.filter((c) => c !== "PRODUCT" && c !== "VOUCHER").map((c) => <option key={c} value={c}>for the {humanize(c).toLowerCase()}</option>)}</select>
          <select className="h-control rounded-control border border-line bg-surface px-2 text-sm" value={add.code} onChange={(e) => setAdd((s) => ({ ...s, code: e.target.value }))}>
            <option value="">Report…</option>{choosable.map((r) => <option key={r.code} value={r.code}>{r.title}</option>)}</select>
          <Input className="w-48" placeholder="Button label" value={add.label} onChange={(e) => setAdd((s) => ({ ...s, label: e.target.value }))} />
          <select className="h-control rounded-control border border-line bg-surface px-2 text-sm" value={add.mode} onChange={(e) => setAdd((s) => ({ ...s, mode: e.target.value as typeof s.mode }))}>
            <option value="QUICK_VIEW">Quick view</option><option value="FULL_REPORT">Full report</option></select>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!mapping} onClick={() => void doAdd()}>Add</Button>
        </div>
        <p className="mt-2 text-xs text-ink-muted">The voucher passes its {humanize(add.ctx).toLowerCase()} into the report's own filter — nothing else can be configured, so a shortcut can never show more than the report itself.</p>
      </Card>
    </div>
  );
}
