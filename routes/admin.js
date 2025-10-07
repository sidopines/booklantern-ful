// routes/admin.js (final, robust)
const express = require("express");
const router = express.Router();

// ---- Lazy import so require() doesn't explode if package missing during build
let createClient;
try {
  ({ createClient } = require("@supabase/supabase-js"));
} catch (e) {
  console.warn("[admin] @supabase/supabase-js not installed yet.");
}

// ---- Single cached Supabase admin client (service role)
let supabase = null;
function getSupabase() {
  if (supabase) return supabase;
  if (!createClient) return null;

  const url = (process.env.SUPABASE_URL || "").trim();
  // IMPORTANT: env name must be SUPABASE_SERVICE_ROLE_KEY
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url || !key) {
    console.warn("[admin] Missing Supabase config", { hasUrl: !!url, hasKey: !!key });
    return null;
  }
  supabase = createClient(url, key);
  return supabase;
}

// ---- Token helpers
function getConfiguredToken() {
  return (process.env.ADMIN_API_TOKEN || "").trim();
}
function getPresentedToken(req) {
  const fromHeader = (req.get("X-Admin-Token") || "").trim();
  const fromQuery  = (req.query && req.query.token ? String(req.query.token) : "").trim();
  const fromBody   = (req.body && req.body.token ? String(req.body.token) : "").trim();
  return fromHeader || fromQuery || fromBody || "";
}
function requireAdmin(req, res) {
  const configured = getConfiguredToken();
  const presented  = getPresentedToken(req);
  if (!configured || !presented || configured !== presented) {
    return {
      ok: false,
      error: "Unauthorized",
      details: {
        hasConfiguredToken: !!configured,
        configuredTokenLength: configured.length,
        hasPresentedToken: !!presented,
        presentedTokenLength: presented.length,
        // only short preview for safety
        presentedPreview: presented ? presented.slice(0, 4) + "…" + presented.slice(-4) : "",
        match: configured && presented && configured === presented
      }
    };
  }
  return { ok: true };
}

// ---------------- Routes ----------------

/**
 * Quick check your header token is reaching the server intact.
 * GET /admin/debug-auth
 * Header: X-Admin-Token: <ADMIN_API_TOKEN>
 * Or:    /admin/debug-auth?token=<ADMIN_API_TOKEN>
 */
router.get("/debug-auth", (req, res) => {
  const configured = getConfiguredToken();
  const presented  = getPresentedToken(req);
  return res.json({
    ok: !!configured && !!presented && configured === presented,
    auth: {
      hasConfiguredToken: !!configured,
      configuredTokenLength: configured.length,
      presentedTokenLength: presented.length,
      presentedPreview: presented ? presented.slice(0, 4) + "…" + presented.slice(-4) : "",
      match: configured && presented && configured === presented
    }
  });
});

/**
 * Insert a test row into public.contact_messages to verify Supabase wiring.
 * POST /admin/debug-contact-insert
 * Header: X-Admin-Token: <ADMIN_API_TOKEN>
 * Or:     body/query with "token"
 */
router.post("/debug-contact-insert", async (req, res) => {
  const gate = requireAdmin(req, res);
  if (!gate.ok) return res.status(403).json({ ok: false, error: "Unauthorized", details: gate.details });

  const sb = getSupabase();
  if (!sb) {
    return res.status(503).json({
      ok: false,
      error: "Supabase admin not configured",
      hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Render env vars"
    });
  }

  try {
    const ip =
      (req.headers["x-forwarded-for"] || "")
        .toString()
        .split(",")[0]
        .trim() || req.ip || null;

    const ua = req.get("user-agent") || null;

    const payload = {
      name: "Debug User",
      email: "debug@example.com",
      message: "Hello from /admin/debug-contact-insert",
      ip,
      user_agent: ua
    };

    const { error } = await sb.from("contact_messages").insert(payload);
    if (error) throw error;

    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin] debug insert failed:", err);
    return res.status(500).json({ ok: false, error: "Insert failed" });
  }
});

/**
 * Delete a Supabase Auth user by UUID
 * POST /admin/delete-user
 * Header: X-Admin-Token: <ADMIN_API_TOKEN>
 * Body: { "user_id": "<uuid>" }
 */
router.post("/delete-user", async (req, res) => {
  const gate = requireAdmin(req, res);
  if (!gate.ok) return res.status(403).json({ error: "Unauthorized", details: gate.details });

  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: "user_id required" });

  const sb = getSupabase();
  if (!sb) {
    return res
      .status(503)
      .json({ error: "Admin API disabled (missing Supabase config)" });
  }

  try {
    const { error } = await sb.auth.admin.deleteUser(user_id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    console.error("[admin] Delete user failed:", err.message);
    return res.status(500).json({ error: "Delete failed" });
  }
});

module.exports = router;
