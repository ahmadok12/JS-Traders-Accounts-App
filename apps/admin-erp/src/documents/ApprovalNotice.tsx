import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { cn } from "@jst/ui";
import { sb, useAccess } from "@jst/data-access";
import { formatNumber } from "@jst/utilities";

export type ApprovalDocType = "SALES_ORDER" | "PURCHASE_ORDER" | "SUPPLIER_BILL" | "PAYMENT_VOUCHER" | "SALES_DISCOUNT";

interface Status { needed: boolean; amount?: number; limit?: number; role_names?: string; can_approve?: boolean }

/** Approval limit status of a waiting document (Settings → Approvals). The database enforces it; this only explains. */
export function useApprovalStatus(docType: ApprovalDocType, id: string | null | undefined, enabled = true) {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["approval-status", docType, id],
    enabled: !!companyId && !!id && enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await sb().rpc("approval_status", { p_company: companyId, p_doc_type: docType, p_id: id });
      if (error) return null; // older database without approval rules — nothing to show
      return data as Status | null;
    },
  });
}

export function ApprovalNotice({ docType, id, enabled = true, action = "approve", className }: {
  docType: ApprovalDocType; id: string | null | undefined; enabled?: boolean; action?: string; className?: string;
}) {
  const q = useApprovalStatus(docType, id, enabled);
  const s = q.data;
  if (!enabled || !s?.needed) return null;
  const pct = docType === "SALES_DISCOUNT";
  const amt = pct ? `${formatNumber(s.amount ?? 0, 1)}% discount` : `PKR ${formatNumber(s.amount ?? 0, 0)}`;
  const lim = pct ? `${formatNumber(s.limit ?? 0, 1)}%` : `PKR ${formatNumber(s.limit ?? 0, 0)}`;
  return (
    <div className={cn("mb-3 flex items-start gap-2 rounded-card border px-3 py-2 text-sm",
      s.can_approve ? "border-info-line bg-info-soft text-info" : "border-warning-line bg-warning-soft text-warning", className)}>
      {s.can_approve ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
      <div>
        <b>Above approval limit</b> — {amt} (limit {lim}).{" "}
        {s.can_approve ? `You can ${action} it.` : `Only ${s.role_names} can ${action} it; they have been notified.`}
      </div>
    </div>
  );
}
