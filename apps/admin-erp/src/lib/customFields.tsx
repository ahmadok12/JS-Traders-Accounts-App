/**
 * Custom fields (spec §19.1): extra, typed fields an administrator adds to master records
 * (Settings → Custom fields). Values are stored per type (text / number / date / yes-no / choices)
 * so they can be filtered and reported; the database validates every value.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Paperclip, Sigma } from "lucide-react";
import { Badge, Button, Checkbox, Field, FormGrid, Input, KeyValue, SearchableSelect, Textarea, cn } from "@jst/ui";
import { friendlyError, makeLookupLoader, sb, useAccess, type LookupSpec } from "@jst/data-access";
import { formatDate, formatDateTime, formatNumber } from "@jst/utilities";
import { openAttachment, uploadAttachment, type AttachmentEntity } from "../attachments/Attachments";

export const CF_ENTITIES: { key: string; label: string }[] = [
  { key: "customers", label: "Customers" },
  { key: "suppliers", label: "Suppliers" },
  { key: "products", label: "Products" },
  { key: "warehouses", label: "Warehouses" },
  { key: "employees", label: "Employees" },
  { key: "customer_groups", label: "Customer groups" },
  { key: "bank_accounts", label: "Bank & cash accounts" },
  { key: "payment_agents", label: "Payment agents" },
];
/** Documents: custom fields show on the document; required ones are checked when it is approved / posted. */
export const CF_DOC_ENTITIES: { key: string; label: string }[] = [
  { key: "quotations", label: "Quotations" },
  { key: "sales_orders", label: "Sales orders" },
  { key: "gdns", label: "Dispatch notes (GDN)" },
  { key: "sales_invoices", label: "Sales invoices" },
  { key: "purchase_orders", label: "Purchase orders" },
  { key: "goods_receipts", label: "Goods receipts" },
  { key: "supplier_bills", label: "Supplier bills" },
  { key: "shipments", label: "Shipments" },
  { key: "journal_entries", label: "Vouchers" },
  { key: "stock_adjustments", label: "Stock adjustments" },
  { key: "stock_transfers", label: "Stock transfers" },
];
export const isCfEntity = (table: string) => CF_ENTITIES.some((e) => e.key === table) || CF_DOC_ENTITIES.some((e) => e.key === table);
export const isCfDocEntity = (table: string) => CF_DOC_ENTITIES.some((e) => e.key === table);
/** records that can hold files (same list as the attachments service) */
export const CF_FILE_ENTITIES = ["customers", "suppliers", "products", "quotations", "sales_orders", "gdns", "sales_invoices", "purchase_orders",
  "goods_receipts", "supplier_bills", "shipments", "journal_entries", "stock_adjustments", "stock_transfers"];

export const CF_REF_ENTITIES: { key: string; label: string; lookup: LookupSpec }[] = [
  { key: "customers", label: "Customer", lookup: { table: "customers", label: "name", secondary: "code", filters: { is_active: true } } },
  { key: "suppliers", label: "Supplier", lookup: { table: "suppliers", label: "name", secondary: "code", filters: { is_active: true } } },
  { key: "products", label: "Product", lookup: { table: "products", label: "name", secondary: "sku", filters: { is_active: true } } },
  { key: "warehouses", label: "Warehouse", lookup: { table: "warehouses", label: "name", secondary: "code", filters: { is_active: true } } },
  { key: "employees", label: "Employee", lookup: { table: "employees", label: "full_name", secondary: "code" } },
];
export const NUMBER_TYPES: CfType[] = ["number", "decimal", "currency", "percentage", "formula"];

export type CfType = "text" | "long_text" | "number" | "decimal" | "currency" | "percentage" | "date" | "datetime" | "checkbox" | "dropdown" | "multi_select"
  | "reference" | "file" | "image" | "formula";
export const CF_TYPES: { value: CfType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "long_text", label: "Long text" },
  { value: "number", label: "Whole number" },
  { value: "decimal", label: "Decimal number" },
  { value: "currency", label: "Amount (PKR)" },
  { value: "percentage", label: "Percentage" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & time" },
  { value: "checkbox", label: "Yes / no" },
  { value: "dropdown", label: "Dropdown (one choice)" },
  { value: "multi_select", label: "Multi-select (several choices)" },
  { value: "reference", label: "Link to a record (customer, product …)" },
  { value: "file", label: "File" },
  { value: "image", label: "Image / photo" },
  { value: "formula", label: "Formula (calculated)" },
];

