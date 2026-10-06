import * as React from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Boxes, Building2, Camera, Hash, RotateCcw, Save, Tag, TriangleAlert, Zap } from "lucide-react";
import { Button, Card, Checkbox, ConfirmDialog, DataTable, Field, FormGrid, Input, PageHeader, SectionTitle, Skeleton, Textarea } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { diffObject, humanize } from "@jst/utilities";
import { useUnsavedGuard } from "../lib/unsaved";
import { FEATURES, featureQueryKey, useFeature, useStorageLocations } from "../lib/settings";
import { EntityPage } from "../entity/EntityPage";
import { branches } from "../entities/config";
import { Tabs } from "../entity/EntityDialog";

type Company = { id: string; code: string; name: string; legal_name: string | null; ntn: string | null; strn: string | null; phone: string | null; email: string | null; address: string | null; base_currency: string };

export function SettingsPage() {
  const { roles } = useAccess();
  const [tab, setTab] = React.useState("company");
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" description="Company profile, branches, optional features and document numbering" />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "company", label: "Company" }, { key: "branches", label: "Branches" }, { key: "features", label: "Features" }, { key: "numbering", label: "Numbering" }, ...(roles.includes("ADMINISTRATOR") ? [{ key: "trial", label: "Trial data" }] : [])]} />
      {tab === "company" && <CompanyForm />}
      {tab === "branches" && <div className="min-h-0 flex-1"><EntityPage config={branches} /></div>}
      {tab === "features" && <FeatureSettings />}
      {tab === "numbering" && <Numbering />}
      {tab === "trial" && <TrialReset />}
    </div>
  );
}

