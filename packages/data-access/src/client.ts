import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Initialise once per app with the PUBLISHABLE key only. Service-role keys never reach clients. */
export function initSupabase(url: string, publishableKey: string): SupabaseClient {
  if (!url || !publishableKey) throw new Error("Supabase URL / publishable key missing — check .env");
  client = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: {
      // correlation id lands in audit_logs.request_id
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (!headers.has("x-request-id")) headers.set("x-request-id", crypto.randomUUID());
        return fetch(input, { ...init, headers });
      },
    },
  });
  return client;
}

export function sb(): SupabaseClient {
  if (!client) throw new Error("Supabase not initialised");
  return client;
}

/** Map PostgREST / Postgres errors to messages a business user understands. */
export function friendlyError(err: unknown): string {
  const e = err as { code?: string; message?: string; details?: string } | null;
  if (!e) return "Something went wrong";
  // Business-rule errors raised by our database functions carry a readable
  // message (e.g. "Insufficient stock for …") — show it as-is. Only raw
  // constraint violations get the generic wording below.
  const raw = e.message ?? "";
  const isConstraintText = /violates|duplicate key|null value in column|invalid input syntax/i.test(raw);
  if (raw && !isConstraintText && ["23514", "23502", "22023", "P0002", "42501"].includes(e.code ?? "")) {
    return e.code === "42501" && /permission denied for/i.test(raw) ? "You don't have permission to do this." : raw;
  }
  switch (e.code) {
    case "23505":
      return "A record with the same code/name already exists.";
    case "23503":
      return "This record is linked to another record that doesn't exist or can't be changed.";
    case "23514":
      return "A value is outside the allowed range. Please check the highlighted fields.";
    case "23502":
      return "A required value is missing.";
    case "42501":
      return "You don't have permission to do this.";
    case "PGRST116":
      return "Record not found or you don't have access to it.";
    default:
      return e.message ?? "Something went wrong";
  }
}
