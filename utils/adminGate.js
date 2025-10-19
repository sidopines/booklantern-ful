// utils/adminGate.js
// Gate /admin/* routes. Allows either:
// 1) X-Admin-Token header that matches process.env.ADMIN_API_TOKEN
// 2) A valid Supabase access token (cookie or Authorization header) whose user has role "admin"
//    in app_metadata.role or user_metadata.role.
//
// Requires: supabaseAdmin.js (service-role client) to be configured.

const supabase = require('../supabaseAdmin');

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

module.exports = async function ensureAdmin(req, res, next) {
  try {
    // 0) Emergency/bot access: static header token
    const bypass = req.get('X-Admin-Token') || req.get('x-admin-token');
    if (bypass && process.env.ADMIN_API_TOKEN && bypass === process.env.ADMIN_API_TOKEN) {
      return next();
    }

    // 1) Find a Supabase access token: Authorization: Bearer <jwt> OR cookie
    const auth = req.get('Authorization') || req.get('authorization') || '';
    let token = '';
    if (auth.startsWith('Bearer ')) token = auth.slice(7).trim();

    if (!token) {
      const cookies = parseCookies(req.get('cookie') || '');
      // Supabase Auth Helpers commonly use these cookie names:
      token =
        cookies['sb-access-token'] ||
        cookies['access_token'] ||
        cookies['supabase-access-token'] ||
        '';
    }

    if (!token) {
      // Not authenticated -> send to login (or 401 if this is API)
      if (req.accepts('html')) return res.redirect('/login');
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // 2) Validate the token and fetch the user with the service role
    if (!supabase || !supabase.auth || typeof supabase.auth.getUser !== 'function') {
      console.warn('[adminGate] Supabase not configured; allowing access (dev fallback).');
      return next(); // Dev fallback; remove if you want strict behavior
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) {
      if (req.accepts('html')) return res.redirect('/login');
      return res.status(401).json({ error: 'Invalid auth' });
    }

    const user = data.user;
    const role =
      (user.app_metadata && user.app_metadata.role) ||
      (user.user_metadata && user.user_metadata.role) ||
      user.role ||
      '';

    if (String(role).toLowerCase() !== 'admin') {
      if (req.accepts('html')) return res.status(403).send('Forbidden (admin only)');
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Attach user for downstream handlers if helpful
    req.adminUser = user;
    return next();
  } catch (e) {
    console.error('[adminGate] unexpected error:', e);
    if (req.accepts('html')) return res.status(500).send('Admin gate error');
    return res.status(500).json({ error: 'Admin gate error' });
  }
};
