// utils/gate.js

const ensureSubscriber = (req, res, next) => {
  if (process.env.DEV_OPEN_READER === '1') return next();
  if (req?.user?.is_subscriber === true) return next();
  if (req.signedCookies && req.signedCookies.bl_sub === '1') return next();
  const nextUrl = encodeURIComponent(req.originalUrl || '/unified-reader');
  return res.redirect(302, '/login?next=' + nextUrl);
};

module.exports = { ensureSubscriber };
