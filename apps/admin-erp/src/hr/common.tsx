import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { LookupPicker } from "../inventory/pickers";

export const PAY_TYPES: { value: string; label: string; direction: "EARNING" | "DEDUCTION" }[] = [
  { value: "BONUS", label: "Bonus", direction: "EARNING" },
  { value: "OVERTIME", label: "Overtime", direction: "EARNING" },
  { value: "ALLOWANCE", label: "Allowance", direction: "EARNING" },
  { value: "OTHER_EARNING", label: "Other earning", direction: "EARNING" },
  { value: "FINE", label: "Fine / penalty", direction: "DEDUCTION" },
  { value: "OTHER_DEDUCTION", label: "Other deduction", direction: "DEDUCTION" },
];
export const payTypeLabel = (t: string) => (t === "ASSEMBLY_LABOUR" ? "Assembly labour" : PAY_TYPES.find((p) => p.value === t)?.label ?? t);

export const monthLabel = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "";
export const monthStart = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
/** <input type="month"> value ↔ first-of-month date */
export const toMonthInput = (d: string) => d.slice(0, 7);
export const fromMonthInput = (v: string) => (v ? `${v}-01` : "");

export function EmployeePicker(p: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean; invalid?: boolean; placeholder?: string }) {
  return <LookupPicker {...p} clearable={false} placeholder={p.placeholder ?? "Employee…"}
    spec={{ table: "employees", label: "full_name", secondary: "code", filters: {} }} />;
}

export interface HrRow {
  employee_id: string; code: string; full_name: string; department: string | null; position: string | null; status: string; payroll_eligible: boolean;
  current_salary: number | null; salary_from: string | null; advance_outstanding: number; payable_balance: number; payment_method: string | null;
}
export function useHrOverview() {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["hr", "overview", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().rpc("hr_overview", { p_company_id: companyId });
      if (error) throw error;
      return (data ?? []) as HrRow[];
    },
  });
}
export function useEmployeeNames() {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["hr", "names", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb().from("employees").select("id, code, full_name").eq("company_id", companyId!);
      if (error) throw error;
      return new Map((data ?? []).map((e) => [e.id as string, `${e.full_name}`]));
    },
  });
}

/** small helper: run an RPC, toast, refresh everything HR-related */
export function useHrAction<V>(fn: (v: V) => Promise<unknown>, ok: string | ((v: V) => string), after?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_d, v) => {
      toast.success(typeof ok === "function" ? ok(v) : ok);
      qc.invalidateQueries({ queryKey: ["hr"] });
      qc.invalidateQueries({ queryKey: ["list"] });
      qc.invalidateQueries({ queryKey: ["payroll"] });
      after?.();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
}
export async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await sb().rpc(name, args);
  if (error) throw error;
  return data;
}

export function StatusPill({ s }: { s: string }) {
  const tone: Record<string, string> = {
    PENDING: "bg-warning-soft text-warning border-warning-line", REQUESTED: "bg-warning-soft text-warning border-warning-line",
    DRAFT: "bg-warning-soft text-warning border-warning-line", APPROVED: "bg-sky-50 text-sky-700 border-sky-200",
    OPEN: "bg-sky-50 text-sky-700 border-sky-200", POSTED: "bg-success-soft text-success border-success-line", APPLIED: "bg-success-soft text-success border-success-line",
    RECOVERED: "bg-success-soft text-success border-success-line", ASSIGNED: "bg-field text-ink-2 border-line",
    REJECTED: "bg-danger-soft text-danger border-red-200", REVERSED: "bg-danger-soft text-danger border-red-200",
    CANCELLED: "bg-field text-ink-muted border-line", WRITTEN_OFF: "bg-field text-ink-muted border-line",
  };
  const label: Record<string, string> = { WRITTEN_OFF: "Written off", OPEN: "Outstanding", APPLIED: "In payroll" };
  return <span className={`inline-flex h-5 items-center rounded-full border px-2 text-2xs font-medium ${tone[s] ?? "bg-field text-ink-2 border-line"}`}>{label[s] ?? s.charAt(0) + s.slice(1).toLowerCase()}</span>;
}

export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = React.useState(v);
  React.useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
