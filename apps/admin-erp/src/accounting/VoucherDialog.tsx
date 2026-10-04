import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Ban, BookOpenCheck, CheckCircle2, Landmark, Pencil, Plus, Save, Trash2, Undo2 } from "lucide-react";
import { Badge, Button, ConfirmDialog, ErpDialog, Field, FormGrid, Input, KeyValue, Skeleton, Textarea, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, formatDateTime, humanize } from "@jst/utilities";
import { useUnsavedGuard } from "../lib/unsaved";
import { AuditTimeline } from "../entity/AuditTimeline";
import { Tabs } from "../entity/EntityDialog";
import { STATUS_TONE } from "../inventory/docConfigs";
import { ReceiptAllocationPanel } from "../sales/allocations";
import { AttachmentsPanel, filesLabel, useAttachments } from "../attachments/Attachments";
import {
  AccountPicker, Amount, BankPicker, ENTRY_LABEL, PartyPicker, money, num, today, useAccountNames, useBanks, usePartyNames, useSystemAccounts,
  type EntryType, type PartyType,
} from "./common";

type Row = Record<string, unknown>;
type DraftLine = { account_id: string; debit: number; credit: number; party_type: string | null; party_id: string | null; bank_account_id: string | null; description: string | null };
type Counter = "CUSTOMER" | "SUPPLIER" | "ACCOUNT";
interface GridLine { key: string; account_id: string | null; party_id: string | null; description: string; debit: string; credit: string }
const newGrid = (): GridLine => ({ key: crypto.randomUUID(), account_id: null, party_id: null, description: "", debit: "", credit: "" });

export const ENTRY_ICON: Record<EntryType, React.ReactNode> = {
  RECEIPT: <ArrowDownLeft className="h-4 w-4" />, PAYMENT: <ArrowUpRight className="h-4 w-4" />, TRANSFER: <ArrowLeftRight className="h-4 w-4" />,
  JOURNAL: <BookOpenCheck className="h-4 w-4" />, OPENING: <Landmark className="h-4 w-4" />, SYSTEM: <BookOpenCheck className="h-4 w-4" />,
};

function useEntry(id: string | null) {
  return useQuery({
    queryKey: ["record", "journal_entries", id],
    enabled: !!id,
    queryFn: async () => {
      const [h, l] = await Promise.all([
        sb().from("journal_entries_v").select("*").eq("id", id!).single(),
        sb().from("journal_entries").select("lines_draft").eq("id", id!).single(),
      ]);
      if (h.error) throw h.error;
      if (l.error) throw l.error;
      return { ...(h.data as Row), lines_draft: (l.data as Row).lines_draft as DraftLine[] };
    },
  });
}

export function VoucherDialog({ id, newType, onClose, onSaved, onOpen }: {
  id: string | null; newType?: EntryType; onClose: () => void; onSaved: (id: string) => void; onOpen?: (id: string) => void;
}) {
  const doc = useEntry(id);
  const [mode, setMode] = React.useState<"view" | "edit">(id ? "view" : "edit");
  React.useEffect(() => setMode(id ? "view" : "edit"), [id]);
  if (mode === "edit" && (!id || doc.data)) {
    return <VoucherForm id={id} initial={doc.data ?? null} newType={newType ?? "RECEIPT"} onCancel={() => (id ? setMode("view") : onClose())} onClose={onClose}
      onSaved={(nid) => { setMode("view"); onSaved(nid); }} />;
  }
  return <VoucherView id={id!} data={doc.data ?? null} loading={doc.isLoading} error={doc.error} onEdit={() => setMode("edit")} onClose={onClose} onOpen={onOpen} />;
}

