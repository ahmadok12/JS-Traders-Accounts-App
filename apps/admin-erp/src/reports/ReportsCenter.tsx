import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Bookmark, ChevronRight, ExternalLink, Search } from "lucide-react";
import { Button, Card, EmptyState, Input, PageHeader, cn } from "@jst/ui";
import { sb, useAccess } from "@jst/data-access";
import { CATEGORIES, REPORT, REPORTS, canSee } from "./registry";
import { ReportScreen } from "./ReportView";

const icon = <BarChart3 className="h-4 w-4" />;

export function ReportsCenterPage() {
  const { code } = useParams();
  const def = code ? REPORT[code] : undefined;
  if (code && def && !def.route) return <ReportPage code={code} />;
  return <ReportsIndex />;
}

function ReportsIndex() {
  const { can, companyId } = useAccess();
  const navigate = useNavigate();
  const [q, setQ] = React.useState("");
  const saved = useQuery({ queryKey: ["saved-reports-all", companyId], enabled: !!companyId, queryFn: async () =>
    ((await sb().from("saved_reports").select("id, name, report_code, is_shared").eq("company_id", companyId!).order("name")).data ?? []) as { id: string; name: string; report_code: string; is_shared: boolean }[] });
  const t = q.trim().toLowerCase();
  const list = REPORTS.filter((r) => canSee(r, can) && (!t || `${r.title} ${r.description} ${r.category}`.toLowerCase().includes(t)));
  const open = (r: (typeof REPORTS)[number]) => navigate(r.route ?? `/reports/${r.code}`);
  const mySaved = (saved.data ?? []).filter((s) => REPORT[s.report_code] && canSee(REPORT[s.report_code], can));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Reports" icon={icon} description="Every report in one place. Pick a report, set the period and filters, then group, sort, choose columns, export to Excel / CSV or print to PDF, and save it for next time." />
      <div className="mb-3 flex items-center gap-2"><Search className="h-4 w-4 text-ink-muted" /><Input className="w-80" placeholder="Find a report…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="min-h-0 flex-1 overflow-auto">
        {mySaved.length > 0 && !t && (
          <Card className="mb-3 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-muted"><Bookmark className="h-3.5 w-3.5" /> Saved reports</div>
            <div className="flex flex-wrap gap-2">{mySaved.map((s) => (
              <Link key={s.id} to={`/reports/${s.report_code}?saved=${s.id}`} className="rounded-control border border-line px-2.5 py-1 text-sm hover:border-line-strong">
                {s.name} <span className="text-2xs text-ink-muted">· {REPORT[s.report_code].title}{s.is_shared ? " · shared" : ""}</span></Link>))}</div>
          </Card>
        )}
        {list.length === 0 ? <Card><EmptyState icon={icon} title="No reports" description="No report matches, or you don't have access." /></Card> : (
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {CATEGORIES.map((cat) => {
              const rs = list.filter((r) => r.category === cat);
              if (!rs.length) return null;
              return (
                <Card key={cat} className="p-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{cat}</div>
                  {rs.map((r) => (
                    <button key={r.code} onClick={() => open(r)} className="group flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left hover:bg-subtle">
                      <div className="min-w-0 flex-1"><div className="text-sm font-medium">{r.title}{r.route && <ExternalLink className="ml-1 inline h-3 w-3 text-ink-faint" />}</div>
                        <div className="line-clamp-2 text-xs text-ink-muted">{r.description}</div></div>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink-faint group-hover:text-ink" />
                    </button>
                  ))}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ReportPage({ code }: { code: string }) {
  const { can } = useAccess();
  const def = REPORT[code];
  if (!canSee(def, can)) return <Card><EmptyState icon={icon} title="No access" description="You don't have access to this report." /></Card>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={def.title} icon={icon} description={def.description}
        actions={<Link to="/reports"><Button icon={<ArrowLeft className="h-4 w-4" />}>All reports</Button></Link>} />
      <ReportScreen key={code} def={def} />
    </div>
  );
}

export function ReportLinkCard({ title, to, className }: { title: string; to: string; className?: string }) {
  return <Link to={to} className={cn("text-sm text-primary hover:underline", className)}>{title}</Link>;
}