export interface CfDef {
  id: string; entity: string; code: string; label: string; field_type: CfType; options: string[]; required: boolean;
  help_text: string | null; show_in_list: boolean; sort_order: number; is_active: boolean;
  ref_entity?: string | null; formula?: string | null; decimals?: number | null;
}
export interface CfValueRow {
  field_id: string; record_id: string; value_text: string | null; value_number: number | null; value_date: string | null; value_bool: boolean | null; value_options: string[] | null;
  value_ts?: string | null; value_ref?: string | null;
}
/** form value: string for text/number/date inputs, boolean for yes/no, string[] for multi-select */
export type CfValue = string | boolean | string[] | null;

export function useCfDefs(entity: string | null, opts: { includeInactive?: boolean } = {}) {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["cf-defs", companyId, entity, !!opts.includeInactive],
    enabled: !!companyId && !!entity && isCfEntity(entity),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let q = sb().from("custom_field_definitions").select("id, entity, code, label, field_type, options, required, help_text, show_in_list, sort_order, is_active, ref_entity, formula, decimals")
        .eq("company_id", companyId!).eq("entity", entity!).order("sort_order").order("label");
      if (!opts.includeInactive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) return [] as CfDef[]; // database older than Stage 12 → no custom fields
      return (data ?? []) as CfDef[];
    },
  });
}

export function useCfValues(entity: string, recordIds: string[], enabled = true) {
  const key = [...recordIds].sort().join(",");
  return useQuery({
    queryKey: ["cf-values", entity, key],
    enabled: enabled && recordIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await sb().from("custom_field_values").select("field_id, record_id, value_text, value_number, value_date, value_bool, value_options, value_ts, value_ref")
        .eq("entity", entity).in("record_id", recordIds);
      if (error) return [] as CfValueRow[];
      return (data ?? []) as CfValueRow[];
    },
  });
}

export function rowToForm(d: CfDef, r: CfValueRow | undefined): CfValue {
  if (!r) return d.field_type === "checkbox" ? false : d.field_type === "multi_select" ? [] : "";
  switch (d.field_type) {
    case "number": case "decimal": case "currency": case "percentage": return r.value_number == null ? "" : String(r.value_number);
    case "date": return r.value_date ?? "";
    case "datetime": return r.value_ts ? toLocalInput(r.value_ts) : "";
    case "checkbox": return !!r.value_bool;
    case "multi_select": return r.value_options ?? [];
    case "reference": case "file": case "image": return r.value_ref ?? "";
    case "formula": return r.value_number == null ? "" : String(r.value_number);
    default: return r.value_text ?? "";
  }
}

/** ISO time → value for <input type="datetime-local"> in the browser's time zone */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatCf(d: CfDef, r: CfValueRow | undefined): string {
  if (!r) return "";
  switch (d.field_type) {
    case "number": return r.value_number == null ? "" : formatNumber(r.value_number, 0);
    case "decimal": return r.value_number == null ? "" : String(Number(r.value_number));
    case "currency": return r.value_number == null ? "" : formatNumber(r.value_number, 2);
    case "percentage": return r.value_number == null ? "" : `${Number(r.value_number)}%`;
    case "date": return r.value_date ? formatDate(r.value_date) : "";
    case "datetime": return r.value_ts ? formatDateTime(r.value_ts) : "";
    case "formula": return r.value_number == null ? "" : formatNumber(r.value_number, d.decimals ?? 2);
    case "checkbox": return r.value_bool ? "Yes" : "No";
    case "multi_select": return (r.value_options ?? []).join(", ");
    default: return r.value_text ?? "";
  }
}

const isEmpty = (v: CfValue) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

/** Client-side check before saving (the database checks again). Returns field id → message. */
export function validateCf(defs: CfDef[], values: Record<string, CfValue>): Record<string, string> {
  const err: Record<string, string> = {};
  for (const d of defs) {
    if (d.field_type === "formula") continue;
    const v = values[d.id];
    if (d.required && d.field_type !== "checkbox" && isEmpty(v) && !isCfDocEntity(d.entity)) { err[d.id] = "Required"; continue; }
    if (isEmpty(v)) continue;
    if (["number", "decimal", "currency", "percentage"].includes(d.field_type) && !Number.isFinite(Number(v))) err[d.id] = "Enter a number";
    if (d.field_type === "dropdown" && !d.options.includes(String(v))) err[d.id] = "Choose from the list";
  }
  return err;
}

