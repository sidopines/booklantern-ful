const express = require('express');
const router = express.Router();

router.get('/login', (req, res) => {
  res.set({ 'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache' });
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https');
  const host = req.get('host');
  const redirectTo = `${proto}://${host}/auth/callback`;
  return res.status(200).render('login', {
    title: 'Sign in',
    redirectTo,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnon: process.env.SUPABASE_ANON_KEY,
  });
});

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

// Single source of truth: auth completion page (200, no redirects)
router.get('/auth/callback', (req, res) => {
  res.set({ 'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache' });
  const next = (req.query.next && req.query.next.startsWith('/')) ? req.query.next : '/account';
  return res.status(200).render('auth-callback', { title: 'Completing sign-in…', next });
});

// Legacy POST handlers redirect to GET
router.post('/login', (req, res) => res.redirect(303, '/login'));
router.post('/register', (req, res) => res.redirect(303, '/register'));

// Legacy routes
router.get('/dashboard', (req, res) => res.redirect('/account'));
router.get('/settings', (req, res) => res.redirect('/account'));

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
