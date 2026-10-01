import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import * as React from "react";
import { Loader2 } from "lucide-react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ Button */
type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "destructive-ghost";
type ButtonSize = "sm" | "md" | "icon" | "icon-sm";

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover shadow-sm",
  secondary: "bg-surface text-ink border border-line hover:bg-subtle hover:border-line-strong",
  ghost: "text-ink-2 hover:bg-field hover:text-ink",
  destructive: "bg-danger text-white hover:bg-red-800 shadow-sm",
  "destructive-ghost": "text-danger hover:bg-danger-soft",
};
const sizeClass: Record<ButtonSize, string> = {
  sm: "h-control-sm px-2.5 text-xs gap-1.5",
  md: "h-control px-3.5 text-sm gap-2",
  icon: "h-control w-control justify-center",
  "icon-sm": "h-control-sm w-control-sm justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center rounded-control font-medium transition-colors",
        "focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

/* ------------------------------------------------------------------ Inputs */
const controlBase =
  "w-full rounded-control border border-transparent bg-field px-2.5 text-sm text-ink placeholder:text-ink-faint " +
  "transition-colors hover:border-line focus:border-line-strong focus:bg-surface focus:outline-none focus:shadow-focus " +
  "disabled:cursor-not-allowed disabled:opacity-60 read-only:bg-subtle";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...rest }, ref) => (
    <input
      ref={ref}
      className={cn(controlBase, "h-control", invalid && "border-danger-line bg-danger-soft/40", className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  ({ className, invalid, rows = 3, ...rest }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(controlBase, "py-2 leading-5", invalid && "border-danger-line", className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  ),
);
Textarea.displayName = "Textarea";

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const autoId = React.useId();
  const cid = id ?? autoId;
  return (
    <label htmlFor={cid} className={cn("inline-flex cursor-pointer select-none items-start gap-2", disabled && "cursor-not-allowed opacity-60")}>
      <input
        id={cid}
        type="checkbox"
        className="mt-[2px] h-4 w-4 rounded border-line-strong text-primary accent-[#111827] focus-visible:shadow-focus"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex flex-col">
        <span className="text-sm font-medium text-ink">{label}</span>
        {description && <span className="text-xs text-ink-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Field({
  label,
  required,
  error,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: React.ReactNode;
  required?: boolean;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {/* reserve space so validation doesn't make the layout jump */}
      <div className="min-h-[14px] truncate text-2xs leading-[14px]">
        {error ? <span className="text-danger">{error}</span> : hint ? <span className="text-ink-faint">{hint}</span> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Badge */
export type Tone = "neutral" | "success" | "warning" | "danger" | "info";
const toneClass: Record<Tone, string> = {
  neutral: "bg-field text-ink-2 border-line",
  success: "bg-success-soft text-success border-success-line",
  warning: "bg-warning-soft text-warning border-warning-line",
  danger: "bg-danger-soft text-danger border-danger-line",
  info: "bg-info-soft text-info border-info-line",
};
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-2xs font-medium", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "success" : "neutral"}>{active ? "Active" : "Inactive"}</Badge>;
}

/* ------------------------------------------------------------------ Layout bits */
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-card border border-line bg-surface shadow-card", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <div className="flex h-8 w-8 items-center justify-center rounded-control border border-line bg-surface text-ink-2">{icon}</div>}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-ink">{title}</h1>
          {description && <p className="truncate text-xs text-ink-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{children}</h3>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-ink-faint">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-xs text-ink-muted">{description}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-field", className)} />;
}

export function KeyValue({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-2xs font-medium uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children ?? <span className="text-ink-faint">—</span>}</dd>
    </div>
  );
}
