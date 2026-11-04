/**
 * Owner / management phone app (/o) — read-oriented (spec §3.5): today's numbers, stock, customer balances and
 * ledgers, sales, PDC cheques, shipments, cash & bank, and one controlled action: approving sales orders.
 * Same database functions as the office app (rpt_* reports, party_statement); nothing is calculated twice.
 */
import * as React from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, Banknote, Boxes, CheckCircle2, ChevronRight, FileText, Home, Landmark, Loader2, LogOut, Monitor,
  MoreHorizontal, Phone, RefreshCw, Search, Ship, ShoppingCart, TrendingDown, TrendingUp, Users,
} from "lucide-react";
import { Badge, Button, ConfirmDialog, Input, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { formatDate, formatNumber } from "@jst/utilities";
import { openWhatsApp } from "../sales/pdf";

type Tab = "home" | "stock" | "customers" | "sales" | "more";
const rs = (v: unknown) => `Rs ${formatNumber(Number(v ?? 0), 0)}`;
const short = (v: unknown) => {
  const x = Number(v ?? 0); const a = Math.abs(x);
  return a >= 10_000_000 ? `${(x / 10_000_000).toFixed(2)} Cr` : a >= 100_000 ? `${(x / 100_000).toFixed(1)} Lac` : formatNumber(x, 0);
};
const q = (v: unknown) => formatNumber(Number(v ?? 0), Number.isInteger(Number(v ?? 0)) ? 0 : 2);
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = (back = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back); return d.toISOString().slice(0, 10); };
const monthEnd = (back = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back + 1); d.setDate(0); return d.toISOString().slice(0, 10); };

