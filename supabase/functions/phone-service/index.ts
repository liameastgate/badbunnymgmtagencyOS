// phone-service — browser -> Railway phone service, keeping the bearer key
// server-side. Same shape as proxy-service / trainer-service.
//
// The key is read from app_secrets (key='phone_api_key') with the service
// role, falling back to a PHONE_API_KEY function secret. Either works; the
// table means no CLI step to rotate it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SERVICE = (Deno.env.get("PHONE_SERVICE_URL") ||
  "https://phone-service-production-e15c.up.railway.app").replace(/\/$/, "");

async function apiKey(): Promise<string> {
  const env = Deno.env.get("PHONE_API_KEY");
  if (env) return env;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data } = await sb.from("app_secrets").select("value").eq("key", "phone_api_key").maybeSingle();
  return data?.value || "";
}

// Explicit allow-list — an open forwarder with a bearer token is a leak.
const ROUTES: Record<string, { method: string; path: (b: any) => string; body?: boolean }> = {
  health:  { method: "GET",  path: () => "/health" },
  status:  { method: "GET",  path: () => "/queue/status" },
  sync:    { method: "POST", path: (b) => `/accounts/sync?backend=${encodeURIComponent(String(b.backend || "multilogin"))}` },
  queue:   { method: "POST", path: () => "/queue", body: true },
  probe:   { method: "POST", path: () => "/probe", body: true },
  job:     { method: "GET",  path: (b) => `/jobs/${encodeURIComponent(String(b.job_id || ""))}` },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const KEY = await apiKey();
  if (!KEY) return json({ error: "phone_api_key missing from app_secrets" }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const action = String(body.action || "");
  delete body.action;
  const route = ROUTES[action];
  if (!route) return json({ error: `unknown action '${action}'` }, 400);

  try {
    const r = await fetch(SERVICE + route.path(body), {
      method: route.method,
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: route.body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    try { return json(JSON.parse(t), r.status); } catch { return json({ error: t.slice(0, 400) }, r.status); }
  } catch (e) {
    return json({ error: `phone service unreachable: ${String(e).slice(0, 200)}` }, 502);
  }
});
