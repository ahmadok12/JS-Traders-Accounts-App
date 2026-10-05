import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BarChart3, Columns3, ExternalLink, FileSpreadsheet, FileText, Printer, Save, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Skeleton, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { LookupPicker } from "../inventory/pickers";
import { AccountPicker, BankPicker, DateRangeBar, PartyPicker, presetRange } from "../accounting/common";
import { cellText, exportCsv, exportXlsx, printReport, type ExportRow } from "./exporting";
import type { Col, Params, PartyRef, ReportDef, Row } from "./registry";

/* ---------------------------------------------------------------- params <-> URL */
export function paramsToSearch(p: Params): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of ["from", "to", "asOf", "customer", "supplier", "warehouse", "bank", "account", "payType", "entity"] as const) if (p[k]) o[k] = String(p[k]);
  if (p.party) { o.ptype = p.party.type; o.party = p.party.id; }
  if (p.compare) o.compare = "1";
  return o;
}
function searchToParams(def: ReportDef, sp: URLSearchParams): Params {
  const has = (k: string) => sp.has(k);
  const preset = def.rangePreset ? presetRange(def.rangePreset) : { from: null, to: null };
  return {
    from: has("from") ? sp.get("from") || null : def.params?.includes("range") ? preset.from : null,
    to: has("to") ? sp.get("to") || null : def.params?.includes("range") ? preset.to : null,
    asOf: sp.get("asOf"), customer: sp.get("customer"), supplier: sp.get("supplier"), warehouse: sp.get("warehouse"), bank: sp.get("bank"), account: sp.get("account"),
    payType: sp.get("payType"), entity: sp.get("entity"), compare: sp.get("compare") === "1",
    party: sp.get("party") ? { type: (sp.get("ptype") as PartyRef["type"]) ?? fixedPartyType(def) ?? "CUSTOMER", id: sp.get("party")! } : null,
  };
}
export function fixedPartyType(def: ReportDef): PartyRef["type"] | null {
  if (def.code.startsWith("customer")) return "CUSTOMER";
  if (def.code.startsWith("supplier")) return "SUPPLIER";
  return null;
}

/* ---------------------------------------------------------------- data shaping (filter → sort → group → totals) */
export interface Layout { cols?: string[]; group?: string | null; sort?: { key: string; desc: boolean } | null; filter?: string }
const numericKinds = new Set(["money", "qty", "pct", "int", "rate"]);
function shape(def: ReportDef, rows: Row[], cols: Col[], layout: Layout): ExportRow[] {
  const all = def.columns ?? [];
  const t = (layout.filter ?? "").trim().toLowerCase();
  let r = t ? rows.filter((x) => cols.some((c) => cellText(c, x[c.key]).toLowerCase().includes(t))) : rows;
  if (layout.sort) {
    const c = all.find((x) => x.key === layout.sort!.key);
    const k = layout.sort.key, s = layout.sort.desc ? -1 : 1;
    r = [...r].sort((a, b) => {
      const va = a[k], vb = b[k];
      if (va == null) return 1; if (vb == null) return -1;
      return (c && numericKinds.has(c.kind ?? "") ? Number(va) - Number(vb) : String(va).localeCompare(String(vb))) * s;
    });
  }
  const totals = (list: Row[]) => {
    const o: Row = {};
    for (const c of all) if (c.total) o[c.key] = list.reduce((s, x) => s + (x[c.key] == null ? 0 : Number(x[c.key])), 0);
    return o;
  };
  const out: ExportRow[] = [];
  const groupCol = layout.group ? all.find((c) => c.key === layout.group) : null;
  if (groupCol) {
    const groups = new Map<string, Row[]>();
    for (const x of r) { const g = cellText(groupCol, x[groupCol.key]) || "(blank)"; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(x); }
    for (const [g, list] of groups) {
      out.push({ kind: "group", row: {}, label: `${groupCol.label}: ${g} (${list.length})` });
      for (const x of list) out.push({ kind: "row", row: x });
      if (all.some((c) => c.total)) out.push({ kind: "subtotal", row: totals(list), label: `Subtotal ${g}` });
    }
  } else for (const x of r) out.push({ kind: "row", row: x });
  if (all.some((c) => c.total) && r.length) out.push({ kind: "total", row: totals(r), label: "Total" });
  return out;
}

