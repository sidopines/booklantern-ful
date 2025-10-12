// routes/loginShim.js
const express = require('express');
const router = express.Router();

// helper for canonical url
function canonical(req) {
  const base = `${req.protocol}://${req.get('host')}`;
  const qs   = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return `${base}${req.path}${qs}`;
}

/**
 * Render-only routes for all auth flows.
 * Never redirect away from these paths so the hash tokens can be read.
 */

// Interstitial that requires a real user click before calling Supabase verify
router.get('/auth/open', (req, res) => {
  // accepts ?type=recovery&th=<tokenHash>
  res.render('auth-open', { canonicalUrl: canonical(req) });
});

// Supabase callback: receives tokens in hash or ?code after verify
router.get(['/auth/callback', '/auth/callback/'], (req, res) => {
  res.render('auth-callback', { canonicalUrl: canonical(req) });
});

// Safety net
router.get('/auth/*', (req, res) => {
  res.render('auth-callback', { canonicalUrl: canonical(req) });
});

// Convenience renders
router.get('/login', (req, res) => res.render('login', { canonicalUrl: canonical(req) }));
router.get('/register', (req, res) => res.render('register', { canonicalUrl: canonical(req) }));

module.exports = router;
