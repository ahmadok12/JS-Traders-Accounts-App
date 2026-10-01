import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Cylinder, PackagePlus, Pencil, ShieldAlert } from "lucide-react";
import {
  Badge, Button, Card, DataTable, EmptyState, ErpDialog, Field, FormGrid, Input, KeyValue, PageHeader, SearchableSelect, SectionTitle, Skeleton, Textarea, cn,
} from "@jst/ui";
import { friendlyError, sb, useAccess, useEntityList } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatDateTime, humanize } from "@jst/utilities";
import { SearchBox, StatusFilter, useUrlState } from "./DocPage";
import { ADJUSTMENT_REASONS, SOURCE_ROUTE } from "./docConfigs";
import { MovementsTable } from "./MovementsTable";
import { ProductPicker, VariantPicker, WarehousePicker, useProductMeta, useStockFigures } from "./pickers";
import { RollLengthsEditor, fmtQty, newRoll, sumRolls, useRolls, type RollEntry } from "./rolls";
import { useNavigate } from "react-router-dom";

type Row = Record<string, unknown> & { id: string };
const PAGE = 50;
const FILTERS = [
  { label: "In stock", in_stock: true as boolean | undefined },
  { label: "Used up", in_stock: false as boolean | undefined },
  { label: "All", in_stock: undefined as boolean | undefined },
];
const SELECT =
  "id, unit_no, remaining_qty, original_qty, label, source_type, source_id, source_doc_no, created_at, last_movement_at, in_stock, product_id, variant_id, warehouse_id, parent_unit_id, product:products(name, sku, uom:units_of_measure!products_base_uom_id_fkey(code)), variant:product_variants(name), warehouse:warehouses(code, name)";

/** Roll numbers for parent rolls (looked up separately — a roll's link to its own table is not embedded). */
function useRollNos(ids: (string | null | undefined)[]) {
  const list = Array.from(new Set(ids.filter(Boolean) as string[])).sort();
  return useQuery({
    queryKey: ["roll-nos", list.join()],
    enabled: list.length > 0,
    queryFn: async () => {
      const { data, error } = await sb().from("physical_units").select("id, unit_no").in("id", list);
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.id as string, r.unit_no as string]));
    },
  });
}