export function OwnerApp() {
  const { session, sessionLoading, accessLoading, companies, company, companyId, can, signOut } = useAccess();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("t") as Tab) || "home";
  const sub = params.get("s");
  const go = (t: Tab, s?: string | null) => { const p = new URLSearchParams(); if (t !== "home") p.set("t", t); if (s) p.set("s", s); setParams(p); window.scrollTo(0, 0); };
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (sessionLoading || (session && accessLoading)) return <div className="flex h-dvh items-center justify-center bg-page"><Loader2 className="h-6 w-6 animate-spin text-ink-faint" /></div>;
  if (!session) return <Navigate to="/login" replace state={{ from: "/o" }} />;
  const allowed = companies.length > 0 && (can("sales.view") || can("journals.view") || can("inventory.view"));
  if (!allowed || !companyId) return <div className="p-6 text-center text-sm text-ink-muted">This account has no access to the management app.<div className="mt-3"><Button onClick={() => void signOut()}>Sign out</Button></div></div>;

  const TABS: { key: Tab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { key: "home", label: "Today", icon: <Home className="h-5 w-5" />, show: true },
    { key: "stock", label: "Stock", icon: <Boxes className="h-5 w-5" />, show: can("inventory.view") },
    { key: "customers", label: "Customers", icon: <Users className="h-5 w-5" />, show: can("journals.view") || can("sales.view_prices") },
    { key: "sales", label: "Sales", icon: <TrendingUp className="h-5 w-5" />, show: can("sales.view_prices") },
    { key: "more", label: "More", icon: <MoreHorizontal className="h-5 w-5" />, show: true },
  ];
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-page">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-white/95 px-3 py-2 backdrop-blur">
        {sub ? <button type="button" aria-label="Back" className="-ml-1 p-1" onClick={() => go(tab)}><ArrowLeft className="h-5 w-5" /></button> : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{company?.company_name ?? "JS Traders"}</div>
          <div className="text-2xs text-ink-muted">Management · {formatDate(today())}</div>
        </div>
        <button type="button" aria-label="Refresh" className="p-2 text-ink-muted" onClick={() => { void qc.invalidateQueries(); toast.success("Updated"); }}><RefreshCw className="h-4 w-4" /></button>
        <button type="button" aria-label="Office app" title="Open the full office app" className="p-2 text-ink-muted" onClick={() => navigate("/")}><Monitor className="h-4 w-4" /></button>
        <button type="button" aria-label="Sign out" className="p-2 text-ink-muted" onClick={() => void signOut()}><LogOut className="h-4 w-4" /></button>
      </header>
      <main className="flex-1 space-y-3 p-3 pb-24">
        {tab === "home" && <HomeTab companyId={companyId} go={go} />}
        {tab === "stock" && <StockTab companyId={companyId} />}
        {tab === "customers" && (sub ? <LedgerScreen partyId={sub} /> : <CustomersTab companyId={companyId} onOpen={(id) => go("customers", id)} />)}
        {tab === "sales" && <SalesTab companyId={companyId} />}
        {tab === "more" && (sub === "approve" ? <ApproveScreen companyId={companyId} /> : sub === "pdc" ? <PdcScreen companyId={companyId} />
          : sub === "ship" ? <ShipScreen companyId={companyId} /> : sub === "cash" ? <CashScreen companyId={companyId} /> : sub === "orders" ? <OpenOrdersScreen companyId={companyId} />
          : <MoreTab go={go} />)}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-xl border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
        {TABS.filter((t) => t.show).map((t) => (
          <button key={t.key} type="button" onClick={() => go(t.key)}
            className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-2xs", tab === t.key ? "font-semibold text-primary" : "text-ink-muted")}>
            {t.icon}{t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------- shared bits
function Tile({ label, value, sub, tone, onClick, icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad" | "warn"; onClick?: () => void; icon?: React.ReactNode }) {
  return (
    <button type="button" disabled={!onClick} onClick={onClick}
      className={cn("rounded-card border bg-white p-3 text-left shadow-card disabled:cursor-default", tone === "bad" ? "border-danger/40" : tone === "warn" ? "border-warning/50" : "border-line")}>
      <div className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-ink-muted">{icon}{label}</div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums", tone === "bad" && "text-danger", tone === "good" && "text-success")}>{value}</div>
      {sub && <div className="text-2xs text-ink-muted">{sub}</div>}
    </button>
  );
}
const Section = ({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <section className="rounded-card border border-line bg-white p-3 shadow-card">
    <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2>{action}</div>{children}
  </section>
);
const Busy = () => <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-ink-faint" /></div>;
const Err = ({ e }: { e: unknown }) => <p className="py-4 text-center text-sm text-danger">{friendlyError(e)}</p>;
function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-faint" /><Input className="pl-8" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></div>;
}
function useRpc<T>(key: unknown[], fn: string, args: Record<string, unknown>, enabled = true) {
  return useQuery({ queryKey: ["owner", fn, ...key], enabled, staleTime: 60_000, queryFn: async () => { const { data, error } = await sb().rpc(fn, args); if (error) throw error; return data as T; } });
}

// ---------------------------------------------------------------- today
interface Dash {
  sales_month?: number; sales_prev_month?: number; invoices_month?: number; overdue_receivable?: number; overdue_invoices?: number;
  sales_by_month?: { month: string; amount: number }[]; top_customers?: { name: string; amount: number }[];
  receivables?: number; payables?: number; cash_bank?: number; pdc_due_count?: number; pdc_due_amount?: number; pdc_week_amount?: number; pdc_bounced?: number;
  profit_month?: number; low_stock?: number; pending_picking?: number; stock_value?: number; open_orders?: number; orders_to_approve?: number; late_shipments?: number; shipments_in_transit?: number;
}
function HomeTab({ companyId, go }: { companyId: string; go: (t: Tab, s?: string | null) => void }) {
  const d = useRpc<Dash>([companyId], "rpt_dashboard", { p_company: companyId });
  if (d.isLoading) return <Busy />;
  if (d.error) return <Err e={d.error} />;
  const x = d.data ?? {};
  const has = (k: keyof Dash) => x[k] !== undefined;
  const growth = x.sales_prev_month ? ((Number(x.sales_month) - Number(x.sales_prev_month)) / Number(x.sales_prev_month)) * 100 : null;
  const months = x.sales_by_month ?? [];
  const max = Math.max(1, ...months.map((m) => Number(m.amount)));
  return (
    <>
      {(x.orders_to_approve ?? 0) > 0 && (
        <button type="button" onClick={() => go("more", "approve")} className="flex w-full items-center gap-2 rounded-card border border-warning/50 bg-warning/10 p-3 text-left text-sm">
          <ShoppingCart className="h-4 w-4 text-warning" /><span className="flex-1"><b>{x.orders_to_approve}</b> sales order{x.orders_to_approve === 1 ? "" : "s"} waiting for your approval</span><ChevronRight className="h-4 w-4" />
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        {has("sales_month") && <Tile label="Sales this month" value={short(x.sales_month)} onClick={() => go("sales")}
          sub={growth == null ? `${x.invoices_month ?? 0} invoices` : <span className={growth >= 0 ? "text-success" : "text-danger"}>{growth >= 0 ? "▲" : "▼"} {Math.abs(growth).toFixed(0)}% vs last month</span>} />}
        {has("profit_month") && <Tile label="Profit this month" value={short(x.profit_month)} tone={Number(x.profit_month) < 0 ? "bad" : "good"} sub="from the accounts" />}
        {has("receivables") && <Tile label="Customers owe" value={short(x.receivables)} onClick={() => go("customers")} sub={has("overdue_receivable") ? `${short(x.overdue_receivable)} overdue` : undefined} tone={Number(x.overdue_receivable) > 0 ? "warn" : undefined} />}
        {has("payables") && <Tile label="We owe suppliers" value={short(x.payables)} />}
        {has("cash_bank") && <Tile label="Cash & bank" value={short(x.cash_bank)} onClick={() => go("more", "cash")} icon={<Landmark className="h-3 w-3" />} />}
        {has("stock_value") && <Tile label="Stock value" value={short(x.stock_value)} onClick={() => go("stock")} />}
        {has("pdc_due_count") && <Tile label="Cheques due" value={x.pdc_due_count ?? 0} onClick={() => go("more", "pdc")} tone={(x.pdc_bounced ?? 0) > 0 ? "bad" : (x.pdc_due_count ?? 0) > 0 ? "warn" : undefined}
          sub={`${short(x.pdc_due_amount)} to deposit · ${short(x.pdc_week_amount)} next 7 days${(x.pdc_bounced ?? 0) > 0 ? ` · ${x.pdc_bounced} bounced` : ""}`} />}
        {has("open_orders") && <Tile label="Open orders" value={x.open_orders ?? 0} onClick={() => go("more", "orders")} sub={has("pending_picking") ? `${x.pending_picking} picking now` : undefined} />}
        {has("shipments_in_transit") && <Tile label="Shipments" value={x.shipments_in_transit ?? 0} onClick={() => go("more", "ship")} tone={(x.late_shipments ?? 0) > 0 ? "warn" : undefined}
          sub={(x.late_shipments ?? 0) > 0 ? `${x.late_shipments} late` : "in transit"} icon={<Ship className="h-3 w-3" />} />}
        {has("low_stock") && <Tile label="Below reorder level" value={x.low_stock ?? 0} onClick={() => go("stock")} tone={(x.low_stock ?? 0) > 0 ? "warn" : undefined} sub="items" />}
      </div>
      {months.length > 0 && (
        <Section title="Sales — last 12 months">
          <div className="flex h-28 items-end gap-1">
            {months.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${m.month}: ${rs(m.amount)}`}>
                <div className="w-full rounded-t bg-primary/70" style={{ height: `${Math.max(2, (Number(m.amount) / max) * 100)}%` }} />
                <span className="text-[9px] text-ink-faint">{m.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {!!x.top_customers?.length && (
        <Section title="Top customers this month">
          {x.top_customers.map((c) => <div key={c.name} className="flex justify-between border-b border-line/60 py-1.5 text-sm last:border-0"><span className="truncate">{c.name}</span><span className="tabular-nums">{rs(c.amount)}</span></div>)}
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- stock
interface StockRow { product_id: string; variant_id: string | null; sku: string; item: string; variant: string | null; warehouse: string; uom: string; qty: number; reserved: number; available: number; below_reorder: boolean; value: number | null }
function StockTab({ companyId }: { companyId: string }) {
  const r = useRpc<StockRow[]>([companyId], "rpt_stock_summary", { p_company: companyId, p_as_of: null, p_warehouse: null });
  const [s, setS] = React.useState("");
  const [only, setOnly] = React.useState<"all" | "neg" | "low">("all");
  const groups = React.useMemo(() => {
    const m = new Map<string, { key: string; sku: string; item: string; variant: string | null; uom: string; total: number; avail: number; value: number; low: boolean; wh: { wh: string; qty: number; avail: number }[] }>();
    for (const x of r.data ?? []) {
      const k = `${x.product_id}|${x.variant_id ?? ""}`;
      const g = m.get(k) ?? { key: k, sku: x.sku, item: x.item, variant: x.variant, uom: x.uom, total: 0, avail: 0, value: 0, low: false, wh: [] };
      g.total += Number(x.qty); g.avail += Number(x.available); g.value += Number(x.value ?? 0); g.low = g.low || x.below_reorder;
      if (x.warehouse) g.wh.push({ wh: x.warehouse, qty: Number(x.qty), avail: Number(x.available) });
      m.set(k, g);
    }
    const t = s.trim().toLowerCase();
    return [...m.values()].filter((g) => (!t || `${g.sku} ${g.item} ${g.variant ?? ""}`.toLowerCase().includes(t))
      && (only === "all" || (only === "neg" ? g.total < 0 : g.low))).sort((a, b) => a.item.localeCompare(b.item) || (a.variant ?? "").localeCompare(b.variant ?? ""));
  }, [r.data, s, only]);
  const neg = (r.data ?? []).filter((x) => Number(x.qty) < 0).length;
  return (
    <>
      <SearchField value={s} onChange={setS} placeholder="Search item or SKU…" />
      <div className="flex gap-1">
        {([["all", "All"], ["neg", `Negative${neg ? ` (${neg})` : ""}`], ["low", "Below reorder"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setOnly(k)} className={cn("rounded-full border px-3 py-1 text-xs", only === k ? "border-primary bg-primary text-white" : "border-line bg-white")}>{l}</button>
        ))}
      </div>
      {r.isLoading ? <Busy /> : r.error ? <Err e={r.error} /> : (
        <div className="space-y-1.5">
          {groups.map((g) => (
            <div key={g.key} className="rounded-card border border-line bg-white p-2.5 shadow-card">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{g.item}{g.variant && <span className="font-normal text-ink-muted"> · {g.variant}</span>}</div>
                  <div className="text-2xs text-ink-faint">{g.sku}{g.value ? ` · ${rs(g.value)}` : ""}</div>
                </div>
                <div className="text-right">
                  <div className={cn("text-sm font-semibold tabular-nums", g.total < 0 && "text-danger")}>{q(g.total)} <span className="text-2xs font-normal text-ink-faint">{g.uom}</span></div>
                  {g.avail !== g.total && <div className="text-2xs text-ink-muted">{q(g.avail)} free</div>}
                </div>
              </div>
              {g.wh.length > 1 && <div className="mt-1 flex flex-wrap gap-1">{g.wh.map((w) => <span key={w.wh} className="rounded bg-subtle px-1.5 py-0.5 text-2xs tabular-nums">{w.wh} {q(w.qty)}</span>)}</div>}
            </div>
          ))}
          {!groups.length && <p className="py-6 text-center text-sm text-ink-muted">Nothing here.</p>}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- customers + ledger
interface Aging { party_id: string; code: string; name: string; city: string | null; balance: number; not_due: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; oldest_due: string | null }
function CustomersTab({ companyId, onOpen }: { companyId: string; onOpen: (id: string) => void }) {
  const r = useRpc<Aging[]>([companyId, "CUSTOMER"], "rpt_aging", { p_company: companyId, p_party_type: "CUSTOMER", p_as_of: null });
  const [s, setS] = React.useState("");
  const rows = (r.data ?? []).filter((x) => Number(x.balance) !== 0 && (!s.trim() || `${x.name} ${x.code} ${x.city ?? ""}`.toLowerCase().includes(s.trim().toLowerCase())))
    .sort((a, b) => Number(b.balance) - Number(a.balance));
  const total = rows.reduce((a, x) => a + Number(x.balance), 0);
  const over = rows.reduce((a, x) => a + Number(x.d31_60) + Number(x.d61_90) + Number(x.d90_plus), 0);
  return (
    <>
      <div className="grid grid-cols-2 gap-2"><Tile label="Customers owe" value={short(total)} /><Tile label="Over 30 days" value={short(over)} tone={over > 0 ? "warn" : undefined} /></div>
      <SearchField value={s} onChange={setS} placeholder="Search customer…" />
      {r.isLoading ? <Busy /> : r.error ? <Err e={r.error} /> : (
        <div className="space-y-1.5">
          {rows.map((x) => {
            const late = Number(x.d31_60) + Number(x.d61_90) + Number(x.d90_plus);
            return (
              <button key={x.party_id} type="button" onClick={() => onOpen(x.party_id)} className="flex w-full items-center gap-2 rounded-card border border-line bg-white p-2.5 text-left shadow-card">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{x.name}</div>
                  <div className="text-2xs text-ink-muted">{x.city ?? x.code}{late > 0 && <span className="text-warning"> · {short(late)} over 30 days</span>}{Number(x.d90_plus) > 0 && <span className="text-danger"> · {short(x.d90_plus)} over 90</span>}</div>
                </div>
                <div className={cn("text-sm font-semibold tabular-nums", Number(x.balance) < 0 && "text-success")}>{short(x.balance)}</div>
                <ChevronRight className="h-4 w-4 text-ink-faint" />
              </button>
            );
          })}
          {!rows.length && <p className="py-6 text-center text-sm text-ink-muted">No customer balances.</p>}
        </div>
      )}
    </>
  );
}

interface StRow { row_kind: string; entry_no: string | null; entry_date: string | null; entry_type: string | null; memo: string | null; reference: string | null; debit: number; credit: number; balance: number }
function LedgerScreen({ partyId }: { partyId: string }) {
  const cust = useQuery({
    queryKey: ["owner", "customer", partyId],
    queryFn: async () => { const { data, error } = await sb().from("customers").select("id, name, code, city, phone, whatsapp").eq("id", partyId).single(); if (error) throw error; return data as { name: string; code: string; city: string | null; phone: string | null; whatsapp: string | null }; },
  });
  const from = (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); })();
  const st = useRpc<StRow[]>([partyId, from], "party_statement", { p_party_type: "CUSTOMER", p_party_id: partyId, p_from: from, p_to: null, p_include_linked: false });
  const rows = st.data ?? [];
  const closing = rows.length ? Number(rows[rows.length - 1].balance) : 0;
  const c = cust.data;
  const phone = c?.whatsapp || c?.phone || null;
  return (
    <>
      <Section title={c?.name ?? "Customer"} action={<span className="text-xs text-ink-muted">{c?.city ?? c?.code}</span>}>
        <div className="flex items-end justify-between">
          <div><div className="text-2xs uppercase tracking-wide text-ink-muted">Balance</div><div className={cn("text-2xl font-semibold tabular-nums", closing < 0 && "text-success")}>{rs(closing)}</div>{closing < 0 && <div className="text-2xs text-success">advance (we owe them)</div>}</div>
          <div className="flex gap-2">
            {c?.phone && <a href={`tel:${c.phone}`} className="rounded-full border border-line p-2" aria-label="Call"><Phone className="h-4 w-4" /></a>}
            {phone && <button type="button" aria-label="WhatsApp" className="rounded-full border border-[#25D366] p-2 text-[#128C7E]"
              onClick={() => openWhatsApp(phone, `Assalam-o-Alaikum ${c?.name ?? ""}, your balance with us is ${rs(closing)}. Kindly arrange payment. Thank you.`)}><Banknote className="h-4 w-4" /></button>}
          </div>
        </div>
      </Section>
      <Section title="Last 6 months">
        {st.isLoading ? <Busy /> : st.error ? <Err e={st.error} /> : (
          <div className="divide-y divide-line/60">
            {rows.map((x, i) => (
              <div key={i} className={cn("flex gap-2 py-1.5 text-sm", x.row_kind !== "TXN" && "font-medium text-ink-muted")}>
                <div className="w-16 shrink-0 text-2xs text-ink-muted">{x.entry_date ? formatDate(x.entry_date) : ""}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{x.row_kind === "OPENING" ? "Brought forward" : x.row_kind === "CLOSING" ? "Balance" : x.memo || x.entry_type || x.entry_no}</div>
                  {x.row_kind === "TXN" && <div className="text-2xs text-ink-faint">{x.entry_no}{x.reference ? ` · ${x.reference}` : ""}</div>}
                </div>
                <div className="w-20 text-right tabular-nums">{Number(x.debit) ? <span>{short(x.debit)}</span> : Number(x.credit) ? <span className="text-success">−{short(x.credit)}</span> : null}</div>
                <div className="w-20 text-right font-medium tabular-nums">{short(x.balance)}</div>
              </div>
            ))}
            {!rows.length && <p className="py-4 text-center text-sm text-ink-muted">No entries.</p>}
          </div>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- sales
interface SaleRow { invoice_id: string; doc_no: string; invoice_date: string; customer: string; total: number; outstanding: number; payment_status: string; margin: number | null; margin_pct: number | null }
function SalesTab({ companyId }: { companyId: string }) {
  const [p, setP] = React.useState<"today" | "month" | "last">("month");
  const range = p === "today" ? [today(), today()] : p === "month" ? [monthStart(0), today()] : [monthStart(1), monthEnd(1)];
  const r = useRpc<SaleRow[]>([companyId, ...range], "rpt_sales_register", { p_company: companyId, p_from: range[0], p_to: range[1], p_customer: null });
  const rows = [...(r.data ?? [])].sort((a, b) => b.invoice_date.localeCompare(a.invoice_date) || b.doc_no.localeCompare(a.doc_no));
  const total = rows.reduce((a, x) => a + Number(x.total), 0);
  const unpaid = rows.reduce((a, x) => a + Number(x.outstanding), 0);
  const margin = rows.reduce((a, x) => a + Number(x.margin ?? 0), 0);
  return (
    <>
      <div className="flex gap-1">
        {([["today", "Today"], ["month", "This month"], ["last", "Last month"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setP(k)} className={cn("rounded-full border px-3 py-1 text-xs", p === k ? "border-primary bg-primary text-white" : "border-line bg-white")}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Sales" value={short(total)} sub={`${rows.length} invoices`} />
        <Tile label="Unpaid" value={short(unpaid)} tone={unpaid > 0 ? "warn" : undefined} />
        <Tile label="Margin" value={short(margin)} sub={total ? `${((margin / total) * 100).toFixed(0)}%` : undefined} tone={margin < 0 ? "bad" : "good"} />
      </div>
      {r.isLoading ? <Busy /> : r.error ? <Err e={r.error} /> : (
        <div className="space-y-1.5">
          {rows.map((x) => (
            <div key={x.invoice_id} className="flex items-center gap-2 rounded-card border border-line bg-white p-2.5 shadow-card">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{x.customer}</div>
                <div className="text-2xs text-ink-muted">{x.doc_no} · {formatDate(x.invoice_date)}{x.margin_pct != null && ` · margin ${Number(x.margin_pct).toFixed(0)}%`}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">{short(x.total)}</div>
                {Number(x.outstanding) > 0 ? <Badge tone="warning">{short(x.outstanding)} due</Badge> : <Badge tone="success">paid</Badge>}
              </div>
            </div>
          ))}
          {!rows.length && <p className="py-6 text-center text-sm text-ink-muted">No invoices in this period.</p>}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- more
function MoreTab({ go }: { go: (t: Tab, s?: string | null) => void }) {
  const { can } = useAccess();
  const items: { s: string; label: string; sub: string; icon: React.ReactNode; show: boolean }[] = [
    { s: "approve", label: "Approve sales orders", sub: "Orders waiting for approval", icon: <CheckCircle2 className="h-5 w-5 text-success" />, show: can("sales.approve") },
    { s: "orders", label: "Open orders", sub: "Approved, not fully delivered", icon: <ShoppingCart className="h-5 w-5 text-primary" />, show: can("sales.view") },
    { s: "pdc", label: "Post-dated cheques", sub: "Due, upcoming and bounced", icon: <FileText className="h-5 w-5 text-warning" />, show: can("journals.view") },
    { s: "ship", label: "Shipments", sub: "In transit, ETA, late", icon: <Ship className="h-5 w-5 text-info" />, show: can("purchasing.view") },
    { s: "cash", label: "Cash & bank", sub: "This month in / out and balances", icon: <Landmark className="h-5 w-5 text-ink-muted" />, show: can("journals.view") },
  ];
  return (
    <div className="space-y-1.5">
      {items.filter((i) => i.show).map((i) => (
        <button key={i.s} type="button" onClick={() => go("more", i.s)} className="flex w-full items-center gap-3 rounded-card border border-line bg-white p-3 text-left shadow-card">
          {i.icon}<div className="flex-1"><div className="text-sm font-medium">{i.label}</div><div className="text-2xs text-ink-muted">{i.sub}</div></div><ChevronRight className="h-4 w-4 text-ink-faint" />
        </button>
      ))}
      <p className="pt-2 text-center text-2xs text-ink-faint">Tip: in Chrome use “Add to Home screen” to keep this app on your phone.</p>
    </div>
  );
}

interface DraftSo { id: string; doc_no: string; order_date: string; customer: { name: string } | null; lines: { count: number }[] }
function ApproveScreen({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["owner", "so-draft", companyId],
    queryFn: async () => {
      const { data, error } = await sb().from("sales_orders").select("id, doc_no, order_date, customer:customers(name), lines:sales_order_lines(count)").eq("company_id", companyId).eq("status", "DRAFT").order("created_at");
      if (error) throw error;
      const rows = (data ?? []) as unknown as DraftSo[];
      const pr = rows.length ? await sb().rpc("so_line_prices", { p_so_ids: rows.map((r) => r.id) }) : { data: [] };
      const ql = rows.length ? await sb().from("sales_order_lines").select("id, sales_order_id, quantity").in("sales_order_id", rows.map((r) => r.id)).eq("is_active", true) : { data: [] };
      const pm = new Map(((pr.data ?? []) as { line_id: string; unit_price: number | null }[]).map((x) => [x.line_id, x.unit_price]));
      const val = new Map<string, number>();
      for (const l of (ql.data ?? []) as { id: string; sales_order_id: string; quantity: number }[]) val.set(l.sales_order_id, (val.get(l.sales_order_id) ?? 0) + Number(l.quantity) * Number(pm.get(l.id) ?? 0));
      return rows.map((r) => ({ ...r, value: val.get(r.id) ?? 0 }));
    },
  });
  const [ask, setAsk] = React.useState<{ id: string; doc_no: string } | null>(null);
  const approve = useMutation({
    mutationFn: async (id: string) => { const { error } = await sb().rpc("approve_sales_order", { p_id: id }); if (error) throw error; },
    onSuccess: () => { toast.success("Approved — stock reserved, the warehouse can pick it"); setAsk(null); void qc.invalidateQueries(); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <Section title="Sales orders waiting for approval">
      {list.isLoading ? <Busy /> : list.error ? <Err e={list.error} /> : (
        <div className="space-y-1.5">
          {(list.data ?? []).map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-control border border-line p-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.customer?.name}</div>
                <div className="text-2xs text-ink-muted">{r.doc_no} · {formatDate(r.order_date)} · {r.lines?.[0]?.count ?? 0} items{r.value ? ` · ${rs(r.value)}` : ""}</div>
              </div>
              <Button size="sm" variant="primary" onClick={() => setAsk({ id: r.id, doc_no: r.doc_no })}>Approve</Button>
            </div>
          ))}
          {!list.data?.length && <p className="py-4 text-center text-sm text-ink-muted">Nothing waiting. 👍</p>}
        </div>
      )}
      <ConfirmDialog open={!!ask} title={`Approve ${ask?.doc_no ?? ""}?`} message="Stock is reserved and the order is released to the warehouse." confirmLabel="Approve"
        loading={approve.isPending} onCancel={() => setAsk(null)} onConfirm={() => ask && approve.mutate(ask.id)} />
    </Section>
  );
}

interface OpenRow { sales_order_id: string; doc_no: string; order_date: string; age_days: number; customer: string; item: string; variant: string | null; open_qty: number; open_value: number | null }
function OpenOrdersScreen({ companyId }: { companyId: string }) {
  const r = useRpc<OpenRow[]>([companyId], "rpt_pending_orders", { p_company: companyId, p_customer: null });
  const orders = React.useMemo(() => {
    const m = new Map<string, { id: string; doc_no: string; date: string; age: number; customer: string; items: number; value: number }>();
    for (const x of r.data ?? []) {
      const o = m.get(x.sales_order_id) ?? { id: x.sales_order_id, doc_no: x.doc_no, date: x.order_date, age: x.age_days, customer: x.customer, items: 0, value: 0 };
      o.items += 1; o.value += Number(x.open_value ?? 0); m.set(x.sales_order_id, o);
    }
    return [...m.values()].sort((a, b) => b.age - a.age);
  }, [r.data]);
  return (
    <Section title="Open orders (still to deliver)">
      {r.isLoading ? <Busy /> : r.error ? <Err e={r.error} /> : (
        <div className="space-y-1.5">
          {orders.map((o) => (
            <div key={o.id} className="flex items-center gap-2 rounded-control border border-line p-2.5">
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{o.customer}</div><div className="text-2xs text-ink-muted">{o.doc_no} · {formatDate(o.date)} · {o.items} items open</div></div>
              <div className="text-right">{o.value ? <div className="text-sm tabular-nums">{short(o.value)}</div> : null}<Badge tone={o.age > 7 ? "danger" : o.age > 2 ? "warning" : "info"}>{o.age} days</Badge></div>
            </div>
          ))}
          {!orders.length && <p className="py-4 text-center text-sm text-ink-muted">Everything is delivered.</p>}
        </div>
      )}
    </Section>
  );
}

interface Pdc { id: string; doc_no: string; direction: string; party_type: string; party_id: string; cheque_no: string; cheque_date: string; amount: number; status: string; drawer_bank: string | null; bounce_reason: string | null }
function PdcScreen({ companyId }: { companyId: string }) {
  const list = useQuery({
    queryKey: ["owner", "pdc", companyId],
    queryFn: async () => {
      const { data, error } = await sb().from("pdc_records").select("id, doc_no, direction, party_type, party_id, cheque_no, cheque_date, amount, status, drawer_bank, bounce_reason")
        .eq("company_id", companyId).in("status", ["HELD", "DEPOSITED", "BOUNCED"]).order("cheque_date").limit(300);
      if (error) throw error;
      const rows = (data ?? []) as Pdc[];
      const cIds = rows.filter((r) => r.party_type === "CUSTOMER").map((r) => r.party_id);
      const sIds = rows.filter((r) => r.party_type === "SUPPLIER").map((r) => r.party_id);
      const [c, s] = await Promise.all([
        cIds.length ? sb().from("customers").select("id, name").in("id", cIds) : Promise.resolve({ data: [] }),
        sIds.length ? sb().from("suppliers").select("id, name").in("id", sIds) : Promise.resolve({ data: [] }),
      ]);
      const names = new Map([...((c.data ?? []) as { id: string; name: string }[]), ...((s.data ?? []) as { id: string; name: string }[])].map((x) => [x.id, x.name]));
      return rows.map((r) => ({ ...r, party: names.get(r.party_id) ?? "" }));
    },
  });
  const t = today();
  const rows = list.data ?? [];
  const groups: { title: string; tone: "danger" | "warning" | "info" | "neutral"; rows: typeof rows }[] = [
    { title: "Bounced", tone: "danger", rows: rows.filter((r) => r.status === "BOUNCED") },
    { title: "Due now — to deposit / pay", tone: "warning", rows: rows.filter((r) => r.status === "HELD" && r.cheque_date <= t) },
    { title: "Deposited, waiting to clear", tone: "info", rows: rows.filter((r) => r.status === "DEPOSITED") },
    { title: "Upcoming", tone: "neutral", rows: rows.filter((r) => r.status === "HELD" && r.cheque_date > t) },
  ];
  return list.isLoading ? <Busy /> : list.error ? <Err e={list.error} /> : (
    <>
      {groups.filter((g) => g.rows.length).map((g) => (
        <Section key={g.title} title={g.title} action={<span className="text-xs tabular-nums text-ink-muted">{rs(g.rows.reduce((a, r) => a + Number(r.amount), 0))}</span>}>
          <div className="space-y-1.5">
            {g.rows.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-control border border-line p-2">
                {r.direction === "RECEIVED" ? <TrendingUp className="h-4 w-4 shrink-0 text-success" /> : <TrendingDown className="h-4 w-4 shrink-0 text-danger" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{r.party || r.doc_no}</div>
                  <div className="text-2xs text-ink-muted">Chq {r.cheque_no}{r.drawer_bank ? ` · ${r.drawer_bank}` : ""} · {formatDate(r.cheque_date)}{r.bounce_reason ? ` · ${r.bounce_reason}` : ""}</div>
                </div>
                <div className="text-right"><div className="text-sm font-semibold tabular-nums">{short(r.amount)}</div><Badge tone={g.tone}>{r.direction === "RECEIVED" ? "in" : "out"}</Badge></div>
              </div>
            ))}
          </div>
        </Section>
      ))}
      {!rows.length && <p className="py-6 text-center text-sm text-ink-muted">No open cheques.</p>}
    </>
  );
}

interface ShipRow { shipment_id: string; doc_no: string; supplier: string; mode: string; status: string; bl_no: string | null; etd: string | null; eta: string | null; ata: string | null; late: boolean; days_late: number | null; goods_value_pkr: number | null }
function ShipScreen({ companyId }: { companyId: string }) {
  const from = (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); })();
  const r = useRpc<ShipRow[]>([companyId, from], "rpt_shipments", { p_company: companyId, p_from: from, p_to: today() });
  const rows = (r.data ?? []).filter((x) => !["DELIVERED", "CANCELLED"].includes(x.status)).sort((a, b) => (a.eta ?? "9").localeCompare(b.eta ?? "9"));
  return (
    <Section title="Shipments on the way">
      {r.isLoading ? <Busy /> : r.error ? <Err e={r.error} /> : (
        <div className="space-y-1.5">
          {rows.map((x) => (
            <div key={x.shipment_id} className={cn("rounded-control border p-2.5", x.late ? "border-warning/60" : "border-line")}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{x.supplier}</div><div className="text-2xs text-ink-muted">{x.doc_no} · {x.mode}{x.bl_no ? ` · BL ${x.bl_no}` : ""}</div></div>
                <Badge tone={x.late ? "warning" : "info"}>{x.status.toLowerCase().replace(/_/g, " ")}</Badge>
              </div>
              <div className="mt-1 flex justify-between text-xs">
                <span className="text-ink-muted">ETD {x.etd ? formatDate(x.etd) : "—"} · ETA <b className={cn(x.late && "text-warning")}>{x.eta ? formatDate(x.eta) : "—"}</b>{x.late && x.days_late ? ` (${x.days_late} days late)` : ""}</span>
                {x.goods_value_pkr ? <span className="tabular-nums">{short(x.goods_value_pkr)}</span> : null}
              </div>
            </div>
          ))}
          {!rows.length && <p className="py-4 text-center text-sm text-ink-muted">No shipments on the way.</p>}
        </div>
      )}
    </Section>
  );
}

interface CashRow { bank_account_id: string; code: string; name: string; kind: string; currency: string; opening: number; money_in: number; money_out: number; closing: number; unmatched_items: number }
function CashScreen({ companyId }: { companyId: string }) {
  const r = useRpc<CashRow[]>([companyId, monthStart(0)], "rpt_cash_bank_summary", { p_company: companyId, p_from: monthStart(0), p_to: today() });
  const rows = r.data ?? [];
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Tile label="In this month" value={short(rows.reduce((a, x) => a + Number(x.money_in), 0))} tone="good" />
        <Tile label="Out this month" value={short(rows.reduce((a, x) => a + Number(x.money_out), 0))} />
        <Tile label="Balance now" value={short(rows.reduce((a, x) => a + Number(x.closing), 0))} />
      </div>
      <Section title="Accounts">
        {r.isLoading ? <Busy /> : r.error ? <Err e={r.error} /> : rows.map((x) => (
          <div key={x.bank_account_id} className="flex items-center justify-between border-b border-line/60 py-2 text-sm last:border-0">
            <div><div className="font-medium">{x.name}</div><div className="text-2xs text-ink-muted">in {short(x.money_in)} · out {short(x.money_out)}{x.unmatched_items ? <span className="text-warning"> · {x.unmatched_items} to reconcile</span> : null}</div></div>
            <div className={cn("font-semibold tabular-nums", Number(x.closing) < 0 && "text-danger")}>{x.currency !== "PKR" ? `${x.currency} ` : ""}{short(x.closing)}</div>
          </div>
        ))}
        {!r.isLoading && !rows.length && <p className="py-3 text-center text-sm text-ink-muted"><AlertTriangle className="mr-1 inline h-4 w-4" />No bank accounts.</p>}
      </Section>
    </>
  );
}
