// trainer-service — thin proxy from the browser to the Railway scan service.
//
// Exists for one reason: SCAN_API_KEY must never reach the browser. The page
// calls this with an action; this adds the bearer token and forwards.
// Same shape as proxy-service so there is one pattern to remember.
//
// Deploy:  supabase functions deploy trainer-service
// Secrets: SCAN_SERVICE_URL, SCAN_API_KEY  (already set for proxy-service)

const SERVICE = (Deno.env.get("SCAN_SERVICE_URL") || "").replace(/\/$/, "");
const KEY = Deno.env.get("SCAN_API_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!SERVICE || !KEY) {
    return json({ error: "SCAN_SERVICE_URL or SCAN_API_KEY not set on the function" }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }

  const action = String(body.action || "");
  delete body.action;

  // Explicit allow-list. An open forwarder with a bearer token attached is a
  // credential leak with extra steps.
  const ROUTES: Record<string, { method: string; path: (b: any) => string }> = {
    case:    { method: "POST", path: () => "/trainer/case" },
    test:    { method: "POST", path: () => "/trainer/test" },
    sweep:   { method: "POST", path: () => "/trainer/sweep" },
    status:  { method: "GET",  path: (b) => `/trainer/sweep/${encodeURIComponent(String(b.sweep_id || ""))}` },
    job:     { method: "GET",  path: (b) => `/jobs/${encodeURIComponent(String(b.job_id || ""))}` },
    health:  { method: "GET",  path: () => "/health" },
  };

  const route = ROUTES[action];
  if (!route) return json({ error: `unknown action '${action}'` }, 400);

  try {
    const r = await fetch(SERVICE + route.path(body), {
      method: route.method,
      headers: {
        "Authorization": `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: route.method === "POST" ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    try {
      return json(JSON.parse(text), r.status);
    } catch {
      return json({ error: text.slice(0, 400) }, r.status);
    }
  } catch (e) {
    return json({ error: `could not reach scan service: ${String(e).slice(0, 200)}` }, 502);
  }
});
