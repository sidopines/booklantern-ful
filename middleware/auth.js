// middleware/auth.js
// Tiny helpers to protect routes.
// We'll use requireAdmin for the Admin dashboard & APIs.

function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?next=${nextUrl}`);
}

function requireAdmin(req, res, next) {
  const u = req.session && req.session.user;
  if (u && u.isAdmin) return next();

  if (!u) {
    const nextUrl = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/login?next=${nextUrl}`);
  }
  // Keep this simple to avoid template errors if 403.ejs doesn't exist
  return res.status(403).send('Admin access required.');
}

// Optional: keep res.locals.user in sync (safe even if you already set it in server.js)
function injectUser(req, res, next) {
  res.locals.user = req.session?.user || null;
  next();
}

module.exports = {
  requireLogin,
  requireAdmin,
  injectUser,
};
