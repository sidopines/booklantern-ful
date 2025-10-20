// routes/loginShim.js
const express = require('express');
const router = express.Router();

/**
 * Utility: build safe meta locals for header.ejs and OG tags
 */
function meta(req, title, desc = 'Free books & educational videos.') {
  return {
    pageTitle: title,
    pageDescription: desc,
    // header.ejs can derive og:url if req exists; harmless if unused.
    req,
  };
}

/**
 * /login — render the login page (never 404)
 */
router.get('/login', (req, res) => {
  res.status(200).render('login', meta(req, 'Login • BookLantern'));
});

/**
 * /register — render the register page (never 404)
 */
router.get('/register', (req, res) => {
  res.status(200).render('register', meta(req, 'Create account • BookLantern'));
});

/**
 * /auth/open
 * Handles PKCE-style email links: /auth/open?type=recovery&th=<token_hash>
 * Renders a tiny page that runs supabase.auth.verifyOtp(...) in the browser,
 * then forwards to /auth/callback?type=recovery
 */
router.get('/auth/open', (req, res) => {
  const type = String(req.query.type || '');
  const th   = String(req.query.th || '');
  res.render('auth-open', {
    ...meta(req, 'Almost there…', 'Continue resetting your password.'),
    canonicalUrl: req.protocol + '://' + req.get('host') + req.originalUrl,
    type,
    th
  });
});

/**
 * /auth/callback
 * Neutral page to finalize auth in the browser (tokens in hash / PKCE exchanges).
 * Your views/auth-callback.ejs can do the rest.
 */
router.get('/auth/callback', (req, res) => {
  res.render('auth-callback', {
    ...meta(req, 'Almost there…', 'Complete your login or password update.'),
    canonicalUrl: req.protocol + '://' + req.get('host') + req.originalUrl
  });
});

module.exports = router;
