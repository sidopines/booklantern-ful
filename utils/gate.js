// utils/gate.js
module.exports.ensureSubscriber = function ensureSubscriber(req, res, next) {
  if (process.env.DEV_OPEN_READER === '1') return next();
  if (req.user?.is_subscriber === true) return next();
  // TRUST the signed cookie set by /api/auth/session-cookie
  if (req.signedCookies && req.signedCookies.bl_sub === '1') return next();
  return res.redirect(302, '/login?next=' + encodeURIComponent(req.originalUrl));
};
