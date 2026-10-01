import * as React from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import * as DM from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Loader2, LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { Badge, Button, cn } from "@jst/ui";
import { useAccess } from "@jst/data-access";
import { ROLE_LABELS } from "@jst/permissions";
import { NavigationGuard } from "../lib/unsaved";
import { NAV } from "./nav";
import { useFeatures } from "../lib/settings";

function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { can } = useAccess();
  const features = useFeatures();
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-2">
      {NAV.map((g) => {
        const items = g.items.filter((i) => features.isOn(i.feature) && (i.soon || !i.perms || i.perms.some((p) => can(p))));
        if (!items.length) return null;
        return (
          <div key={g.label || "top"} className="mb-3">
            {g.label && !collapsed && <div className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-ink-faint">{g.label}</div>}
            {items.map((i) =>
              i.soon ? (
                <div
                  key={i.to}
                  title={`${i.label} — ${i.soon}`}
                  className={cn("flex h-8 cursor-default items-center gap-2.5 rounded-control px-2 text-sm text-ink-faint", collapsed && "justify-center")}
                >
                  <i.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate">{i.label}</span>
                      <span className="text-2xs">{i.soon}</span>
                    </>
                  )}
                </div>
              ) : (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.to === "/"}
                  onClick={onNavigate}
                  title={collapsed ? i.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      "flex h-8 items-center gap-2.5 rounded-control px-2 text-sm transition-colors",
                      collapsed && "justify-center",
                      isActive ? "bg-field font-medium text-ink" : "text-ink-muted hover:bg-subtle hover:text-ink",
                    )
                  }
                >
                  <i.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{i.label}</span>}
                </NavLink>
              ),
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn("flex h-14 items-center gap-2 border-b border-line px-4", collapsed && "justify-center px-0")}>
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">JS</div>
      {!collapsed && (
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink">JS Traders</div>
          <div className="text-2xs text-ink-faint">ERP · Admin</div>
        </div>
      )}
    </div>
  );
}

export function AppShell() {
  const { session, sessionLoading, accessLoading, companies, company, setCompanyId, roles, signOut } = useAccess();
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem("jst.sidebar") === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const loc = useLocation();

  if (sessionLoading || (session && accessLoading)) {
    return (
      <div className="flex h-screen items-center justify-center bg-page">
        <Loader2 className="h-5 w-5 animate-spin text-ink-faint" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;

  if (!companies.length) {
    return (
      <div className="flex h-screen items-center justify-center bg-page p-4">
        <div className="max-w-sm rounded-card border border-line bg-surface p-6 text-center shadow-card">
          <p className="text-base font-semibold text-ink">Waiting for access</p>
          <p className="mt-1 text-sm text-ink-muted">
            You're signed in as {session.user.email}, but no role has been assigned yet. Ask an administrator to grant you access.
          </p>
          <Button className="mt-4" onClick={signOut} icon={<LogOut className="h-3.5 w-3.5" />}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  // Warehouse staff only do picking on the phone app
  if (company && company.permissions.includes("picking.perform") && !["inventory.view", "sales.view", "journals.view", "products.manage"].some((p) => company.permissions.includes(p))) {
    return <Navigate to="/m" replace />;
  }

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("jst.sidebar", c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-page">
      {/* desktop sidebar */}
      <aside className={cn("hidden shrink-0 flex-col border-r border-line bg-surface md:flex", collapsed ? "w-[60px]" : "w-[232px]")}>
        <Brand collapsed={collapsed} />
        <Sidebar collapsed={collapsed} />
        <div className="border-t border-line p-2">
          <Button variant="ghost" size="sm" className={cn("w-full", collapsed && "justify-center")} onClick={toggle} icon={collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}>
            {!collapsed && "Collapse"}
          </Button>
        </div>
      </aside>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[260px] flex-col bg-surface shadow-dialog">
            <div className="flex items-center justify-between pr-2">
              <Brand collapsed={false} />
              <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-4 w-4" />
          </Button>
          {companies.length > 1 ? (
            <select
              className="h-control rounded-control border border-line bg-surface px-2 text-sm"
              value={company?.company_id}
              onChange={(e) => setCompanyId(e.target.value)}
              aria-label="Company"
            >
              {companies.map((c) => (
                <option key={c.company_id} value={c.company_id}>
                  {c.company_name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm font-medium text-ink">{company?.company_name}</span>
          )}
          <div className="flex-1" />
          <DM.Root>
            <DM.Trigger asChild>
              <button className="flex items-center gap-2 rounded-control px-2 py-1 hover:bg-subtle">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-field text-xs font-semibold text-ink-2">
                  {(session.user.email ?? "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="hidden text-left leading-tight sm:block">
                  <div className="max-w-[180px] truncate text-xs font-medium text-ink">{session.user.email}</div>
                  <div className="text-2xs text-ink-faint">{roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}</div>
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-ink-faint" />
              </button>
            </DM.Trigger>
            <DM.Portal>
              <DM.Content align="end" sideOffset={6} className="z-50 min-w-[200px] rounded-control border border-line bg-surface p-1 shadow-pop">
                <div className="px-2 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {roles.map((r) => (
                      <Badge key={r}>{ROLE_LABELS[r] ?? r}</Badge>
                    ))}
                  </div>
                </div>
                <DM.Separator className="my-1 h-px bg-line" />
                <DM.Item onSelect={signOut} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-field">
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </DM.Item>
              </DM.Content>
            </DM.Portal>
          </DM.Root>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
      <NavigationGuard />
    </div>
  );
}
