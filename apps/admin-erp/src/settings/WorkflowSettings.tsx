/**
 * Settings → Workflows: review steps a document must pass before it can be approved / posted.
 * Per document type: steps (who acts, fields needed), the actions between steps (pass on, send back …),
 * on / off. The database holds the document at its step and refuses approve / post until the steps are done.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowRight, ArrowUp, GitBranch, Plus, Save, Trash2, Undo2 } from "lucide-react";
import { Badge, Button, Card, Checkbox, EmptyState, Field, FormGrid, Input, Skeleton, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { ROLE_LABELS } from "@jst/permissions";
import { useCfDefs } from "../lib/customFields";

const ROLES = ["ADMINISTRATOR", "OWNER", "ACCOUNTANT", "WAREHOUSE_MANAGER", "SALESPERSON"];
const selectCls = "h-control w-full rounded-control border border-transparent bg-field px-2 text-sm hover:border-line focus:border-line-strong focus:bg-surface focus:outline-none";

interface DocType { doc_type: string; entity: string; entry_type: string | null; label: string; gate: string; view_perm: string; link: string; sort: number }
interface Def { id: string; doc_type: string; name: string; description: string | null; is_active: boolean; include_one_step: boolean; activated_at: string | null }
interface Step { key: string; id: string | null; name: string; roles: string[]; required_fields: string[]; notify: boolean }
interface Trans { from_key: string; to_key: string | null; label: string; roles: string[]; requires_comment: boolean }

let keySeq = 0;
const newKey = () => `n${++keySeq}`;

function defaultTransitions(steps: Step[]): Trans[] {
  const out: Trans[] = [];
  steps.forEach((s, i) => {
    const next = steps[i + 1];
    out.push({ from_key: s.key, to_key: next?.key ?? null, label: next ? `Pass to ${next.name || "next step"}` : "Mark ready", roles: [], requires_comment: false });
    if (i > 0) out.push({ from_key: s.key, to_key: steps[i - 1].key, label: `Send back to ${steps[i - 1].name || "previous step"}`, roles: [], requires_comment: true });
  });
  return out;
}

export function WorkflowSettings() {
  const { companyId, can } = useAccess();
  const types = useQuery({
    queryKey: ["wf-doc-types"],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await sb().rpc("wf_doc_types");
      if (error) throw error;
      return ((data ?? []) as DocType[]).sort((a, b) => a.sort - b.sort);
    },
  });
  const defs = useQuery({
    queryKey: ["wf-defs", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().from("workflow_definitions").select("id, doc_type, name, description, is_active, include_one_step, activated_at").eq("company_id", companyId!);
      if (error) throw error;
      return (data ?? []) as Def[];
    },
  });
  const [sel, setSel] = React.useState<string>("SALES_ORDER");
  if (types.isLoading || defs.isLoading) return <Skeleton className="h-96" />;
  if (types.error || defs.error) return <Card className="p-4 text-sm text-danger">{friendlyError(types.error ?? defs.error)}</Card>;
  const t = types.data!.find((x) => x.doc_type === sel) ?? types.data![0];
  return (
    <div className="max-w-6xl space-y-3">
      <Card className="flex gap-3 p-3 text-sm text-ink-2">
        <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
        <div>Add review steps a document must pass <b>before</b> it can be approved or posted — for example a sales order checked by the warehouse manager, then OK'd by the owner.
          Each step says who acts and which fields must be filled. People at a step get a notification. Approval limits (Settings → Approvals) still apply on top.
          Turning a workflow on affects documents made from then on.</div>
      </Card>
      <div className="grid gap-3 md:grid-cols-[240px_1fr]">
        <Card className="self-start overflow-hidden">
          {types.data!.map((x) => {
            const d = defs.data!.find((y) => y.doc_type === x.doc_type);
            return (
              <button key={x.doc_type} onClick={() => setSel(x.doc_type)}
                className={cn("flex w-full items-center gap-2 border-b border-line/70 px-3 py-2 text-left text-sm last:border-0 hover:bg-subtle", sel === x.doc_type && "bg-subtle font-medium")}>
                <span className="flex-1">{x.label}</span>
                {d?.is_active ? <Badge tone="success">On</Badge> : d ? <Badge>Off</Badge> : null}
              </button>
            );
          })}
        </Card>
        <WorkflowEditor key={t.doc_type} type={t} def={defs.data!.find((y) => y.doc_type === t.doc_type) ?? null} canEdit={can("settings.manage")} />
      </div>
    </div>
  );
}

function WorkflowEditor({ type, def, canEdit }: { type: DocType; def: Def | null; canEdit: boolean }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const loaded = useQuery({
    queryKey: ["wf-def-detail", def?.id],
    enabled: !!def,
    queryFn: async () => {
      const [s, t] = await Promise.all([
        sb().from("workflow_steps").select("id, seq, name, roles, required_fields, notify").eq("definition_id", def!.id).order("seq"),
        sb().from("workflow_transitions").select("from_step, to_step, label, roles, requires_comment, sort").eq("definition_id", def!.id).order("sort"),
      ]);
      if (s.error) throw s.error;
      if (t.error) throw t.error;
      return { steps: s.data as { id: string; name: string; roles: string[]; required_fields: string[]; notify: boolean }[],
               trans: t.data as { from_step: string; to_step: string | null; label: string; roles: string[]; requires_comment: boolean }[] };
    },
  });
  const coreFields = useQuery({
    queryKey: ["wf-core-fields", type.entity],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await sb().rpc("wf_core_fields", { p_entity: type.entity });
      if (error) throw error;
      return (data ?? []) as { key: string; label: string }[];
    },
  });
  const cfDefs = useCfDefs(type.entity).data ?? [];
  const fieldChoices = [
    ...(coreFields.data ?? []),
    ...cfDefs.filter((d) => d.field_type !== "formula").map((d) => ({ key: `cf:${d.id}`, label: d.label })),
  ];

  const [name, setName] = React.useState(def?.name ?? `${type.label} review`);
  const [active, setActive] = React.useState(def?.is_active ?? false);
  const [oneStep, setOneStep] = React.useState(def?.include_one_step ?? false);
  const [steps, setSteps] = React.useState<Step[]>([]);
  const [custom, setCustom] = React.useState(false);
  const [trans, setTrans] = React.useState<Trans[]>([]);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (def && !loaded.data) return;
    const st: Step[] = (loaded.data?.steps ?? []).map((s) => ({ key: s.id, id: s.id, name: s.name, roles: s.roles, required_fields: s.required_fields, notify: s.notify }));
    const tr: Trans[] = (loaded.data?.trans ?? []).map((t) => ({ from_key: t.from_step, to_key: t.to_step, label: t.label, roles: t.roles, requires_comment: t.requires_comment }));
    setSteps(st);
    setTrans(tr);
    // custom when the saved actions differ from the standard ones
    const std = defaultTransitions(st);
    setCustom(tr.length > 0 && JSON.stringify(tr.map((t) => [t.from_key, t.to_key, t.label, t.requires_comment, t.roles.length])) !== JSON.stringify(std.map((t) => [t.from_key, t.to_key, t.label, t.requires_comment, 0])));
    setDirty(false);
  }, [def, loaded.data]);

  const touch = () => setDirty(true);
  const setStep = (i: number, patch: Partial<Step>) => { setSteps((o) => o.map((s, j) => (j === i ? { ...s, ...patch } : s))); touch(); };
  const addStep = () => { setSteps((o) => [...o, { key: newKey(), id: null, name: o.length ? "Owner OK" : "Manager check", roles: o.length ? ["OWNER"] : ["WAREHOUSE_MANAGER", "ADMINISTRATOR"], required_fields: [], notify: true }]); touch(); };
  const moveStep = (i: number, d: -1 | 1) => { setSteps((o) => { const n = [...o]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; }); touch(); };
  const removeStep = (i: number) => { const k = steps[i].key; setSteps((o) => o.filter((_, j) => j !== i)); setTrans((o) => o.filter((t) => t.from_key !== k && t.to_key !== k)); touch(); };

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name, is_active: active, include_one_step: oneStep,
        steps: steps.map((s) => ({ id: s.id, key: s.key, name: s.name.trim(), roles: s.roles, required_fields: s.required_fields, notify: s.notify })),
        transitions: custom ? trans : [],
      };
      const { error } = await sb().rpc("save_workflow", { p_company: companyId, p_doc_type: type.doc_type, p_data: body });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(active ? "Workflow saved and on" : "Workflow saved");
      qc.invalidateQueries({ queryKey: ["wf-defs"] });
      qc.invalidateQueries({ queryKey: ["wf-def-detail"] });
      qc.invalidateQueries({ queryKey: ["wf-state"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (def && loaded.isLoading) return <Skeleton className="h-80" />;
  const shownTrans = custom ? trans : defaultTransitions(steps);
  const stepName = (k: string | null) => (k === null ? `Ready to ${type.gate}` : steps.find((s) => s.key === k)?.name || "?");

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-base font-semibold">{type.label}</div>
        {def?.is_active && def.activated_at && <span className="text-xs text-ink-muted">on since {new Date(def.activated_at).toLocaleDateString()}</span>}
        <div className="flex-1" />
        {canEdit && <Button variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} disabled={!dirty && !!def} onClick={() => save.mutate()}>Save workflow</Button>}
      </div>
      <FormGrid cols={2}>
        <Field label="Name"><Input disabled={!canEdit} value={name} maxLength={80} onChange={(e) => { setName(e.target.value); touch(); }} /></Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox disabled={!canEdit} checked={active} onChange={(c) => { setActive(c); touch(); }} label="Workflow on"
            description={`Documents made from now on must pass the steps before they can be ${type.gate === "send" ? "sent" : type.gate === "dispatch" ? "dispatched" : type.gate + "d"}.`} />
          <Checkbox disabled={!canEdit} checked={oneStep} onChange={(c) => { setOneStep(c); touch(); }} label="Also hold one-step entries"
            description="Documents made and finished in a single step (Quick invoice, Pay now, Receive payment now…). Off = these go through without the steps." />
        </div>
      </FormGrid>

      <div>
        <div className="mb-2 flex items-center gap-2"><span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Steps</span><div className="flex-1" />
          {canEdit && steps.length < 10 && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={addStep}>Add step</Button>}</div>
        {steps.length === 0 ? (
          <EmptyState icon={<GitBranch className="h-6 w-6" />} title="No steps yet" description={`Add a step, e.g. "Manager check" by the warehouse manager, then "Owner OK" by the owner.`} />
        ) : (
          <div className="space-y-2">
            {steps.map((s, i) => (
              <div key={s.key} className="rounded-card border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">{i + 1}</span>
                  <Input className="max-w-xs" disabled={!canEdit} value={s.name} maxLength={60} placeholder="Step name" onChange={(e) => setStep(i, { name: e.target.value })} />
                  <div className="flex-1" />
                  {canEdit && <>
                    <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => moveStep(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Remove step" onClick={() => removeStep(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </>}
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-2xs font-medium text-ink-muted">Who acts at this step</div>
                    <Chips options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] ?? r }))} value={s.roles} disabled={!canEdit} onChange={(v) => setStep(i, { roles: v })} />
                  </div>
                  <div>
                    <div className="mb-1 text-2xs font-medium text-ink-muted">Must be filled before passing this step</div>
                    {fieldChoices.length === 0 ? <span className="text-2xs text-ink-faint">No fields to choose — add document fields in Settings → Custom fields.</span>
                      : <Chips options={fieldChoices.map((f) => ({ value: f.key, label: f.label }))} value={s.required_fields} disabled={!canEdit} onChange={(v) => setStep(i, { required_fields: v })} />}
                  </div>
                </div>
                <div className="mt-2"><Checkbox disabled={!canEdit} checked={s.notify} onChange={(c) => setStep(i, { notify: c })} label="Notify these roles when a document reaches this step" /></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {steps.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Actions between steps</span>
            <div className="flex-1" />
            {canEdit && (custom
              ? <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => { setCustom(false); setTrans([]); touch(); }}>Use standard actions</Button>
              : <Button size="sm" onClick={() => { setCustom(true); setTrans(defaultTransitions(steps)); touch(); }}>Customise actions</Button>)}
          </div>
          {!custom && <p className="mb-2 text-xs text-ink-muted">Standard: each step passes to the next (the last one marks the document ready), and later steps can send it back to the previous one with a comment.</p>}
          <div className="overflow-hidden rounded-card border border-line">
            <table className="w-full text-sm">
              <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                <th className="h-8 px-2">From</th><th className="px-2" /><th className="px-2">To</th><th className="px-2">Button</th><th className="px-2">Who (empty = the step's roles)</th><th className="px-2">Comment</th>{custom && <th className="w-8" />}
              </tr></thead>
              <tbody>
                {shownTrans.map((t, i) => (
                  <tr key={i} className="border-t border-line/70 align-top">
                    <td className="px-2 py-1.5">{custom && canEdit
                      ? <select className={selectCls} value={t.from_key} onChange={(e) => { setTrans((o) => o.map((x, j) => (j === i ? { ...x, from_key: e.target.value } : x))); touch(); }}>
                          {steps.map((s) => <option key={s.key} value={s.key}>{s.name || "?"}</option>)}</select>
                      : stepName(t.from_key)}</td>
                    <td className="px-1 pt-2.5"><ArrowRight className="h-3.5 w-3.5 text-ink-faint" /></td>
                    <td className="px-2 py-1.5">{custom && canEdit
                      ? <select className={selectCls} value={t.to_key ?? ""} onChange={(e) => { setTrans((o) => o.map((x, j) => (j === i ? { ...x, to_key: e.target.value || null } : x))); touch(); }}>
                          {steps.filter((s) => s.key !== t.from_key).map((s) => <option key={s.key} value={s.key}>{s.name || "?"}</option>)}
                          <option value="">Ready to {type.gate}</option></select>
                      : stepName(t.to_key)}</td>
                    <td className="px-2 py-1.5">{custom && canEdit
                      ? <Input value={t.label} maxLength={60} onChange={(e) => { setTrans((o) => o.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))); touch(); }} />
                      : t.label}</td>
                    <td className="px-2 py-1.5">{custom && canEdit
                      ? <Chips options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] ?? r }))} value={t.roles} onChange={(v) => { setTrans((o) => o.map((x, j) => (j === i ? { ...x, roles: v } : x))); touch(); }} />
                      : t.roles.length ? t.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") : <span className="text-ink-faint">step's roles</span>}</td>
                    <td className="px-2 py-1.5">{custom && canEdit
                      ? <input type="checkbox" className="mt-2 h-4 w-4 accent-[#111827]" checked={t.requires_comment} onChange={(e) => { setTrans((o) => o.map((x, j) => (j === i ? { ...x, requires_comment: e.target.checked } : x))); touch(); }} />
                      : t.requires_comment ? "Required" : ""}</td>
                    {custom && <td className="px-1 py-1.5">{canEdit && <Button size="icon-sm" variant="ghost" aria-label="Remove action" onClick={() => { setTrans((o) => o.filter((_, j) => j !== i)); touch(); }}><Trash2 className="h-3.5 w-3.5" /></Button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {custom && canEdit && <Button className="mt-2" size="sm" icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => { setTrans((o) => [...o, { from_key: steps[0].key, to_key: null, label: "Approve directly", roles: ["OWNER"], requires_comment: false }]); touch(); }}>Add action</Button>}
        </div>
      )}
    </Card>
  );
}

function Chips({ options, value, onChange, disabled }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" disabled={disabled} onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
            className={cn("h-6 rounded-full border px-2 text-2xs", on ? "border-ink bg-ink text-white" : "border-line text-ink-muted hover:border-line-strong", disabled && "opacity-70")}>{o.label}</button>
        );
      })}
    </div>
  );
}
