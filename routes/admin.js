// routes/admin.js (final)
// Admin-only utility routes. CommonJS.

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// ---------- Supabase (optional) ----------
let supabase = null;
let createClient = null;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch (e) {
  console.warn('[admin] @supabase/supabase-js not installed yet.');
}

function getSupabase() {
  if (supabase) return supabase;
  if (!createClient) return null;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[admin] Supabase not configured; admin DB actions disabled.');
    return null;
    }
  supabase = createClient(url, key);
  return supabase;
}

// ---------- Admin token helpers ----------
function getConfiguredToken() {
  // Primary name, with a practical fallback in case of a typo in Render.
  const raw =
    process.env.ADMIN_API_TOKEN ??
    process.env.BL_ADMIN_TOKEN ??
    '';

  return String(raw).trim(); // remove stray whitespace/newlines
}

function constantTimeEqual(a, b) {
  // Compare secrets without timing leaks
  const abuf = Buffer.from(a);
  const bbuf = Buffer.from(b);
  if (abuf.length !== bbuf.length) return false;
  return crypto.timingSafeEqual(abuf, bbuf);
}

function extractPresentedToken(req) {
  // 1) Header (preferred)
  let t = req.get('X-Admin-Token');
  if (typeof t === 'string' && t.length > 0) return t.trim();
  // 2) Query (diagnostic / when proxies strip headers)
  if (typeof req.query?.token === 'string') return req.query.token.trim();
  // 3) Body (just in case someone posts it)
  if (typeof req.body?.token === 'string') return req.body.token.trim();
  return '';
}

const ADMIN_TOKEN = getConfiguredToken();
if (ADMIN_TOKEN) {
  console.log(
    `[admin] Admin API enabled (token length: ${ADMIN_TOKEN.length}).`
  );
} else {
  console.warn('[admin] Admin API disabled (no ADMIN_API_TOKEN set).');
}

function requireAdmin(req, res, next) {
  const configured = ADMIN_TOKEN;
  if (!configured) {
    return res.status(503).json({ ok: false, error: 'Admin API not configured' });
  }
  const presented = extractPresentedToken(req);
  if (!presented) {
    return res.status(403).json({ ok: false, error: 'Unauthorized' });
  }
  if (!constantTimeEqual(configured, presented)) {
    return res.status(403).json({ ok: false, error: 'Unauthorized' });
  }
  return next();
}

// ---------- Routes ----------

/**
 * Diagnostic: tells you why auth failed (does NOT leak secrets).
 * Call with:
 *   GET /admin/debug-auth?token=YOUR_TOKEN
 * or:
 *   curl -H "X-Admin-Token: YOUR_TOKEN" https://booklantern.org/admin/debug-auth
 */
router.get('/debug-auth', (req, res) => {
  const configured = ADMIN_TOKEN;
  const presented = extractPresentedToken(req);

  const info = {
    hasConfiguredToken: Boolean(configured),
    configuredTokenLength: configured ? configured.length : 0,
    presentedTokenLength: presented ? presented.length : 0,
    // just show first/last 4 for sanity; never the whole token
    presentedPreview:
      presented && presented.length >= 8
        ? `${presented.slice(0, 4)}…${presented.slice(-4)}`
        : presented || '',
    match:
      configured && presented
        ? constantTimeEqual(configured, presented)
        : false,
  };
  // No secrets exposed; safe to return 200 for debugging.
  return res.json({ ok: true, auth: info });
});

/**
 * Insert a debug row into public.contact_messages (protected).
 * POST /admin/debug-contact-insert
 * Header:  X-Admin-Token: <ADMIN_API_TOKEN>
 * or use:  ?token=<ADMIN_API_TOKEN>
 */
router.post('/debug-contact-insert', requireAdmin, async (req, res) => {
  const sb = getSupabase();
  if (!sb) {
    return res.status(503).json({
      ok: false,
      error: 'Supabase admin not configured on server',
    });
  }
  try {
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from('contact_messages')
      .insert({
        name: 'Debug',
        email: 'debug@booklantern.org',
        message: `Hello from /admin/debug-contact-insert at ${now}`,
        ip: null,
        user_agent: 'debug',
      })
      .select()
      .limit(1);

    if (error) throw error;
    return res.json({ ok: true, data });
  } catch (e) {
    console.error('[admin] debug insert failed:', e.message || e);
    return res.status(500).json({ ok: false, error: 'Insert failed' });
  }
});

/**
 * Delete a Supabase Auth user by UUID (unchanged, protected).
 * POST /admin/delete-user
 * Header or query must include the admin token.
 * Body: { "user_id": "<uuid>" }
 */
router.post('/delete-user', requireAdmin, async (req, res) => {
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ ok: false, error: 'user_id required' });

  const sb = getSupabase();
  if (!sb) {
    return res
      .status(503)
      .json({ ok: false, error: 'Admin API disabled (missing Supabase config)' });
  }

  try {
    const { error } = await sb.auth.admin.deleteUser(user_id);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] delete user failed:', err.message);
    return res.status(500).json({ ok: false, error: 'Delete failed' });
  }
});

module.exports = router;
