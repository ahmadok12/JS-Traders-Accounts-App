import type { Column } from "@jst/ui";
import { ActiveBadge, Badge } from "@jst/ui";
import { formatNumber, humanize } from "@jst/utilities";

type R = Record<string, unknown> & { id: string };

export const col = {
  code: (key = "code", header = "Code"): Column<R> => ({
    key,
    header,
    width: "110px",
    cell: (r) => <span className="whitespace-nowrap font-mono text-xs text-ink-2">{String(r[key] ?? "")}</span>,
  }),
  text: (key: string, header: string, opts: Partial<Column<R>> = {}): Column<R> => ({
    key,
    header,
    cell: (r) => (r[key] == null || r[key] === "" ? <span className="text-ink-faint">—</span> : String(r[key])),
    ...opts,
  }),
  strong: (key: string, header: string, sub?: string): Column<R> => ({
    key,
    header,
    cell: (r) => (
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{String(r[key] ?? "")}</div>
        {sub && r[sub] ? <div className="truncate text-2xs text-ink-muted">{String(r[sub])}</div> : null}
      </div>
    ),
  }),
  rel: (key: string, rel: string, field: string, header: string, opts: Partial<Column<R>> = {}): Column<R> => ({
    key,
    header,
    cell: (r) => {
      const o = r[rel] as Record<string, unknown> | null;
      return o?.[field] ? String(o[field]) : <span className="text-ink-faint">—</span>;
    },
    ...opts,
  }),
  num: (key: string, header: string, decimals = 2, opts: Partial<Column<R>> = {}): Column<R> => ({
    key,
    header,
    align: "right",
    cell: (r) => (r[key] == null ? <span className="text-ink-faint">—</span> : formatNumber(r[key] as string, decimals)),
    ...opts,
  }),
  active: (key = "is_active"): Column<R> => ({
    key,
    header: "Status",
    width: "90px",
    cell: (r) => <ActiveBadge active={Boolean(r[key])} />,
  }),
  enumBadge: (key: string, header: string, tones: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {}): Column<R> => ({
    key,
    header,
    cell: (r) => <Badge tone={tones[String(r[key])] ?? "neutral"}>{humanize(String(r[key] ?? ""))}</Badge>,
  }),
  flag: (key: string, header: string, label: string): Column<R> => ({
    key,
    header,
    hideBelow: "lg",
    cell: (r) => (r[key] ? <Badge tone="info">{label}</Badge> : null),
  }),
};

export const CURRENCY_LOOKUP = { table: "currencies", label: "code", secondary: "name", valueColumn: "code", companyScoped: false, filters: { is_active: true } } as const;

export const opts = (values: string[]) => values.map((v) => ({ value: v, label: humanize(v) }));
