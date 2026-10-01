import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Link2, Printer, ScrollText, ShieldAlert } from "lucide-react";
import { Badge, Button, Card, Checkbox, EmptyState, PageHeader, Skeleton, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate } from "@jst/utilities";
import type { ExtraPanelProps } from "../entity/types";
import { useUrlState } from "../inventory/DocPage";
import { Amount, BalanceText, DateRangeBar, ENTRY_LABEL, PartyPicker, money, presetRange, type DateRange, type EntryType, type PartyType } from "./common";
import { VoucherDialog } from "./VoucherDialog";

interface StRow { row_kind: string; entry_id: string | null; entry_no: string | null; entry_date: string | null; entry_type: EntryType | null; memo: string | null; reference: string | null; via: string | null; debit: number | null; credit: number | null; balance: number }

const plainType = (t: EntryType | null, partyType: PartyType, memo?: string | null) =>
  t === "SYSTEM" && memo?.startsWith("Sales invoice") ? "Invoice"
  : t === "SYSTEM" && memo?.startsWith("Reversal") ? "Reversal"
  : t === "RECEIPT" ? (partyType === "SUPPLIER" ? "Refund received" : "Payment received")
  : t === "PAYMENT" ? (partyType === "SUPPLIER" ? "Payment made" : "Refund paid")
  : t ? ENTRY_LABEL[t] : "";

function useLinked(partyType: PartyType, partyId: string | null) {
  return useQuery({
    queryKey: ["linked-party", partyType, partyId],
    enabled: !!partyId && partyType !== "EMPLOYEE",
    queryFn: async () => {
      const { data } = partyType === "CUSTOMER"
        ? await sb().from("customers").select("name, linked_supplier_id").eq("id", partyId!).maybeSingle()
        : await sb().from("suppliers").select("name, linked_customer_id").eq("id", partyId!).maybeSingle();
      const d = data as { name: string; linked_supplier_id?: string | null; linked_customer_id?: string | null } | null;
      return { name: d?.name ?? "", linked: d?.linked_supplier_id ?? d?.linked_customer_id ?? null };
    },
  });
}

