// routes/loginShim.js
const express = require('express');
const router = express.Router();

/**
 * /auth/open
 * Handles PKCE-style email links: /auth/open?type=recovery&th=<token_hash>
 * We render a tiny page that runs supabase.auth.verifyOtp(...) in the browser,
 * and then sends the user to /auth/callback?type=recovery
 */
router.get('/auth/open', (req, res) => {
  const type = String(req.query.type || '');
  const th   = String(req.query.th || '');
  // Render the view either way; the client JS will show an error if missing.
  res.render('auth-open', {
    pageTitle: 'Almost there…',
    pageDescription: 'Continue resetting your password.',
    canonicalUrl: req.protocol + '://' + req.get('host') + req.originalUrl,
    type,
    th
  });
});

/**
 * /auth/callback
 * A neutral page that finalizes auth in the browser (tokens in hash / PKCE exchanges)
 * Your existing views/auth-callback.ejs contains the password update form logic.
 */
router.get('/auth/callback', (req, res) => {
  res.render('auth-callback', {
    pageTitle: 'Almost there…',
    pageDescription: 'Complete your login or password update.',
    canonicalUrl: req.protocol + '://' + req.get('host') + req.originalUrl
  });
});

// (Optional convenience redirects used elsewhere in your app)
router.get('/login', (_req, res, next) => next());     // handled by views/login.ejs via index router
router.get('/register', (_req, res, next) => next());  // handled by index router
router.get('/account', (_req, res, next) => next());   // handled by index router

module.exports = router;
