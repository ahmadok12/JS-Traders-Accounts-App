import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, BarChart3, Banknote, Boxes, CalendarClock, ChevronRight, ClipboardList, Coins, HandCoins, Landmark, Ship, ShoppingCart, TrendingUp, Wallet } from "lucide-react";
import { Card, PageHeader, Skeleton, cn } from "@jst/ui";
import { sb, useAccess } from "@jst/data-access";
import { formatNumber } from "@jst/utilities";

interface Dash {
  sales_month?: number; sales_prev_month?: number; invoices_month?: number; overdue_receivable?: number; overdue_invoices?: number;
  sales_by_month?: { month: string; amount: number }[]; top_customers?: { name: string; amount: number }[];
  receivables?: number; payables?: number; cash_bank?: number; pdc_due_count?: number; pdc_due_amount?: number; pdc_week_amount?: number; pdc_bounced?: number;
  bank_unmatched?: number; profit_month?: number; low_stock?: number; pending_picking?: number; stock_value?: number; open_orders?: number; orders_to_approve?: number;
  late_shipments?: number; shipments_in_transit?: number;
}
const m = (v?: number) => formatNumber(Number(v ?? 0), 0);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function DashboardPage() {
  const { companyId, company } = useAccess();
  const q = useQuery({ queryKey: ["dashboard", companyId], enabled: !!companyId, staleTime: 60_000, refetchInterval: 5 * 60_000,
    queryFn: async () => { const { data, error } = await sb().rpc("rpt_dashboard", { p_company: companyId }); if (error) throw error; return (data ?? {}) as Dash; } });
  const d = q.data ?? {};
  const has = (k: keyof Dash) => d[k] !== undefined;
  const change = has("sales_prev_month") && Number(d.sales_prev_month) > 0 ? ((Number(d.sales_month) - Number(d.sales_prev_month)) / Number(d.sales_prev_month)) * 100 : null;

  const kpis = [
    has("sales_month") && { label: "Sales this month", value: `PKR ${m(d.sales_month)}`, sub: change == null ? `${d.invoices_month ?? 0} invoices` : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(0)}% vs last month`, icon: TrendingUp, to: "/reports/sales_register" },
    has("profit_month") && { label: "Profit this month (books)", value: `PKR ${m(d.profit_month)}`, sub: "income − costs − expenses", icon: Coins, to: "/reports/profit_loss" },
    has("receivables") && { label: "Customers owe", value: `PKR ${m(d.receivables)}`, sub: has("overdue_receivable") ? `${m(d.overdue_receivable)} overdue` : undefined, icon: HandCoins, to: "/reports/customer_aging", hot: Number(d.overdue_receivable) > 0 },
    has("payables") && { label: "We owe suppliers", value: `PKR ${m(d.payables)}`, icon: Landmark, to: "/reports/supplier_aging" },
    has("cash_bank") && { label: "Cash & bank", value: `PKR ${m(d.cash_bank)}`, sub: Number(d.pdc_week_amount) > 0 ? `+ ${m(d.pdc_week_amount)} cheques due in 7 days` : undefined, icon: Wallet, to: "/reports/cash_bank_summary" },
    has("stock_value") && { label: "Stock value", value: `PKR ${m(d.stock_value)}`, icon: Boxes, to: "/stock-valuation" },
    has("open_orders") && { label: "Open sales orders", value: m(d.open_orders), sub: Number(d.orders_to_approve) ? `${d.orders_to_approve} waiting approval` : undefined, icon: ShoppingCart, to: "/reports/pending_orders" },
    has("shipments_in_transit") && { label: "Shipments on the way", value: m(d.shipments_in_transit), sub: Number(d.late_shipments) ? `${d.late_shipments} late` : undefined, icon: Ship, to: "/reports/shipments", hot: Number(d.late_shipments) > 0 },
  ].filter(Boolean) as { label: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }>; to: string; hot?: boolean }[];

  const alerts = [
    Number(d.pdc_due_count) > 0 && { text: `${d.pdc_due_count} cheque(s) due — PKR ${m(d.pdc_due_amount)} to deposit`, to: "/pdc?f=1", icon: CalendarClock },
    Number(d.pdc_bounced) > 0 && { text: `${d.pdc_bounced} bounced cheque(s) to follow up`, to: "/pdc?f=3", icon: AlertTriangle },
    Number(d.overdue_invoices) > 0 && { text: `${d.overdue_invoices} overdue invoice(s) — PKR ${m(d.overdue_receivable)}`, to: "/reports/customer_open_invoices", icon: HandCoins },
    Number(d.orders_to_approve) > 0 && { text: `${d.orders_to_approve} sales order(s) waiting for approval`, to: "/sales-orders", icon: ShoppingCart },
    Number(d.pending_picking) > 0 && { text: `${d.pending_picking} picking task(s) open`, to: "/picking", icon: ClipboardList },
    Number(d.low_stock) > 0 && { text: `${d.low_stock} item(s) at or below reorder level`, to: "/reports/low_stock", icon: Boxes },
    Number(d.late_shipments) > 0 && { text: `${d.late_shipments} shipment(s) past ETA`, to: "/reports/shipments", icon: Ship },
    Number(d.bank_unmatched) > 0 && { text: `${d.bank_unmatched} bank statement line(s) not reconciled`, to: "/bank-reconciliation", icon: Banknote },
  ].filter(Boolean) as { text: string; to: string; icon: React.ComponentType<{ className?: string }> }[];

  return (
    <div>
      <PageHeader title="Dashboard" description={company?.company_name} />
      {q.isLoading ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}</div> : (
        <>
          {kpis.length > 0 && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map((k) => (
              <Link key={k.label} to={k.to}>
                <Card className={cn("h-full p-4 transition-colors hover:border-line-strong", k.hot && "border-amber-200")}>
                  <div className="flex items-center justify-between text-xs text-ink-muted">{k.label}<k.icon className="h-4 w-4 text-ink-faint" /></div>
                  <div className="mt-2 text-xl font-semibold tabular-nums text-ink">{k.value}</div>
                  {k.sub && <div className={cn("mt-0.5 text-xs", k.hot ? "text-warning" : "text-ink-muted")}>{k.sub}</div>}
                </Card>
              </Link>
            ))}
          </div>}
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {d.sales_by_month && <Card className="p-4 lg:col-span-2"><SalesChart data={d.sales_by_month} /></Card>}
            <Card className="p-4">
              <div className="mb-2 text-sm font-semibold">Needs attention</div>
              {alerts.length === 0 ? <p className="text-sm text-ink-muted">Nothing waiting.</p> : alerts.map((a) => (
                <Link key={a.text} to={a.to} className="flex items-center gap-2 border-t border-line/70 py-2 text-sm first:border-t-0 hover:text-primary">
                  <a.icon className="h-4 w-4 shrink-0 text-warning" /><span className="flex-1">{a.text}</span><ChevronRight className="h-4 w-4 text-ink-faint" /></Link>))}
            </Card>
            {d.top_customers && d.top_customers.length > 0 && (
              <Card className="p-4">
                <div className="mb-2 text-sm font-semibold">Top customers this month</div>
                {d.top_customers.map((c) => {
                  const max = Math.max(...d.top_customers!.map((x) => Number(x.amount)), 1);
                  return (
                    <div key={c.name} className="py-1 text-sm">
                      <div className="flex justify-between gap-2"><span className="truncate">{c.name}</span><span className="tabular-nums text-ink-muted">{m(c.amount)}</span></div>
                      <div className="mt-1 h-1.5 rounded-full bg-subtle"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${(Number(c.amount) / max) * 100}%` }} /></div>
                    </div>
                  );
                })}
              </Card>
            )}
            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4" /> Reports</div>
              {[["Sales register", "/reports/sales_register"], ["Receivables ageing", "/reports/customer_aging"], ["Stock summary", "/reports/stock_summary"], ["Profit & loss", "/reports/profit_loss"],
                ["Balance sheet", "/reports/balance_sheet"], ["All reports…", "/reports"]].map(([t, to]) => (
                <Link key={to} to={to} className="flex items-center justify-between border-t border-line/70 py-1.5 text-sm first:border-t-0 hover:text-primary">{t}<ChevronRight className="h-4 w-4 text-ink-faint" /></Link>))}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/** 12-month sales: one series, thin bars with rounded tops, hover tooltip, table fallback via title. */
