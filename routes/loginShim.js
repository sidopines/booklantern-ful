// routes/loginShim.js
const express = require('express');
const router = express.Router();

/**
 * DO NOT redirect from these routes.
 * They must render a page that can read the URL hash
 * (access_token / refresh_token) from Supabase.
 */

// helper to build a canonical url for <head>
function canonical(req) {
  const base = `${req.protocol}://${req.get('host')}`;
  const qs   = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return `${base}${req.path}${qs}`;
}

// Supabase callback target for email links, password recovery, OAuth code, etc.
router.get(['/auth/callback', '/auth/callback/'], (req, res) => {
  res.render('auth-callback', { canonicalUrl: canonical(req) });
});

// Safety net: if anything else under /auth/ is called by mistake, still render.
router.get('/auth/*', (req, res) => {
  res.render('auth-callback', { canonicalUrl: canonical(req) });
});

// Optional convenience routes (render-only)
router.get('/login', (req, res) => {
  res.render('login', { canonicalUrl: canonical(req) });
});

router.get('/register', (req, res) => {
  res.render('register', { canonicalUrl: canonical(req) });
});

module.exports = router;
