// utils/gate.js

const DEV_OPEN_READER = process.env.DEV_OPEN_READER === '1';

/**
 * ensureSubscriber
 * - Trusts signed bl_sub cookie set by /api/auth/session-cookie
 * - Redirects to /login if not authenticated
 * - DEV_OPEN_READER=1 bypasses auth for testing (unsafe for production)
 */
async function ensureSubscriber(req, res, next) {
  try {
    if (DEV_OPEN_READER) return next();
    if (req.user?.is_subscriber === true) return next();
    if (req.signedCookies?.bl_sub === '1') return next();
    return res.redirect(302, '/login?next=' + encodeURIComponent(req.originalUrl));
  } catch {
    return res.redirect(302, '/login?next=' + encodeURIComponent(req.originalUrl));
  }
}

module.exports = { ensureSubscriber };
