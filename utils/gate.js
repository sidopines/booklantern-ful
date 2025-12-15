// utils/gate.js
// Ensure user is logged in (treat ANY logged-in user as subscriber until paid tier exists)
function isLoggedIn(req) {
  const user = req.authUser || req.user || (req.session && req.session.user);
  if (user && (user.id || user._id || user.email || user.is_subscriber)) return true;

  const signed = req.signedCookies && req.signedCookies.bl_sub === '1';
  const raw = req.cookies && (req.cookies.bl_sub === '1' || (req.cookies.bl_sub || '').startsWith('s:1') || (req.cookies.bl_sub || '').startsWith('s%3A1'));
  return signed || raw;
}

module.exports.ensureSubscriber = function ensureSubscriber(req, res, next) {
  if (process.env.DEV_OPEN_READER === '1') return next();
  if (isLoggedIn(req)) return next();
  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(302, '/auth?next=' + nextUrl);
};

module.exports.ensureSubscriberApi = function ensureSubscriberApi(req, res, next) {
  if (process.env.DEV_OPEN_READER === '1') return next();
  if (isLoggedIn(req)) return next();
  const nextUrl = req.originalUrl || '/read';
  return res.status(401).json({ error: 'auth_required', next: '/auth?next=' + encodeURIComponent(nextUrl) });
};
