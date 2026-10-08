import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, History, Pencil, RotateCcw, Save } from "lucide-react";
import {
  ActiveBadge,
  Badge,
  Button,
  ConditionalSection,
  ConfirmDialog,
  ErpDialog,
  FormGrid,
  KeyValue,
  SectionTitle,
  Skeleton,
  cn,
} from "@jst/ui";
import { friendlyError, makeLookupLoader, sb, useAccess, useEntityRecord, useEntitySave } from "@jst/data-access";
import { diffObject, formatDate, formatNumber } from "@jst/utilities";
import { useUnsavedGuard } from "../lib/unsaved";
import { useFeatures, useStorageLocations } from "../lib/settings";
import { AuditTimeline } from "./AuditTimeline";
import { FieldInput } from "./FieldInput";
import { buildSchema, toDbValues, toFormValues } from "./schema";
import type { EntityConfig, FieldDef } from "./types";
import { CfFormSection, CfViewSection, isCfEntity, saveCfValues, useCfDefs, useCfForm, useCfValues, type CfDef, type CfValueRow } from "../lib/customFields";

type Mode = "view" | "edit" | "create";
const NO_DEFS: CfDef[] = [];
const NO_IDS: string[] = [];
const NO_ROWS: CfValueRow[] = [];
type Row = Record<string, unknown>;

