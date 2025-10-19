// utils/adminGate.js — simple gate with NO external packages
const ADMIN_SECRET = (process.env.ADMIN_SECRET || "").trim();
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * allow if:
 *  1) request sends the correct X-Admin-Token / ?admin_secret matching ADMIN_SECRET
 *  2) user email (from req.user / res.locals / header / cookie) is in ADMIN_EMAILS
 * otherwise -> redirect to /login
 */
module.exports = function ensureAdmin(req, res, next) {
  try {
    // option 1: shared secret header or query (useful for local testing or CI jobs)
    const hdrToken =
      req.get("x-admin-token") ||
      req.get("x-admin-secret") ||
      req.query.admin_secret;
    if (ADMIN_SECRET && hdrToken && hdrToken === ADMIN_SECRET) return next();

    // option 2: allowed email
    const email =
      (req.user && req.user.email) ||
      (res.locals && res.locals.user && res.locals.user.email) ||
      req.get("x-user-email") ||
      (req.cookies ? req.cookies["bl-user-email"] : null);

    if (email && ADMIN_EMAILS.includes(String(email).toLowerCase())) {
      return next();
    }
  } catch (e) {
    console.error("[adminGate] error:", e);
  }
  return res.redirect(302, "/login");
};
