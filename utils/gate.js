// utils/gate.js

const DEV_OPEN_READER = process.env.DEV_OPEN_READER === '1';

/**
 * ensureSubscriber
 * - Requires valid Supabase session (reuses existing auth check)
 * - Checks is_subscriber claim from user/app metadata
 * - Redirects to /login if not authenticated or not subscribed
 * - DEV_OPEN_READER=1 bypasses auth for testing (unsafe for production)
 */
function ensureSubscriber(req, res, next) {
  // Dev bypass (do not enable in production)
  if (DEV_OPEN_READER) return next();

  // Check for is_subscriber claim in Supabase metadata
  const meta = (req.user && (req.user.user_metadata || req.user.app_metadata)) || {};
  if (meta.is_subscriber === true) return next();

  // Check for authenticated session (fallback)
  if (req.session && req.session.user) {
    return next();
  }

  // Save the requested URL for redirect after login
  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?next=${nextUrl}`);
}

module.exports = { ensureSubscriber };
