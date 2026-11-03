/**
 * Settings → Forms: shape the add / edit forms of master records for each role —
 * hide fields a role never uses, make fields required for a role, hide optional sections or open them by default.
 * "Required" is also checked by the database. Hiding only tidies the form; it never changes access rights.
 */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LayoutList, Save } from "lucide-react";
import { Badge, Button, Card, Skeleton, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { ROLE_LABELS } from "@jst/permissions";
import { ALL_ENTITIES } from "../entities/config";
import type { EntityConfig } from "../entity/types";
import { FORM_ENTITIES, useFormLayouts } from "../lib/formLayouts";

const ROLES = ["ADMINISTRATOR", "OWNER", "ACCOUNTANT", "WAREHOUSE_MANAGER", "SALESPERSON"];
type FieldMode = "normal" | "hidden" | "required";
type SectionMode = "normal" | "open" | "hidden";

function configFor(table: string): EntityConfig | undefined {
  return Object.values(ALL_ENTITIES as Record<string, EntityConfig>).find((c) => c.table === table);
}

export function FormSettings() {
  const { can } = useAccess();
  const [entity, setEntity] = React.useState("customers");
  const [role, setRole] = React.useState("SALESPERSON");
  const cfg = configFor(entity);
  return (
    <div className="max-w-5xl space-y-3">
      <Card className="p-3">
        <div className="flex gap-3 text-sm text-ink-2">
          <LayoutList className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
          <div>Shape the add / edit forms for each role: hide fields a role never uses, make fields <b>required</b> for a role (checked by the database too),
            and hide optional sections or open them by default. Someone with two roles sees a field unless both roles hide it. Fields the system always needs can't be hidden.</div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1">
          <span className="w-14 text-2xs font-semibold uppercase tracking-wide text-ink-faint">Form</span>
          {FORM_ENTITIES.map((e) => (
            <button key={e.key} onClick={() => setEntity(e.key)}
              className={cn("h-7 rounded-full border px-3 text-xs font-medium", entity === e.key ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:border-line-strong")}>{e.label}</button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="w-14 text-2xs font-semibold uppercase tracking-wide text-ink-faint">Role</span>
          {ROLES.map((r) => (
            <button key={r} onClick={() => setRole(r)}
              className={cn("h-7 rounded-full border px-3 text-xs font-medium", role === r ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:border-line-strong")}>{ROLE_LABELS[r] ?? r}</button>
          ))}
        </div>
      </Card>
      {cfg ? <LayoutEditor key={`${entity}:${role}`} cfg={cfg} role={role} canEdit={can("settings.manage")} /> : <Card className="p-4 text-sm text-ink-muted">This form can't be configured.</Card>}
    </div>
  );
}

function LayoutEditor({ cfg, role, canEdit }: { cfg: EntityConfig; role: string; canEdit: boolean }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const q = useFormLayouts(cfg.table);
  const row = q.data?.find((r) => r.role_code === role);
  const [fields, setFields] = React.useState<Record<string, FieldMode>>({});
  const [sections, setSections] = React.useState<Record<string, SectionMode>>({});
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => {
    const f: Record<string, FieldMode> = {};
    for (const n of row?.hidden_fields ?? []) f[n] = "hidden";
    for (const n of row?.required_fields ?? []) f[n] = "required";
    const s: Record<string, SectionMode> = {};
    for (const n of row?.open_sections ?? []) s[n] = "open";
    for (const n of row?.hidden_sections ?? []) s[n] = "hidden";
    setFields(f); setSections(s); setDirty(false);
  }, [row]);

  const save = useMutation({
    mutationFn: async () => {
      const by = (m: FieldMode) => Object.entries(fields).filter(([, v]) => v === m).map(([k]) => k);
      const bs = (m: SectionMode) => Object.entries(sections).filter(([, v]) => v === m).map(([k]) => k);
      const { error } = await sb().rpc("save_form_layout", { p_company: companyId, p_entity: cfg.table, p_role: role,
        p_data: { hidden_fields: by("hidden"), required_fields: by("required"), hidden_sections: bs("hidden"), open_sections: bs("open") } });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(`${cfg.title} form saved for ${ROLE_LABELS[role] ?? role}`); qc.invalidateQueries({ queryKey: ["form-layouts"] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (q.isLoading) return <Skeleton className="h-80" />;
  // restricted fields are read through separate functions — leave them alone
  const usable = cfg.fields.filter((f) => !f.restricted);
  const groups = [{ code: "basic", label: "Main fields" }, ...(cfg.sections ?? []).map((s) => ({ code: s.code, label: s.label.replace(/^Show /, "") }))];
  const changed = Object.values(fields).filter((v) => v !== "normal").length + Object.values(sections).filter((v) => v !== "normal").length;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-sm font-medium">{cfg.title} — {ROLE_LABELS[role] ?? role}</span>
        {changed > 0 ? <Badge tone="info">{changed} change(s)</Badge> : <Badge>Standard form</Badge>}
        <div className="flex-1" />
        {canEdit && <Button variant="primary" icon={<Save className="h-3.5 w-3.5" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save form</Button>}
      </div>
      {groups.map((g) => {
        const list = usable.filter((f) => (f.section ?? "basic") === g.code);
        if (!list.length) return null;
        return (
          <div key={g.code} className="border-b border-line last:border-0">
            <div className="flex items-center gap-2 bg-subtle px-3 py-1.5">
              <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{g.label}</span>
              {g.code !== "basic" && (
                <Segmented value={sections[g.code] ?? "normal"} disabled={!canEdit}
                  options={[{ value: "normal", label: "Collapsed" }, { value: "open", label: "Open" }, { value: "hidden", label: "Hidden" }]}
                  onChange={(v) => { setSections((o) => ({ ...o, [g.code]: v as SectionMode })); setDirty(true); }} />
              )}
            </div>
            {list.map((f) => (
              <div key={f.name} className="flex items-center gap-2 border-t border-line/60 px-3 py-1.5 text-sm">
                <span className="flex-1">{f.label}{f.required && <span className="ml-1 text-2xs text-ink-faint">(always required)</span>}</span>
                <Segmented value={f.required ? "required" : fields[f.name] ?? "normal"} disabled={!canEdit || f.required}
                  options={[{ value: "normal", label: "Optional" }, { value: "required", label: "Required" }, { value: "hidden", label: "Hidden" }]}
                  onChange={(v) => { setFields((o) => ({ ...o, [f.name]: v as FieldMode })); setDirty(true); }} />
              </div>
            ))}
          </div>
        );
      })}
    </Card>
  );
}

function Segmented({ value, options, onChange, disabled }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className={cn("inline-flex rounded-control border border-line p-0.5", disabled && "opacity-60")}>
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled} onClick={() => onChange(o.value)}
          className={cn("h-6 rounded px-2 text-2xs font-medium", value === o.value ? (o.value === "hidden" ? "bg-ink-muted text-white" : o.value === "required" ? "bg-warning text-white" : "bg-ink text-white") : "text-ink-muted hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
