// utils/gate.js
// Ensure user is logged in via validated session (set by /api/auth/session-cookie after Supabase verify)
function isLoggedIn(req) {
  // Only trust req.session.user.id which is set after Supabase token validation
  const user = req.session && req.session.user;
  return Boolean(user && user.id);
}

module.exports.isLoggedIn = isLoggedIn;

module.exports.ensureSubscriber = function ensureSubscriber(req, res, next) {
  const loggedIn = isLoggedIn(req);
  const userId = req.session?.user?.id || 'none';
  // Debug headers
  res.set('X-BL-Gate', 'ensureSubscriber');
  res.set('X-BL-LoggedIn', loggedIn ? '1' : '0');
  res.set('X-BL-SessionUser', userId);
  
  if (loggedIn) return next();
  console.log('[auth] blocked', req.originalUrl);
  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(302, '/login?next=' + nextUrl);
};

module.exports.ensureSubscriberApi = function ensureSubscriberApi(req, res, next) {
  const loggedIn = isLoggedIn(req);
  const userId = req.session?.user?.id || 'none';
  // Debug headers
  res.set('X-BL-Gate', 'ensureSubscriberApi');
  res.set('X-BL-LoggedIn', loggedIn ? '1' : '0');
  res.set('X-BL-SessionUser', userId);
  
  if (loggedIn) return next();
  console.log('[auth] blocked API', req.originalUrl);
  const nextUrl = req.originalUrl || '/read';
  return res.status(401).json({ error: 'auth_required', next: '/login?next=' + encodeURIComponent(nextUrl) });
};
