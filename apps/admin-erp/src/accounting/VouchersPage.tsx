import { Plus, ShieldAlert } from "lucide-react";
import { Badge, Button, Card, DataTable, EmptyState, PageHeader } from "@jst/ui";
import { friendlyError, useAccess, useEntityList } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDate, humanize } from "@jst/utilities";
import { SearchBox, StatusFilter, useUrlState } from "../inventory/DocPage";
import { STATUS_TONE } from "../inventory/docConfigs";
import { ENTRY_LABEL, ENTRY_TONE, money, type EntryType } from "./common";
import { ENTRY_ICON, VoucherDialog } from "./VoucherDialog";

type Row = Record<string, unknown> & { id: string };
const PAGE = 50;
const TYPES: { label: string; type?: EntryType }[] = [
  { label: "All" }, { label: "Receipts", type: "RECEIPT" }, { label: "Payments", type: "PAYMENT" },
  { label: "Transfers", type: "TRANSFER" }, { label: "Journals", type: "JOURNAL" }, { label: "Opening", type: "OPENING" },
];
const STATUSES = [{ label: "All statuses" }, { label: "Drafts", s: "DRAFT" }, { label: "Posted", s: "POSTED" }, { label: "Reversed", s: "REVERSED" }, { label: "Cancelled", s: "CANCELLED" }];
const NEW: EntryType[] = ["RECEIPT", "PAYMENT", "TRANSFER", "JOURNAL", "OPENING"];

export function VouchersPage() {
  const { can, companyId } = useAccess();
  const { params, update } = useUrlState();
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const t = Number(params.get("t") ?? "0") || 0;
  const st = Number(params.get("s") ?? "0") || 0;
  const viewId = params.get("view");
  const newType = params.get("new") as EntryType | null;

  const list = useEntityList<Row>({
    table: "journal_entries_v",
    select: "id, entry_no, entry_date, entry_type, status, memo, reference, party_name, bank_name, amount, total_debit, source_type",
    companyId, search: q, searchColumns: ["entry_no", "reference", "memo", "party_name"],
    filters: { entry_type: TYPES[t].type, status: (STATUSES[st] as { s?: string }).s },
    orderBy: { column: "entry_date", ascending: false }, page, pageSize: PAGE, enabled: can(P.journalsView),
  });

  if (!can(P.journalsView)) return <Card><EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No access" description="You don't have permission to view accounting entries." /></Card>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Vouchers & Journals"
        description="Receipts, payments, bank / cash transfers, journals and opening balances. Every posted entry balances (debit = credit) and is corrected only by reversal."
        icon={ENTRY_ICON.JOURNAL}
        actions={can(P.journalsCreate) && (
          <div className="flex flex-wrap gap-1.5">
            {NEW.map((k) => (
              <Button key={k} variant={k === "RECEIPT" ? "primary" : "secondary"} icon={k === "RECEIPT" ? <Plus className="h-4 w-4" /> : undefined} onClick={() => update({ new: k, view: null })}>
                {k === "RECEIPT" ? "Receipt" : ENTRY_LABEL[k].replace("Bank / cash transfer", "Transfer")}
              </Button>
            ))}
          </div>
        )}
      />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <SearchBox value={q} onChange={(v) => update({ q: v || null, page: null })} placeholder="Search voucher no. / party / reference…" />
          <StatusFilter items={TYPES} value={t} onChange={(i) => update({ t: i ? String(i) : null, page: null })} />
          <StatusFilter items={STATUSES} value={st} onChange={(i) => update({ s: i ? String(i) : null, page: null })} />
        </div>
        {list.error ? <p className="p-4 text-sm text-danger">{friendlyError(list.error)}</p> : (
          <DataTable
            loading={list.isLoading} rows={list.data?.rows ?? []} onView={(r) => update({ view: r.id, new: null })}
            page={page} pageSize={PAGE} total={list.data?.total ?? null} onPageChange={(p) => update({ page: String(p) })}
            columns={[
              { key: "no", header: "Voucher", width: "130px", cell: (r) => <span className="whitespace-nowrap font-mono text-xs font-medium">{String(r.entry_no)}</span> },
              { key: "date", header: "Date", width: "110px", cell: (r) => <span className="whitespace-nowrap">{formatDate(r.entry_date as string)}</span> },
              { key: "type", header: "Type", width: "140px", cell: (r) => <Badge tone={ENTRY_TONE[r.entry_type as EntryType]}>{ENTRY_LABEL[r.entry_type as EntryType]}</Badge> },
              { key: "party", header: "Party / account", cell: (r) => <div className="min-w-0"><div className="truncate font-medium">{(r.party_name as string) ?? (r.bank_name as string) ?? <span className="text-ink-faint">—</span>}</div>{r.memo ? <div className="truncate text-2xs text-ink-muted">{String(r.memo)}</div> : null}</div> },
              { key: "ref", header: "Reference", hideBelow: "lg", cell: (r) => (r.reference as string) || "" },
              { key: "amt", header: "Amount", align: "right", width: "130px", cell: (r) => <span className="tabular-nums">{money((r.amount as number) ?? (r.total_debit as number))}</span> },
              { key: "status", header: "Status", width: "100px", cell: (r) => <Badge tone={STATUS_TONE[String(r.status)]}>{humanize(String(r.status))}</Badge> },
            ]}
            empty={<EmptyState icon={ENTRY_ICON.JOURNAL} title="No entries yet" description="Start with Opening balances, then record receipts and payments." />}
          />
        )}
      </Card>
      {(viewId || newType) && (
        <VoucherDialog id={viewId} newType={newType ?? undefined} onClose={() => update({ view: null, new: null })}
          onSaved={(id) => update({ view: id, new: null })} onOpen={(id) => update({ view: id, new: null })} />
      )}
    </div>
  );
}
