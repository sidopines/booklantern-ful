// utils/adminGate.js — lightweight admin gate that works with client auth
const cookieName = 'bl_admin';

module.exports = function ensureAdmin(req, res, next) {
  const secret = process.env.BL_ADMIN_SECRET || ''; // long random string
  const allowEmails = String(process.env.BL_ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  // Already unlocked via cookie?
  if (req.cookies && req.cookies[cookieName] === 'ok') return next();

  // One-time unlock: /admin?admin_key=SECRET  or header: x-admin-key: SECRET
  const key = String(req.query.admin_key || req.get('x-admin-key') || '');
  if (secret && key && key === secret) {
    res.cookie(cookieName, 'ok', {
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      maxAge: 7 * 24 * 3600 * 1000, // 7 days
    });
    // Clean admin_key from the URL
    const clean = req.originalUrl.replace(/([?&])admin_key=[^&]+(&|$)/, '$1').replace(/[?&]$/, '');
    return res.redirect(clean || '/admin');
  }

  // Optional: allow if a trusted proxy/app forwards the user email
  const fwdEmail = String(req.get('x-user-email') || '').toLowerCase();
  if (allowEmails.length && fwdEmail && allowEmails.includes(fwdEmail)) return next();

  // Not authorized → HTML users to /login; API callers get JSON
  if ((req.get('accept') || '').includes('json') || req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'forbidden' });
  }
  return res.redirect('/login');
};
