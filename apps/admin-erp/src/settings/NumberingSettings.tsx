import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hash, Save } from "lucide-react";
import { Badge, Button, Card, Checkbox, DataTable, ErpDialog, Field, FormGrid, Input } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { humanize } from "@jst/utilities";

interface Seq { id: string; doc_type: string; prefix: string; next_number: number; padding: number; reset_yearly: boolean; current_year: number | null }

/** Friendly names for the document types the database numbers. */
const NAMES: Record<string, string> = {
  SALES_ORDER: "Sales order", SALES_INVOICE: "Sales invoice", GDN: "Delivery note (GDN)", QUOTATION: "Quotation", RESERVATION: "Reserved order",
  PICKING: "Picking task", PRICE_TASK: "Price task", SALES_RETURN: "Sales return", PURCHASE_ORDER: "Purchase order", GOODS_RECEIPT: "Goods receipt (GRN)",
  SUPPLIER_BILL: "Supplier bill", COST_TASK: "Purchase cost task", PURCHASE_RETURN: "Purchase return", SHIPMENT: "Shipment", LANDED_COST: "Landed cost",
  FX_PAYMENT: "Foreign payment", STOCK_TRANSFER: "Stock transfer", STOCK_ADJUSTMENT: "Stock adjustment", STOCK_COUNT: "Stock count", ASSEMBLY_ORDER: "Assembly order",
  PHYSICAL_UNIT: "Roll number", JE_RECEIPT: "Receipt voucher", JE_PAYMENT: "Payment voucher", JE_TRANSFER: "Bank / cash transfer", JE_JOURNAL: "Journal voucher",
  JE_OPENING: "Opening balances", JE_SYSTEM: "System journal", PDC: "Post-dated cheque", BANK_IMPORT: "Bank statement import", BANK_REC: "Bank reconciliation",
  AGENT_TXN: "Agent transaction", CURRENCY_CONVERSION: "Currency conversion", PAYROLL: "Payroll run", EMP_ADVANCE: "Employee advance",
  CUSTOMER: "Customer code", CUSTOMER_GROUP: "Customer group code", SUPPLIER: "Supplier code", PRODUCT: "Product SKU", WAREHOUSE: "Warehouse code",
  BANK_ACCOUNT: "Bank account code", PAYMENT_AGENT: "Payment agent code", EMPLOYEE: "Employee code",
};
const GROUP = (t: string) =>
  ["CUSTOMER", "CUSTOMER_GROUP", "SUPPLIER", "PRODUCT", "WAREHOUSE", "BANK_ACCOUNT", "PAYMENT_AGENT", "EMPLOYEE"].includes(t) ? "Master codes" : "Documents";

export const nextCode = (s: { prefix: string; next_number: number; padding: number; reset_yearly: boolean; current_year?: number | null }, year = new Date().getFullYear()) => {
  const n = s.reset_yearly && s.current_year && s.current_year !== year ? 1 : s.next_number;
  return `${s.prefix}${s.reset_yearly ? `${year}-` : ""}${String(n).padStart(s.padding, "0")}`;
};

