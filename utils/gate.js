// utils/gate.js
// Ensure user is logged in via validated session (set by /api/auth/session-cookie after Supabase verify)
function isLoggedIn(req) {
  // Only trust req.session.user.id which is set after Supabase token validation
  const user = req.session && req.session.user;
  return Boolean(user && user.id);
}

module.exports.ensureSubscriber = function ensureSubscriber(req, res, next) {
  if (process.env.DEV_OPEN_READER === '1') return next();
  if (isLoggedIn(req)) return next();
  console.log('[auth] blocked', req.originalUrl);
  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(302, '/auth?next=' + nextUrl);
};

module.exports.ensureSubscriberApi = function ensureSubscriberApi(req, res, next) {
  if (process.env.DEV_OPEN_READER === '1') return next();
  if (isLoggedIn(req)) return next();
  console.log('[auth] blocked', req.originalUrl);
  const nextUrl = req.originalUrl || '/read';
  return res.status(401).json({ error: 'auth_required', next: '/auth?next=' + encodeURIComponent(nextUrl) });
};
