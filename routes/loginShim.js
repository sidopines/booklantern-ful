// routes/loginShim.js
const express = require('express');
const router = express.Router();

/**
 * This router owns the exact auth endpoints so nothing else intercepts them.
 * It only renders views and does NOT redirect away from /auth/callback.
 */

// Login page
router.get('/login', (req, res) => {
  const canonicalUrl = `${req.protocol}://${req.get('host')}/login`;
  res.render('login', { canonicalUrl });
});

// Register page (if you keep it)
router.get('/register', (req, res) => {
  const canonicalUrl = `${req.protocol}://${req.get('host')}/register`;
  res.render('register', { canonicalUrl, csrfToken: '' });
});

// Supabase returns here for all link-based auth: recovery, email confirm, magic link, PKCE
router.get('/auth/callback', (req, res) => {
  const canonicalUrl = `${req.protocol}://${req.get('host')}/auth/callback`;
  // DO NOT redirect here. We must render so the client JS can read tokens from the hash
  // (e.g., #access_token=...&refresh_token=...) and call supabase.auth.setSession.
  res.render('auth-callback', { canonicalUrl });
});

// Optional: account page shell (if you want)
router.get('/account', (req, res) => {
  const canonicalUrl = `${req.protocol}://${req.get('host')}/account`;
  res.render('account', { canonicalUrl });
});

module.exports = router;
