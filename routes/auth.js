const express = require('express');
const router = express.Router();

function makeRedirectTo(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https');
  const host = req.get('host');
  return `${proto}://${host}/auth/callback`;
}

router.get('/login', (req, res) => {
  res.set({'Cache-Control':'no-store'});
  return res.status(200).render('login', {
    title: 'Sign in',
    redirectTo: makeRedirectTo(req),
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnon: process.env.SUPABASE_ANON_KEY,
  });
});

router.get('/register', (req, res) => {
  res.set({'Cache-Control':'no-store'});
  return res.status(200).render('register', {
    title: 'Create account',
    redirectTo: makeRedirectTo(req),
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnon: process.env.SUPABASE_ANON_KEY,
  });
});

// PUBLIC: Supabase redirects here with hash tokens OR ?code for PKCE.
// COMMIT: ff96fff - This should return 200 and render auth-callback.ejs
router.get('/auth/callback', (req, res) => {
  res.set({
    'Cache-Control':'no-store',
    'X-Auth-Route-Version': 'ff96fff-2024-11-07'
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

// Legacy POSTs
router.post('/login',    (_req, res) => res.redirect(303, '/login'));
router.post('/register', (_req, res) => res.redirect(303, '/register'));

module.exports = router;
