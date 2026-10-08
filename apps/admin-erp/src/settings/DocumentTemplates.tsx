import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown, FileText, ImagePlus, Palette, RotateCcw, Save, Trash2 } from "lucide-react";
import { Badge, Button, Card, Checkbox, ConfirmDialog, Field, FormGrid, Input, SectionTitle, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { useUnsavedGuard } from "../lib/unsaved";
import { DOC_TYPES, docTypeDef, type DocTypeDef } from "../documents/registry";
import { applyTemplate, autoHeaderLines, clearTemplateCache, mergeSettings, renderHtml, type CompanyInfo, type PrintSpecBase, type TemplateSettings } from "../documents/template";
import { downloadBlob, renderPdf } from "../sales/pdf";

type Row = { doc_type: string; settings: TemplateSettings; logo: string | null; updated_at: string };

const selectCls = "h-control w-full rounded-control border border-transparent bg-field px-2 text-sm hover:border-line focus:border-line-strong focus:bg-surface focus:outline-none";

/** Shrink an uploaded logo so templates stay small (≤ 600 × 300 px). */
async function readLogo(file: File): Promise<string> {
  const src = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const k = Math.min(1, 600 / img.naturalWidth, 300 / img.naturalHeight);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext("2d")!;
  const png = file.type === "image/png" || file.type === "image/svg+xml" || file.type === "image/webp";
  if (!png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const out = png ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.88);
  if (out.length > 400_000) throw new Error("This logo is too large even after resizing — use a smaller image (PNG or JPG).");
  return out;
}

function sampleSpec(def: DocTypeDef): PrintSpecBase {
  const sampleMeta: Record<string, string> = {
    Customer: "Al-Noor Poultry Farm, Okara", Supplier: "Guangzhou Huanan Equipment Co.", Date: "08 Oct 2026", "Invoice date": "08 Oct 2026", "Bill date": "08 Oct 2026",
    "Due date": "07 Nov 2026", "Valid until": "22 Oct 2026", "Customer ref.": "PO-778", "Your reference": "WhatsApp 05-Oct", "Sales order": "SO-2026-00012",
    Transport: "Mazda LES-1234", "Delivery notes": "GDN-2026-00021", Status: "Approved", Currency: "PKR", "Supplier ref.": "HN-2210", Expected: "30 Oct 2026",
    "Supplier invoice": "HN-INV-5521", Reason: "Wrong size", GDN: "GDN-2026-00021", "Goods receipt": "GRN-2026-00004", "Received from": "Al-Noor Poultry Farm",
    "Paid to": "Malik Goods Transport", Reference: "CHQ 004512", "Bank / cash": "Meezan Current", Memo: "Salaries October", Month: "Oct 2026", "Accounting date": "31 Oct 2026",
    Shipment: "SHP-00003",
  };
  return {
    company: "JS Traders", title: def.title, docNo: `${def.key === "GDN" ? "GDN" : def.key.split("_").map((w) => w[0]).join("")}-2026-00012`, docType: def.key,
    meta: def.meta.map((k) => [k, sampleMeta[k] ?? "—"] as [string, string]),
    columns: def.columns, rows: def.sampleRows, totals: def.sampleTotals, notes: "Deliver to farm gate no. 2.", signatures: def.signatures,
  };
}

export function DocumentTemplates() {
  const { companyId, can } = useAccess();
  const [sel, setSel] = React.useState("DEFAULT");
  const rows = useQuery({
    queryKey: ["document-templates", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [t, c] = await Promise.all([
        sb().from("document_templates").select("doc_type, settings, logo, updated_at").eq("company_id", companyId!),
        sb().from("companies").select("name, legal_name, address, phone, email, ntn, strn").eq("id", companyId!).single(),
      ]);
      if (t.error) throw t.error;
      return { rows: (t.data ?? []) as Row[], company: (c.data ?? null) as CompanyInfo | null };
    },
  });
  if (rows.isLoading) return <Skeleton className="h-96" />;
  if (rows.error) return <Card className="p-4 text-sm text-danger">{friendlyError(rows.error)}</Card>;
  const have = new Set(rows.data!.rows.map((r) => r.doc_type));
  const groups = ["Sales", "Purchasing", "Accounting", "HR"] as const;
  return (
    <div className="grid min-h-0 gap-3 lg:grid-cols-[230px_1fr]">
      <Card className="h-fit overflow-hidden">
        <button onClick={() => setSel("DEFAULT")} className={cn("flex w-full items-center gap-2 border-b border-line px-3 py-2.5 text-left text-sm", sel === "DEFAULT" ? "bg-field font-semibold" : "hover:bg-subtle")}>
          <Palette className="h-4 w-4 text-ink-muted" /> <span className="flex-1">Company look</span>
        </button>
        {groups.map((g) => (
          <div key={g} className="py-1">
            <div className="px-3 pb-0.5 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">{g}</div>
            {DOC_TYPES.filter((d) => d.group === g).map((d) => (
              <button key={d.key} onClick={() => setSel(d.key)} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", sel === d.key ? "bg-field font-medium text-ink" : "text-ink-2 hover:bg-subtle")}>
                <FileText className="h-3.5 w-3.5 text-ink-faint" /><span className="flex-1 truncate">{d.label}</span>
                {have.has(d.key) && <Badge tone="info">Custom</Badge>}
              </button>
            ))}
          </div>
        ))}
      </Card>
      <TemplateEditor key={sel} docType={sel} rows={rows.data!.rows} company={rows.data!.company} canEdit={can("settings.manage")} />
    </div>
  );
}

function TemplateEditor({ docType, rows, company, canEdit }: { docType: string; rows: Row[]; company: CompanyInfo | null; canEdit: boolean }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const isDefault = docType === "DEFAULT";
  const def = docTypeDef(docType) ?? docTypeDef("SALES_INVOICE")!;
  const defRow = rows.find((r) => r.doc_type === "DEFAULT");
  const row = rows.find((r) => r.doc_type === docType);
  const initial = React.useMemo(() => ({ settings: (row?.settings ?? {}) as TemplateSettings, logo: isDefault ? row?.logo ?? null : null }), [row, isDefault]);
  const [s, setS] = React.useState<TemplateSettings>(initial.settings);
  const [logo, setLogo] = React.useState<string | null>(initial.logo);
  const [askReset, setAskReset] = React.useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial.settings) || logo !== initial.logo;
  const { dialog } = useUnsavedGuard(dirty);
  const set = <K extends keyof TemplateSettings>(k: K, v: TemplateSettings[K]) => setS((o) => ({ ...o, [k]: v }));

  const bundle = {
    settings: isDefault ? mergeSettings(s, null) : mergeSettings(defRow?.settings, s),
    logo: isDefault ? logo : defRow?.logo ?? null,
    company,
  };
  const preview = applyTemplate(sampleSpec(def), bundle);
  const html = renderHtml(preview);

  const save = useMutation({
    mutationFn: async () => {
      const clean = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)));
      const { error } = await sb().from("document_templates").upsert(
        { company_id: companyId, doc_type: docType, settings: clean, ...(isDefault ? { logo } : {}) }, { onConflict: "company_id,doc_type" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Template saved — new prints and PDFs use it now"); clearTemplateCache(); qc.invalidateQueries({ queryKey: ["document-templates", companyId] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const reset = useMutation({
    mutationFn: async () => {
      const { error } = await sb().from("document_templates").delete().eq("company_id", companyId!).eq("doc_type", docType);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Back to the standard layout"); setAskReset(false); clearTemplateCache(); setS({}); setLogo(null); qc.invalidateQueries({ queryKey: ["document-templates", companyId] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const testPdf = async () => {
    try { downloadBlob(await renderPdf(preview), `Sample ${def.label}.pdf`); } catch (e) { toast.error(friendlyError(e)); }
  };
  const fileRef = React.useRef<HTMLInputElement>(null);
  const onLogo = async (f: File | undefined) => {
    if (!f) return;
    try { setLogo(await readLogo(f)); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not read this image"); }
  };

  const cols = s.columns ?? {};
  const setCol = (label: string, patch: { hidden?: boolean; label?: string }) => {
    const next = { ...cols, [label]: { ...cols[label], ...patch } };
    if (!next[label].hidden && !next[label].label?.trim()) delete next[label];
    set("columns", Object.keys(next).length ? next : undefined);
  };
  const hiddenMeta = new Set(s.hiddenMeta ?? []);
  const auto = autoHeaderLines(company);

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="min-w-0 space-y-4 p-4">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <div className="text-base font-semibold text-ink">{isDefault ? "Company look" : def.label}</div>
            <div className="text-xs text-ink-muted">{isDefault ? "Logo, header and style used on every printed document and PDF." : "Layout for this document. Anything left blank follows the company look."}</div>
          </div>
          {row && canEdit && <Button variant="ghost" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setAskReset(true)}>Reset</Button>}
        </div>

        {isDefault ? (
          <>
            <section>
              <SectionTitle>Logo</SectionTitle>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-16 w-40 items-center justify-center rounded-card border border-dashed border-line bg-subtle">
                  {logo ? <img src={logo} alt="Logo" className="max-h-14 max-w-36 object-contain" /> : <span className="text-xs text-ink-faint">No logo</span>}
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void onLogo(e.target.files?.[0]); e.target.value = ""; }} />
                <Button size="sm" icon={<ImagePlus className="h-3.5 w-3.5" />} disabled={!canEdit} onClick={() => fileRef.current?.click()}>{logo ? "Change" : "Upload logo"}</Button>
                {logo && <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} disabled={!canEdit} onClick={() => setLogo(null)}>Remove</Button>}
              </div>
              <FormGrid cols={3} className="mt-2">
                <Field label="Position"><select className={selectCls} value={s.logoPosition ?? "left"} onChange={(e) => set("logoPosition", e.target.value as "left" | "right")}><option value="left">Left, beside company name</option><option value="right">Right, above the title</option></select></Field>
                <Field label="Height (mm)"><Input type="number" min={8} max={40} value={s.logoHeight ?? 16} onChange={(e) => set("logoHeight", Number(e.target.value) || undefined)} /></Field>
                <div className="flex items-end pb-5"><Checkbox checked={s.showLogo !== false} onChange={(v) => set("showLogo", v ? undefined : false)} label="Show logo" /></div>
              </FormGrid>
            </section>
            <section>
              <SectionTitle>Header</SectionTitle>
              <FormGrid cols={2}>
                <Field label="Company name shown"><select className={selectCls} value={s.headerName ?? "legal_name"} onChange={(e) => set("headerName", e.target.value as "name" | "legal_name")}>
                  <option value="legal_name">Legal name ({company?.legal_name || company?.name || "—"})</option><option value="name">Trading name ({company?.name ?? "—"})</option></select></Field>
                <div />
              </FormGrid>
              <Field label="Lines under the name" hint="One per line. Leave empty to use the address, phone, e-mail and NTN from the Company tab.">
                <Textarea rows={3} value={s.headerLines ?? ""} placeholder={auto.join("\n") || "Address\nPhone · e-mail\nNTN"} onChange={(e) => set("headerLines", e.target.value || undefined)} />
              </Field>
            </section>
          </>
        ) : (
          <>
            <FormGrid cols={2}>
              <Field label="Title on the document"><Input value={s.title ?? ""} placeholder={def.title} onChange={(e) => set("title", e.target.value || undefined)} /></Field>
              <div />
            </FormGrid>
            <section>
              <SectionTitle>Item columns</SectionTitle>
              <div className="overflow-hidden rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted"><th className="h-8 px-3">Column</th><th className="px-3">Print as</th><th className="w-20 px-3 text-center">Show</th></tr></thead>
                  <tbody>
                    {def.columns.map((c) => (
                      <tr key={c.label} className="border-t border-line/70">
                        <td className="px-3 py-1.5 text-ink-2">{c.label}</td>
                        <td className="px-3 py-1"><Input className="h-control-sm" value={cols[c.label]?.label ?? ""} placeholder={c.label} onChange={(e) => setCol(c.label, { label: e.target.value })} /></td>
                        <td className="px-3 text-center"><input type="checkbox" className="h-4 w-4 accent-[#111827]" checked={!cols[c.label]?.hidden} onChange={(e) => setCol(c.label, { hidden: !e.target.checked || undefined })} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-2xs text-ink-faint">Hiding a column only removes it from the printout — the document's figures never change.</p>
            </section>
            <section>
              <SectionTitle>Details box</SectionTitle>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {def.meta.map((m) => (
                  <Checkbox key={m} checked={!hiddenMeta.has(m)} label={m}
                    onChange={(v) => { const n = new Set(hiddenMeta); v ? n.delete(m) : n.add(m); set("hiddenMeta", n.size ? [...n] : undefined); }} />
                ))}
              </div>
            </section>
            <section className="space-y-2">
              <SectionTitle>Totals, notes, terms and signatures</SectionTitle>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {def.sampleTotals && <Checkbox checked={s.showTotals !== false} onChange={(v) => set("showTotals", v ? undefined : false)} label="Totals" />}
                <Checkbox checked={s.showNotes !== false} onChange={(v) => set("showNotes", v ? undefined : false)} label="Notes from the document" />
                <Checkbox checked={s.showSignatures !== false} onChange={(v) => set("showSignatures", v ? undefined : false)} label="Signature boxes" />
              </div>
              <Field label="Terms & conditions" hint="Printed under the items on every copy of this document">
                <Textarea rows={4} value={s.terms ?? ""} onChange={(e) => set("terms", e.target.value || undefined)} placeholder="e.g. Goods once sold will not be taken back. Payment within 30 days." />
              </Field>
              {s.showSignatures !== false && (
                <Field label="Signature boxes" hint="One per line. Empty = standard boxes.">
                  <Textarea rows={3} value={(s.signatures ?? []).join("\n")} placeholder={def.signatures.join("\n") || "Prepared by\nApproved by"}
                    onChange={(e) => { const l = e.target.value.split("\n"); set("signatures", l.some((x) => x.trim()) ? l : undefined); }} />
                </Field>
              )}
            </section>
          </>
        )}

        <section>
          <SectionTitle>{isDefault ? "Style and footer" : "Style (blank = company look)"}</SectionTitle>
          <FormGrid cols={3}>
            <Field label="Accent colour">
              <div className="flex items-center gap-2">
                <input type="color" className="h-control w-12 cursor-pointer rounded-control border border-line bg-surface" value={s.accent ?? bundle.settings.accent} onChange={(e) => set("accent", e.target.value)} />
                {!isDefault && s.accent && <Button size="sm" variant="ghost" onClick={() => set("accent", undefined)}>Use company</Button>}
              </div>
            </Field>
            <Field label="Text size"><select className={selectCls} value={s.fontSize ?? ""} onChange={(e) => set("fontSize", (e.target.value || undefined) as TemplateSettings["fontSize"])}>
              {!isDefault && <option value="">Company look</option>}<option value="small">Small</option><option value="normal">Normal</option><option value="large">Large</option></select></Field>
            <Field label="Paper"><select className={selectCls} value={s.paper ?? ""} onChange={(e) => set("paper", (e.target.value || undefined) as TemplateSettings["paper"])}>
              {!isDefault && <option value="">Company look</option>}<option value="A4">A4</option><option value="A5">A5</option><option value="Letter">Letter</option></select></Field>
          </FormGrid>
          <Field label="Footer" hint="Bottom of every page — e.g. bank details, thank-you line">
            <Textarea rows={2} value={s.footer ?? ""} placeholder={isDefault ? "Thank you for your business · Meezan Bank A/C 0123-4567890" : "Company look footer"} onChange={(e) => set("footer", e.target.value || undefined)} />
          </Field>
          {isDefault && <Checkbox checked={s.showPageNumbers !== false} onChange={(v) => set("showPageNumbers", v ? undefined : false)} label="Page numbers on PDFs" />}
        </section>

        {canEdit && (
          <div className="flex items-center gap-2 border-t border-line pt-3">
            {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
            <div className="flex-1" />
            <Button icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => void testPdf()}>Sample PDF</Button>
            <Button variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>Save template</Button>
          </div>
        )}
      </Card>
      <Card className="min-w-0 overflow-hidden">
        <div className="border-b border-line px-3 py-2 text-xs text-ink-muted">Preview with sample data{isDefault ? " (sales invoice)" : ""}</div>
        <iframe title="Document preview" className="h-[760px] w-full bg-white" srcDoc={html} sandbox="" />
      </Card>
      <ConfirmDialog open={askReset} title="Reset this template?" message={isDefault ? "The logo and company look are removed; documents go back to the standard layout." : "This document goes back to the standard layout with the company look."}
        confirmLabel="Reset" tone="destructive" loading={reset.isPending} onCancel={() => setAskReset(false)} onConfirm={() => reset.mutate()} />
      {dialog}
    </div>
  );
}
