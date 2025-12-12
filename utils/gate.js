// utils/gate.js
// Ensure user is logged in (treat ANY logged-in user as subscriber until paid tier exists)
module.exports.ensureSubscriber = function ensureSubscriber(req, res, next) {
  if (process.env.DEV_OPEN_READER === '1') return next();
  
  // Treat any logged-in user as subscriber (no paid tier yet)
  const user = req.user || (req.session && req.session.user);
  if (user && (user.id || user._id || user.email || user.is_subscriber)) {
    return next();
  }

  // Legacy cookie check for backwards compatibility
  const signed = req.signedCookies && req.signedCookies.bl_sub === '1';
  const raw = req.cookies && (req.cookies.bl_sub === '1' || (req.cookies.bl_sub || '').startsWith('s:1') || (req.cookies.bl_sub || '').startsWith('s%3A1'));
  if (signed || raw) return next();

  return res.redirect(302, '/login?next=' + encodeURIComponent(req.originalUrl));
};
