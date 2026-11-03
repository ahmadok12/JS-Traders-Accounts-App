/**
 * Custom fields on printed documents and PDFs (Settings → Documents → "Custom fields").
 * A screen says which records' fields belong on its document (cfSources); the template says which
 * fields to leave out (hiddenCf) and which image fields print their picture (cfPictures).
 */
import { sb } from "@jst/data-access";
import { formatCf, type CfDef, type CfValueRow } from "../lib/customFields";
import { templateCompany, type PrintSpecBase, type TemplateSettings } from "./template";

export async function withCustomFields(p: PrintSpecBase, s: TemplateSettings | null | undefined): Promise<PrintSpecBase> {
  if (!p.cfSources?.length) return p;
  const hidden = new Set(s?.hiddenCf ?? []);
  const pics = new Set(s?.cfPictures ?? []);
  const company = templateCompany();
  const meta: [string, string][] = [...p.meta];
  const pictures: { id: string; caption: string }[] = [];
  for (const src of p.cfSources) {
    if (!src.id) continue;
    let dq = sb().from("custom_field_definitions").select("id, entity, code, label, field_type, options, required, help_text, show_in_list, sort_order, is_active, ref_entity, formula, decimals")
      .eq("entity", src.entity).eq("is_active", true).order("sort_order");
    if (company) dq = dq.eq("company_id", company);
    const [d, v] = await Promise.all([
      dq,
      sb().from("custom_field_values").select("field_id, record_id, value_text, value_number, value_date, value_bool, value_options, value_ts, value_ref").eq("entity", src.entity).eq("record_id", src.id),
    ]);
    if (d.error) continue; // never block printing
    const by = new Map(((v.data ?? []) as CfValueRow[]).map((r) => [r.field_id, r]));
    for (const def of (d.data ?? []) as CfDef[]) {
      if (hidden.has(def.id)) continue;
      const row = by.get(def.id);
      meta.push([def.label, formatCf(def, row) || "—"]);
      if (def.field_type === "image" && pics.has(def.id) && row?.value_ref) pictures.push({ id: row.value_ref, caption: def.label });
    }
  }
  return { ...p, meta, photoSources: [...pictures, ...(p.photoSources ?? [])] };
}
