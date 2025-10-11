// routes/loginShim.js
// Minimal routes for Supabase auth flows + account page (no server sessions)

const express = require('express');
const router = express.Router();

/** Absolute canonical URL for meta tags */
function canonical(req) {
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

/**
 * 🔐 Auth callback endpoint
 * Supabase will redirect here after:
 *  - email verification (type=signup|invitation|magiclink)
 *  - password recovery (type=recovery)
 *
 * IMPORTANT: Do NOT redirect this route elsewhere.
 * The page's JS (auth-callback.ejs) completes the flow:
 *  - shows the "set new password" form for recovery
 *  - finalizes sessions for other flows
 */
router.get(['/auth/callback', /^\/auth\/callback(?:\/.*)?$/], (req, res) => {
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

/** Optional: “register” uses its own view; change if you want it to reuse login */
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
