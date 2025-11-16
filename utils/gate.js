// utils/gate.js
const { createClient } = require('@supabase/supabase-js');

const DEV_OPEN_READER = process.env.DEV_OPEN_READER === '1';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * ensureSubscriber
 * - Trusts Supabase auth tokens/claims
 * - Checks is_subscriber from user metadata
 * - Redirects to /login if not authenticated or not subscribed
 * - DEV_OPEN_READER=1 bypasses auth for testing (unsafe for production)
 */
async function ensureSubscriber(req, res, next) {
  // Dev bypass (do not enable in production)
  if (DEV_OPEN_READER) return next();

  // Check if req.user already has is_subscriber claim
  if (req.user?.is_subscriber === true) return next();

  // Try to read access token from cookies
  const accessToken = req.cookies?.['sb-access-token'] || req.cookies?.['sb:token'];
  
  if (accessToken && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      
      const { data: { user }, error } = await supabase.auth.getUser(accessToken);
      
      if (!error && user && user.user_metadata?.is_subscriber === true) {
        req.user = {
          id: user.id,
          email: user.email,
          is_subscriber: true
        };
        return next();
      }
    } catch (err) {
      console.error('[ensureSubscriber] token validation error:', err.message);
    }
  }

  // Check for authenticated session (fallback)
  if (req.session && req.session.user) {
    return next();
  }

  // Save the requested URL for redirect after login
  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?next=${nextUrl}`);
}

module.exports = { ensureSubscriber };
