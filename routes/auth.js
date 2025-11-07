const express = require('express');
const router = express.Router();

function makeRedirectTo(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https');
  const host = req.get('host');
  return `${proto}://${host}/auth/callback`;
}

// Unified auth page for both sign-in and sign-up
router.get('/auth', (req, res) => {
  res.set({
    'Cache-Control':'no-store, max-age=0',
    'Pragma':'no-cache'
  });
  return res.status(200).render('auth', {
    title: 'Sign in or create an account',
    redirectTo: makeRedirectTo(req),
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnon: process.env.SUPABASE_ANON_KEY,
  });
});

// Aliases: /login and /register redirect to /auth, preserving hash fragments
router.get('/login', (req, res) => {
  const hash = req.url.includes('#') ? req.url.slice(req.url.indexOf('#')) : '';
  return res.redirect(302, '/auth' + hash);
});

router.get('/register', (req, res) => {
  const hash = req.url.includes('#') ? req.url.slice(req.url.indexOf('#')) : '';
  return res.redirect(302, '/auth' + hash);
});

// PUBLIC: Supabase redirects here with hash tokens OR ?code for PKCE.
// This should return 200 and render auth-callback.ejs (NO redirects to /login)
router.get('/auth/callback', (req, res) => {
  res.set({
    'Cache-Control':'no-store, max-age=0',
    'Pragma':'no-cache',
    'X-Auth-Route-Version': 'unified-2024-11-07'
  });
  const next = (req.query.next && req.query.next.startsWith('/')) ? req.query.next : '/account';
  return res.status(200).render('auth-callback', { title: 'Completing sign-in…', next });
});

// TEST ENDPOINT to verify deployment
router.get('/auth/test-deploy', (req, res) => {
  res.set({'Cache-Control':'no-store'});
  return res.status(200).json({ 
    deployed: true, 
    timestamp: new Date().toISOString(),
    commit: 'e12d4d0',
    message: 'If you see this, the latest code is deployed!'
  });
});

// Legacy POSTs redirect to unified /auth page
router.post('/login',    (_req, res) => res.redirect(303, '/auth'));
router.post('/register', (_req, res) => res.redirect(303, '/auth'));

module.exports = router;