/** Payload for save_custom_field_values: every field, empty → null. */
export function cfPayload(defs: CfDef[], values: Record<string, CfValue>) {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    if (d.field_type === "formula") continue; // calculated by the database
    const v = values[d.id];
    if (isEmpty(v)) { out[d.id] = d.field_type === "checkbox" ? false : null; continue; }
    out[d.id] = ["number", "decimal", "currency", "percentage"].includes(d.field_type) ? Number(v)
      : d.field_type === "datetime" ? new Date(String(v)).toISOString() : v;
  }
  return out;
}

/**
 * Files chosen before the record exists: kept here and uploaded right after the record is saved.
 * The field's form value is "pending:<key>" until then.
 */
const pendingFiles = new Map<string, File>();
const PENDING = "pending:";
export const isPendingFile = (v: CfValue) => typeof v === "string" && v.startsWith(PENDING);

export async function saveCfValues(companyId: string, entity: string, recordId: string, defs: CfDef[], values: Record<string, CfValue>) {
  if (!defs.length) return;
  values = { ...values };
  for (const d of defs) {
    const v = values[d.id];
    if ((d.field_type === "file" || d.field_type === "image") && isPendingFile(v)) {
      const f = pendingFiles.get(String(v));
      values[d.id] = f ? await uploadAttachment(entity as AttachmentEntity, recordId, f, d.label) : null;
      pendingFiles.delete(String(v));
    }
  }
  const { error } = await sb().rpc("save_custom_field_values", { p_company: companyId, p_entity: entity, p_record: recordId, p_values: cfPayload(defs, values) });
  if (error) throw error;
}

const selectCls = "h-control w-full rounded-control border border-transparent bg-field px-2 text-sm hover:border-line focus:border-line-strong focus:bg-surface focus:outline-none";

export function CfInput({ def, value, onChange, error, recordId, label: shownLabel }: {
  def: CfDef; value: CfValue; onChange: (v: CfValue) => void; error?: string;
  /** the record being edited — needed to attach files (not available while creating) */
  recordId?: string | null; label?: string | null;
}) {
  const id = `cf-${def.id}`;
  const label = def.label;
  switch (def.field_type) {
    case "formula":
      return <Field label={label} hint={def.help_text ?? `= ${def.formula ?? ""}`} htmlFor={id}>
        <div id={id} className="flex h-control items-center gap-1.5 rounded-control bg-subtle px-2 text-sm tabular-nums text-ink-2">
          <Sigma className="h-3.5 w-3.5 text-ink-faint" />{value === "" || value == null ? <span className="text-ink-faint">calculated on save</span> : formatNumber(Number(value), def.decimals ?? 2)}
        </div></Field>;
    case "datetime":
      return <Field label={label} required={def.required} error={error} hint={def.help_text} htmlFor={id}><Input id={id} type="datetime-local" invalid={!!error} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} /></Field>;
    case "reference":
      return <Field label={label} required={def.required} error={error} hint={def.help_text} htmlFor={id}><CfRefSelect def={def} id={id} value={String(value ?? "")} invalid={!!error} onChange={onChange} /></Field>;
    case "file": case "image":
      return <Field label={label} required={def.required} error={error} hint={def.help_text} htmlFor={id}>
        <CfFileInput def={def} id={id} value={String(value ?? "")} recordId={recordId ?? null} fileName={shownLabel ?? null} onChange={onChange} /></Field>;
    case "checkbox":
      return <div className="flex items-end pb-5"><Checkbox id={id} checked={value === true} onChange={(v) => onChange(v)} label={label} description={def.help_text ?? undefined} /></div>;
    case "long_text":
      return <Field label={label} required={def.required} error={error} hint={def.help_text} htmlFor={id} className="sm:col-span-2 lg:col-span-3">
        <Textarea id={id} rows={2} value={String(value ?? "")} invalid={!!error} onChange={(e) => onChange(e.target.value)} /></Field>;
    case "dropdown":
      return <Field label={label} required={def.required} error={error} hint={def.help_text} htmlFor={id}>
        <select id={id} className={cn(selectCls, error && "border-danger-line")} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
          {value && !def.options.includes(String(value)) ? <option value={String(value)}>{String(value)} (old choice)</option> : null}
        </select></Field>;
    case "multi_select": {
      const sel = new Set(Array.isArray(value) ? value : []);
      return <Field label={label} required={def.required} error={error} hint={def.help_text} className="sm:col-span-2 lg:col-span-3">
        <div className="flex flex-wrap gap-1.5">
          {def.options.map((o) => (
            <button key={o} type="button" onClick={() => { const n = new Set(sel); n.has(o) ? n.delete(o) : n.add(o); onChange(def.options.filter((x) => n.has(x))); }}
              className={cn("h-7 rounded-full border px-2.5 text-xs", sel.has(o) ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong")}>{o}</button>
          ))}
        </div></Field>;
    }
    case "date":
      return <Field label={label} required={def.required} error={error} hint={def.help_text} htmlFor={id}><Input id={id} type="date" invalid={!!error} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} /></Field>;
    case "number": case "decimal": case "currency": case "percentage":
      return <Field label={def.field_type === "percentage" ? `${label} (%)` : def.field_type === "currency" ? `${label} (PKR)` : label} required={def.required} error={error} hint={def.help_text} htmlFor={id}>
        <Input id={id} type="number" inputMode="decimal" step={def.field_type === "number" ? 1 : "any"} invalid={!!error} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="tabular-nums" /></Field>;
    default:
      return <Field label={label} required={def.required} error={error} hint={def.help_text} htmlFor={id}><Input id={id} maxLength={500} invalid={!!error} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} /></Field>;
  }
}

