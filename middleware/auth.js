// middleware/auth.js

/**
 * ensureAuthenticated
 * - If logged in, proceed.
 * - If not, send them to /login?next=<originalUrl>
 */
function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();

  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?next=${nextUrl}`);
}

/**
 * ensureAdmin
 * - Requires an authenticated user with isAdmin === true
 * - If not admin, respond 403 to make it clear.
 */
function ensureAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.isAdmin) return next();

  // You can change this to a redirect if you prefer:
  // return res.redirect('/dashboard?err=admins_only');
  return res.status(403).send('Admins only');
}

module.exports = { ensureAuthenticated, ensureAdmin };
