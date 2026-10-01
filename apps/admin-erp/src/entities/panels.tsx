import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Layers, MapPin, Plus, Wallet } from "lucide-react";
import { Badge, Button, DataTable, SectionTitle } from "@jst/ui";
import { friendlyError, sb } from "@jst/data-access";
import { P } from "@jst/permissions";
import { EntityDialog } from "../entity/EntityDialog";
import type { EntityConfig, ExtraPanelProps } from "../entity/types";
import { CURRENCY_LOOKUP, col } from "./helpers";

type Row = Record<string, unknown> & { id: string };

/** Child records of a parent (variants, locations…) — same View-first pattern. */
function ChildList({
  config,
  parentField,
  parentId,
  canManage,
  hint,
}: {
  config: EntityConfig;
  parentField: string;
  parentId: string;
  canManage: boolean;
  hint?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState<{ id: string | null } | null>(null);
  const q = useQuery({
    queryKey: ["list", config.table, "child", parentId],
    queryFn: async () => {
      const { data, error } = await sb()
        .from(config.table)
        .select(config.listSelect)
        .eq(parentField, parentId)
        .order(config.orderBy.column, { ascending: config.orderBy.ascending ?? true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  return (
    <div>
      <SectionTitle
        action={
          canManage && (
            <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen({ id: null })}>
              Add {config.singular.toLowerCase()}
            </Button>
          )
        }
      >
        {config.title}
      </SectionTitle>
      {hint && <p className="mb-2 text-xs text-ink-muted">{hint}</p>}
      <div className="overflow-hidden rounded-card border border-line">
        {q.error ? (
          <p className="p-3 text-sm text-danger">{friendlyError(q.error)}</p>
        ) : (
          <DataTable columns={config.columns} rows={q.data ?? []} loading={q.isLoading} onView={(r) => setOpen({ id: r.id })} empty={<p className="py-6 text-center text-xs text-ink-muted">None yet</p>} />
        )}
      </div>
      {open && (
        <EntityDialog
          config={config}
          id={open.id}
          open
          onClose={() => setOpen(null)}
          onCreated={(id) => setOpen({ id })}
          fixedValues={{ [parentField]: parentId }}
        />
      )}
    </div>
  );
}

const variantConfig: EntityConfig = {
  key: "variants",
  table: "product_variants",
  title: "Variants",
  singular: "Variant",
  icon: <Layers className="h-4 w-4" />,
  perms: { view: P.productsView, manage: P.productsManage },
  listSelect: "id, sku, name, weight_kg, allow_negative_stock, is_active",
  recordSelect: "id, sku, name, weight_kg, allow_negative_stock, is_active, created_at, updated_at",
  searchColumns: ["name", "sku"],
  orderBy: { column: "name" },
  titleField: "name",
  subtitle: (r) => String(r.sku),
  activeField: "is_active",
  dialogSize: "md",
  columns: [col.code("sku", "SKU"), col.strong("name", "Variant"), col.num("weight_kg", "Weight kg", 3, { hideBelow: "sm" }), col.active()],
  fields: [
    { name: "name", label: "Variant name", kind: "text", required: true, span: 2, placeholder: "e.g. 16-hole" },
    { name: "sku", label: "Variant SKU", kind: "text", required: true, autoCode: true, hint: "Blank = product SKU + -01, -02…" },
    { name: "weight_kg", label: "Weight (kg)", kind: "number", min: 0 },
    { name: "allow_negative_stock", label: "Allow negative stock", kind: "checkbox" },
  ],
};

export function VariantsPanel({ record, canManage }: ExtraPanelProps) {
  const has = Boolean(record.has_variants);
  return (
    <div className="space-y-3">
      {!has && <Badge tone="warning">"Has variants" is off — stock is tracked on the product itself.</Badge>}
      <ChildList
        config={variantConfig}
        parentField="product_id"
        parentId={String(record.id)}
        canManage={canManage && has}
        hint="When a product has variants, every stock-affecting transaction must name the variant."
      />
    </div>
  );
}

const locationConfig: EntityConfig = {
  key: "locations",
  table: "warehouse_locations",
  title: "Locations",
  singular: "Location",
  icon: <MapPin className="h-4 w-4" />,
  perms: { view: P.warehousesView, manage: P.warehousesManage },
  listSelect: "id, code, name, is_active",
  recordSelect: "id, code, name, is_active, created_at, updated_at",
  searchColumns: ["name", "code"],
  orderBy: { column: "code" },
  titleField: "name",
  subtitle: (r) => String(r.code),
  activeField: "is_active",
  dialogSize: "md",
  columns: [col.code(), col.strong("name", "Location"), col.active()],
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, placeholder: "A-01" },
    { name: "name", label: "Name", kind: "text", required: true, span: 2, placeholder: "Rack A, shelf 1" },
  ],
};

export function LocationsPanel({ record, canManage }: ExtraPanelProps) {
  return <ChildList config={locationConfig} parentField="warehouse_id" parentId={String(record.id)} canManage={canManage} />;
}

const agentAccountConfig: EntityConfig = {
  key: "agent-accounts",
  table: "payment_agent_accounts",
  title: "Currency sub-accounts",
  singular: "Sub-account",
  icon: <Wallet className="h-4 w-4" />,
  perms: { view: P.paymentAgentsView, manage: P.paymentAgentsManage },
  listSelect: "id, currency, is_active, gl:chart_of_accounts(code, name)",
  recordSelect: "id, currency, gl_account_id, is_active, created_at, updated_at",
  searchColumns: ["currency"],
  orderBy: { column: "currency" },
  titleField: "currency",
  activeField: "is_active",
  dialogSize: "md",
  columns: [
    col.text("currency", "Currency"),
    { key: "gl", header: "GL account", cell: (r) => { const g = r.gl as { code: string; name: string } | null; return g ? `${g.code} · ${g.name}` : <span className="text-ink-faint">Default agent clearing</span>; } },
    col.active(),
  ],
  fields: [
    { name: "currency", label: "Currency", kind: "lookup", required: true, lookup: CURRENCY_LOOKUP, lockOnEdit: true },
    { name: "gl_account_id", label: "GL account (optional)", kind: "lookup", span: 2, lookup: { table: "chart_of_accounts", label: "name", secondary: "code", filters: { is_group: false } } },
  ],
};

export function AgentAccountsPanel({ record, canManage }: ExtraPanelProps) {
  return (
    <ChildList
      config={agentAccountConfig}
      parentField="payment_agent_id"
      parentId={String(record.id)}
      canManage={canManage}
      hint="An agent can hold PKR, RMB, USD… balances. Advances are assets until allocated to a supplier settlement."
    />
  );
}

export function CustomerGroupMembersPanel({ record }: ExtraPanelProps) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["list", "customers", "group", record.id],
    queryFn: async () => {
      const { data, error } = await sb()
        .from("customers")
        .select("id, code, name, city, phone, is_active")
        .eq("group_id", String(record.id))
        .order("name")
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  return (
    <div>
      <SectionTitle>Linked farms / customer accounts</SectionTitle>
      <p className="mb-2 text-xs text-ink-muted">
        Each farm keeps its own ledger. The group statement is derived from these accounts — nothing is merged or duplicated. Link a farm by setting its Customer group.
      </p>
      <div className="overflow-hidden rounded-card border border-line">
        <DataTable
          columns={[col.code(), col.strong("name", "Farm / Account"), col.text("city", "City"), col.text("phone", "Phone"), col.active()]}
          rows={q.data ?? []}
          loading={q.isLoading}
          onView={(r) => navigate(`/customers?view=${r.id}`)}
          empty={<p className="py-6 text-center text-xs text-ink-muted">No accounts linked yet</p>}
        />
      </div>
    </div>
  );
}