function CfRefSelect({ def, id, value, invalid, onChange }: { def: CfDef; id: string; value: string; invalid: boolean; onChange: (v: CfValue) => void }) {
  const { companyId } = useAccess();
  const spec = CF_REF_ENTITIES.find((e) => e.key === def.ref_entity)?.lookup;
  const loader = React.useMemo(() => (spec ? makeLookupLoader(spec, companyId) : null), [spec, companyId]);
  if (!loader) return <p className="text-xs text-ink-faint">—</p>;
  return <SearchableSelect id={id} value={value || null} invalid={invalid} onChange={(v) => onChange(v ?? "")} loadOptions={loader.load} resolveOption={loader.resolve} placeholder="Search…" clearable={!def.required} />;
}

function CfFileInput({ def, id, value, recordId, fileName, onChange }: { def: CfDef; id: string; value: string; recordId: string | null; fileName: string | null; onChange: (v: CfValue) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState<string | null>(fileName);
  React.useEffect(() => setName(fileName), [fileName]);
  const pending = isPendingFile(value) ? pendingFiles.get(value) ?? null : null;
  const preview = React.useMemo(() => (pending && pending.type.startsWith("image/") ? URL.createObjectURL(pending) : null), [pending]);
  React.useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (def.field_type === "image" && !f.type.startsWith("image/")) { toast.error("Choose a photo or image"); return; }
    if (!recordId) {
      // not saved yet: keep the file, it is uploaded together with the save
      const key = `${PENDING}${crypto.randomUUID()}`;
      pendingFiles.set(key, f);
      if (isPendingFile(value)) pendingFiles.delete(value);
      onChange(key);
      return;
    }
    setBusy(true);
    try {
      const aid = await uploadAttachment(def.entity as AttachmentEntity, recordId, f, def.label);
      setName(f.name);
      onChange(aid);
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  const clear = () => { if (isPendingFile(value)) pendingFiles.delete(value); onChange(""); };
  return (
    <div className="flex h-control items-center gap-2">
      <label className={cn("inline-flex h-control-sm shrink-0 cursor-pointer items-center gap-1 rounded-control border border-line px-2 text-xs hover:border-line-strong", busy && "opacity-60")}>
        <Paperclip className="h-3.5 w-3.5" />{busy ? "Uploading…" : value ? "Replace" : def.field_type === "image" ? "Add photo" : "Attach file"}
        <input id={id} type="file" className="hidden" disabled={busy} accept={def.field_type === "image" ? "image/*" : "image/*,application/pdf,.doc,.docx,.xls,.xlsx"}
          onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {pending ? (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-2" title="Uploaded when you save">
          {preview && <img src={preview} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />}
          <span className="truncate">{pending.name}</span><span className="shrink-0 text-ink-faint">· uploads on save</span>
        </span>
      ) : value ? <button type="button" className="min-w-0 truncate text-xs text-primary hover:underline" onClick={() => void openAttachment(value)}>{name ?? "Open"}</button> : null}
      {value && <Button size="sm" variant="ghost" onClick={clear}>Remove</Button>}
    </div>
  );
}

export function CfFormSection({ defs, values, onChange, errors, recordId, rows, title = "Additional fields" }: {
  defs: CfDef[]; values: Record<string, CfValue>; onChange: (id: string, v: CfValue) => void; errors: Record<string, string>;
  recordId?: string | null; rows?: CfValueRow[]; title?: string;
}) {
  if (!defs.length) return null;
  const by = new Map((rows ?? []).map((r) => [r.field_id, r]));
  return (
    <div className="rounded-card border border-line p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</div>
      <FormGrid cols={3}>
        {defs.map((d) => <CfInput key={d.id} def={d} value={values[d.id] ?? null} error={errors[d.id]} onChange={(v) => onChange(d.id, v)}
          recordId={recordId} label={by.get(d.id)?.value_text ?? null} />)}
      </FormGrid>
    </div>
  );
}

export function CfViewSection({ defs, rows, title = "Additional fields", action }: { defs: CfDef[]; rows: CfValueRow[]; title?: string; action?: React.ReactNode }) {
  if (!defs.length) return null;
  const by = new Map(rows.map((r) => [r.field_id, r]));
  const any = defs.some((d) => by.has(d.id));
  return (
    <div className="rounded-card border border-line p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted"><span className="flex-1">{title}</span>{action}</div>
      {any ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3 lg:grid-cols-4">
          {defs.map((d) => {
            const r = by.get(d.id);
            const txt = formatCf(d, r);
            return (
              <KeyValue key={d.id} label={d.label} className={d.field_type === "long_text" ? "col-span-2 md:col-span-3 lg:col-span-4" : undefined}>
                {d.field_type === "multi_select" && r?.value_options?.length
                  ? <span className="flex flex-wrap gap-1">{r.value_options.map((o) => <Badge key={o}>{o}</Badge>)}</span>
                  : (d.field_type === "file" || d.field_type === "image") && r?.value_ref
                    ? <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => void openAttachment(r.value_ref!)}><Paperclip className="h-3.5 w-3.5" />{txt || "Open"}</button>
                  : txt ? <span className="whitespace-pre-wrap">{txt}</span> : <span className="text-ink-faint">—</span>}
              </KeyValue>
            );
          })}
        </dl>
      ) : <p className="text-xs text-ink-faint">Nothing recorded.</p>}
    </div>
  );
}