/** Used / remaining bar for a roll */
function Meter({ remaining, original }: { remaining: number; original: number }) {
  const pct = original > 0 ? Math.max(0, Math.min(100, (remaining / original) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle" aria-hidden>
      <div className={cn("h-full rounded-full", pct > 50 ? "bg-success" : pct > 15 ? "bg-warning" : "bg-danger")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function RollsPage() {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const f = Number(params.get("f") ?? "0") || 0;
  const wh = params.get("wh");
  const viewId = params.get("view");
  const registering = params.get("register") === "1";

  const list = useEntityList<Row>({
    table: "physical_units",
    select: SELECT,
    companyId,
    search: q,
    searchColumns: ["unit_no", "label", "source_doc_no"],
    filters: { in_stock: FILTERS[f].in_stock, warehouse_id: wh ?? undefined },
    orderBy: { column: "created_at", ascending: false },
    page,
    pageSize: PAGE,
    enabled: can(P.inventoryView),
  });

  const parents = useRollNos((list.data?.rows ?? []).map((r) => r.parent_unit_id as string | null));

  if (!can(P.inventoryView)) {
    return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="You don't have permission to view inventory." /></Card>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Rolls"
        description="Pipe, cable and other items tracked roll by roll — what is left on each roll, where it is and where it came from."
        icon={<Cylinder className="h-4 w-4" />}
        actions={can(P.inventoryAdjust) && (
          <Button icon={<PackagePlus className="h-4 w-4" />} onClick={() => update({ register: "1", view: null })}>Register existing stock as rolls</Button>
        )}
      />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search roll no. / lot / document…" />
          <StatusFilter items={FILTERS} value={f} onChange={(i) => update({ f: i ? String(i) : null, page: null })} />
          <div className="w-56"><WarehousePicker value={wh} onChange={(v) => update({ wh: v, page: null })} /></div>
          {wh && <Button size="sm" variant="ghost" onClick={() => update({ wh: null })}>All warehouses</Button>}
        </div>
        {list.error ? (
          <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p>
        ) : (
          <DataTable
            loading={list.isLoading}
            rows={list.data?.rows ?? []}
            onView={(r) => update({ view: r.id, register: null })}
            page={page}
            pageSize={PAGE}
            total={list.data?.total ?? null}
            onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "no", header: "Roll", width: "110px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.unit_no)}</span> },
              {
                key: "item", header: "Item", cell: (r) => {
                  const p = r.product as { name: string; sku: string }; const v = r.variant as { name: string } | null;
                  return <div className="min-w-0"><div className="truncate font-medium">{p?.name}{v ? <span className="font-normal text-ink-muted"> · {v.name}</span> : null}</div>
                    <div className="text-2xs text-ink-muted">{p?.sku}{r.label ? ` · Lot ${String(r.label)}` : ""}</div></div>;
                },
              },
              { key: "wh", header: "Warehouse", hideBelow: "md", cell: (r) => { const w = r.warehouse as { code: string; name: string }; return <span><span className="font-mono text-xs text-ink-muted">{w?.code}</span> {w?.name}</span>; } },
              {
                key: "left", header: "Left", width: "180px", cell: (r) => {
                  const uom = (r.product as { uom: { code: string } })?.uom?.code ?? "";
                  return (
                    <div className="w-full">
                      <div className="flex justify-between text-xs tabular-nums"><b>{fmtQty(Number(r.remaining_qty))} {uom}</b><span className="text-ink-faint">of {fmtQty(Number(r.original_qty))}</span></div>
                      <Meter remaining={Number(r.remaining_qty)} original={Number(r.original_qty)} />
                    </div>
                  );
                },
              },
              { key: "from", header: "Cut from", hideBelow: "lg", cell: (r) => r.parent_unit_id ? <span className="font-mono text-xs">{parents.data?.get(String(r.parent_unit_id)) ?? "…"}</span> : <span className="text-ink-faint">—</span> },
              { key: "src", header: "Came in", hideBelow: "lg", cell: (r) => <span className="text-xs">{r.source_type === "REGISTERED" ? "Registered" : (r.source_doc_no as string) ?? ""} <span className="text-ink-faint">· {formatDate(r.created_at as string)}</span></span> },
            ]}
            empty={
              <EmptyState icon={<Cylinder className="h-6 w-6" />} title="No rolls yet"
                description='Set a product’s Tracking to "By roll" (Products → Show Advanced Product Details). Rolls are then created when stock arrives, or register stock you already hold.' />
            }
          />
        )}
      </Card>
      {viewId && <RollDialog id={viewId} onClose={() => update({ view: null })} onOpen={(id) => update({ view: id })} />}
      {registering && <RegisterDialog onClose={() => update({ register: null })} />}
    </div>
  );
}

/* ================================================================== ROLL */
function RollDialog({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { can } = useAccess();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [correcting, setCorrecting] = React.useState(false);
  const r = useQuery({
    queryKey: ["record", "physical_units", id],
    queryFn: async () => {
      const { data, error } = await sb().from("physical_units").select(SELECT).eq("id", id).single();
      if (error) throw error;
      return data as unknown as Row;
    },
  });
  const children = useQuery({
    queryKey: ["roll-children", id],
    queryFn: async () => {
      const { data, error } = await sb().from("physical_units").select("id, unit_no, remaining_qty, original_qty, warehouse:warehouses(code)").eq("parent_unit_id", id).order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; unit_no: string; remaining_qty: number; original_qty: number; warehouse: { code: string } }[];
    },
  });
  const d = r.data;
  const parentNo = useRollNos([d?.parent_unit_id as string | null]);
  const p = d?.product as { name: string; sku: string; uom: { code: string } } | undefined;
  const v = d?.variant as { name: string } | null | undefined;
  const w = d?.warehouse as { code: string; name: string } | undefined;
  const uom = p?.uom?.code ?? "";

  return (
    <ErpDialog
      open
      onRequestClose={onClose}
      title={d ? `Roll ${String(d.unit_no)}` : "Roll"}
      subtitle={p ? `${p.name}${v ? ` · ${v.name}` : ""}` : undefined}
      icon={<Cylinder className="h-4 w-4" />}
      status={d ? <Badge tone={Number(d.remaining_qty) > 0 ? "success" : "neutral"}>{Number(d.remaining_qty) > 0 ? "In stock" : "Used up"}</Badge> : null}
      size="lg"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Close</Button>
          {d && can(P.inventoryAdjust) && can(P.inventoryPost) && (
            <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setCorrecting(true)}>Correct length</Button>
          )}
        </>
      }
    >
      {r.isLoading ? <Skeleton className="h-40" /> : r.error ? <p className="text-sm text-danger">{friendlyError(r.error)}</p> : d ? (
        <>
          <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
            <KeyValue label="Left"><span className="text-lg font-semibold tabular-nums">{fmtQty(Number(d.remaining_qty))}</span> {uom}</KeyValue>
            <KeyValue label="Original length"><span className="tabular-nums">{fmtQty(Number(d.original_qty))}</span> {uom}</KeyValue>
            <KeyValue label="Warehouse">{w ? `${w.code} · ${w.name}` : null}</KeyValue>
            <KeyValue label="Lot / label">{(d.label as string) || null}</KeyValue>
            <KeyValue label="Came in">
              {d.source_type === "REGISTERED" ? "Registered from existing stock"
                : d.source_id && SOURCE_ROUTE[String(d.source_type)]
                  ? <button className="font-mono text-xs text-info hover:underline" onClick={() => navigate(`${SOURCE_ROUTE[String(d.source_type)]}?view=${d.source_id}`)}>{String(d.source_doc_no ?? humanize(String(d.source_type)))}</button>
                  : humanize(String(d.source_type ?? ""))}
            </KeyValue>
            <KeyValue label="Created">{formatDateTime(d.created_at as string)}</KeyValue>
            {d.parent_unit_id ? (
              <KeyValue label="Cut from"><button className="font-mono text-xs text-info hover:underline" onClick={() => onOpen(String(d.parent_unit_id))}>{parentNo.data?.get(String(d.parent_unit_id)) ?? "…"}</button></KeyValue>
            ) : null}
          </dl>
          <div className="mb-3"><Meter remaining={Number(d.remaining_qty)} original={Number(d.original_qty)} /></div>
          {(children.data ?? []).length > 0 && (
            <div className="mb-3">
              <SectionTitle>Pieces cut off as separate rolls</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {children.data!.map((c) => (
                  <button key={c.id} onClick={() => onOpen(c.id)} className="rounded-control border border-line px-2 py-0.5 text-xs hover:border-primary">
                    <span className="font-mono">{c.unit_no}</span> <span className="text-ink-muted">{c.warehouse?.code} · {fmtQty(Number(c.remaining_qty))}/{fmtQty(Number(c.original_qty))}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <SectionTitle>History</SectionTitle>
          <MovementsTable unitId={id} showItem={false} limit={100} />
        </>
      ) : null}
      {correcting && d && (
        <CorrectDialog roll={d} uom={uom} onClose={() => setCorrecting(false)} onDone={() => { setCorrecting(false); qc.invalidateQueries(); }} />
      )}
    </ErpDialog>
  );
}

function CorrectDialog({ roll, uom, onClose, onDone }: { roll: Row; uom: string; onClose: () => void; onDone: () => void }) {
  const [len, setLen] = React.useState(String(Number(roll.remaining_qty)));
  const [reason, setReason] = React.useState<string | null>("COUNT_CORRECTION");
  const [note, setNote] = React.useState("");
  const v = Number(len.replace(/,/g, ""));
  const ok = len.trim() !== "" && !Number.isNaN(v) && v >= 0 && v !== Number(roll.remaining_qty);
  const diff = ok ? v - Number(roll.remaining_qty) : 0;
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await sb().rpc("correct_unit_length", { p_unit_id: roll.id, p_new_remaining: len.replace(/,/g, ""), p_reason: reason, p_note: note || null });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(`Roll ${String(roll.unit_no)} corrected — stock adjusted`); onDone(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <ErpDialog
      open
      onRequestClose={onClose}
      title={`Correct roll ${String(roll.unit_no)}`}
      icon={<Pencil className="h-4 w-4" />}
      size="md"
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} loading={save.isPending} onClick={() => save.mutate()}>Save & post</Button></>}
    >
      <FormGrid cols={2}>
        <Field label={`Length actually left (${uom})`} required hint={`System: ${fmtQty(Number(roll.remaining_qty))} ${uom}. Enter 0 to write off an unusable off-cut.`}>
          <Input inputMode="decimal" className="text-right tabular-nums" value={len} onChange={(e) => setLen(e.target.value)} autoFocus />
        </Field>
        <Field label="Reason" required>
          <SearchableSelect value={reason} onChange={setReason} clearable={false}
            options={ADJUSTMENT_REASONS.filter((r) => ["COUNT_CORRECTION", "DAMAGE", "LOSS", "FOUND_STOCK", "WAREHOUSE_CORRECTION", "OTHER"].includes(r.value))} />
        </Field>
        <Field label="Note" className="sm:col-span-2"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. measured on 1 Oct, end damaged" /></Field>
      </FormGrid>
      {ok && <p className={cn("mt-2 text-xs tabular-nums", diff < 0 ? "text-danger" : "text-success")}>A stock adjustment of {diff > 0 ? "+" : "−"}{fmtQty(Math.abs(diff))} {uom} will be posted for this roll.</p>}
    </ErpDialog>
  );
}

/* ================================================================== REGISTER */
function RegisterDialog({ onClose }: { onClose: () => void }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const [wh, setWh] = React.useState<string | null>(null);
  const [product, setProduct] = React.useState<string | null>(null);
  const [variant, setVariant] = React.useState<string | null>(null);
  const [rolls, setRolls] = React.useState<RollEntry[]>([newRoll()]);
  const meta = useProductMeta(product);
  const stock = useStockFigures(wh, product, variant);
  const ready = !!wh && !!product && !!meta.data && (!meta.data.has_variants || !!variant);
  const inRolls = useRolls(wh, product, variant, ready);
  const onHand = stock.data ? Number(stock.data.on_hand) : 0;
  const rolled = (inRolls.data ?? []).reduce((a, r) => a + Number(r.remaining_qty), 0);
  const loose = Math.max(onHand - rolled, 0);
  const total = sumRolls(rolls);
  const valid = ready && !!meta.data?.rolls && rolls.length > 0 && rolls.every((r) => Number(r.qty.replace(/,/g, "")) > 0) && total > 0 && total <= loose + 1e-9;

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb().rpc("register_units", {
        p_company_id: companyId, p_warehouse_id: wh, p_product_id: product, p_variant_id: variant,
        p_rolls: rolls.map((r) => ({ qty: r.qty.replace(/,/g, ""), label: r.label || null })),
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => { toast.success(`${n} roll(s) registered`); qc.invalidateQueries(); setRolls([newRoll()]); },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <ErpDialog
      open
      onRequestClose={onClose}
      title="Register existing stock as rolls"
      subtitle="Split stock you already hold into rolls. Stock totals do not change."
      icon={<PackagePlus className="h-4 w-4" />}
      size="lg"
      footer={<><div className="flex-1" /><Button onClick={onClose}>Close</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Register rolls</Button></>}
    >
      <FormGrid cols={3}>
        <Field label="Warehouse" required><WarehousePicker value={wh} onChange={(v) => setWh(v)} /></Field>
        <Field label="Item (tracked by roll)" required>
          <ProductPicker warehouseId={wh} filters={{ tracking_type: "PHYSICAL_UNIT" }} placeholder="Search roll item…" value={product} onChange={(v) => { setProduct(v); setVariant(null); }} />
        </Field>
        <Field label="Variant"><VariantPicker productId={product} warehouseId={wh} value={variant} onChange={setVariant} /></Field>
      </FormGrid>
      {ready && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2 text-xs tabular-nums">
            <Badge tone="neutral">On hand {fmtQty(onHand)} {meta.data?.uom}</Badge>
            <Badge tone="info">Already in rolls {fmtQty(rolled)}</Badge>
            <Badge tone={loose > 0 ? "warning" : "success"}>Not yet in rolls {fmtQty(loose)}</Badge>
          </div>
          {loose > 0 ? (
            <>
              <RollLengthsEditor rolls={rolls} onChange={(r) => setRolls(r.length ? r : [newRoll()])} uom={meta.data?.uom ?? ""} />
              {total > loose + 1e-9 && <p className="text-xs text-danger">The rolls add up to {fmtQty(total)}, but only {fmtQty(loose)} is not yet in rolls.</p>}
            </>
          ) : (
            <p className="text-xs text-ink-muted">All stock of this item here is already in rolls.</p>
          )}
        </div>
      )}
    </ErpDialog>
  );
}
