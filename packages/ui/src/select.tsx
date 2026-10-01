import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import { cn } from "./primitives";

/**
 * The single shared ERP dropdown (spec §5.5.4).
 * - Static options: filtered client-side (small fixed sets only).
 * - `loadOptions`: debounced server-side search for large datasets.
 * - `resolveOption`: fetches the label of an already-selected value so a
 *   selection is never lost or silently replaced when results change.
 */
export interface SelectOption {
  value: string;
  label: string;
  secondary?: string;
  disabled?: boolean;
}

export interface SearchableSelectProps {
  value: string | null | undefined;
  onChange: (value: string | null, option?: SelectOption) => void;
  options?: SelectOption[];
  loadOptions?: (search: string) => Promise<SelectOption[]>;
  resolveOption?: (value: string) => Promise<SelectOption | null>;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  emptyText?: string;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  loadOptions,
  resolveOption,
  placeholder = "Select…",
  clearable = true,
  disabled,
  invalid,
  id,
  className,
  emptyText = "No results",
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const debounced = useDebounced(search, 250);
  const [remote, setRemote] = React.useState<SelectOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<SelectOption | null>(null);

  // Resolve label for the current value (preserved across searches / reopen)
  React.useEffect(() => {
    if (!value) {
      setSelected(null);
      return;
    }
    if (selected?.value === value) return;
    const local = options?.find((o) => o.value === value) ?? remote.find((o) => o.value === value);
    if (local) {
      setSelected(local);
      return;
    }
    let cancelled = false;
    resolveOption?.(value).then((o) => !cancelled && setSelected(o ?? { value, label: value }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options]);

  React.useEffect(() => {
    if (!open || !loadOptions) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadOptions(debounced)
      .then((r) => !cancelled && setRemote(r))
      .catch((e) => !cancelled && setError(e?.message ?? "Failed to load"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, debounced, loadOptions]);

  const list = loadOptions ? remote : (options ?? []);

  return (
    <Popover.Root
      modal // own scroll layer: lets the mouse wheel scroll the list even inside a dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <Popover.Trigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          aria-invalid={invalid || undefined}
          className={cn(
            "group flex h-control w-full items-center gap-2 rounded-control border border-transparent bg-field px-2.5 text-left text-sm",
            "hover:border-line focus:border-line-strong focus:bg-surface focus:outline-none focus:shadow-focus",
            "disabled:cursor-not-allowed disabled:opacity-60 data-[state=open]:border-line-strong data-[state=open]:bg-surface",
            invalid && "border-danger-line",
            className,
          )}
        >
          <span className={cn("min-w-0 flex-1 truncate", !selected && "text-ink-faint")}>
            {selected ? (
              <>
                {selected.label}
                {selected.secondary && <span className="ml-1.5 text-xs text-ink-faint">{selected.secondary}</span>}
              </>
            ) : (
              placeholder
            )}
          </span>
          {clearable && selected && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear selection"
              className="rounded p-0.5 text-ink-faint hover:bg-line hover:text-ink"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSelected(null);
                onChange(null);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-faint" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-[70] w-[var(--radix-popover-trigger-width)] min-w-[300px] overflow-hidden rounded-control border border-line bg-surface shadow-pop"
        >
          <Command shouldFilter={!loadOptions} loop>
            <div className="flex items-center gap-2 border-b border-line px-2.5">
              <Search className="h-3.5 w-3.5 text-ink-faint" />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search…"
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-ink-faint"
              />
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-faint" />}
            </div>
            <Command.List className="max-h-64 overflow-y-auto overscroll-contain p-1" onWheel={(e) => e.stopPropagation()}>
              {error ? (
                <div className="px-2 py-3 text-xs text-danger">{error}</div>
              ) : (
                !loading && <Command.Empty className="px-2 py-3 text-xs text-ink-muted">{emptyText}</Command.Empty>
              )}
              {list.map((o) => (
                <Command.Item
                  key={o.value}
                  value={`${o.label} ${o.secondary ?? ""} ${o.value}`}
                  disabled={o.disabled}
                  onSelect={() => {
                    setSelected(o);
                    onChange(o.value, o);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink aria-selected:bg-field data-[disabled=true]:opacity-50"
                >
                  <Check className={cn("h-3.5 w-3.5", o.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-[5rem] flex-1 truncate">{o.label}</span>
                  {o.secondary && <span className="min-w-0 max-w-[60%] truncate text-right text-xs text-ink-faint">{o.secondary}</span>}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