/** Values for one record, kept in local form state. */
export function useCfForm(defs: CfDef[], rows: CfValueRow[] | undefined, resetKey: unknown) {
  const initial = React.useMemo(() => {
    const by = new Map((rows ?? []).map((r) => [r.field_id, r]));
    return Object.fromEntries(defs.map((d) => [d.id, rowToForm(d, by.get(d.id))])) as Record<string, CfValue>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defs, rows, resetKey]);
  const [values, setValues] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => { setValues(initial); setErrors({}); }, [initial]);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  return {
    values, errors, dirty,
    set: (id: string, v: CfValue) => { setValues((o) => ({ ...o, [id]: v })); setErrors((e) => { const n = { ...e }; delete n[id]; return n; }); },
    validate: () => { const e = validateCf(defs, values); setErrors(e); return Object.keys(e).length === 0; },
  };
}

// ------------------------------------------------------------------ list filter
export interface CfFilter { field: string; op: "eq" | "contains" | "gte" | "lte" | "yes" | "no" | "empty" | "any"; value: string }

export const filterOps = (t: CfType): { value: CfFilter["op"]; label: string }[] =>
  t === "checkbox" ? [{ value: "yes", label: "is Yes" }, { value: "no", label: "is No" }]
  : t === "dropdown" ? [{ value: "eq", label: "is" }, { value: "empty", label: "is empty" }]
  : t === "multi_select" ? [{ value: "any", label: "includes" }, { value: "empty", label: "is empty" }]
  : t === "reference" || t === "file" || t === "image" ? [{ value: "contains", label: "contains" }, { value: "empty", label: "is empty" }]
  : ["number", "decimal", "currency", "percentage", "formula", "date", "datetime"].includes(t) ? [{ value: "eq", label: "=" }, { value: "gte", label: "≥" }, { value: "lte", label: "≤" }, { value: "empty", label: "is empty" }]
  : [{ value: "contains", label: "contains" }, { value: "eq", label: "is exactly" }, { value: "empty", label: "is empty" }];