function CompanyForm() {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["company", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().from("companies").select("id, code, name, legal_name, ntn, strn, phone, email, address, base_currency").eq("id", companyId!).single();
      if (error) throw error;
      return data as Company;
    },
  });
  const form = useForm<Company>();
  React.useEffect(() => {
    if (q.data) form.reset(q.data);
  }, [q.data, form]);
  const { dialog } = useUnsavedGuard(form.formState.isDirty);
  const save = useMutation({
    mutationFn: async (v: Company) => {
      const changes = diffObject(q.data!, v);
      delete (changes as Partial<Company>).id;
      if (!Object.keys(changes).length) return;
      const { error } = await sb().from("companies").update(changes).eq("id", companyId!);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success("Company saved");
      form.reset(v);
      qc.invalidateQueries({ queryKey: ["company", companyId] });
      qc.invalidateQueries({ queryKey: ["my_access"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (q.isLoading) return <Skeleton className="h-48" />;
  return (
    <Card className="max-w-4xl p-4">
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> Company profile</span>
      </SectionTitle>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <FormGrid cols={3}>
          <Field label="Company name" required><Input {...form.register("name", { required: true })} /></Field>
          <Field label="Legal name"><Input {...form.register("legal_name")} /></Field>
          <Field label="Code" hint="Fixed"><Input value={q.data?.code ?? ""} readOnly /></Field>
          <Field label="NTN"><Input {...form.register("ntn")} /></Field>
          <Field label="STRN"><Input {...form.register("strn")} /></Field>
          <Field label="Base currency" hint="Fixed after setup"><Input value={q.data?.base_currency ?? ""} readOnly /></Field>
          <Field label="Phone"><Input {...form.register("phone")} /></Field>
          <Field label="Email"><Input type="email" {...form.register("email")} /></Field>
          <div />
          <Field label="Address" className="sm:col-span-2 lg:col-span-3"><Textarea rows={2} {...form.register("address")} /></Field>
        </FormGrid>
        <div className="mt-2 flex justify-end">
          <Button type="submit" variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} disabled={!form.formState.isDirty}>
            Save changes
          </Button>
        </div>
      </form>
      {dialog}
    </Card>
  );
}

function Numbering() {
  const { companyId } = useAccess();
  const q = useQuery({
    queryKey: ["numbering", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().from("numbering_sequences").select("id, doc_type, prefix, next_number, padding, reset_yearly").eq("company_id", companyId!).order("doc_type");
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <Card className="max-w-4xl overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm text-ink-muted">
        <Hash className="h-4 w-4" /> Numbers are issued by the database under a row lock — never by the browser — so they can't be duplicated.
      </div>
      <DataTable
        loading={q.isLoading}
        rows={q.data ?? []}
        columns={[
          { key: "d", header: "Document", cell: (r) => humanize(r.doc_type) },
          { key: "p", header: "Prefix", cell: (r) => <span className="font-mono text-xs">{r.prefix}</span> },
          { key: "n", header: "Next number", align: "right", cell: (r) => r.next_number },
          { key: "x", header: "Next code", cell: (r) => <span className="font-mono text-xs">{r.prefix}{r.reset_yearly ? `${new Date().getFullYear()}-` : ""}{String(r.next_number).padStart(r.padding, "0")}</span> },
        ]}
      />
    </Card>
  );
}

function FeatureSettings() {
  return (
    <div className="max-w-4xl space-y-3">
      <InventorySettings />
      <ProductSettings />
      <SalesSettings />
      <PickingSettings />
    </div>
  );
}

function InventorySettings() {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const loc = useStorageLocations();
  const [pending, setPending] = React.useState<boolean | null>(null);
  const save = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data, error } = await sb().rpc("set_storage_locations_enabled", { p_company_id: companyId!, p_enabled: enabled });
      if (error) throw error;
      return data as { enabled: boolean; balances_moved: number };
    },
    onSuccess: (r) => {
      toast.success(r.enabled ? "Storage locations turned on" : `Storage locations turned off${r.balances_moved ? ` — ${r.balances_moved} stock balance(s) moved to warehouse level` : ""}`);
      setPending(null);
      qc.invalidateQueries();
    },
    onError: (e) => { toast.error(friendlyError(e)); setPending(null); },
  });

  if (loc.loading) return <Skeleton className="h-32" />;
  return (
    <Card className="p-4">
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5"><Boxes className="h-3.5 w-3.5" /> Inventory</span>
      </SectionTitle>
      <Checkbox
        checked={loc.enabled}
        disabled={save.isPending}
        onChange={(v) => setPending(v)}
        label="Track stock by storage location (rack / shelf / bay) inside warehouses"
        description="When off, stock is kept per warehouse only and location fields are hidden on receipts, transfers, adjustments and counts. Turn on when you start organising warehouses into racks or shelves."
      />
      <ConfirmDialog
        open={pending !== null}
        title={pending ? "Turn on storage locations?" : "Turn off storage locations?"}
        message={
          pending
            ? "Location fields will appear on stock documents and a Locations tab will appear on each warehouse. Existing stock stays as unassigned until you move it into locations."
            : "Any stock currently held in a location will be moved to the warehouse's unassigned stock (logged in Stock Movements). Warehouse totals do not change."
        }
        confirmLabel={pending ? "Turn on" : "Turn off"}
        loading={save.isPending}
        onConfirm={() => pending !== null && save.mutate(pending)}
        onCancel={() => setPending(null)}
      />
    </Card>
  );
}

function ProductSettings() {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const brands = useFeature(FEATURES.brands);
  const save = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await sb()
        .from("system_settings")
        .upsert(
          { company_id: companyId!, key: FEATURES.brands, value: enabled, description: "Brand master list and Brand field on products" },
          { onConflict: "company_id,key" },
        );
      if (error) throw error;
      return enabled;
    },
    onSuccess: (enabled) => {
      toast.success(enabled ? "Brands turned on" : "Brands turned off");
      qc.invalidateQueries({ queryKey: featureQueryKey(companyId) });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (brands.loading) return <Skeleton className="h-24" />;
  return (
    <Card className="p-4">
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" /> Products</span>
      </SectionTitle>
      <Checkbox
        checked={brands.enabled}
        disabled={save.isPending}
        onChange={(v) => save.mutate(v)}
        label="Use brands"
        description="Shows the Brands list in the menu and a Brand field on products (under advanced details). Turning it off only hides them — saved brands and product brand tags are kept."
      />
    </Card>
  );
}

function SalesSettings() {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const quick = useFeature(FEATURES.quickInvoice);
  const save = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await sb()
        .from("system_settings")
        .upsert(
          { company_id: companyId!, key: FEATURES.quickInvoice, value: enabled, description: "Quick invoice: invoice and dispatch from the chosen warehouse in one step" },
          { onConflict: "company_id,key" },
        );
      if (error) throw error;
      return enabled;
    },
    onSuccess: (enabled) => {
      toast.success(enabled ? "Quick invoice turned on" : "Quick invoice turned off");
      qc.invalidateQueries({ queryKey: featureQueryKey(companyId) });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  if (quick.loading) return <Skeleton className="h-24" />;
  return (
    <Card className="p-4">
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Sales</span>
      </SectionTitle>
      <Checkbox
        checked={quick.enabled}
        disabled={save.isPending}
        onChange={(v) => save.mutate(v)}
        label="Quick invoice (counter sale)"
        description="Adds a “Quick invoice” button on Sales Invoices: pick customer, items, warehouse, quantity and price, then post — the goods are dispatched from that warehouse automatically (a sales order and GDN are created and linked behind the scenes). Turning it off only hides the button; invoices already made stay as they are."
      />
    </Card>
  );
}

function PickingSettings() {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const photos = useFeature(FEATURES.pickingPhotosRequired);
  const save = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await sb()
        .from("system_settings")
        .upsert(
          { company_id: companyId!, key: FEATURES.pickingPhotosRequired, value: enabled, description: "Pickers must add at least one photo before finishing a picking task" },
          { onConflict: "company_id,key" },
        );
      if (error) throw error;
      return enabled;
    },
    onSuccess: (enabled) => {
      toast.success(enabled ? "Picking photos are now required" : "Picking photos are now optional");
      qc.invalidateQueries({ queryKey: featureQueryKey(companyId) });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  if (photos.loading) return <Skeleton className="h-24" />;
  return (
    <Card className="p-4">
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5"><Camera className="h-3.5 w-3.5" /> Picking</span>
      </SectionTitle>
      <Checkbox
        checked={photos.enabled}
        disabled={save.isPending}
        onChange={(v) => save.mutate(v)}
        label="Photo required before finishing picking"
        description="Pickers must take or upload at least one photo of the picked goods in the staff app before they can finish a task. Photos show instantly in the sales order (Picking photos tab). When off, photos are optional. Managers finishing a task themselves are never asked for a photo."
      />
    </Card>
  );
}

/** Wipe trial transactions before going live (administrators only). Masters stay. */
function TrialReset() {
  const { companyId, company } = useAccess();
  const qc = useQueryClient();
  const code = useQuery({
    queryKey: ["company-code", companyId], enabled: !!companyId,
    queryFn: async () => ((await sb().from("companies").select("code").eq("id", companyId!).single()).data as { code: string } | null)?.code ?? "",
  });
  const [text, setText] = React.useState("");
  const [ask, setAsk] = React.useState(false);
  const want = `RESET ${code.data ?? ""}`;
  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb().rpc("reset_trial_transactions", { p_company: companyId, p_confirm: text.trim() });
      if (error) throw error;
      return data as { deleted: Record<string, number> };
    },
    onSuccess: (d) => {
      const total = Object.values(d.deleted ?? {}).reduce((a, b) => a + Number(b), 0);
      toast.success(`Trial data cleared — ${total.toLocaleString()} records removed. Masters kept.`);
      setAsk(false); setText(""); qc.invalidateQueries();
    },
    onError: (e) => { setAsk(false); toast.error(friendlyError(e)); },
  });
  return (
    <Card className="max-w-3xl space-y-3 p-4">
      <SectionTitle>Clear trial transactions</SectionTitle>
      <div className="flex gap-3 rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1.5">
          <p>Use this once, when the trial is over and you are ready to go live. It permanently removes <b>every transaction</b> of {company?.company_name ?? "this company"}:
            stock movements and balances, rolls, sales orders, reservations, picking, GDNs, invoices, quotations, purchase orders, goods receipts, bills, returns,
            shipments, landed costs, payments, cheques, bank reconciliations, payroll runs and all accounting entries. Document numbers restart at 1.</p>
          <p><b>Kept:</b> products, variants, categories, units, warehouses and locations, customers, suppliers, chart of accounts, bank accounts, payment agents,
            employees, users and roles, settings, saved reports. The audit log is kept and records that the reset happened.</p>
          <p>After the reset, enter opening stock from a physical count and opening balances before starting live work.</p>
        </div>
      </div>
      <Field label={`Type ${want} to confirm`}>
        <Input className="max-w-xs font-mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={want} />
      </Field>
      <Button variant="destructive" icon={<RotateCcw className="h-4 w-4" />} disabled={!code.data || text.trim() !== want} onClick={() => setAsk(true)}>Clear all transactions</Button>
      <ConfirmDialog open={ask} tone="destructive" title="Clear all trial transactions?" confirmLabel="Yes, clear everything" cancelLabel="Keep" loading={run.isPending}
        message="This cannot be undone. Make sure nobody is entering data right now." onCancel={() => setAsk(false)} onConfirm={() => run.mutate()} />
    </Card>
  );
}
