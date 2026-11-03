/**
 * Settings → Notifications → Delivery: send alerts by e-mail and WhatsApp as well as the bell.
 * Company switches, each person's contact and opt-in, test messages, and the recent outbox.
 * Messages are queued in the database and sent by the notify-send edge function (every 5 minutes, or straight after a test).
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Mail, MessageCircle, Send } from "lucide-react";
import { Badge, Button, Card, Checkbox, Field, FormGrid, Input, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { formatDateTime } from "@jst/utilities";

export interface Channels { email_on: boolean; whatsapp_on: boolean; email_from_name: string; whatsapp_template: string; whatsapp_lang: string; app_url: string }
const DEFAULTS: Channels = { email_on: false, whatsapp_on: false, email_from_name: "JS Traders ERP", whatsapp_template: "erp_alert", whatsapp_lang: "en", app_url: "https://js-traders-accounts-app-1fsw.vercel.app" };

export function useChannels() {
  const { companyId } = useAccess();
  return useQuery({
    queryKey: ["notify-channels", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb().from("notification_channels").select("email_on, whatsapp_on, email_from_name, whatsapp_template, whatsapp_lang, app_url").eq("company_id", companyId!).maybeSingle();
      if (error) return null; // older database
      return (data as Channels | null) ?? DEFAULTS;
    },
  });
}

interface UserRow { user_id: string; full_name: string | null; login_email: string | null; roles: string | null; email_on: boolean; whatsapp_on: boolean; email: string | null; whatsapp_phone: string | null; sent_7d: number; failed_7d: number; last_error: string | null }
interface OutRow { id: string; channel: string; recipient: string; subject: string; status: string; last_error: string | null; created_at: string; sent_at: string | null }

/** run the sender now (after a test) — it also runs every 5 minutes on its own */
async function kick() {
  const { data, error } = await sb().functions.invoke("notify-send", { body: {} });
  if (error) throw error;
  return data as { processed: number; sent: number; failed: number; skipped: number };
}

