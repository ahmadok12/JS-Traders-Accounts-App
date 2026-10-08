import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ListPlus, Plus, Save, SlidersHorizontal } from "lucide-react";
import { ActiveBadge, Badge, Button, Card, Checkbox, EmptyState, ErpDialog, Field, FormGrid, Input, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { CF_ENTITIES, CF_TYPES, CfInput, useCfDefs, type CfDef, type CfType, type CfValue } from "../lib/customFields";

const selectCls = "h-control w-full rounded-control border border-transparent bg-field px-2 text-sm hover:border-line focus:border-line-strong focus:bg-surface focus:outline-none";

export function CustomFieldsSettings() {
  const { can } = useAccess();
  const [entity, setEntity] = React.useState("customers");
  const defs = useCfDefs(entity, { includeInactive: true });
  const [edit, setEdit] = React.useState<CfDef | "new" | null>(null);
  const qc = useQueryClient();
  const { companyId } = useAccess();
  const canEdit = can("settings.manage");

  const move = useMutation({
    mutationFn: async ({ from, to }: { from: number; to: number }) => {
      // swap two rows, then renumber 10, 20, 30 … saving only rows whose position changed
      const order = [...(defs.data ?? [])];
      [order[from], order[to]] = [order[to], order[from]];
      for (const [i, d] of order.entries()) {
        const so = (i + 1) * 10;
        if (d.sort_order === so) continue;
        const { error } = await sb().rpc("save_custom_field_definition", { p_company: companyId, p_id: d.id, p_data: { ...d, sort_order: so } });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cf-defs", companyId, entity] }),
    onError: (e) => toast.error(friendlyError(e)),
  });

  const list = defs.data ?? [];
  return (
    <div className="max-w-5xl space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-ink-muted" />
          <span className="text-sm text-ink-2">Extra fields for</span>
          <div className="flex flex-wrap gap-1">
            {CF_ENTITIES.map((e) => (
              <button key={e.key} onClick={() => setEntity(e.key)}
                className={cn("h-7 rounded-full border px-3 text-xs font-medium", entity === e.key ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:border-line-strong")}>{e.label}</button>
            ))}
          </div>
          <div className="flex-1" />
          {canEdit && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit("new")}>Add field</Button>}
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Fields you add here appear under <b>Additional fields</b> when adding, editing and viewing a record, can be shown as list columns, and can be used in the
          list's <b>Filter by field</b>. Core stock and accounting values are never stored in custom fields.
        </p>
      </Card>
      <Card className="overflow-hidden">
        {defs.isLoading ? <Skeleton className="h-40" /> : list.length === 0 ? (
          <EmptyState icon={<ListPlus className="h-6 w-6" />} title="No custom fields yet"
            description={`Add fields such as "Farm capacity (birds)", "Shed type" or "Preferred delivery day" to ${CF_ENTITIES.find((e) => e.key === entity)?.label.toLowerCase()}.`} />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              <th className="h-8 px-3">Field</th><th className="px-3">Type</th><th className="hidden px-3 md:table-cell">Choices</th><th className="px-3">Options</th><th className="px-3">Status</th><th className="w-28 px-3" />
            </tr></thead>
            <tbody>
              {list.map((d, i) => (
                <tr key={d.id} className={cn("border-t border-line/70", !d.is_active && "text-ink-faint")}>
                  <td className="px-3 py-2"><div className="font-medium">{d.label}</div>{d.help_text && <div className="text-2xs text-ink-muted">{d.help_text}</div>}</td>
                  <td className="px-3 text-xs">{CF_TYPES.find((t) => t.value === d.field_type)?.label}</td>
                  <td className="hidden max-w-[240px] truncate px-3 text-xs text-ink-muted md:table-cell">{d.options.join(", ")}</td>
                  <td className="px-3"><div className="flex flex-wrap gap-1">{d.required && <Badge tone="warning">Required</Badge>}{d.show_in_list && <Badge tone="info">List column</Badge>}</div></td>
                  <td className="px-3"><ActiveBadge active={d.is_active} /></td>
                  <td className="px-3 text-right">
                    {canEdit && <div className="flex justify-end gap-0.5">
                      <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0 || move.isPending} onClick={() => move.mutate({ from: i, to: i - 1 })}><ArrowUp className="h-3.5 w-3.5" /></Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === list.length - 1 || move.isPending} onClick={() => move.mutate({ from: i, to: i + 1 })}><ArrowDown className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" onClick={() => setEdit(d)}>Edit</Button>
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {edit && <FieldDialog entity={entity} def={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function FieldDialog({ entity, def, onClose }: { entity: string; def: CfDef | null; onClose: () => void }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const [v, setV] = React.useState({
    label: def?.label ?? "", field_type: (def?.field_type ?? "text") as CfType, options: (def?.options ?? []).join("\n"), required: def?.required ?? false,
    help_text: def?.help_text ?? "", show_in_list: def?.show_in_list ?? false, is_active: def?.is_active ?? true,
  });
  const [sample, setSample] = React.useState<CfValue>(null);
  const choices = v.options.split("\n").map((o) => o.trim()).filter(Boolean);
  const needsChoices = v.field_type === "dropdown" || v.field_type === "multi_select";
  const save = useMutation({
    mutationFn: async () => {
      if (!v.label.trim()) throw new Error("Enter a field name");
      if (needsChoices && !choices.length) throw new Error("Add at least one choice (one per line)");
      const { error } = await sb().rpc("save_custom_field_definition", {
        p_company: companyId, p_id: def?.id ?? null,
        p_data: { entity, label: v.label.trim(), field_type: v.field_type, options: needsChoices ? choices : [], required: v.required, help_text: v.help_text, show_in_list: v.show_in_list, is_active: v.is_active },
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(def ? "Field saved" : "Field added"); qc.invalidateQueries({ queryKey: ["cf-defs"] }); onClose(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const preview: CfDef = { id: "preview", entity, code: "", label: v.label || "Field name", field_type: v.field_type, options: choices, required: v.required, help_text: v.help_text || null, show_in_list: false, sort_order: 0, is_active: true };
  return (
    <ErpDialog open onRequestClose={onClose} size="md" icon={<ListPlus className="h-4 w-4" />} title={def ? `Edit "${def.label}"` : "New custom field"}
      subtitle={CF_ENTITIES.find((e) => e.key === entity)?.label}
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={() => save.mutate()}>Save field</Button></>}>
      <FormGrid cols={2}>
        <Field label="Field name" required><Input autoFocus value={v.label} maxLength={60} onChange={(e) => setV((s) => ({ ...s, label: e.target.value }))} placeholder="e.g. Farm capacity (birds)" /></Field>
        <Field label="Type" hint={def ? "Type can't change once the field has values" : undefined}>
          <select className={selectCls} value={v.field_type} onChange={(e) => setV((s) => ({ ...s, field_type: e.target.value as CfType }))}>
            {CF_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
      </FormGrid>
      {needsChoices && (
        <Field label="Choices" required hint="One per line">
          <Textarea rows={4} value={v.options} onChange={(e) => setV((s) => ({ ...s, options: e.target.value }))} placeholder={"Open shed\nControlled shed\nCage"} />
        </Field>
      )}
      <Field label="Help text" hint="Shown under the field"><Input value={v.help_text} onChange={(e) => setV((s) => ({ ...s, help_text: e.target.value }))} /></Field>
      <div className="flex flex-col gap-2">
        {v.field_type !== "checkbox" && <Checkbox checked={v.required} onChange={(c) => setV((s) => ({ ...s, required: c }))} label="Required" description="A record can't be saved without it." />}
        <Checkbox checked={v.show_in_list} onChange={(c) => setV((s) => ({ ...s, show_in_list: c }))} label="Show as a column in the list" />
        {def && <Checkbox checked={v.is_active} onChange={(c) => setV((s) => ({ ...s, is_active: c }))} label="Active" description="Inactive fields are hidden; their saved values are kept." />}
      </div>
      <div className="mt-4 rounded-card border border-dashed border-line p-3">
        <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">Preview</div>
        <FormGrid cols={2}><CfInput def={preview} value={sample} onChange={setSample} /></FormGrid>
      </div>
    </ErpDialog>
  );
}