/** Customer / supplier statement: opening balance, transactions with running balance, closing balance. */
export function PartyStatement({ partyType, partyId, range, compact }: { partyType: PartyType; partyId: string; range: DateRange; compact?: boolean }) {
  const linked = useLinked(partyType, partyId);
  const [combine, setCombine] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  const st = useQuery({
    queryKey: ["statement", partyType, partyId, range.from, range.to, combine],
    queryFn: async () => {
      const { data, error } = await sb().rpc("party_statement", { p_party_type: partyType, p_party_id: partyId, p_from: range.from, p_to: range.to, p_include_linked: combine });
      if (error) throw error;
      return (data ?? []) as StRow[];
    },
  });
  const rows = st.data ?? [];
  const opening = rows.find((r) => r.row_kind === "OPENING")?.balance ?? 0;
  const txns = rows.filter((r) => r.row_kind === "TXN");
  const shown = compact ? txns.slice(-15) : txns;
  const closing = txns.length ? Number(txns[txns.length - 1].balance) : Number(opening);
  const tDr = txns.reduce((a, r) => a + Number(r.debit ?? 0), 0), tCr = txns.reduce((a, r) => a + Number(r.credit ?? 0), 0);
  const other = partyType === "CUSTOMER" ? "supplier" : "customer";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2 text-xs">
          {!compact && range.from && <Badge tone="neutral">Opening <span className="ml-1"><BalanceText v={Number(opening)} partyType={partyType} /></span></Badge>}
          <Badge tone={closing > 0.005 ? (partyType === "CUSTOMER" ? "warning" : "info") : "success"}>Balance <span className="ml-1"><BalanceText v={closing} partyType={partyType} /></span></Badge>
        </div>
        {linked.data?.linked && (
          <Checkbox checked={combine} onChange={setCombine}
            label={<span className="inline-flex items-center gap-1"><Link2 className="h-3.5 w-3.5" />Include their {other} account (net balance)</span>} />
        )}
      </div>
      {st.isLoading ? <Skeleton className="h-32" /> : st.error ? <p className="text-sm text-danger">{friendlyError(st.error)}</p> : (
        <div className="overflow-auto rounded-card border border-line print:border-0">
          <table className="w-full text-sm">
            <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              <th className="h-8 px-3">Date</th><th className="px-3">Voucher</th><th className="px-3">Type</th><th className="hidden px-3 md:table-cell">Details</th>
              <th className="px-3 text-right">Debit</th><th className="px-3 text-right">Credit</th><th className="px-3 text-right">Balance</th>
            </tr></thead>
            <tbody>
              {!compact && (
                <tr className="border-b border-line/70 bg-subtle/40">
                  <td className="h-row px-3 text-xs">{range.from ? formatDate(range.from) : ""}</td><td className="px-3" colSpan={5}><span className="text-xs font-medium">Opening balance</span></td>
                  <td className="px-3 text-right"><BalanceText v={Number(opening)} partyType={partyType} /></td>
                </tr>
              )}
              {compact && txns.length > shown.length && <tr><td colSpan={7} className="px-3 py-1 text-2xs text-ink-muted">Showing the last {shown.length} transactions — open Statements for the full history.</td></tr>}
              {shown.map((r) => (
                <tr key={r.entry_id!} className="cursor-pointer border-b border-line/70 hover:bg-subtle/60" onClick={() => setOpen(r.entry_id)}>
                  <td className="h-row whitespace-nowrap px-3 text-xs">{formatDate(r.entry_date!)}</td>
                  <td className="px-3"><span className="font-mono text-xs text-info">{r.entry_no}</span></td>
                  <td className="px-3 text-xs">{plainType(r.entry_type, partyType, r.memo)}{r.via && <Badge tone="neutral" className="ml-1">as {r.via.toLowerCase()}</Badge>}</td>
                  <td className="hidden max-w-[280px] truncate px-3 text-xs text-ink-muted md:table-cell">{[r.reference, r.memo].filter(Boolean).join(" · ")}</td>
                  <td className="px-3 text-right"><Amount v={r.debit} /></td>
                  <td className="px-3 text-right"><Amount v={r.credit} /></td>
                  <td className="px-3 text-right"><BalanceText v={Number(r.balance)} partyType={partyType} /></td>
                </tr>
              ))}
              {txns.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-xs text-ink-muted">No posted transactions{range.from || range.to ? " in this period" : ""}.</td></tr>}
              {!compact && txns.length > 0 && (
                <tr className="bg-subtle/60 font-semibold">
                  <td className="h-row px-3" colSpan={4}>Closing balance</td>
                  <td className="px-3 text-right tabular-nums">{money(tDr)}</td><td className="px-3 text-right tabular-nums">{money(tCr)}</td>
                  <td className="px-3 text-right"><BalanceText v={closing} partyType={partyType} /></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {open && <VoucherDialog id={open} onClose={() => setOpen(null)} onSaved={() => undefined} onOpen={setOpen} />}
    </div>
  );
}

/** Quick statement tab on the customer / supplier record */
export function makeQuickStatementPanel(partyType: PartyType) {
  return function QuickStatementPanel({ record }: ExtraPanelProps) {
    const { can } = useAccess();
    if (!can(P.journalsView)) return <p className="text-xs text-ink-muted">You don't have permission to view statements.</p>;
    return (
      <div className="space-y-2">
        <PartyStatement partyType={partyType} partyId={String(record.id)} range={{ from: null, to: null }} compact />
        <Link className="text-xs text-info hover:underline" to={`/statements?type=${partyType}&party=${record.id}`}>Open full statement →</Link>
      </div>
    );
  };
}

export function StatementsPage() {
  const { can } = useAccess();
  const { params, update } = useUrlState();
  const partyType = (params.get("type") as PartyType) ?? "CUSTOMER";
  const partyId = params.get("party");
  const range: DateRange = params.has("from") || params.has("to") ? { from: params.get("from") || null, to: params.get("to") || null } : presetRange("year");
  if (!can(P.journalsView)) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="You don't have permission to view statements." /></Card>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Customer & Supplier Statements" description="Opening balance, every posted transaction with a running balance, and the closing balance. Click a row to open the voucher."
        icon={<ScrollText className="h-4 w-4" />} actions={partyId && <Button icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>} />
      <Card className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div className="flex rounded-control border border-line bg-subtle p-0.5">
            {(["CUSTOMER", "SUPPLIER"] as PartyType[]).map((k) => (
              <button key={k} type="button" onClick={() => update({ type: k, party: null })}
                className={cn("h-[26px] rounded-[6px] px-2.5 text-xs font-medium", partyType === k ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink")}>
                {k === "CUSTOMER" ? "Customer" : "Supplier"}
              </button>
            ))}
          </div>
          <div className="w-72"><PartyPicker type={partyType} value={partyId} onChange={(v) => update({ party: v })} /></div>
          <DateRangeBar value={range} onChange={(r) => update({ from: r.from ?? "", to: r.to ?? "" })} />
        </div>
        {partyId ? <PartyStatement partyType={partyType} partyId={partyId} range={range} />
          : <EmptyState icon={<ScrollText className="h-6 w-6" />} title={`Choose a ${partyType.toLowerCase()}`} description="Their statement appears here." />}
      </Card>
    </div>
  );
}
