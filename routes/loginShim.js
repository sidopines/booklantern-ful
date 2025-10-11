// routes/loginShim.js
// Minimal routes to support auth flows + account page without server sessions.

const express = require('express');
const router = express.Router();

/** Helper to build an absolute canonical URL for meta tags */
function canonical(req) {
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

/**
 * Auth callback page (handles ALL cases: signup confirm, OAuth, recovery, magic links).
 * Supabase will redirect here with tokens after you click links in email.
 */
router.get('/auth/callback', (req, res) => {
  res.render('auth-callback', {
    canonicalUrl: canonical(req),
  });
});

/** Back-compat: if anything hits /auth/callback/... keep rendering the same page */
router.get(/^\/auth\/callback(?:.*)?$/, (req, res) => {
  res.render('auth-callback', {
    canonicalUrl: canonical(req),
  });
});

/** Login page (email/password + Google/Apple buttons) */
router.get('/login', (req, res) => {
  res.render('login', {
    canonicalUrl: canonical(req),
  });
});

/** Register page — dedicated view */
router.get('/register', (req, res) => {
  res.render('register', {
    canonicalUrl: canonical(req),
  });
});

/** Account page (client pulls profile via Supabase on the page) */
router.get('/account', (req, res) => {
  res.render('account', {
    canonicalUrl: canonical(req),
  });
});

module.exports = router;
