// routes/loginShim.js
// Minimal, robust routes for login/register/account and Supabase auth flows.
// IMPORTANT: We DO NOT redirect away from /auth/callback — we render a page there
// so the URL fragment (#access_token…) remains available to client JS.

const express = require('express');
const router = express.Router();

/** Absolute canonical URL for meta tags */
function canonical(req) {
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

/** Make sure sensitive auth pages are never cached by intermediaries/browsers */
function noCache(res) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
  });
}

/**
 * Supabase redirects (email confirm, OAuth, recovery) land here.
 * We render an HTML page (views/auth-callback.ejs) that:
 *  - Listens for Supabase auth events
 *  - If PASSWORD_RECOVERY → shows "set new password" UI and calls updateUser({ password })
 *  - Otherwise → sends user to /login?confirmed=1 (or straight to /account)
 *
 * We match /auth/callback and anything under it to be future-proof.
 */
router.get(/^\/auth\/callback(?:\/.*)?$/, (req, res) => {
  noCache(res);
  return res.render('auth-callback', {
    canonicalUrl: canonical(req),
  });
});

/** Login page (email/password + Google/Apple buttons) */
router.get('/login', (req, res) => {
  return res.render('login', {
    canonicalUrl: canonical(req),
  });
});

/** Register page (dedicated view, not an alias of /login) */
router.get('/register', (req, res) => {
  return res.render('register', {
    canonicalUrl: canonical(req),
  });
});

/** Account page (client reads Supabase session to show user info) */
router.get('/account', (req, res) => {
  return res.render('account', {
    canonicalUrl: canonical(req),
  });
});

module.exports = router;
