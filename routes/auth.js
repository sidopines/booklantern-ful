// routes/auth.js — Supabase-first shim (final)
//
// This file intentionally **does not** implement local password auth.
// Your production auth flows are handled by Supabase on the client:
//   - /login and /register: EJS pages that call supabase-js
//   - /auth/callback      : handled by routes/loginShim.js + views/auth-callback.ejs
//   - reset password      : via Supabase email → /auth/callback?type=recovery
//
// Keeping this shim prevents old links from breaking and avoids route conflicts
// with the Supabase-based pages you already serve elsewhere.

const express = require('express');
const router  = express.Router();

/* ----------------------------- Small helpers ----------------------------- */
function safeNext(url) {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return null;
}
function redirectWithNext(res, basePath, next) {
  const n = safeNext(next);
  if (!n) return res.redirect(basePath);
  // carry ?next only to pages that may care (purely cosmetic here)
  const glue = basePath.includes('?') ? '&' : '?';
  return res.redirect(`${basePath}${glue}next=${encodeURIComponent(n)}`);
}

/* ----------------------------- Public routes ----------------------------- */

// Stable first-party callback endpoint (no server redirects)
// No auth gating; this page consumes tokens/hash and then redirects.
router.get('/auth/callback', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache'
  });
  return res.render('auth-callback', { title: 'Signing you in…' });
});

// Legacy GET /login → show the Supabase-driven login page
router.get('/login', (req, res) => {
  return redirectWithNext(res, '/login', req.query.next);
});

// Legacy POST /login (from older forms) → just send to GET /login
router.post('/login', (req, res) => {
  return redirectWithNext(res, '/login', req.body?.next || req.query?.next);
});

// Legacy GET /register → show the Supabase-driven register page
router.get('/register', (req, res) => {
  return redirectWithNext(res, '/register', req.query.next);
});

// Legacy POST /register → just send to GET /register
router.post('/register', (req, res) => {
  return redirectWithNext(res, '/register', req.body?.next || req.query?.next);
});

// Legacy “dashboard” or “settings” pages now live under Supabase’s account UX
router.get('/dashboard', (req, res) => res.redirect('/account'));
router.get('/settings',  (req, res) => res.redirect('/account'));

// Legacy logout: clear any Express session cookie if present,
// but **Supabase sign-out happens on the client UI**. This is harmless
// and keeps old links from 404ing.
router.get('/logout', (req, res) => {
  try {
    if (req.session) {
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        return res.redirect('/');
      });
    } else {
      res.clearCookie('connect.sid');
      return res.redirect('/');
    }
  } catch {
    return res.redirect('/');
  }
});

module.exports = router;