/* ================================================================== VIEW */
function VoucherView({ id, data, loading, error, onEdit, onClose, onOpen }: {
  id: string; data: (Row & { lines_draft: DraftLine[] }) | null; loading: boolean; error: unknown; onEdit: () => void; onClose: () => void; onOpen?: (id: string) => void;
}) {
  const { can } = useAccess();
  const qc = useQueryClient();
  const [tab, setTab] = React.useState("lines");
  const files = useAttachments("journal_entries", id);
  const [confirm, setConfirm] = React.useState<null | "post" | "cancel" | "reverse">(null);
  const [reason, setReason] = React.useState("");
  const [revDate, setRevDate] = React.useState("");
  const status = String(data?.status ?? "DRAFT");
  const type = (data?.entry_type as EntryType) ?? "JOURNAL";
  const lines = data?.lines_draft ?? [];
  const allocatable = status === "POSTED" && type === "RECEIPT" && data?.party_type === "CUSTOMER" && !!data?.party_id;
  const accts = useAccountNames(lines.map((l) => l.account_id));
  const parties = usePartyNames(lines.map((l) => ({ type: l.party_type, id: l.party_id })));
  const banks = useBanks();

  const act = useMutation({
    mutationFn: async (k: "post" | "cancel" | "reverse") => {
      const r = k === "post" ? await sb().rpc("post_journal_entry", { p_id: id })
        : k === "cancel" ? await sb().rpc("cancel_journal_entry", { p_id: id })
        : await sb().rpc("reverse_journal_entry", { p_id: id, p_reason: reason.trim(), p_date: revDate || null });
      if (r.error) throw r.error;
    },
    onSuccess: (_d, k) => { toast.success(k === "post" ? "Posted to the ledger" : k === "cancel" ? "Draft cancelled" : "Reversed"); setConfirm(null); setReason(""); qc.invalidateQueries(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const title = String(data?.entry_no ?? "Voucher");
  const tDr = lines.reduce((a, l) => a + Number(l.debit), 0), tCr = lines.reduce((a, l) => a + Number(l.credit), 0);

  return (
    <>
      <ErpDialog
        open onRequestClose={onClose} size="xl" title={title} icon={ENTRY_ICON[type]}
        subtitle={data ? `${ENTRY_LABEL[type]} · ${formatDate(data.entry_date as string)}` : undefined}
        status={<Badge tone={STATUS_TONE[status]}>{humanize(status)}</Badge>}
        footer={
          <>
            {status === "DRAFT" && can(P.journalsCreate) && <Button variant="destructive-ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setConfirm("cancel")}>Cancel draft</Button>}
            {status === "POSTED" && !data?.source_type && can(P.journalsPost) && <Button variant="destructive-ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setConfirm("reverse")}>Reverse</Button>}
            <div className="flex-1" />
            <Button onClick={onClose}>Close</Button>
            {status === "DRAFT" && can(P.journalsCreate) && <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>Edit</Button>}
            {status === "DRAFT" && can(P.journalsPost) && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setConfirm("post")}>Post</Button>}
          </>
        }
      >
        {loading ? <Skeleton className="h-40" /> : error ? <p className="text-sm text-danger">{friendlyError(error)}</p> : data ? (
          <>
            <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
              {data.party_name ? <KeyValue label={type === "RECEIPT" ? "Received from" : type === "PAYMENT" ? "Paid to" : "Party"}><span className="font-medium">{String(data.party_name)}</span></KeyValue> : null}
              {data.bank_name ? <KeyValue label={type === "RECEIPT" ? "Into" : "From"}>{String(data.bank_name)}</KeyValue> : null}
              <KeyValue label="Amount"><span className="text-lg font-semibold tabular-nums">{money((data.amount ?? data.total_debit) as number)}</span></KeyValue>
              <KeyValue label="Reference">{(data.reference as string) || null}</KeyValue>
              {data.posted_at ? <KeyValue label="Posted">{formatDateTime(data.posted_at as string)}</KeyValue> : null}
              {data.reversal_of ? <KeyValue label="Reverses"><button className="text-info hover:underline" onClick={() => onOpen?.(String(data.reversal_of))}>View original</button></KeyValue> : null}
              {data.reversed_by_entry ? <KeyValue label="Reversed by"><button className="text-info hover:underline" onClick={() => onOpen?.(String(data.reversed_by_entry))}>View reversal</button></KeyValue> : null}
              {data.reversal_reason ? <KeyValue label="Reversal reason" className="col-span-2">{String(data.reversal_reason)}</KeyValue> : null}
              {data.memo ? <KeyValue label="Narration" className="col-span-2 md:col-span-4">{String(data.memo)}</KeyValue> : null}
            </dl>
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "lines", label: "Accounting lines" }, ...(allocatable ? [{ key: "alloc", label: "Invoices paid" }] : []), { key: "files", label: filesLabel(files.data?.length) }, ...(can("audit.view") ? [{ key: "history", label: "History" }] : [])]} />
            {tab === "alloc" && allocatable && <ReceiptAllocationPanel entryId={id} customerId={String(data.party_id)} />}
            {tab === "lines" && (
              <div className="overflow-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th className="h-8 px-3">Account</th><th className="px-3">Customer / supplier / bank</th><th className="hidden px-3 md:table-cell">Description</th>
                    <th className="px-3 text-right">Debit</th><th className="px-3 text-right">Credit</th>
                  </tr></thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-b border-line/70">
                        <td className="h-row px-3">{accts.data?.get(l.account_id) ?? "…"}</td>
                        <td className="px-3 text-xs">{l.party_id ? parties.data?.get(l.party_id) ?? "…" : l.bank_account_id ? banks.data?.find((b) => b.id === l.bank_account_id)?.name : <span className="text-ink-faint">—</span>}</td>
                        <td className="hidden px-3 text-xs text-ink-muted md:table-cell">{l.description}</td>
                        <td className="px-3 text-right"><Amount v={l.debit} /></td>
                        <td className="px-3 text-right"><Amount v={l.credit} /></td>
                      </tr>
                    ))}
                    <tr className="bg-subtle/60 font-semibold"><td className="h-row px-3" colSpan={3}>Total</td><td className="px-3 text-right tabular-nums">{money(tDr)}</td><td className="px-3 text-right tabular-nums">{money(tCr)}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
            {tab === "history" && <AuditTimeline table="journal_entries" id={id} />}
            {tab === "files" && <AttachmentsPanel entityType="journal_entries" entityId={id} />}
          </>
        ) : null}
      </ErpDialog>
      <ConfirmDialog open={confirm === "post"} title={`Post ${title}?`} message="The entry goes into the ledger and can then only be corrected by a reversal entry."
        confirmLabel="Post now" loading={act.isPending} onCancel={() => setConfirm(null)} onConfirm={() => act.mutate("post")} />
      <ConfirmDialog open={confirm === "cancel"} title="Cancel this draft?" message="The draft is kept for history but can no longer be posted." tone="destructive"
        confirmLabel="Cancel draft" cancelLabel="Keep draft" loading={act.isPending} onCancel={() => setConfirm(null)} onConfirm={() => act.mutate("cancel")} />
      <ConfirmDialog open={confirm === "reverse"} title={`Reverse ${title}?`} message="A new entry with debits and credits swapped is posted. The original stays in history."
        tone="destructive" confirmLabel="Reverse" loading={act.isPending} onCancel={() => { setConfirm(null); setReason(""); }}
        onConfirm={() => (reason.trim() ? act.mutate("reverse") : toast.error("Enter a reason"))}>
        <Field label="Reason" required className="mt-3"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being reversed?" /></Field>
        <Field label="Reversal date" hint="Blank = same date as the original" className="mt-2"><Input type="date" value={revDate} onChange={(e) => setRevDate(e.target.value)} /></Field>
      </ConfirmDialog>
    </>
  );
}

/* ================================================================== FORM */
function VoucherForm({ id, initial, newType, onCancel, onClose, onSaved }: {
  id: string | null; initial: (Row & { lines_draft: DraftLine[] }) | null; newType: EntryType; onCancel: () => void; onClose: () => void; onSaved: (id: string) => void;
}) {
  const { companyId, can } = useAccess();
  const qc = useQueryClient();
  const sys = useSystemAccounts();
  const banks = useBanks();
  const idem = React.useRef(crypto.randomUUID());
  const type = ((initial?.entry_type as EntryType) ?? newType) as EntryType;
  const simple = type === "RECEIPT" || type === "PAYMENT" || type === "TRANSFER";

  const init = React.useMemo(() => {
    const L = initial?.lines_draft ?? [];
    const bankLine = (side: "debit" | "credit") => L.find((l) => l.bank_account_id && Number(l[side]) > 0);
    const counterLine = L.find((l) => !l.bank_account_id) ?? null;
    const pt = (initial?.party_type as PartyType | null) ?? null;
    return {
      date: (initial?.entry_date as string) ?? today(),
      reference: (initial?.reference as string) ?? "",
      memo: (initial?.memo as string) ?? "",
      amount: initial?.amount != null ? String(Number(initial.amount)) : "",
      counter: (pt === "CUSTOMER" || pt === "SUPPLIER" ? pt : counterLine ? "ACCOUNT" : type === "PAYMENT" ? "SUPPLIER" : "CUSTOMER") as Counter,
      party_id: ((initial?.party_id as string | undefined) ?? null) as string | null,
      account_id: !pt && counterLine ? counterLine.account_id : null,
      bank_id: type === "TRANSFER" ? bankLine("credit")?.bank_account_id ?? null : (initial?.bank_account_id as string) ?? null,
      to_bank_id: type === "TRANSFER" ? bankLine("debit")?.bank_account_id ?? null : null,
      grid: !simple && L.length
        ? L.filter((l) => !(type === "OPENING" && l.account_id === sys.data?.byKey.OPENING_BALANCE?.id)).map((l) => ({
            key: crypto.randomUUID(), account_id: l.account_id, party_id: l.party_id, description: l.description ?? "",
            debit: Number(l.debit) ? String(Number(l.debit)) : "", credit: Number(l.credit) ? String(Number(l.credit)) : "",
          }))
        : [newGrid(), newGrid()],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, type, sys.data]);
  const [f, setF] = React.useState(init);
  const set = <K extends keyof typeof init>(k: K, v: (typeof init)[K]) => setF((s) => ({ ...s, [k]: v }));
  const snapshot = React.useRef(JSON.stringify(init));
  // reference data (system accounts) can arrive after the form opens: refresh only if nothing was typed yet
  React.useEffect(() => {
    const prev = snapshot.current;
    setF((cur) => (JSON.stringify(cur) === prev ? init : cur));
    snapshot.current = JSON.stringify(init);
  }, [init]);
  const dirty = JSON.stringify(f) !== snapshot.current;
  const { guard, dialog } = useUnsavedGuard(dirty);
  const [showErrors, setShowErrors] = React.useState(false);

  const glOf = (bankId: string | null) => banks.data?.find((b) => b.id === bankId)?.gl_account_id ?? null;
  const partyOf = sys.data?.partyOf ?? {};
  const amt = num(f.amount);

  // ---- build the accounting lines
  const lines: DraftLine[] = React.useMemo(() => {
    const L = (account_id: string | null, debit: number, credit: number, extra: Partial<DraftLine> = {}): DraftLine =>
      ({ account_id: account_id ?? "", debit, credit, party_type: null, party_id: null, bank_account_id: null, description: null, ...extra });
    if (type === "TRANSFER") return [L(glOf(f.to_bank_id), amt, 0, { bank_account_id: f.to_bank_id }), L(glOf(f.bank_id), 0, amt, { bank_account_id: f.bank_id })];
    if (simple) {
      const counterAcc = f.counter === "CUSTOMER" ? sys.data?.byKey.AR_CONTROL?.id ?? null : f.counter === "SUPPLIER" ? sys.data?.byKey.AP_CONTROL?.id ?? null : f.account_id;
      const counterExtra = f.counter === "ACCOUNT" ? {} : { party_type: f.counter, party_id: f.party_id };
      const bank = { bank_account_id: f.bank_id };
      return type === "RECEIPT"
        ? [L(glOf(f.bank_id), amt, 0, bank), L(counterAcc, 0, amt, counterExtra)]
        : [L(counterAcc, amt, 0, counterExtra), L(glOf(f.bank_id), 0, amt, bank)];
    }
    const g = f.grid.filter((x) => x.account_id || num(x.debit) || num(x.credit)).map((x) => L(x.account_id, num(x.debit) || 0, num(x.credit) || 0, {
      party_type: x.account_id && partyOf[x.account_id] ? partyOf[x.account_id] : null, party_id: x.account_id && partyOf[x.account_id] ? x.party_id : null, description: x.description || null,
    }));
    if (type === "OPENING") {
      const diff = g.reduce((a, l) => a + l.debit - l.credit, 0);
      if (Math.abs(diff) >= 0.005 && sys.data?.byKey.OPENING_BALANCE)
        g.push(L(sys.data.byKey.OPENING_BALANCE.id, diff < 0 ? -diff : 0, diff > 0 ? diff : 0, { description: "Balancing — opening balance equity" }));
    }
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, type, sys.data, banks.data]);
  const tDr = lines.reduce((a, l) => a + l.debit, 0), tCr = lines.reduce((a, l) => a + l.credit, 0);

  // ---- validation
  const errors: Record<string, string> = {};
  if (simple) {
    if (!f.bank_id) errors.bank = "Choose the bank / cash account";
    if (!(amt > 0)) errors.amount = "Enter the amount";
    if (type === "TRANSFER") { if (!f.to_bank_id) errors.to_bank = "Choose where the money goes"; else if (f.to_bank_id === f.bank_id) errors.to_bank = "Choose a different account"; }
    else if (f.counter === "ACCOUNT" ? !f.account_id : !f.party_id) errors.counter = f.counter === "ACCOUNT" ? "Choose the account" : `Choose the ${f.counter.toLowerCase()}`;
  } else {
    f.grid.forEach((x) => {
      const used = x.account_id || num(x.debit) || num(x.credit);
      if (!used) return;
      if (!x.account_id) errors[`${x.key}.a`] = "Account";
      else if (partyOf[x.account_id] && !x.party_id) errors[`${x.key}.p`] = `Choose the ${partyOf[x.account_id].toLowerCase()}`;
      if ((num(x.debit) || 0) > 0 && (num(x.credit) || 0) > 0) errors[`${x.key}.a`] = "Debit or credit, not both";
    });
    if (lines.length < 2) errors.grid = "Enter at least two lines";
    else if (Math.abs(tDr - tCr) >= 0.005) errors.grid = `Debits and credits differ by ${money(Math.abs(tDr - tCr))}`;
  }
  const err = (k: string) => (showErrors ? errors[k] : undefined);

  const save = useMutation({
    mutationFn: async (andPost: boolean) => {
      const header = {
        company_id: companyId, entry_type: type, entry_date: f.date, reference: f.reference, memo: f.memo,
        party_type: simple && type !== "TRANSFER" && f.counter !== "ACCOUNT" ? f.counter : null,
        party_id: simple && type !== "TRANSFER" && f.counter !== "ACCOUNT" ? f.party_id : null,
        bank_account_id: simple ? f.bank_id : null,
        amount: simple ? f.amount.replace(/,/g, "") : String(tDr),
      };
      const { data, error } = await sb().rpc("save_journal_entry", { p_id: id, p_header: header, p_lines: lines, p_idempotency_key: id ? null : idem.current });
      if (error) throw error;
      const nid = data as string;
      if (andPost) {
        const r = await sb().rpc("post_journal_entry", { p_id: nid });
        if (r.error) throw Object.assign(r.error, { savedId: nid });
      }
      return { nid, andPost };
    },
    onSuccess: ({ nid, andPost }) => {
      snapshot.current = JSON.stringify(f); idem.current = crypto.randomUUID();
      toast.success(andPost ? "Posted to the ledger" : "Draft saved"); qc.invalidateQueries(); onSaved(nid);
    },
    onError: (e: Error & { savedId?: string }) => {
      if (e.savedId) { snapshot.current = JSON.stringify(f); toast.error(`Saved as draft, but not posted: ${friendlyError(e)}`); qc.invalidateQueries(); onSaved(e.savedId); }
      else toast.error(friendlyError(e));
    },
  });
  const submit = (andPost: boolean) => {
    setShowErrors(true);
    if (Object.keys(errors).length) { toast.error("Please fix the highlighted fields"); return; }
    if (!save.isPending) save.mutate(andPost);
  };

  const setGrid = (key: string, patch: Partial<GridLine>) => set("grid", f.grid.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  return (
    <>
      <ErpDialog
        open onRequestClose={() => guard(onClose)} size="xl" icon={ENTRY_ICON[type]}
        title={id ? `Edit ${String(initial?.entry_no ?? "")}` : `New ${ENTRY_LABEL[type].toLowerCase()}`}
        status={<Badge tone="warning">Draft</Badge>}
        footer={
          <>
            {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
            <div className="flex-1" />
            <Button onClick={() => guard(onCancel)}>Cancel</Button>
            <Button icon={<Save className="h-3.5 w-3.5" />} loading={save.isPending && save.variables === false} disabled={save.isPending} onClick={() => submit(false)}>Save draft</Button>
            {can(P.journalsPost) && <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} loading={save.isPending && save.variables === true} disabled={save.isPending} onClick={() => submit(true)}>Save & post</Button>}
          </>
        }
      >
        {simple ? (
          <FormGrid cols={3}>
            {type === "TRANSFER" ? (
              <>
                <Field label="From (bank / cash)" required error={err("bank")}><BankPicker value={f.bank_id} onChange={(v) => set("bank_id", v)} invalid={!!err("bank")} /></Field>
                <Field label="To (bank / cash)" required error={err("to_bank")}><BankPicker value={f.to_bank_id} onChange={(v) => set("to_bank_id", v)} invalid={!!err("to_bank")} /></Field>
              </>
            ) : (
              <>
                <Field label={type === "RECEIPT" ? "Received from" : "Paid to"} required error={err("counter")} className="sm:col-span-2">
                  <div className="flex gap-2">
                    <div className="inline-flex shrink-0 rounded-control border border-line bg-subtle p-0.5" role="radiogroup">
                      {(["CUSTOMER", "SUPPLIER", "ACCOUNT"] as Counter[]).map((k) => (
                        <button key={k} type="button" role="radio" aria-checked={f.counter === k} onClick={() => setF((s) => ({ ...s, counter: k, party_id: null, account_id: null }))}
                          className={cn("h-[28px] rounded-[6px] px-2.5 text-xs font-medium", f.counter === k ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink")}>
                          {k === "CUSTOMER" ? "Customer" : k === "SUPPLIER" ? "Supplier" : type === "PAYMENT" ? "Expense / other" : "Other income"}
                        </button>
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      {f.counter === "ACCOUNT"
                        ? <AccountPicker value={f.account_id} onChange={(v) => set("account_id", v)} invalid={!!err("counter")} placeholder={type === "PAYMENT" ? "Expense account…" : "Income / other account…"} />
                        : <PartyPicker type={f.counter} value={f.party_id} onChange={(v) => set("party_id", v)} invalid={!!err("counter")} />}
                    </div>
                  </div>
                </Field>
                <Field label={type === "RECEIPT" ? "Into (bank / cash)" : "From (bank / cash)"} required error={err("bank")}><BankPicker value={f.bank_id} onChange={(v) => set("bank_id", v)} invalid={!!err("bank")} /></Field>
              </>
            )}
            <Field label="Amount (PKR)" required error={err("amount")}><Input inputMode="decimal" className="text-right tabular-nums text-base font-semibold" value={f.amount} invalid={!!err("amount")} onChange={(e) => set("amount", e.target.value)} /></Field>
            <Field label="Date" required><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
            <Field label="Reference"><Input value={f.reference} onChange={(e) => set("reference", e.target.value)} placeholder="Cheque / transaction no." /></Field>
            <Field label="Narration" className="sm:col-span-3"><Textarea rows={2} value={f.memo} onChange={(e) => set("memo", e.target.value)} placeholder="What is this for?" /></Field>
          </FormGrid>
        ) : (
          <>
            <FormGrid cols={3}>
              <Field label="Date" required><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
              <Field label="Reference"><Input value={f.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
              <div />
              <Field label="Narration" className="sm:col-span-3"><Textarea rows={2} value={f.memo} onChange={(e) => set("memo", e.target.value)} /></Field>
            </FormGrid>
            {type === "OPENING" && (
              <p className="mb-2 text-xs text-ink-muted">
                Enter what each customer owes (debit), what you owe each supplier (credit), and bank / cash balances (debit). The difference is balanced
                automatically against <b>Opening Balance Equity</b>.
              </p>
            )}
            <div className="space-y-2">
              <div className="hidden grid-cols-12 gap-2 px-2 text-2xs font-semibold uppercase tracking-wide text-ink-muted md:grid">
                <div className="col-span-4">Account</div><div className="col-span-3">Customer / supplier</div><div className="col-span-2 text-right">Debit</div><div className="col-span-2 text-right">Credit</div>
              </div>
              {f.grid.map((x) => {
                const need = x.account_id ? partyOf[x.account_id] : undefined;
                return (
                  <div key={x.key} className="grid grid-cols-12 items-start gap-2 rounded-control border border-line bg-surface p-2">
                    <div className="col-span-12 md:col-span-4">
                      <AccountPicker value={x.account_id} onChange={(v) => setGrid(x.key, { account_id: v, party_id: null })} invalid={!!err(`${x.key}.a`)} />
                      {err(`${x.key}.a`) && <p className="mt-0.5 text-2xs text-danger">{err(`${x.key}.a`)}</p>}
                    </div>
                    <div className="col-span-12 md:col-span-3">
                      {need ? <PartyPicker type={need} value={x.party_id} onChange={(v) => setGrid(x.key, { party_id: v })} invalid={!!err(`${x.key}.p`)} />
                        : <Input value={x.description} onChange={(e) => setGrid(x.key, { description: e.target.value })} placeholder="Description (optional)" />}
                      {err(`${x.key}.p`) && <p className="mt-0.5 text-2xs text-danger">{err(`${x.key}.p`)}</p>}
                    </div>
                    <div className="col-span-5 md:col-span-2"><Input inputMode="decimal" aria-label="Debit" placeholder="Debit" className="text-right tabular-nums" value={x.debit} onChange={(e) => setGrid(x.key, { debit: e.target.value, ...(e.target.value ? { credit: "" } : {}) })} /></div>
                    <div className="col-span-5 md:col-span-2"><Input inputMode="decimal" aria-label="Credit" placeholder="Credit" className="text-right tabular-nums" value={x.credit} onChange={(e) => setGrid(x.key, { credit: e.target.value, ...(e.target.value ? { debit: "" } : {}) })} /></div>
                    <div className="col-span-2 flex justify-end md:col-span-1">
                      {f.grid.length > 2 && <Button size="icon-sm" variant="ghost" aria-label="Remove line" onClick={() => set("grid", f.grid.filter((y) => y.key !== x.key))}><Trash2 className="h-3.5 w-3.5 text-ink-faint" /></Button>}
                    </div>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set("grid", [...f.grid, newGrid()])}>Add line</Button>
                <div className="ml-auto flex items-center gap-4 text-sm tabular-nums">
                  <span>Debit <b>{money(tDr)}</b></span><span>Credit <b>{money(tCr)}</b></span>
                  {Math.abs(tDr - tCr) >= 0.005 ? <Badge tone="danger">Difference {money(Math.abs(tDr - tCr))}</Badge> : tDr > 0 ? <Badge tone="success">Balanced</Badge> : null}
                </div>
              </div>
              {err("grid") && <p className="text-xs text-danger">{err("grid")}</p>}
            </div>
          </>
        )}
        {simple && amt > 0 && (
          <p className="mt-3 text-xs text-ink-muted">
            Ledger: {type === "RECEIPT" ? "bank / cash up, " + (f.counter === "CUSTOMER" ? "customer's balance down" : f.counter === "SUPPLIER" ? "supplier refund" : "income recorded")
              : type === "PAYMENT" ? "bank / cash down, " + (f.counter === "SUPPLIER" ? "what we owe the supplier goes down" : f.counter === "CUSTOMER" ? "customer refund" : "expense recorded")
              : "money moves between your own accounts"} — {money(amt)}.
          </p>
        )}
      </ErpDialog>
      {dialog}
    </>
  );
}