export function NumberingSettings() {
  const { companyId, can } = useAccess();
  const [edit, setEdit] = React.useState<Seq | null>(null);
  const q = useQuery({
    queryKey: ["numbering", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().from("numbering_sequences").select("id, doc_type, prefix, next_number, padding, reset_yearly, current_year").eq("company_id", companyId!);
      if (error) throw error;
      return ((data ?? []) as Seq[]).sort((a, b) => GROUP(a.doc_type).localeCompare(GROUP(b.doc_type)) || (NAMES[a.doc_type] ?? a.doc_type).localeCompare(NAMES[b.doc_type] ?? b.doc_type));
    },
  });
  const canEdit = can("settings.manage");
  return (
    <Card className="max-w-5xl overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm text-ink-muted">
        <Hash className="h-4 w-4 shrink-0" /> Numbers are issued by the database under a row lock — never by the browser — so they can't be duplicated.
        {canEdit && " Open a row to change its prefix, digits or next number."}
      </div>
      <DataTable
        loading={q.isLoading}
        rows={q.data ?? []}
        onView={canEdit ? (r) => setEdit(r) : undefined}
        columns={[
          { key: "d", header: "Document", cell: (r) => <span className="font-medium">{NAMES[r.doc_type] ?? humanize(r.doc_type)}</span> },
          { key: "g", header: "Kind", hideBelow: "md", cell: (r) => <Badge>{GROUP(r.doc_type)}</Badge> },
          { key: "p", header: "Prefix", cell: (r) => <span className="font-mono text-xs">{r.prefix}</span> },
          { key: "y", header: "Year in number", hideBelow: "md", cell: (r) => (r.reset_yearly ? "Yes — restarts every year" : "No") },
          { key: "n", header: "Next number", align: "right", cell: (r) => r.next_number },
          { key: "x", header: "Next code", cell: (r) => <span className="font-mono text-xs">{nextCode(r)}</span> },
        ]}
      />
      {edit && <EditSequence seq={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function EditSequence({ seq, onClose }: { seq: Seq; onClose: () => void }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const [v, setV] = React.useState({ prefix: seq.prefix, next: String(seq.next_number), padding: String(seq.padding), reset: seq.reset_yearly });
  const nextNum = Math.max(1, Math.floor(Number(v.next) || 1));
  const padding = Math.min(12, Math.max(1, Math.floor(Number(v.padding) || 1)));
  const cur = seq.reset_yearly && seq.current_year && seq.current_year !== new Date().getFullYear() ? 1 : seq.next_number;
  const lowering = nextNum < cur && v.prefix === seq.prefix && v.reset === seq.reset_yearly;
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb().rpc("set_numbering_sequence", {
        p_company: companyId, p_doc_type: seq.doc_type, p_prefix: v.prefix.trim(), p_next_number: nextNum, p_padding: padding, p_reset_yearly: v.reset,
      });
      if (error) throw error;
      return data as { next_code: string };
    },
    onSuccess: (d) => { toast.success(`Saved — the next one will be ${d.next_code}`); qc.invalidateQueries({ queryKey: ["numbering", companyId] }); onClose(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <ErpDialog open onRequestClose={onClose} size="md" icon={<Hash className="h-4 w-4" />} title={NAMES[seq.doc_type] ?? humanize(seq.doc_type)} subtitle="Document numbering"
      footer={<><div className="flex-1" /><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending} disabled={lowering} onClick={() => save.mutate()}>Save</Button></>}>
      <FormGrid cols={3}>
        <Field label="Prefix" hint="Letters, digits, - / _"><Input value={v.prefix} maxLength={12} onChange={(e) => setV((s) => ({ ...s, prefix: e.target.value }))} className="font-mono" /></Field>
        <Field label="Digits" hint="Zero-padded to this length"><Input type="number" min={1} max={12} value={v.padding} onChange={(e) => setV((s) => ({ ...s, padding: e.target.value }))} /></Field>
        <Field label="Next number" error={lowering ? `Can't go below ${cur}` : undefined}><Input type="number" min={1} value={v.next} onChange={(e) => setV((s) => ({ ...s, next: e.target.value }))} /></Field>
      </FormGrid>
      <Checkbox checked={v.reset} onChange={(c) => setV((s) => ({ ...s, reset: c }))} label="Put the year in the number and restart at 1 every January"
        description="Example: SO-2026-00001 … SO-2027-00001." />
      <div className="mt-4 rounded-card border border-line bg-subtle px-3 py-2 text-sm">
        Next code: <span className="font-mono font-semibold">{nextCode({ prefix: v.prefix.trim(), next_number: nextNum, padding, reset_yearly: v.reset })}</span>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Numbers already issued never change. The next number can't be lowered (that could repeat a number already used) unless you also change the prefix
        or the year setting, which gives a new, different series.
      </p>
    </ErpDialog>
  );
}
