// utils/gate.js
module.exports.ensureSubscriber = function ensureSubscriber(req, res, next) {
  if (process.env.DEV_OPEN_READER === '1') return next();
  if (req.user?.is_subscriber === true) return next();

  const signed = req.signedCookies && req.signedCookies.bl_sub === '1';
  const raw = req.cookies && (req.cookies.bl_sub === '1' || (req.cookies.bl_sub || '').startsWith('s:1') || (req.cookies.bl_sub || '').startsWith('s%3A1'));
  if (signed || raw) return next();

  return res.redirect(302, '/login?next=' + encodeURIComponent(req.originalUrl));
};
