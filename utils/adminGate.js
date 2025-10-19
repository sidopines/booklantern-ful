// utils/adminGate.js
// Admits admin if ANY of the following is true:
// 1) Request carries header X-Admin-Token that matches ADMIN_SECRET
// 2) The authenticated user email matches one in ADMIN_EMAILS (comma-separated)
//
// NOTE: This does not depend on client SDK; it only checks headers/cookies we can see.

const jwt = require('jsonwebtoken');

const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Try to pull a Supabase JWT from the "Authorization: Bearer" header or cookie "sb-access-token"
function getJwtFromReq(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7);
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function emailFromSupabaseJwt(token) {
  if (!token) return '';
  try {
    const payload = jwt.decode(token) || {};
    // Supabase puts email at payload.email
    return (payload.email || '').toLowerCase();
  } catch {
    return '';
  }
}

module.exports = function ensureAdmin(req, res, next) {
  // Path 1: shared header secret (useful for now)
  const hdr = req.headers['x-admin-token'];
  if (ADMIN_SECRET && hdr && hdr === ADMIN_SECRET) return next();

  // Path 2: allow-list by email via Supabase JWT
  const token = getJwtFromReq(req);
  const email = emailFromSupabaseJwt(token);
  if (email && ADMIN_EMAILS.includes(email)) return next();

  // Not authorized — bounce to login (keeps UI flow consistent)
  return res.redirect(302, '/login');
};
