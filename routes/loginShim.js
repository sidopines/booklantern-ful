// routes/loginShim.js
// Minimal routes to support Supabase auth redirects + login/register/account pages.
// This version NEVER redirects /auth/callback to /login. It renders a page that
// completes OAuth/email verification and shows a password form for recovery.

const express = require('express');
const router = express.Router();

/** Build an absolute canonical URL for meta tags */
function canonical(req) {
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

/**
 * Finalize Supabase email/OAuth flows.
 *
 * We purposely render a small client page that:
 * - For type=recovery → shows "set new password" form and calls supabase.auth.updateUser().
 * - For type=signup / type=magiclink / type=invitation → confirms session then sends to /login?confirmed=1.
 * - For anything else, if a session exists → go home, else show a helpful message.
 *
 * IMPORTANT: Do not redirect this route to /login. Let the client JS read the URL
 * (query OR hash) that Supabase attaches and finish the flow.
 */
router.get(/^\/auth\/callback(?:.*)?$/, (req, res) => {
  res.render('auth-callback', {
    canonicalUrl: canonical(req),
  });
});

/**
 * Backstop for *old* email templates that linked directly to /auth/callback with
 * extra suffixes (some mail clients mangle them). This keeps them working.
 */
router.get('/auth/callback/*', (req, res) => {
  res.render('auth-callback', {
    canonicalUrl: canonical(req),
  });
});

/**
 * If someone hits /auth/v1/verify directly (copied link without redirect_to),
 * show a gentle message instead of a 404. (Supabase usually 302s to redirect_to.)
 */
router.get(/^\/auth\/v1\/verify(?:.*)?$/, (_req, res) => {
  res.status(400).render('auth-callback', {
    canonicalUrl: '',
  });
});

/** Login page (email/password + Google/Apple buttons) */
router.get('/login', (req, res) => {
  res.render('login', {
    canonicalUrl: canonical(req),
  });
});

/** Register page (same UX as login or dedicated template if you have one) */
router.get('/register', (req, res) => {
  // If you keep a separate register.ejs, swap to 'register'
  res.render('register', {
    canonicalUrl: canonical(req),
  });
});

/** Account page (client reads Supabase user on load) */
router.get('/account', (req, res) => {
  res.render('account', {
    canonicalUrl: canonical(req),
  });
});

module.exports = router;
