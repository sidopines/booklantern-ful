// utils/adminGate.js
// Pragmatic admin gate that won't 302 legit admins.
// It supports three ways to allow access:
//
// 1) Temporary bypass for staging:
//    set BYPASS_ADMIN=1
//
// 2) Static admin token (good for tools/CRON):
//    set ADMIN_TOKEN=...   and send header  X-Admin-Token: <token>
//
// 3) Email allowlist (best for real users):
//    set ADMIN_EMAILS=admin@example.com,editor@example.com
//    and forward X-User-Email: <their email> from your edge/proxy,
//    OR if you haven't wired that, this gate will accept any request
//    that has a Supabase auth cookie *when ADMIN_EMAILS is not set*.
//    (That lets you test the dashboard without wiring SSR auth.)
//
function parseCookie(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) {
      const k = p.slice(0, i).trim();
      const v = p.slice(i + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

module.exports = function ensureAdmin(req, res, next) {
  // 1) Staging bypass
  if (process.env.BYPASS_ADMIN === '1') return next();

  // 2) Header token
  const hdrToken = req.get('x-admin-token');
  if (hdrToken && process.env.ADMIN_TOKEN && hdrToken === process.env.ADMIN_TOKEN) {
    return next();
  }

  // 3) Email allowlist
  const allow = String(process.env.ADMIN_EMAILS || '')
    .toLowerCase()
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const emailHdr = String(req.get('x-user-email') || '').toLowerCase();

  if (allow.length && emailHdr && allow.includes(emailHdr)) {
    return next();
  }

  // 4) If no allowlist configured, accept any signed-in Supabase user
  //    (we just check for a Supabase auth cookie so you can test the admin)
  if (!allow.length) {
    const cookieHeader = req.headers.cookie || '';
    const cookies = parseCookie(cookieHeader);
    const hasSb =
      cookies['sb-access-token'] ||
      cookies['supabase-auth-token'] || // older helper
      (cookieHeader && /\bsb-access-token=/.test(cookieHeader));
    if (hasSb) return next();
  }

  // Not allowed
  if (req.accepts('html')) return res.redirect(302, '/login');
  return res.status(401).json({ error: 'admin_only' });
};
