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
  const next = req.query.next || '/account';
  return res.render('auth-callback', { 
    title: 'Signing you in…',
    next: next.startsWith('/') ? next : '/account'
  });
});

// GET /login → render login page (no redirects)
router.get('/login', (req, res) => {
  res.set({ 'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache' });
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https');
  const host = req.get('host');
  const redirectTo = `${proto}://${host}/auth/callback`;
  return res.status(200).render('login', {
    title: 'Login',
    redirectTo,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnon: process.env.SUPABASE_ANON_KEY,
  });
});

// POST /login (from older forms) → redirect to GET /login to avoid resubmit
router.post('/login', (req, res) => {
  return res.redirect(303, '/login');
});

// GET /register → render register page (no redirects)
router.get('/register', (req, res) => {
  res.set({ 'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache' });
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https');
  const host = req.get('host');
  const redirectTo = `${proto}://${host}/auth/callback`;
  return res.status(200).render('register', {
    title: 'Create account',
    redirectTo,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnon: process.env.SUPABASE_ANON_KEY,
  });
});

// POST /register → redirect to GET /register to avoid resubmit
router.post('/register', (req, res) => {
  return res.redirect(303, '/register');
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

/* ----------------------------- Debug routes ----------------------------- */

// Self-test endpoint for Safari/redirect diagnostics
router.get('/auth/self-test', (req, res) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const cookies = Object.keys(req.cookies || {});
  res.json({
    origin: `${req.protocol}://${req.get('host')}`,
    host: req.get('host') || '',
    protocol: req.protocol,
    forwarded_proto: forwardedProto || '',
    url: req.originalUrl,
    query: req.query || {},
    cookies,
    ua: req.get('user-agent') || '',
    timestamp: new Date().toISOString()
  });
});

// Route enumeration for debugging
router.get('/debug/routes', (req, res) => {
  const routes = [];
  const app = req.app;
  
  // Extract routes from the Express app
  if (app._router && app._router.stack) {
    app._router.stack.forEach((middleware) => {
      if (middleware.route) {
        routes.push({
          path: middleware.route.path,
          methods: Object.keys(middleware.route.methods).join(', ').toUpperCase()
        });
      } else if (middleware.name === 'router' && middleware.handle.stack) {
        middleware.handle.stack.forEach((handler) => {
          if (handler.route) {
            const basePath = middleware.regexp.source
              .replace('\\/?', '')
              .replace('(?=\\/|$)', '')
              .replace(/\\/g, '')
              .replace('^', '')
              .replace('$', '');
            routes.push({
              path: basePath + handler.route.path,
              methods: Object.keys(handler.route.methods).join(', ').toUpperCase()
            });
          }
        });
      }
    });
  }
  
  res.json({
    routes,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
