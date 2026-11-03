// Notification delivery — sends queued ERP alerts by e-mail (Resend) and WhatsApp (Meta Cloud API).
//   POST {}                    → send what is waiting in notification_outbox (up to 50)
//   POST { action: "status" }  → which channels have their keys set (no secrets returned)
// Called every 5 minutes by pg_cron (header x-cron-secret) and by the ERP right after "Send test".
// The 5-minute database job proves itself with a secret kept in Supabase Vault (notify_check_secret).
// Secrets to add (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY           e-mail: API key from resend.com
//   NOTIFY_EMAIL_FROM         e-mail: sender on a verified domain, e.g. alerts@jstradersokr.shop
//   WHATSAPP_TOKEN            WhatsApp: permanent system-user token (Meta Business)
//   WHATSAPP_PHONE_NUMBER_ID  WhatsApp: the sending number's ID (Meta → WhatsApp → API setup)
// WhatsApp business-initiated messages must use an approved template. Default template "erp_alert",
// body with two variables:  "JS Traders ERP: {{1}}  {{2}}"   (title, details + link).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface Job {
  id: string; company_id: string; channel: "EMAIL" | "WHATSAPP"; recipient: string; subject: string; body: string | null; link: string | null;
  email_from_name: string; whatsapp_template: string; whatsapp_lang: string;
}

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const emailReady = () => !!env("RESEND_API_KEY") && !!env("NOTIFY_EMAIL_FROM");
const whatsappReady = () => !!env("WHATSAPP_TOKEN") && !!env("WHATSAPP_PHONE_NUMBER_ID");

// WhatsApp template variables may not contain new lines, tabs or more than 4 spaces in a row
const waText = (s: string, max = 900) => s.replace(/[\r\n\t]+/g, " · ").replace(/ {4,}/g, "   ").trim().slice(0, max) || "-";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function sendEmail(j: Job): Promise<string | null> {
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#111827">
    <p style="font-size:16px;font-weight:600;margin:0 0 8px">${esc(j.subject)}</p>
    ${j.body ? `<p style="margin:0 0 12px;color:#374151">${esc(j.body)}</p>` : ""}
    ${j.link ? `<p><a href="${esc(j.link)}" style="background:#111827;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Open in the ERP</a></p>` : ""}
    <p style="color:#9ca3af;font-size:12px;margin-top:16px">JS Traders ERP · change what you receive in Settings → Notifications</p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${j.email_from_name} <${env("NOTIFY_EMAIL_FROM")}>`, to: [j.recipient], subject: j.subject,
      html, text: [j.subject, j.body, j.link].filter(Boolean).join("\n\n"),
    }),
  });
  if (r.ok) return null;
  return `E-mail ${r.status}: ${(await r.text()).slice(0, 300)}`;
}

async function sendWhatsapp(j: Job): Promise<string | null> {
  const r = await fetch(`https://graph.facebook.com/v22.0/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: j.recipient, type: "template",
      template: {
        name: j.whatsapp_template, language: { code: j.whatsapp_lang },
        components: [{ type: "body", parameters: [
          { type: "text", text: waText(j.subject, 200) },
          { type: "text", text: waText([j.body, j.link].filter(Boolean).join(" · ")) },
        ] }],
      },
    }),
  });
  if (r.ok) return null;
  const t = await r.text();
  let msg = t.slice(0, 300);
  try { const e = JSON.parse(t)?.error; if (e?.message) msg = `${e.message}${e.error_data?.details ? ` — ${e.error_data.details}` : ""}`; } catch { /* keep text */ }
  return `WhatsApp ${r.status}: ${msg}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const url = env("SUPABASE_URL");
  const admin = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });

  // the database job (secret kept in Supabase Vault) or any signed-in ERP user may flush the queue
  const given = req.headers.get("x-cron-secret") ?? "";
  const fromCron = given.length >= 32 && (await admin.rpc("notify_check_secret", { p_secret: given })).data === true;
  if (!fromCron) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who } = token ? await admin.auth.getUser(token) : { data: null };
    if (!who?.user) return json(401, { error: "Sign in first" });
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  if (body.action === "status") return json(200, { email: emailReady(), whatsapp: whatsappReady() });

  const { data, error } = await admin.rpc("notify_outbox_claim", { p_limit: 50 });
  if (error) return json(500, { error: error.message });
  const jobs = (data ?? []) as Job[];
  let sent = 0, failed = 0, skipped = 0;
  for (const j of jobs) {
    let status = "SENT"; let err: string | null = null;
    try {
      if (j.channel === "EMAIL" && !emailReady()) { status = "SKIPPED"; err = "E-mail is not set up — add RESEND_API_KEY and NOTIFY_EMAIL_FROM in Supabase secrets"; }
      else if (j.channel === "WHATSAPP" && !whatsappReady()) { status = "SKIPPED"; err = "WhatsApp is not set up — add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Supabase secrets"; }
      else {
        err = j.channel === "EMAIL" ? await sendEmail(j) : await sendWhatsapp(j);
        if (err) status = "FAILED";
      }
    } catch (e) { status = "FAILED"; err = String((e as Error)?.message ?? e).slice(0, 300); }
    await admin.rpc("notify_outbox_result", { p_id: j.id, p_status: status, p_error: err });
    if (status === "SENT") sent++; else if (status === "SKIPPED") skipped++; else failed++;
  }
  return json(200, { processed: jobs.length, sent, failed, skipped });
});
