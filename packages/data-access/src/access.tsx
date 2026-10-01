import * as React from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccessCompany } from "@jst/types";
import { sb } from "./client";

interface AccessState {
  session: Session | null;
  sessionLoading: boolean;
  companies: AccessCompany[];
  company: AccessCompany | null;
  companyId: string | null;
  setCompanyId: (id: string) => void;
  can: (perm: string) => boolean;
  roles: string[];
  accessLoading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = React.createContext<AccessState | null>(null);
const COMPANY_KEY = "jst.companyId";

export function AccessProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = React.useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = React.useState(true);
  const [companyId, setCompanyIdState] = React.useState<string | null>(() => {
    try {
      return localStorage.getItem(COMPANY_KEY);
    } catch {
      return null;
    }
  });

  React.useEffect(() => {
    sb()
      .auth.getSession()
      .then(({ data }) => {
        setSession(data.session);
        setSessionLoading(false);
      });
    const { data } = sb().auth.onAuthStateChange((_e, s) => {
      setSession(s);
      qc.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  // Permission snapshot: short-lived cache (spec §5.4), invalidated on auth change
  const access = useQuery({
    queryKey: ["my_access", session?.user.id],
    enabled: !!session,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb().rpc("my_access");
      if (error) throw error;
      return (data ?? []) as AccessCompany[];
    },
  });

  const companies = access.data ?? [];
  const company = companies.find((c) => c.company_id === companyId) ?? companies[0] ?? null;
  const permSet = React.useMemo(() => new Set(company?.permissions ?? []), [company]);

  const value: AccessState = {
    session,
    sessionLoading,
    companies,
    company,
    companyId: company?.company_id ?? null,
    setCompanyId: (id) => {
      setCompanyIdState(id);
      try {
        localStorage.setItem(COMPANY_KEY, id);
      } catch {
        /* ignore */
      }
      qc.invalidateQueries();
    },
    can: (p) => permSet.has(p),
    roles: company?.role_codes ?? [],
    accessLoading: access.isLoading,
    signOut: async () => {
      await sb().auth.signOut();
      qc.clear();
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccess() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useAccess must be used inside AccessProvider");
  return v;
}
