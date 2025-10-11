// routes/loginShim.js
// Minimal routes to support Supabase auth flows without server sessions.

const express = require('express');
const router = express.Router();

/** Helper to build an absolute canonical URL for meta tags */
function canonical(req) {
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

/**
 * IMPORTANT: render a real page for /auth/callback so the client JS
 * can read tokens from the URL hash and complete the flow.
 */
router.get('/auth/callback', (req, res) => {
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

/** Register page */
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
