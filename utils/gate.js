// utils/gate.js

/**
 * ensureSubscriber
 * - Requires valid Supabase session (reuses existing auth check)
 * - Redirects to /auth if not authenticated
 */
function ensureSubscriber(req, res, next) {
  // Check for authenticated session (same logic as ensureAuthenticated)
  if (req.session && req.session.user) {
    return next();
  }

  // Save the requested URL for redirect after login
  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/auth?next=${nextUrl}`);
}

module.exports = { ensureSubscriber };