export function DeliverySettings() {
  const { companyId, can } = useAccess();
  const qc = useQueryClient();
  const canEdit = can("settings.manage");
  const ch = useChannels();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<Channels>(DEFAULTS);
  React.useEffect(() => { if (ch.data) setForm(ch.data); }, [ch.data]);

  const status = useQuery({
    queryKey: ["notify-provider-status"],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb().functions.invoke("notify-send", { body: { action: "status" } });
      if (error) return null;
      return data as { email: boolean; whatsapp: boolean };
    },
  });
  const users = useQuery({
    queryKey: ["notify-users", companyId],
    enabled: open && !!companyId && canEdit,
    queryFn: async () => {
      const { data, error } = await sb().rpc("notification_delivery_users", { p_company: companyId });
      if (error) throw error;
      return (data ?? []) as UserRow[];
    },
  });
  const outbox = useQuery({
    queryKey: ["notify-outbox", companyId],
    enabled: open && !!companyId,
    refetchInterval: open ? 15_000 : false,
    queryFn: async () => {
      const { data, error } = await sb().from("notification_outbox").select("id, channel, recipient, subject, status, last_error, created_at, sent_at")
        .eq("company_id", companyId!).order("created_at", { ascending: false }).limit(20);
      if (error) return [] as OutRow[];
      return (data ?? []) as OutRow[];
    },
  });

  const saveCh = useMutation({
    mutationFn: async () => {
      const { error } = await sb().rpc("save_notification_channels", { p_company: companyId, p_data: form });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Delivery settings saved"); qc.invalidateQueries({ queryKey: ["notify-channels"] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const test = useMutation({
    mutationFn: async (channel: "EMAIL" | "WHATSAPP") => {
      const { error } = await sb().rpc("notify_test", { p_company: companyId, p_channel: channel });
      if (error) throw error;
      return kick();
    },
    onSuccess: (r) => {
      if (r.sent) toast.success("Test sent — check your phone / inbox");
      else toast.error("Not sent — see the reason in Recent messages below");
      qc.invalidateQueries({ queryKey: ["notify-outbox"] });
      qc.invalidateQueries({ queryKey: ["notify-users"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (ch.data === null) return null; // database older than this feature
  const any = ch.data?.email_on || ch.data?.whatsapp_on;
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <Send className="h-4 w-4 text-ink-muted" />
        <span className="flex-1 text-sm font-medium">E-mail & WhatsApp delivery</span>
        {ch.data?.email_on && <Badge tone="success">E-mail on</Badge>}
        {ch.data?.whatsapp_on && <Badge tone="success">WhatsApp on</Badge>}
        {!any && <Badge>Bell only</Badge>}
        <ChevronDown className={cn("h-4 w-4 text-ink-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-line p-3">
          <p className="text-xs text-ink-muted">
            When a notification appears in someone's bell, it can also go to their e-mail and WhatsApp. Turn the channel on here, tick <b>E-mail</b> / <b>WhatsApp</b> on the rules below,
            and switch it on for each person. Alerts are checked every 5 minutes, even when nobody has the ERP open. WhatsApp uses your Meta business number and an approved message template.
          </p>
          <FormGrid cols={3}>
            <div className="flex flex-col gap-2 pt-1">
              <Checkbox checked={form.email_on} disabled={!canEdit} onChange={(c) => setForm((f) => ({ ...f, email_on: c }))} label="Send by e-mail"
                description={status.data ? (status.data.email ? "Sender is set up" : "Sender keys not set yet (see below)") : undefined} />
              <Checkbox checked={form.whatsapp_on} disabled={!canEdit} onChange={(c) => setForm((f) => ({ ...f, whatsapp_on: c }))} label="Send by WhatsApp"
                description={status.data ? (status.data.whatsapp ? "WhatsApp number is set up" : "WhatsApp keys not set yet (see below)") : undefined} />
            </div>
            <Field label="E-mail sender name"><Input disabled={!canEdit} value={form.email_from_name} maxLength={60} onChange={(e) => setForm((f) => ({ ...f, email_from_name: e.target.value }))} /></Field>
            <Field label="Link in messages" hint="Your ERP address"><Input disabled={!canEdit} value={form.app_url} onChange={(e) => setForm((f) => ({ ...f, app_url: e.target.value }))} /></Field>
            <Field label="WhatsApp template name" hint="Approved in Meta, with 2 variables"><Input disabled={!canEdit} className="font-mono" value={form.whatsapp_template} onChange={(e) => setForm((f) => ({ ...f, whatsapp_template: e.target.value }))} /></Field>
            <Field label="Template language"><Input disabled={!canEdit} className="w-24 font-mono" value={form.whatsapp_lang} onChange={(e) => setForm((f) => ({ ...f, whatsapp_lang: e.target.value }))} /></Field>
            <div className="flex items-end gap-2 pb-1">
              {canEdit && <Button variant="primary" loading={saveCh.isPending} onClick={() => saveCh.mutate()}>Save</Button>}
              {canEdit && ch.data?.email_on && <Button icon={<Mail className="h-3.5 w-3.5" />} loading={test.isPending && test.variables === "EMAIL"} onClick={() => test.mutate("EMAIL")}>Test e-mail</Button>}
              {canEdit && ch.data?.whatsapp_on && <Button icon={<MessageCircle className="h-3.5 w-3.5" />} loading={test.isPending && test.variables === "WHATSAPP"} onClick={() => test.mutate("WHATSAPP")}>Test WhatsApp</Button>}
            </div>
          </FormGrid>
          {status.data && (!status.data.email || !status.data.whatsapp) && (
            <div className="rounded-card border border-dashed border-line p-2.5 text-xs text-ink-2">
              <b>One-time setup</b> (Supabase → Edge Functions → Secrets):
              {!status.data.email && <div className="mt-1">E-mail: <code>RESEND_API_KEY</code> (from resend.com, after verifying jstradersokr.shop) and <code>NOTIFY_EMAIL_FROM</code> e.g. alerts@jstradersokr.shop.</div>}
              {!status.data.whatsapp && <div className="mt-1">WhatsApp: <code>WHATSAPP_TOKEN</code> (permanent system-user token) and <code>WHATSAPP_PHONE_NUMBER_ID</code>. In Meta, create a <i>Utility</i> template named
                {" "}<code>{form.whatsapp_template}</code> with the body <code>JS Traders ERP: {"{{1}}"} — {"{{2}}"}</code>.</div>}
            </div>
          )}

          {canEdit && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">People</div>
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full text-sm">
                  <thead><tr className="bg-subtle text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th className="h-8 px-2">Person</th><th className="px-2">E-mail</th><th className="px-2">WhatsApp</th><th className="px-2">Last 7 days</th><th className="w-20 px-2" />
                  </tr></thead>
                  <tbody>{(users.data ?? []).map((u) => <PersonRow key={u.user_id} u={u} />)}</tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Recent messages</div>
            {(outbox.data ?? []).length === 0 ? <p className="text-xs text-ink-faint">Nothing sent yet.</p> : (
              <ul className="divide-y divide-line/70 rounded-card border border-line text-xs">
                {outbox.data!.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                    {o.channel === "EMAIL" ? <Mail className="h-3.5 w-3.5 text-ink-muted" /> : <MessageCircle className="h-3.5 w-3.5 text-ink-muted" />}
                    <span className="text-ink-muted">{formatDateTime(o.created_at)}</span>
                    <span className="min-w-0 flex-1 truncate">{o.subject} <span className="text-ink-faint">→ {o.recipient}</span></span>
                    <Badge tone={o.status === "SENT" ? "success" : o.status === "FAILED" ? "danger" : o.status === "SKIPPED" ? "warning" : "neutral"}>{o.status.toLowerCase()}</Badge>
                    {o.last_error && <span className="w-full pl-5 text-2xs text-danger">{o.last_error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function PersonRow({ u }: { u: UserRow }) {
  const { companyId } = useAccess();
  const qc = useQueryClient();
  const [v, setV] = React.useState({ email_on: u.email_on, whatsapp_on: u.whatsapp_on, email: u.email ?? "", whatsapp_phone: u.whatsapp_phone ?? "" });
  const dirty = v.email_on !== u.email_on || v.whatsapp_on !== u.whatsapp_on || v.email !== (u.email ?? "") || v.whatsapp_phone !== (u.whatsapp_phone ?? "");
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await sb().rpc("save_notification_pref", { p_company: companyId, p_user: u.user_id, p_data: v });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(`Saved for ${u.full_name ?? u.login_email}`); qc.invalidateQueries({ queryKey: ["notify-users"] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <tr className="border-t border-line/70 align-top">
      <td className="px-2 py-1.5"><div className="font-medium">{u.full_name ?? u.login_email}</div><div className="text-2xs text-ink-muted">{u.roles}</div></td>
      <td className="px-2 py-1.5">
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="h-4 w-4 accent-[#111827]" checked={v.email_on} onChange={(e) => setV((x) => ({ ...x, email_on: e.target.checked }))} />On</label>
        <Input className="mt-1 h-control-sm w-52 text-xs" placeholder={u.login_email ?? "e-mail"} value={v.email} onChange={(e) => setV((x) => ({ ...x, email: e.target.value }))} />
      </td>
      <td className="px-2 py-1.5">
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="h-4 w-4 accent-[#111827]" checked={v.whatsapp_on} onChange={(e) => setV((x) => ({ ...x, whatsapp_on: e.target.checked }))} />On</label>
        <Input className="mt-1 h-control-sm w-40 font-mono text-xs" placeholder="923001234567" value={v.whatsapp_phone} onChange={(e) => setV((x) => ({ ...x, whatsapp_phone: e.target.value }))} />
      </td>
      <td className="px-2 py-1.5 text-xs">
        {u.sent_7d} sent{u.failed_7d > 0 && <span className="text-danger"> · {u.failed_7d} failed</span>}
        {u.last_error && <div className="max-w-[220px] truncate text-2xs text-ink-faint" title={u.last_error}>{u.last_error}</div>}
      </td>
      <td className="px-2 py-1.5 text-right">{dirty && <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}</td>
    </tr>
  );
}