export const encodeCfFilter = (f: CfFilter) => [f.field, f.op, f.value].map(encodeURIComponent).join("~");
export function decodeCfFilter(s: string | null): CfFilter | null {
  if (!s) return null;
  const [field, op, value] = s.split("~").map(decodeURIComponent);
  return field && op ? { field, op: op as CfFilter["op"], value: value ?? "" } : null;
}

const MAX_FILTER_IDS = 1000;

/** Record ids matching one custom-field condition (null = no filter). */
export function useCfFilterIds(entity: string, f: CfFilter | null, def: CfDef | undefined) {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["cf-filter", entity, f ? encodeCfFilter(f) : null],
    enabled: !!companyId && !!f && !!def,
    staleTime: 15_000,
    queryFn: async () => {
      const d = def!; const flt = f!;
      const col = ["number", "decimal", "currency", "percentage", "formula"].includes(d.field_type) ? "value_number" : d.field_type === "date" || d.field_type === "datetime" ? "value_date" : d.field_type === "checkbox" ? "value_bool" : "value_text";
      if (flt.op === "empty" || flt.op === "no") {
        // records WITHOUT a value: everything except those that have one
        const has = await sb().from("custom_field_values").select("record_id").eq("field_id", d.id).limit(5000);
        if (has.error) throw has.error;
        const all = await sb().from(entity).select("id").eq("company_id", companyId!).limit(MAX_FILTER_IDS + 1);
        if (all.error) throw all.error;
        const skip = new Set((has.data ?? []).map((r) => (r as { record_id: string }).record_id));
        const ids = ((all.data ?? []) as { id: string }[]).map((r) => r.id).filter((x) => !skip.has(x));
        return { ids: ids.slice(0, MAX_FILTER_IDS), capped: ids.length > MAX_FILTER_IDS };
      }
      let q = sb().from("custom_field_values").select("record_id").eq("field_id", d.id);
      const v = flt.value.trim();
      if (flt.op === "yes") q = q.eq("value_bool", true);
      else if (flt.op === "any") q = q.contains("value_options", [v]);
      else if (flt.op === "contains") q = q.ilike("value_text", `%${v.replace(/[%_]/g, " ")}%`);
      else if (flt.op === "gte") q = q.gte(col, v);
      else if (flt.op === "lte") q = q.lte(col, v);
      else q = col === "value_text" && d.field_type !== "dropdown" ? q.ilike(col, v.replace(/[%_]/g, " ")) : q.eq(col, v);
      const { data, error } = await q.limit(MAX_FILTER_IDS + 1);
      if (error) throw error;
      const ids = ((data ?? []) as { record_id: string }[]).map((r) => r.record_id);
      return { ids: ids.slice(0, MAX_FILTER_IDS), capped: ids.length > MAX_FILTER_IDS };
    },
  });
}

// ------------------------------------------------------------------ document forms
const NO_DOC_DEFS: CfDef[] = [];
const NO_DOC_ROWS: CfValueRow[] = [];
/**
 * Custom fields inside a document's New / Edit form (sales order, GDN, PO …).
 * Render `section`, include `dirty` in the form's unsaved check, and call `save(id)` right after the
 * document itself is saved (before approve / post, so required fields are already there).
 */
export function useDocCf(entity: string, id: string | null) {
  const { companyId } = useAccess();
  const defs = useCfDefs(entity).data ?? NO_DOC_DEFS;
  const rows = useCfValues(entity, id ? [id] : [], !!id && defs.length > 0);
  const form = useCfForm(defs, id ? rows.data : NO_DOC_ROWS, `${entity}:${id ?? "new"}`);
  return {
    defs,
    dirty: defs.length > 0 && form.dirty,
    validate: form.validate,
    save: async (recordId: string) => {
      if (!defs.length || (id && !form.dirty)) return;
      await saveCfValues(companyId!, entity, recordId, defs, form.values);
    },
    section: defs.length ? (
      <CfFormSection title="Document fields" defs={defs} values={form.values} errors={form.errors} onChange={form.set} recordId={id} rows={rows.data} />
    ) : null,
  };
}
