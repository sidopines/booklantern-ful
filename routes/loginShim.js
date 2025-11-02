const express = require('express');
const router = express.Router();

/**
 * Helper: absolute base URL for correct Supabase redirects (required)
 */
function baseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https');
  const host  = req.get('host');
  return `${proto}://${host}`;
}

/**
 * GET /login
 * Renders login with Supabase envs + redirectTo for magic link / OAuth flows.
 */
router.get('/login', (req, res) => {
  const redirectTo = `${baseUrl(req)}/login?confirmed=1`; // PKCE/code-exchange lands here
  res.render('login', {
    title: 'Login',
    redirectTo,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnon: process.env.SUPABASE_ANON_KEY,
  });
});

/**
 * GET /register
 * Renders register with Supabase envs + redirectTo as well.
 */
router.get('/register', (req, res) => {
  const redirectTo = `${baseUrl(req)}/login?confirmed=1`; // unify callback target
  res.render('register', {
    title: 'Create account',
    redirectTo,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnon: process.env.SUPABASE_ANON_KEY,
  });
});

module.exports = router;
