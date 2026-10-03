import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Button, Field, Input } from "@jst/ui";
import { sb, useAccess } from "@jst/data-access";

export function LoginPage() {
  const { session, sessionLoading } = useAccess();
  const loc = useLocation();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [mode, setMode] = React.useState<"signin" | "reset">("signin");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "error" | "ok"; text: string } | null>(null);

  if (!sessionLoading && session) {
    const from = (loc.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    if (mode === "signin") {
      const login = email.trim().toLowerCase();
      const { error } = await sb().auth.signInWithPassword({ email: login.includes("@") ? login : `${login}@staff.jstradersokr.shop`, password });
      if (error) setMsg({ tone: "error", text: error.message === "Invalid login credentials" ? "Login or password is incorrect." : error.message });
    } else {
      const { error } = await sb().auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + "/login" });
      setMsg(error ? { tone: "error", text: error.message } : { tone: "ok", text: "If that email has an account, a reset link is on its way." });
    }
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-page p-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-sm font-bold text-white">JS</div>
          <div>
            <div className="text-base font-semibold text-ink">JS Traders ERP</div>
            <div className="text-xs text-ink-muted">Sign in to continue</div>
          </div>
        </div>
        <form onSubmit={submit} className="rounded-dialog border border-line bg-surface p-5 shadow-card">
          <Field label={mode === "signin" ? "Email or staff login" : "Email"} htmlFor="email">
            <Input id="email" type={mode === "signin" ? "text" : "email"} autoCapitalize="none" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          {mode === "signin" && (
            <Field label="Password" htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
          )}
          {msg && <p className={msg.tone === "error" ? "mb-3 text-xs text-danger" : "mb-3 text-xs text-success"}>{msg.text}</p>}
          <Button type="submit" variant="primary" className="w-full justify-center" loading={busy}>
            {mode === "signin" ? "Sign in" : "Send reset link"}
          </Button>
          <button type="button" className="mt-3 w-full text-center text-xs text-ink-muted hover:text-ink" onClick={() => setMode(mode === "signin" ? "reset" : "signin")}>
            {mode === "signin" ? "Forgot password?" : "Back to sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-2xs text-ink-faint">Accounts are created by an administrator.</p>
      </div>
    </div>
  );
}
