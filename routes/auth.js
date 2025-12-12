const express = require('express');
const router = express.Router();

function makeRedirectTo(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https');
  const host = req.get('host');
  return `${proto}://${host}/auth/callback`;
}

// Helper to generate no-cache headers and render data
function noStoreHeaders() {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache'
  };
}

function authRenderData(req) {
  return {
    title: 'Sign in or create an account',
    redirectTo: makeRedirectTo(req),
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnon: process.env.SUPABASE_ANON_KEY,
  };
}

// Serve unified auth page at ALL THREE PATHS (no redirects - preserves hash!)
// Critical: Never redirect when hash fragments might be present
router.get('/auth', (req, res) => {
  res.set(noStoreHeaders());
  return res.status(200).render('auth', authRenderData(req));
});

router.get('/login', (req, res) => {
  // If already authenticated, redirect away from login page
  if (res.locals.isAuthed) {
    const next = req.query.next;
    // Validate next is a safe relative path
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      return res.redirect(302, next);
    }
    return res.redirect(302, '/read');
  }
  res.set(noStoreHeaders());
  return res.status(200).render('auth', authRenderData(req));
});

router.get('/register', (req, res) => {
  res.set(noStoreHeaders());
  return res.status(200).render('auth', authRenderData(req));
});

// PUBLIC: Supabase redirects here with hash tokens OR ?code for PKCE.
// This should return 200 and render auth-callback.ejs (NO redirects to /login)
router.get('/auth/callback', (req, res) => {
  res.set({
    'Cache-Control':'no-store, max-age=0',
    'Pragma':'no-cache',
    'X-Auth-Route-Version': 'no-redirect-2024-11-07'
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
