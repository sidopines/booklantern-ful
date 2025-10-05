// routes/admin.js
const express = require("express");
const router = express.Router();
let supabase = null;

// Lazy import to avoid throwing at require() time if not installed
let createClient;
try {
  ({ createClient } = require("@supabase/supabase-js"));
} catch (e) {
  console.warn("[admin] @supabase/supabase-js not installed yet.");
}

function getSupabase() {
  if (supabase) return supabase;
  if (!createClient) return null;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn("[admin] Supabase not configured; admin API disabled.");
    return null;
  }
  supabase = createClient(url, key);
  return supabase;
}

/**
 * Delete a Supabase Auth user by UUID
 * POST /admin/delete-user
 * Headers: X-Admin-Token: <ADMIN_API_TOKEN>
 * Body: { "user_id": "<uuid>" }
 */
router.post("/delete-user", async (req, res) => {
  const token = req.get("X-Admin-Token");
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    return res.status(403).json({ error: "Unauthorized" });
  }

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
    console.error("Delete user failed:", err.message);
    return res.status(500).json({ error: "Delete failed" });
  }
});

module.exports = router;