/* ---------------------------------------------------------------- the full report screen */
export function ReportScreen({ def }: { def: ReportDef }) {
  const { companyId, company, can } = useAccess();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const params = React.useMemo(() => searchToParams(def, sp), [def, sp]);
  const setParams = (p: Params) => { const keep = sp.get("saved"); setSp({ ...paramsToSearch(p), ...(keep ? { saved: keep } : {}) }, { replace: true }); };
  const missing = (def.required ?? []).filter((k) => !(k === "party" ? params.party?.id : (params as Record<string, unknown>)[k]));
  const q = useQuery({
    queryKey: ["report", def.code, companyId, params],
    enabled: !!companyId && !!def.run && missing.length === 0,
    queryFn: async (): Promise<Row[]> => (await def.run!(params, companyId!)).map((r, i) => ({ ...r, __index: i })),
  });
  const rows = q.data ?? [];
  const all = def.columns ?? [];
  const empty = new Set(all.filter((c) => rows.length > 0 && rows.every((r) => r[c.key] == null || r[c.key] === "")).map((c) => c.key));
  const defaultCols = all.filter((c) => !c.hidden && !empty.has(c.key)).map((c) => c.key);
  const [layout, setLayout] = React.useState<Layout>({ group: def.groupBy ?? null });
  const visible = (layout.cols ?? defaultCols).map((k) => all.find((c) => c.key === k)).filter(Boolean) as Col[];
  const shaped = React.useMemo(() => shape(def, rows, visible, layout), [def, rows, visible, layout]);
  const [colsOpen, setColsOpen] = React.useState(false);

  // saved reports (personal + shared)
  const saved = useQuery({ queryKey: ["saved-reports", companyId, def.code], enabled: !!companyId, queryFn: async () =>
    ((await sb().from("saved_reports").select("id, name, params, layout, is_shared, owner_id").eq("company_id", companyId!).eq("report_code", def.code).order("name")).data ?? []) as
      { id: string; name: string; params: Params; layout: Layout; is_shared: boolean; owner_id: string }[] });
  const savedId = sp.get("saved");
  React.useEffect(() => {
    const s = saved.data?.find((x) => x.id === savedId);
    if (s) { setLayout(s.layout ?? {}); setSp({ ...paramsToSearch(s.params ?? {}), saved: s.id }, { replace: true }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedId, saved.data]);
  const [saveAs, setSaveAs] = React.useState<null | { name: string; shared: boolean }>(null);
  const [delAsk, setDelAsk] = React.useState(false);
  const doSave = async () => {
    if (!saveAs?.name.trim()) return;
    const row = { company_id: companyId, report_code: def.code, name: saveAs.name.trim(), params, layout: { ...layout, cols: visible.map((c) => c.key) }, is_shared: saveAs.shared };
    const cur = saved.data?.find((x) => x.id === savedId && x.name === saveAs.name.trim());
    const r = cur ? await sb().from("saved_reports").update(row).eq("id", cur.id).select("id").single() : await sb().from("saved_reports").insert(row).select("id").single();
    if (r.error) { toast.error(friendlyError(r.error)); return; }
    toast.success("Report saved"); setSaveAs(null); qc.invalidateQueries({ queryKey: ["saved-reports"] });
    setSp({ ...paramsToSearch(params), saved: (r.data as { id: string }).id }, { replace: true });
  };
  const doDelete = async () => {
    const r = await sb().from("saved_reports").delete().eq("id", savedId!);
    if (r.error) toast.error(friendlyError(r.error)); else { toast.success("Saved report deleted"); setDelAsk(false); setSp(paramsToSearch(params), { replace: true }); qc.invalidateQueries({ queryKey: ["saved-reports"] }); }
  };

  const subtitle = describeParams(def, params);
  const toggleSort = (k: string) => setLayout((l) => ({ ...l, sort: l.sort?.key === k ? (l.sort.desc ? null : { key: k, desc: true }) : { key: k, desc: false } }));
  const groupable = all.filter((c) => !numericKinds.has(c.kind ?? "") && c.kind !== "datetime");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <ParamBar def={def} params={params} onChange={setParams} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {(saved.data ?? []).length > 0 && (
              <select className="h-control rounded-control border border-line bg-surface px-2 text-sm" value={savedId ?? ""} onChange={(e) => setSp(e.target.value ? { saved: e.target.value } : paramsToSearch(params), { replace: true })}>
                <option value="">Saved reports…</option>{(saved.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_shared ? " (shared)" : ""}</option>)}
              </select>
            )}
            <Button icon={<Save className="h-4 w-4" />} onClick={() => setSaveAs({ name: saved.data?.find((x) => x.id === savedId)?.name ?? def.title, shared: false })}>Save</Button>
            {savedId && saved.data?.find((x) => x.id === savedId)?.owner_id && <Button variant="destructive-ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDelAsk(true)} />}
          </div>
        </div>
      </Card>
      {missing.length > 0 ? <Card><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Choose what to report on" description={`Fill in: ${missing.map((m) => PARAM_LABEL[m]).join(", ")}`} /></Card> : (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <Input className="h-control-sm w-56" placeholder="Filter rows…" value={layout.filter ?? ""} onChange={(e) => setLayout((l) => ({ ...l, filter: e.target.value }))} />
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">Group by
              <select className="h-control-sm rounded-control border border-line bg-surface px-2 text-xs" value={layout.group ?? ""} onChange={(e) => setLayout((l) => ({ ...l, group: e.target.value || null }))}>
                <option value="">—</option>{groupable.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select></label>
            <div className="relative">
              <Button size="sm" variant="ghost" icon={<Columns3 className="h-3.5 w-3.5" />} onClick={() => setColsOpen((o) => !o)}>Columns</Button>
              {colsOpen && (
                <div className="absolute left-0 top-full z-20 mt-1 w-60 rounded-card border border-line bg-surface p-2 shadow-pop" onMouseLeave={() => setColsOpen(false)}>
                  {all.map((c) => {
                    const on = visible.some((v) => v.key === c.key);
                    return <label key={c.key} className={cn("flex items-center gap-2 py-0.5 text-xs", empty.has(c.key) && "text-ink-faint")}>
                      <input type="checkbox" checked={on} onChange={() => setLayout((l) => {
                        const cur = l.cols ?? defaultCols;
                        return { ...l, cols: on ? cur.filter((k) => k !== c.key) : all.filter((x) => x.key === c.key || cur.includes(x.key)).map((x) => x.key) };
                      })} />{c.label}{empty.has(c.key) ? " (no data)" : ""}</label>;
                  })}
                  <button className="mt-1 text-2xs text-primary hover:underline" onClick={() => setLayout((l) => ({ ...l, cols: undefined }))}>Reset</button>
                </div>
              )}
            </div>
            <span className="text-xs text-ink-muted">{q.isFetching ? "Loading…" : `${rows.length.toLocaleString()} rows`}</span>
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" icon={<FileSpreadsheet className="h-3.5 w-3.5" />} disabled={!rows.length}
                onClick={() => exportXlsx(def.title, subtitle, visible, shaped).catch((e) => toast.error(String(e)))}>Excel</Button>
              <Button size="sm" variant="ghost" icon={<FileText className="h-3.5 w-3.5" />} disabled={!rows.length} onClick={() => exportCsv(def.title, visible, shaped)}>CSV</Button>
              <Button size="sm" variant="ghost" icon={<Printer className="h-3.5 w-3.5" />} disabled={!rows.length} title="Print or save as PDF"
                onClick={() => printReport(company?.company_name ?? "", def.title, subtitle, visible, shaped) || toast.error("Allow pop-ups to print")}>Print / PDF</Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {q.isLoading ? <Skeleton className="m-3 h-40" /> : q.error ? <p className="p-4 text-sm text-danger">{friendlyError(q.error)}</p> : rows.length === 0 ? (
              <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Nothing to show" description="No data for these filters." />
            ) : (
              <ReportTable cols={visible} rows={shaped} sort={layout.sort ?? null} onSort={toggleSort} link={def.link} onOpen={(u) => navigate(u)} />
            )}
          </div>
        </Card>
      )}
      <ConfirmDialog open={!!saveAs} title="Save this report" confirmLabel="Save" onCancel={() => setSaveAs(null)} onConfirm={() => void doSave()}
        message="Saves the filters, columns, grouping and sorting so you can open it again from the Saved reports list.">
        {saveAs && <>
          <Field label="Name" required className="mt-3"><Input value={saveAs.name} onChange={(e) => setSaveAs((s) => (s ? { ...s, name: e.target.value } : s))} /></Field>
          {can("settings.manage") && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={saveAs.shared} onChange={(e) => setSaveAs((s) => (s ? { ...s, shared: e.target.checked } : s))} />
            <Share2 className="h-3.5 w-3.5" /> Share with everyone who can see this report</label>}
        </>}
      </ConfirmDialog>
      <ConfirmDialog open={delAsk} title="Delete this saved report?" tone="destructive" confirmLabel="Delete" onCancel={() => setDelAsk(false)} onConfirm={() => void doDelete()} message="Only the saved view is deleted — no data." />
    </div>
  );
}

export function ReportTable({ cols, rows, sort, onSort, link, onOpen, compact }: {
  cols: Col[]; rows: ExportRow[]; sort?: { key: string; desc: boolean } | null; onSort?: (k: string) => void; link?: (r: Row) => string | null; onOpen?: (u: string) => void; compact?: boolean;
}) {
  const th = "sticky top-0 z-10 bg-subtle px-2 text-2xs font-semibold uppercase tracking-wide text-ink-muted";
  return (
    <table className="w-full text-sm">
      <thead><tr>
        {cols.map((c) => (
          <th key={c.key} className={cn(th, compact ? "h-7" : "h-9", numericKinds.has(c.kind ?? "") ? "text-right" : "text-left", onSort && "cursor-pointer select-none hover:text-ink")} onClick={() => onSort?.(c.key)}>
            {c.label}{sort?.key === c.key && (sort.desc ? <ArrowDown className="ml-0.5 inline h-3 w-3" /> : <ArrowUp className="ml-0.5 inline h-3 w-3" />)}
          </th>
        ))}
        {link && <th className={cn(th, "w-8")} />}
      </tr></thead>
      <tbody>{rows.map((r, i) => {
        const url = r.kind === "row" && link ? link(r.row) : null;
        return (
          <tr key={i} className={cn(r.kind === "group" && "bg-subtle/70 font-semibold", r.kind === "subtotal" && "font-semibold", r.kind === "total" && "bg-subtle font-semibold",
            url && "cursor-pointer hover:bg-sky-50/60")} onClick={() => url && onOpen?.(url)}>
            {r.kind === "group" ? <td colSpan={cols.length + (link ? 1 : 0)} className="border-t border-line px-2 py-1.5 text-xs">{r.label}</td> : (
              <>
                {cols.map((c, j) => {
                  const v = r.row[c.key];
                  const num = numericKinds.has(c.kind ?? "");
                  return (
                    <td key={c.key} className={cn("border-t border-line/70 px-2", compact ? "py-1 text-xs" : "py-1.5", num && "text-right tabular-nums whitespace-nowrap", r.kind === "total" && "border-t-2 border-line-strong")}>
                      {j === 0 && r.label && r.kind !== "row" ? r.label
                        : c.kind === "badge" && v ? <Badge tone="neutral">{cellText(c, v)}</Badge>
                        : num && Number(v) < 0 ? <span className="text-danger">{cellText(c, v)}</span> : cellText(c, v)}
                    </td>
                  );
                })}
                {link && <td className="border-t border-line/70 px-2 text-ink-faint">{url && <ExternalLink className="h-3.5 w-3.5" />}</td>}
              </>
            )}
          </tr>
        );
      })}</tbody>
    </table>
  );
}

/* ---------------------------------------------------------------- parameters */
const PARAM_LABEL: Record<string, string> = { range: "Date range", asOf: "As of", customer: "Customer", supplier: "Supplier", warehouse: "Warehouse", bank: "Bank / cash account",
  account: "Account", party: "Party", compare: "Compare", payType: "Type", entity: "Record type" };
const PAY_TYPES = ["BONUS", "OVERTIME", "ALLOWANCE", "OTHER_EARNING", "ASSEMBLY_LABOUR", "FINE", "OTHER_DEDUCTION"];

function ParamBar({ def, params, onChange }: { def: ReportDef; params: Params; onChange: (p: Params) => void }) {
  const set = (p: Partial<Params>) => onChange({ ...params, ...p });
  const fixed = fixedPartyType(def);
  const [ptype, setPtype] = React.useState<PartyRef["type"]>(params.party?.type ?? fixed ?? "CUSTOMER");
  return (
    <>
      {(def.params ?? []).map((k) => {
        switch (k) {
          case "range": return <Field key={k} label="Period"><DateRangeBar value={{ from: params.from ?? null, to: params.to ?? null }} onChange={(r) => set({ from: r.from, to: r.to })} /></Field>;
          case "asOf": return <Field key={k} label="As of" hint="Blank = today"><Input type="date" className="w-40" value={params.asOf ?? ""} onChange={(e) => set({ asOf: e.target.value || null })} /></Field>;
          case "customer": return <Field key={k} label="Customer"><div className="w-56"><LookupPicker value={params.customer ?? null} onChange={(v) => set({ customer: v })} placeholder="All customers" spec={{ table: "customers", label: "name", secondary: "code" }} /></div></Field>;
          case "supplier": return <Field key={k} label="Supplier"><div className="w-56"><LookupPicker value={params.supplier ?? null} onChange={(v) => set({ supplier: v })} placeholder="All suppliers" spec={{ table: "suppliers", label: "name", secondary: "code" }} /></div></Field>;
          case "warehouse": return <Field key={k} label="Warehouse"><div className="w-48"><LookupPicker value={params.warehouse ?? null} onChange={(v) => set({ warehouse: v })} placeholder="All warehouses" spec={{ table: "warehouses", label: "name", secondary: "code" }} /></div></Field>;
          case "bank": return <Field key={k} label="Bank / cash"><div className="w-56"><BankPicker value={params.bank ?? null} onChange={(v) => set({ bank: v })} /></div></Field>;
          case "account": return <Field key={k} label="Account"><div className="w-64"><AccountPicker value={params.account ?? null} onChange={(v) => set({ account: v })} /></div></Field>;
          case "party": return (
            <Field key={k} label={fixed === "CUSTOMER" ? "Customer" : fixed === "SUPPLIER" ? "Supplier" : "Party"}>
              <div className="flex gap-2">
                {!fixed && <select className="h-control rounded-control border border-line bg-surface px-2 text-sm" value={ptype} onChange={(e) => { setPtype(e.target.value as PartyRef["type"]); set({ party: null }); }}>
                  <option value="CUSTOMER">Customer</option><option value="SUPPLIER">Supplier</option><option value="AGENT">Payment agent</option><option value="EMPLOYEE">Employee</option></select>}
                <div className="w-56"><PartyPicker type={fixed ?? ptype} value={params.party?.id ?? null} onChange={(v) => set({ party: v ? { type: fixed ?? ptype, id: v } : null })} /></div>
                {params.party && !def.required?.includes("party") && <Button size="sm" variant="ghost" onClick={() => set({ party: null })}>All</Button>}
              </div>
            </Field>
          );
          case "compare": return <label key={k} className="flex h-control items-center gap-2 text-sm"><input type="checkbox" checked={!!params.compare} onChange={(e) => set({ compare: e.target.checked })} /> Compare with previous period</label>;
          case "payType": return <Field key={k} label="Type"><select className="h-control rounded-control border border-line bg-surface px-2 text-sm" value={params.payType ?? ""} onChange={(e) => set({ payType: e.target.value || null })}>
            <option value="">All</option>{PAY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ").toLowerCase()}</option>)}</select></Field>;
          case "entity": return <Field key={k} label="Record type"><Input className="w-44" placeholder="e.g. sales_invoices" value={params.entity ?? ""} onChange={(e) => set({ entity: e.target.value || null })} /></Field>;
          default: return null;
        }
      })}
    </>
  );
}

export function describeParams(def: ReportDef, p: Params) {
  const parts: string[] = [];
  if (def.params?.includes("range")) parts.push(p.from || p.to ? `${p.from ?? "start"} to ${p.to ?? "today"}` : "All dates");
  if (def.params?.includes("asOf")) parts.push(`As of ${p.asOf ?? "today"}`);
  if (p.compare) parts.push("vs previous period");
  return parts.join(" · ");
}

/* ---------------------------------------------------------------- quick view (used by report shortcuts) */
export function QuickReport({ def, params, onFull }: { def: ReportDef; params: Params; onFull: () => void }) {
  const { companyId } = useAccess();
  const q = useQuery({ queryKey: ["report-quick", def.code, companyId, params], enabled: !!companyId && !!def.run, staleTime: 30_000,
    queryFn: async (): Promise<Row[]> => (await def.run!(params, companyId!)).map((r, i) => ({ ...r, __index: i })) });
  const all = def.columns ?? [];
  const keys = def.quick?.columns ?? all.filter((c) => !c.hidden).slice(0, 5).map((c) => c.key);
  const cols = keys.map((k) => all.find((c) => c.key === k)).filter(Boolean) as Col[];
  let rows = q.data ?? [];
  if (def.quick?.sortDesc) { const k = def.quick.sortDesc; rows = [...rows].sort((a, b) => (Number(b[k] ?? 0) - Number(a[k] ?? 0)) || String(b[k] ?? "").localeCompare(String(a[k] ?? ""))); }
  const limit = def.quick?.limit ?? 10;
  const shown = rows.slice(0, limit);
  const totals: Row = {};
  for (const c of cols) if (c.total) totals[c.key] = rows.reduce((s, x) => s + Number(x[c.key] ?? 0), 0);
  const out: ExportRow[] = [...shown.map((r) => ({ kind: "row" as const, row: r })), ...(cols.some((c) => c.total) && rows.length ? [{ kind: "total" as const, row: totals, label: rows.length > limit ? `Total (all ${rows.length})` : "Total" }] : [])];
  return (
    <div>
      {q.isLoading ? <Skeleton className="h-24" /> : q.error ? <p className="text-sm text-danger">{friendlyError(q.error)}</p> : rows.length === 0 ? <p className="text-sm text-ink-muted">Nothing to show.</p> : (
        <div className="max-h-[50vh] overflow-auto rounded-card border border-line"><ReportTable cols={cols} rows={out} compact /></div>
      )}
      <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
        <span>{rows.length > limit ? `Latest ${limit} of ${rows.length}` : `${rows.length} row(s)`}</span>
        <Button size="sm" variant="ghost" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={onFull}>View full report</Button>
      </div>
    </div>
  );
}