function SalesChart({ data }: { data: { month: string; amount: number }[] }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const max = Math.max(...data.map((x) => Number(x.amount)), 1);
  const nice = niceMax(max);
  const W = 640, H = 200, padL = 48, padB = 22, padT = 8;
  const bw = (W - padL) / data.length;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / nice);
  const total = data.reduce((s, x) => s + Number(x.amount), 0);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between"><div className="text-sm font-semibold">Sales — last 12 months</div><div className="text-xs text-ink-muted">PKR {m(total)} total</div></div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full" role="img" aria-label="Monthly sales, last 12 months">
          {[0, 0.5, 1].map((f) => (
            <g key={f}><line x1={padL} x2={W} y1={y(nice * f)} y2={y(nice * f)} stroke="currentColor" className="text-line" strokeWidth={1} />
              <text x={padL - 6} y={y(nice * f) + 3} textAnchor="end" className="fill-ink-muted" fontSize={10}>{compact(nice * f)}</text></g>
          ))}
          {data.map((x, i) => {
            const v = Number(x.amount), x0 = padL + i * bw + bw * 0.22, w = bw * 0.56, top = y(v), h = Math.max(H - padB - top, v > 0 ? 1 : 0);
            const [yy, mm] = x.month.split("-");
            return (
              <g key={x.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
                {h > 0 && <path d={`M${x0},${H - padB} V${top + Math.min(4, h)} q0,-4 4,-4 h${w - 8} q4,0 4,4 V${H - padB} Z`} className={cn("fill-primary", hover !== null && hover !== i && "opacity-40")} />}
                <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle" className="fill-ink-muted" fontSize={10}>{MONTHS[Number(mm) - 1]}{mm === "01" ? ` ${yy.slice(2)}` : ""}</text>
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-0 rounded-control border border-line bg-surface px-2 py-1 text-xs shadow-pop" style={{ left: `${((padL + hover * bw + bw / 2) / W) * 100}%`, transform: "translateX(-50%)" }}>
            <div className="text-ink-muted">{data[hover].month}</div><div className="font-semibold tabular-nums">PKR {m(data[hover].amount)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
function niceMax(v: number) { const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function compact(v: number) { return v >= 1e6 ? `${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v); }
