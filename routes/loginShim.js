// routes/loginShim.js
// Minimal routes to support auth flows + account page without server sessions.

const express = require('express');
const router = express.Router();

/** Helper to build an absolute canonical URL for meta tags */
function canonical(req) {
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

/**
 * Handle Supabase redirects after OAuth / magic links / email confirmations.
 * Examples we normalize:
 *   /auth/callback
 *   /auth/callback?type=signup
 *   /auth/callback?type=recovery
 *   /auth/callback... (anything after still matches)
 * Also fixes accidental copies like “… → should redirect …” by matching any suffix.
 */
router.get(/^\/auth\/callback(?:.*)?$/, (req, res) => {
  const type = (req.query.type || '').toLowerCase();

  // Decide the banner query we show on /login
  let to = '/login?confirmed=1';
  if (type === 'recovery' || type === 'invitation' || type === 'magiclink') {
    to = '/login?reset=1';
  }
  return res.redirect(302, to);
});

/** Show login (email/password + Google/Apple buttons) */
router.get('/login', (req, res) => {
  res.render('login', {
    canonicalUrl: canonical(req),
  });
});

/**
 * Optional: Show “register” as the same screen as login (since we use email link / OAuth).
 * If you later add a dedicated views/register.ejs, change this route to render it.
 */
router.get('/register', (req, res) => {
  res.render('login', {
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