export function EntityDialog({
  config,
  id,
  open,
  onClose,
  onCreated,
  fixedValues,
}: {
  config: EntityConfig;
  id: string | null;
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  /** values forced on create, e.g. the parent FK for child records */
  fixedValues?: Record<string, unknown>;
}) {
  const { can, companyId } = useAccess();
  const locOn = useStorageLocations().enabled;
  const hiddenPanels = locOn ? [] : config.storageLocationParts?.panels ?? [];
  const allPanels = (config.extraPanels ?? []).filter((p) => !hiddenPanels.includes(p.key));
  const qc = useQueryClient();
  const [mode, setMode] = React.useState<Mode>(id ? "view" : "create");
  const [tab, setTab] = React.useState("details");
  const [confirmStatus, setConfirmStatus] = React.useState(false);
  const canManage = can(config.perms.manage);

  React.useEffect(() => {
    setMode(id ? "view" : "create");
    setTab("details");
  }, [id, open]);

  const record = useEntityRecord<Row>(config.table, id, config.recordSelect);

  // Fields & sections the user may see (DB enforces; this only avoids empty/forbidden UI)
  const sections = (config.sections ?? []).filter((s) => !s.permission || can(s.permission));
  const allowedSections = new Set(["basic", ...sections.map((s) => s.code)]);
  const features = useFeatures();
  const fields = config.fields.filter(
    (f) => allowedSections.has(f.section ?? "basic") && (!f.restricted || can(f.restricted.permission)) && features.isOn(f.feature),
  );

  // Privilege-restricted columns are fetched through definer RPCs
  const restrictedRpcs = Array.from(
    new Map(fields.filter((f) => f.restricted).map((f) => [f.restricted!.rpc, f.restricted!])).values(),
  );
  const restricted = useQuery({
    queryKey: ["restricted", config.table, id],
    enabled: !!id && restrictedRpcs.length > 0,
    queryFn: async () => {
      const merged: Row = {};
      for (const r of restrictedRpcs) {
        const { data, error } = await sb().rpc(r.rpc, { [r.param]: id });
        if (error) throw error;
        Object.assign(merged, (data as Row[] | null)?.[0] ?? {});
      }
      return merged;
    },
  });

  const row: Row | null = id ? (record.data ? { ...record.data, ...(restricted.data ?? {}) } : null) : null;
  const extraPanels = allPanels.filter((p) => !p.visible || (row ? p.visible(row) : false));
  const formMode = mode === "create" ? "create" : "edit";

  const form = useForm<Row>({
    resolver: zodResolver(buildSchema(fields, formMode)),
    defaultValues: toFormValues(fields, row),
    mode: "onTouched",
  });

  // Reset the form whenever we (re)enter an editable mode with fresh data
  const rowKey = row ? JSON.stringify(row) : "new";
  React.useEffect(() => {
    if (mode !== "view") form.reset(toFormValues(fields, row));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, rowKey]);

  // custom fields (Settings → Custom fields)
  const cfOn = isCfEntity(config.table);
  const cfDefs = useCfDefs(cfOn ? config.table : null);
  const defs = cfDefs.data ?? NO_DEFS;
  const cfRows = useCfValues(config.table, id ? [id] : NO_IDS, cfOn && defs.length > 0);
  const cf = useCfForm(defs, id ? cfRows.data : NO_ROWS, `${mode}:${id}`);

  const dirty = mode !== "view" && (form.formState.isDirty || cf.dirty);
  const { guard, dialog: unsavedDialog } = useUnsavedGuard(open && dirty);
  const save = useEntitySave(config.table);

  const saveCf = async (recordId: string) => {
    if (!defs.length || (mode !== "create" && !cf.dirty)) return;
    await saveCfValues(companyId!, config.table, recordId, defs, cf.values);
    qc.invalidateQueries({ queryKey: ["cf-values", config.table] });
  };

  const submit = form.handleSubmit(async (values) => {
    if (save.isPending) return; // submit lock — no duplicate records on double click
    if (!cf.validate()) { toast.error("Check the additional fields"); return; }
    const db = toDbValues(fields, values);
    try {
      if (mode === "create") {
        const newId = await save.mutateAsync({ values: { ...db, company_id: companyId, ...(fixedValues ?? {}) } });
        try { await saveCf(newId); } catch (e) { toast.error(`${config.singular} created, but the additional fields were not saved: ${friendlyError(e)}`); }
        toast.success(`${config.singular} created`);
        form.reset(values);
        onCreated(newId);
      } else {
        const before = toDbValues(fields, toFormValues(fields, row));
        const changes = diffObject(before, db);
        await save.mutateAsync({ id, values: changes });
        await saveCf(id!);
        qc.invalidateQueries({ queryKey: ["restricted", config.table, id] });
        toast.success("Changes saved");
        form.reset(values);
        setMode("view");
      }
    } catch (e) {
      // keep user input on network/validation errors
      toast.error(friendlyError(e));
    }
  });

  const isActive = config.activeField ? Boolean(row?.[config.activeField]) : true;
  const toggleActive = async () => {
    if (!config.activeField || !id) return;
    try {
      await save.mutateAsync({ id, values: { [config.activeField]: !isActive } });
      toast.success(isActive ? `${config.singular} deactivated` : `${config.singular} reactivated`);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setConfirmStatus(false);
    }
  };

  const title =
    mode === "create" ? `New ${config.singular}` : row ? String(row[config.titleField] ?? config.singular) : config.singular;

  const footer =
    mode === "view" ? (
      <>
        {canManage && config.activeField && row && (
          <Button
            variant={isActive ? "destructive-ghost" : "ghost"}
            icon={isActive ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
            onClick={() => setConfirmStatus(true)}
          >
            {isActive ? "Deactivate" : "Reactivate"}
          </Button>
        )}
        <div className="flex-1" />
        <Button onClick={onClose}>Close</Button>
        {canManage && row && (
          <Button variant="primary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setMode("edit")}>
            Edit
          </Button>
        )}
      </>
    ) : (
      <>
        {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
        <div className="flex-1" />
        <Button onClick={() => (mode === "edit" ? guard(() => setMode("view")) : guard(onClose))}>Cancel</Button>
        <Button variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} onClick={submit}>
          {mode === "create" ? `Create ${config.singular}` : "Save changes"}
        </Button>
      </>
    );

  return (
    <>
      <ErpDialog
        open={open}
        onRequestClose={() => guard(onClose)}
        title={title}
        subtitle={mode === "view" && row && config.subtitle ? config.subtitle(row) : mode === "edit" ? "Editing" : undefined}
        icon={config.icon}
        status={
          mode === "view" && row
            ? config.status
              ? config.status(row)
              : config.activeField
                ? <ActiveBadge active={isActive} />
                : null
            : mode === "edit"
              ? <Badge tone="warning">Editing</Badge>
              : <Badge tone="info">New</Badge>
        }
        size={config.dialogSize ?? "lg"}
        footer={footer}
      >
        {id && record.isLoading ? (
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : record.error ? (
          <div className="rounded-card border border-danger-line bg-danger-soft p-3 text-sm text-danger">{friendlyError(record.error)}</div>
        ) : mode === "view" && row ? (
          <>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "details", label: "Details" },
                ...extraPanels.map((p) => ({ key: p.key, label: p.label })),
                ...(can("audit.view") ? [{ key: "history", label: "History", icon: <History className="h-3.5 w-3.5" /> }] : []),
              ]}
            />
            {tab === "details" && <ViewDetails config={config} fields={fields} sections={sections} row={row} />}
            {tab === "details" && defs.length > 0 && <div className="mt-4"><CfViewSection defs={defs} rows={cfRows.data ?? []} /></div>}
            {extraPanels.map(
              (p) => tab === p.key && <p.component key={p.key} record={row} canManage={canManage} />,
            )}
            {tab === "history" && <AuditTimeline table={config.table} id={id!} />}
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-3"
          >
            <FormGrid cols={3}>
              {fields
                .filter((f) => !f.section)
                .map((f) => (
                  <FieldInput key={f.name} def={f} control={form.control} errors={form.formState.errors} mode={formMode} />
                ))}
            </FormGrid>
            {sections.map((s) => {
              const sf = fields.filter((f) => f.section === s.code);
              if (!sf.length) return null;
              const populated = !!row && sf.some((f) => hasValue(row[f.name]));
              const hasError = sf.some((f) => form.formState.errors[f.name]);
              return (
                <ConditionalSection
                  key={s.code}
                  label={s.label}
                  description={s.description}
                  populated={populated}
                  defaultOpen={hasError}
                >
                  <FormGrid cols={3}>
                    {sf.map((f) => (
                      <FieldInput key={f.name} def={f} control={form.control} errors={form.formState.errors} mode={formMode} />
                    ))}
                  </FormGrid>
                </ConditionalSection>
              );
            })}
            <CfFormSection defs={defs} values={cf.values} errors={cf.errors} onChange={cf.set} />
            <button type="submit" className="hidden" />
          </form>
        )}
      </ErpDialog>
      {unsavedDialog}
      <ConfirmDialog
        open={confirmStatus}
        title={isActive ? `Deactivate ${config.singular.toLowerCase()}?` : `Reactivate ${config.singular.toLowerCase()}?`}
        message={
          isActive
            ? "It will no longer appear in dropdowns for new transactions. History is kept and it can be reactivated later."
            : "It will become available for new transactions again."
        }
        tone={isActive ? "destructive" : "default"}
        confirmLabel={isActive ? "Deactivate" : "Reactivate"}
        loading={save.isPending}
        onCancel={() => setConfirmStatus(false)}
        onConfirm={toggleActive}
      />
    </>
  );
}

