// Attachments on Cloudflare R2 (private bucket).
//   POST { action: "status" }                                         → { configured }
//   POST { action: "begin", entity_type, entity_id, file_name, mime, size, description? } → { id, url }   (PUT the file to url)
//   POST { action: "confirm", id }                                    → { ok }
//   POST { action: "open", id, download? }                            → { url, name, mime }                 (10-minute link)
//   POST { action: "remove", id, reason? }                            → { ok }
// Every permission check happens in the database as the signed-in user (attachment_* functions).
// Secrets (Supabase → Edge Functions → Secrets): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ACCOUNT = Deno.env.get("R2_ACCOUNT_ID") ?? "";
const KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
const SECRET = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
const BUCKET = Deno.env.get("R2_BUCKET") ?? "";
const configured = !!(ACCOUNT && KEY_ID && SECRET && BUCKET);
const r2 = configured ? new AwsClient({ accessKeyId: KEY_ID, secretAccessKey: SECRET, service: "s3", region: "auto" }) : null;

const objectUrl = (bucket: string, key: string) =>
  `https://${ACCOUNT}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;

async function presign(method: "GET" | "PUT", bucket: string, key: string, extra: Record<string, string> = {}) {
  const u = new URL(objectUrl(bucket, key));
  u.searchParams.set("X-Amz-Expires", "600");
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  const signed = await r2!.sign(new Request(u, { method }), { aws: { signQuery: true } });
  return signed.url;
}

const asciiName = (s: string) => s.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in first" });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: who, error: whoErr } = await db.auth.getUser(token);
  if (whoErr || !who?.user) return json(401, { error: "Your session has expired — sign in again" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Bad request" }); }
  const action = String(body.action ?? "");

  if (action === "status") return json(200, { configured });
  if (!configured) return json(503, { error: "File storage is not set up yet (Cloudflare R2 keys missing)" });

  try {
    if (action === "begin") {
      const { data, error } = await db.rpc("attachment_begin", {
        p_entity_type: body.entity_type, p_entity_id: body.entity_id, p_file_name: body.file_name,
        p_mime: body.mime, p_size: body.size, p_bucket: BUCKET, p_description: body.description ?? null,
      });
      if (error) return json(400, { error: error.message });
      const r = data as { id: string; key: string };
      return json(200, { id: r.id, url: await presign("PUT", BUCKET, r.key) });
    }

    if (action === "confirm") {
      const id = String(body.id ?? "");
      const { data: loc, error: locErr } = await db.rpc("attachment_pending_key", { p_id: id });
      if (locErr) return json(400, { error: locErr.message });
      if (!loc) return json(404, { error: "Upload not found" });
      const l = loc as { bucket: string; key: string };
      const head = await r2!.fetch(objectUrl(l.bucket, l.key), { method: "HEAD" });
      const size = head.ok ? Number(head.headers.get("content-length") ?? "0") : null;
      const { error } = await db.rpc("attachment_confirm", { p_id: id, p_size: size, p_ok: head.ok });
      if (error) return json(400, { error: error.message });
      if (!head.ok) return json(400, { error: "The upload did not reach storage — try again" });
      return json(200, { ok: true });
    }

    if (action === "open") {
      const { data, error } = await db.rpc("attachment_locate", { p_id: body.id });
      if (error) return json(404, { error: error.message });
      const a = data as { bucket: string; key: string; name: string; mime: string };
      const disp = `${body.download ? "attachment" : "inline"}; filename="${asciiName(a.name)}"; filename*=UTF-8''${encodeURIComponent(a.name)}`;
      const url = await presign("GET", a.bucket, a.key, { "response-content-disposition": disp, "response-content-type": a.mime });
      return json(200, { url, name: a.name, mime: a.mime });
    }

    if (action === "remove") {
      const { error } = await db.rpc("attachment_remove", { p_id: body.id, p_reason: body.reason ?? null });
      if (error) return json(400, { error: error.message });
      return json(200, { ok: true });
    }
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : "Storage error" });
  }
  return json(400, { error: "Unknown action" });
});
