// Warehouse staff accounts — called from the ERP "Warehouse Staff" page by a picking manager.
//   POST { action: "create", company_id, full_name, login, phone?, password, warehouse_ids[] }
//   POST { action: "reset_password", company_id, user_id, password }
// The caller's own session decides permission (picking.manage, checked in the database).
// Staff without email sign in with a short login name; it is stored as <name>@staff.jstradersokr.shop.
import { createClient } from "jsr:@supabase/supabase-js@2";

const STAFF_DOMAIN = "staff.jstradersokr.shop";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export function loginToEmail(login: string) {
  const v = login.trim().toLowerCase();
  if (v.includes("@")) return v;
  const slug = v.replace(/[^a-z0-9._-]/g, "");
  return slug ? `${slug}@${STAFF_DOMAIN}` : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in first" });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json(401, { error: "Your session has expired — sign in again" });
  const actor = who.user.id;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Bad request" }); }
  const companyId = String(body.company_id ?? "");
  const { data: can } = await admin.rpc("pick_can_manage", { p_actor: actor, p_company_id: companyId });
  if (!can) return json(403, { error: "You do not have permission (picking.manage) to manage warehouse staff" });

  if (body.action === "create") {
    const fullName = String(body.full_name ?? "").trim();
    const email = loginToEmail(String(body.login ?? ""));
    const password = String(body.password ?? "");
    const warehouses = Array.isArray(body.warehouse_ids) ? (body.warehouse_ids as string[]) : [];
    if (!fullName) return json(400, { error: "Enter the name" });
    if (!email) return json(400, { error: "Enter a login name (letters and numbers) or an email" });
    if (password.length < 6) return json(400, { error: "Password must be at least 6 characters" });
    if (!warehouses.length) return json(400, { error: "Choose at least one warehouse" });

    const { data: created, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (error || !created?.user) {
      const msg = /already/i.test(error?.message ?? "") ? "That login is already used — choose another" : error?.message ?? "Could not create the account";
      return json(400, { error: msg });
    }
    const { error: setupErr } = await admin.rpc("pick_setup_new_staff", {
      p_actor: actor, p_company_id: companyId, p_user: created.user.id, p_full_name: fullName,
      p_phone: String(body.phone ?? ""), p_warehouse_ids: warehouses,
    });
    if (setupErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json(400, { error: setupErr.message });
    }
    return json(200, { user_id: created.user.id, login: email });
  }

  if (body.action === "reset_password") {
    const userId = String(body.user_id ?? "");
    const password = String(body.password ?? "");
    if (password.length < 6) return json(400, { error: "Password must be at least 6 characters" });
    const { data: ok } = await admin.rpc("pick_staff_editable", { p_actor: actor, p_company_id: companyId, p_user: userId });
    if (!ok) return json(403, { error: "Only warehouse staff passwords can be changed here" });
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true });
  }

  return json(400, { error: "Unknown action" });
});