function hasValue(v: unknown) {
  return !(v === null || v === undefined || v === "" || v === false);
}

export function Tabs({
  value,
  onChange,
  tabs,
}: {
  value: string;
  onChange: (v: string) => void;
  tabs: { key: string; label: string; icon?: React.ReactNode }[];
}) {
  if (tabs.length <= 1) return null;
  return (
    <div className="-mt-1 mb-4 flex gap-1 border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            value === t.key ? "border-ink text-ink" : "border-transparent text-ink-muted hover:text-ink",
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ViewDetails({
  config,
  fields,
  sections,
  row,
}: {
  config: EntityConfig;
  fields: FieldDef[];
  sections: { code: string; label: string }[];
  row: Row;
}) {
  const basic = fields.filter((f) => !f.section && f.kind !== "checkbox");
  const flags = fields.filter((f) => !f.section && f.kind === "checkbox");
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3 lg:grid-cols-4">
        {basic.map((f) => (
          <KeyValue key={f.name} label={f.label} className={f.span === 3 ? "col-span-2 md:col-span-3 lg:col-span-4" : undefined}>
            <DisplayValue def={f} row={row} />
          </KeyValue>
        ))}
      </dl>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <Badge key={f.name} tone={row[f.name] ? "info" : "neutral"}>
              {f.label}: {row[f.name] ? "Yes" : "No"}
            </Badge>
          ))}
        </div>
      )}
      {sections.map((s) => {
        const sf = fields.filter((f) => f.section === s.code);
        const populated = sf.some((f) => hasValue(row[f.name]));
        if (!sf.length) return null;
        return (
          <div key={s.code} className="rounded-card border border-line p-3">
            <SectionTitle>{s.label.replace(/^Show /, "")}</SectionTitle>
            {populated ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3 lg:grid-cols-4">
                {sf.map((f) => (
                  <KeyValue key={f.name} label={f.label} className={f.span === 3 ? "col-span-2 md:col-span-3 lg:col-span-4" : undefined}>
                    <DisplayValue def={f} row={row} />
                  </KeyValue>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-ink-faint">Nothing recorded.</p>
            )}
          </div>
        );
      })}
      <p className="text-2xs text-ink-faint">
        Created {formatDate(row.created_at as string)} · Last updated {formatDate(row.updated_at as string)}
        {config.activeField === null ? "" : ""}
      </p>
    </div>
  );
}

function DisplayValue({ def, row }: { def: FieldDef; row: Row }) {
  if (def.display) return <>{def.display(row)}</>;
  const v = row[def.name];
  if (v === null || v === undefined || v === "") return <span className="text-ink-faint">—</span>;
  switch (def.kind) {
    case "checkbox":
      return <>{v ? "Yes" : "No"}</>;
    case "money":
      return <span className="tabular-nums">{formatNumber(v as string)}</span>;
    case "number":
      return <span className="tabular-nums">{formatNumber(v as string, 0)}</span>;
    case "date":
      return <>{formatDate(v as string)}</>;
    case "select":
      return <>{def.options?.find((o) => o.value === String(v))?.label ?? String(v)}</>;
    case "lookup":
      return <LookupLabel def={def} value={String(v)} />;
    default:
      return <>{String(v)}</>;
  }
}

function LookupLabel({ def, value }: { def: FieldDef; value: string }) {
  const { companyId } = useAccess();
  const q = useQuery({
    queryKey: ["lookup", def.lookup!.table, "resolve", value],
    staleTime: 5 * 60_000,
    queryFn: () => makeLookupLoader(def.lookup!, companyId).resolve(value),
  });
  if (q.isLoading) return <Skeleton className="h-4 w-24" />;
  return (
    <>
      {q.data?.label ?? "—"}
      {q.data?.secondary && <span className="ml-1 text-xs text-ink-faint">{q.data.secondary}</span>}
    </>
  );
}
