// routes/loginShim.js
const express = require('express');
const router = express.Router();

/**
 * IMPORTANT:
 * - /auth/callback must RENDER a page that can read the URL hash.
 * - Do NOT redirect here, or you will lose the access_token/refresh_token in the hash.
 */

// Supabase auth finishes here (email confirmation, magic link, password recovery)
router.get('/auth/callback', (req, res) => {
  // This renders views/auth-callback.ejs (which you already have)
  res.render('auth-callback', {
    canonicalUrl: `${req.protocol}://${req.get('host')}/auth/callback${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`
  });
});

// Optional conveniences (only keep these if you are serving login/register here)
router.get('/login', (req, res) => {
  res.render('login', {
    canonicalUrl: `${req.protocol}://${req.get('host')}/login${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`
  });
});

router.get('/register', (req, res) => {
  res.render('register', {
    canonicalUrl: `${req.protocol}://${req.get('host')}/register`
  });
});

router.get('/account', (req, res, next) => {
  // If you render account elsewhere, remove this block.
  // Otherwise you can render a simple account page here.
  next();
});

module.exports = router;
