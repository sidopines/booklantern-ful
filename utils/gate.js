// utils/gate.js

const DEV_OPEN_READER = process.env.DEV_OPEN_READER === '1';

/**
 * ensureSubscriber
 * - Requires valid Supabase session (reuses existing auth check)
 * - Redirects to /auth if not authenticated
 * - DEV_OPEN_READER=1 bypasses auth for testing (unsafe for production)
 */
function ensureSubscriber(req, res, next) {
  // Dev bypass (do not enable in production)
  if (DEV_OPEN_READER) return next();

  // Check for authenticated session (same logic as ensureAuthenticated)
  if (req.session && req.session.user) {
    return next();
  }

  // Save the requested URL for redirect after login
  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/auth?next=${nextUrl}`);
}

module.exports = { ensureSubscriber };
