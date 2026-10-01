import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, X } from "lucide-react";
import { Badge, Button, Input, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate } from "@jst/utilities";
import { money, num } from "../accounting/common";

export interface OpenReceipt { entry_id: string; entry_no: string; entry_date: string; amount: number; allocated: number; unallocated: number }
export function useOpenReceipts(customerId: string | null) {
  return useQuery({
    queryKey: ["open-receipts", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await sb().rpc("customer_open_receipts", { p_customer_id: customerId });
      if (error) throw error;
      return ((data ?? []) as OpenReceipt[]).map((r) => ({ ...r, amount: Number(r.amount), allocated: Number(r.allocated), unallocated: Number(r.unallocated) }));
    },
  });
}

export interface OpenInvoice { id: string; doc_no: string; invoice_date: string; due_date: string | null; total_amount: number; outstanding: number }
export function useOpenInvoices(customerId: string | null) {
  return useQuery({
    queryKey: ["open-invoices", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await sb().from("sales_invoices_v").select("id, doc_no, invoice_date, due_date, total_amount, outstanding")
        .eq("customer_id", customerId!).eq("status", "POSTED").gt("outstanding", 0).order("invoice_date").order("doc_no");
      if (error) throw error;
      return ((data ?? []) as OpenInvoice[]).map((r) => ({ ...r, total_amount: Number(r.total_amount), outstanding: Number(r.outstanding) }));
    },
  });
}

/** Fill amounts oldest-first until the money runs out. */
export function autoFill<T extends { id: string; due: number }>(rows: T[], money: number) {
  let left = money;
  const out: Record<string, string> = {};
  for (const r of rows) {
    const a = Math.max(0, Math.min(r.due, left));
    out[r.id] = a > 0 ? String(Math.round(a * 100) / 100) : "";
    left -= a;
  }
  return out;
}

/**
 * Posted customer receipt → which invoices it pays (§10). Shown inside the receipt voucher.
 * Removing an allocation keeps it in history (status REMOVED).
 */
export function ReceiptAllocationPanel({ entryId, customerId }: { entryId: string; customerId: string }) {
  const { can } = useAccess();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canEdit = can(P.salesInvoice) || can(P.journalsCreate);
  const receipts = useOpenReceipts(customerId);
  const invoices = useOpenInvoices(customerId);
  const allocs = useQuery({
    queryKey: ["receipt-allocations", entryId],
    queryFn: async () => {
      const { data, error } = await sb().from("receipt_allocations").select("id, amount, status, created_at, invoice:sales_invoices(id, doc_no, invoice_date)")
        .eq("receipt_entry_id", entryId).eq("status", "ACTIVE").order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; amount: number; invoice: { id: string; doc_no: string; invoice_date: string } | null }[];
    },
  });
  const unallocated = receipts.data?.find((r) => r.entry_id === entryId)?.unallocated ?? 0;
  const [amt, setAmt] = React.useState<Record<string, string>>({});
  const chosen = Object.entries(amt).filter(([, v]) => num(v) > 0);
  const sum = chosen.reduce((a, [, v]) => a + num(v), 0);
  const refresh = () => qc.invalidateQueries();
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await sb().rpc("allocate_receipt", { p_receipt_id: entryId, p_allocations: chosen.map(([invoice_id, v]) => ({ invoice_id, amount: v.replace(/,/g, "") })) });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Receipt allocated"); setAmt({}); refresh(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await sb().rpc("remove_allocation", { p_id: id }); if (error) throw error; },
    onSuccess: () => { toast.success("Allocation removed"); refresh(); },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <div className="mt-3 rounded-card border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-ink-muted" />
        <span className="text-sm font-semibold">Invoices paid by this receipt</span>
        <div className="flex-1" />
        {receipts.data && <Badge tone={unallocated > 0 ? "warning" : "success"}>{unallocated > 0 ? `${money(unallocated)} not allocated` : "Fully allocated"}</Badge>}
      </div>
      {(allocs.data ?? []).length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {allocs.data!.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 rounded-control border border-line bg-subtle px-2 py-0.5 text-xs">
              <button className="font-mono hover:underline" onClick={() => a.invoice && navigate(`/invoices?view=${a.invoice.id}`)}>{a.invoice?.doc_no ?? "invoice"}</button>
              <span className="tabular-nums font-medium">{money(a.amount)}</span>
              {canEdit && <button aria-label="Remove allocation" className="text-ink-faint hover:text-danger" disabled={remove.isPending} onClick={() => remove.mutate(a.id)}><X className="h-3 w-3" /></button>}
            </span>
          ))}
        </div>
      )}
      {canEdit && unallocated > 0 && (
        (invoices.data ?? []).length === 0 ? <p className="text-xs text-ink-muted">This customer has no unpaid posted invoices. The amount stays on account as an advance.</p> : (
          <>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-2xs uppercase text-ink-muted"><th className="py-1">Invoice</th><th>Date</th><th className="text-right">Outstanding</th><th className="w-[140px] text-right">Allocate</th></tr></thead>
              <tbody>
                {invoices.data!.map((i) => (
                  <tr key={i.id} className="border-t border-line/60">
                    <td className="py-1 font-mono text-xs">{i.doc_no}</td>
                    <td className="text-xs">{formatDate(i.invoice_date)}</td>
                    <td className="text-right tabular-nums">{money(i.outstanding)}</td>
                    <td className="py-1 text-right"><Input inputMode="decimal" className={cn("h-control-sm text-right tabular-nums")} placeholder="0" value={amt[i.id] ?? ""} invalid={num(amt[i.id] ?? "") > i.outstanding}
                      onChange={(e) => setAmt((s) => ({ ...s, [i.id]: e.target.value }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" onClick={() => setAmt(autoFill(invoices.data!.map((i) => ({ id: i.id, due: i.outstanding })), unallocated))}>Oldest first</Button>
              <span className={cn("text-xs", sum > unallocated + 0.001 ? "text-danger" : "text-ink-muted")}>Allocating {money(sum)} of {money(unallocated)}</span>
              <div className="flex-1" />
              <Button size="sm" variant="primary" disabled={!chosen.length || sum > unallocated + 0.001} loading={save.isPending} onClick={() => save.mutate()}>Allocate</Button>
            </div>
          </>
        )
      )}
    </div>
  );
}
