import { Skeleton, Badge } from "@jst/ui";
import { useAuditHistory, useProfileNames } from "@jst/data-access";
import { formatDateTime, humanize } from "@jst/utilities";

const HIDDEN = new Set(["id", "company_id", "created_at", "created_by", "updated_at", "updated_by"]);

function show(v: unknown) {
  if (v === null || v === undefined || v === "") return <span className="text-ink-faint">empty</span>;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s) ? <span className="text-ink-faint">(linked record)</span> : s;
}

/** Read-only change history for one record (spec §23). */
export function AuditTimeline({ table, id }: { table: string; id: string }) {
  const q = useAuditHistory(table, id, true);
  const names = useProfileNames((q.data ?? []).map((r) => r.user_id));

  if (q.isLoading) return <Skeleton className="h-24" />;
  if (!q.data?.length) return <p className="text-sm text-ink-muted">No history recorded yet.</p>;

  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      {q.data.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-ink-faint" />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={e.action === "INSERT" ? "success" : e.action === "DELETE" ? "danger" : "info"}>
              {e.action === "INSERT" ? "Created" : e.action === "UPDATE" ? "Updated" : humanize(e.action)}
            </Badge>
            <span className="font-medium text-ink">{e.user_id ? (names.data?.[e.user_id] ?? "User") : "System"}</span>
            <span className="text-ink-faint">{formatDateTime(e.created_at)}</span>
          </div>
          {e.action === "UPDATE" && e.changed_fields && (
            <table className="mt-1.5 text-xs">
              <tbody>
                {e.changed_fields
                  .filter((f: string) => !HIDDEN.has(f))
                  .map((f: string) => (
                    <tr key={f}>
                      <td className="pr-3 align-top text-ink-muted">{humanize(f)}</td>
                      <td className="pr-2 align-top text-ink-2 line-through decoration-ink-faint">{show(e.old_value?.[f])}</td>
                      <td className="align-top text-ink">→ {show(e.new_value?.[f])}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </li>
      ))}
    </ol>
  );
}
