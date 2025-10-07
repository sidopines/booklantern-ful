// routes/admin.js
const express = require("express");
const router = express.Router();

// --- Lazy-load Supabase client so the app still boots if lib isn't installed
let createClient;
try {
  ({ createClient } = require("@supabase/supabase-js"));
} catch (e) {
  console.warn("[admin] @supabase/supabase-js not installed yet.");
}

let supabase = null;
function getSupabase() {
  if (supabase) return supabase;
  if (!createClient) return null;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // MUST be the *service role* key

  const hasUrl = !!url;
  const hasKey = !!key;
  if (!hasUrl || !hasKey) {
    console.warn("[admin] Supabase not configured; admin API limited.", { hasUrl, hasKey });
    return null;
  }
  supabase = createClient(url, key);
  return supabase;
}

// --- Admin token guard (single place)
function requireAdminToken(req, res) {
  const token = req.get("X-Admin-Token") || "";
  const configured = process.env.ADMIN_API_TOKEN || "";
  const ok = configured && token && token === configured;
  if (!ok) {
    return res.status(403).json({ ok: false, error: "Unauthorized" });
  }
  return true;
}

/**
 * Health: check token comparison (for troubleshooting)
 * GET /admin/debug-auth
 */
router.get("/debug-auth", (req, res) => {
  const presented = req.get("X-Admin-Token") || "";
  const configured = process.env.ADMIN_API_TOKEN || "";
  res.json({
    ok: !!configured,
    auth: {
      hasConfiguredToken: !!configured,
      configuredTokenLength: configured.length,
      presentedTokenLength: presented.length,
      presentedPreview: presented ? presented.slice(0, 4) + "…" + presented.slice(-3) : "",
      match: configured && presented && configured === presented
    }
  });
});

/**
 * NEW: quick env check (no secrets leaked)
 * GET /admin/env-check
 */
router.get("/env-check", (req, res) => {
  if (requireAdminToken(req, res) !== true) return;
  res.json({
    ok: true,
    env: {
      has_SUPABASE_URL: !!process.env.SUPABASE_URL,
      has_SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  });
});

/**
 * TEMP (POST): try inserting a debug row into public.contact_messages and
 * return verbose Supabase error if it fails.
 * POST /admin/debug-contact-insert
 */
router.post("/debug-contact-insert", async (req, res) => {
  if (requireAdminToken(req, res) !== true) return;

  const sb = getSupabase();
  if (!sb) {
    return res.status(503).json({ ok: false, error: "Admin API disabled (missing Supabase config)" });
  }

  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;
    const ua = req.get("user-agent") || null;

    const { error } = await sb
      .from("contact_messages")
      .insert({
        name: "Debug User",
        email: "debug@booklantern.org",
        message: "Debug insert from /admin/debug-contact-insert",
        ip,
        user_agent: ua
      });

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message || String(error),
        details: error.details || null,
        hint: error.hint || null,
        code: error.code || null
      });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("[admin] debug-contact-insert unexpected error:", e);
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

/**
 * NEW (GET variant): same insert as above but via GET (no body/HTTP2 quirks)
 * GET /admin/debug-contact-insert-get
 */
router.get("/debug-contact-insert-get", async (req, res) => {
  if (requireAdminToken(req, res) !== true) return;

  const sb = getSupabase();
  if (!sb) {
    return res.status(503).json({ ok: false, error: "Admin API disabled (missing Supabase config)" });
  }

  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;
    const ua = req.get("user-agent") || null;

    const { error } = await sb
      .from("contact_messages")
      .insert({
        name: "Debug GET",
        email: "debug-get@booklantern.org",
        message: "Debug insert from /admin/debug-contact-insert-get",
        ip,
        user_agent: ua
      });

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message || String(error),
        details: error.details || null,
        hint: error.hint || null,
        code: error.code || null
      });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("[admin] debug-contact-insert-get unexpected error:", e);
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

/**
 * Delete a Supabase Auth user by UUID
 * POST /admin/delete-user
 * Headers: X-Admin-Token: <ADMIN_API_TOKEN>
 * Body: { "user_id": "<uuid>" }
 */
router.post("/delete-user", async (req, res) => {
  if (requireAdminToken(req, res) !== true) return;

  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: "user_id required" });

  const sb = getSupabase();
  if (!sb) {
    return res.status(503).json({ error: "Admin API disabled (missing Supabase config)" });
  }

  try {
    const { error } = await sb.auth.admin.deleteUser(user_id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    console.error("[admin] Delete user failed:", err?.message || err);
    return res.status(500).json({ error: "Delete failed" });
  }
});

module.exports = router;
