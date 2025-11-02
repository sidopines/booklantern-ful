// routes/loginShim.js
const express = require('express');
const router = express.Router();

/**
 * Utility: build safe meta locals for header.ejs and OG tags
 */
function meta(req, title, desc = 'Free books & educational videos.') {
  return {
    pageTitle: title,
    pageDescription: desc,
    // header.ejs can derive og:url if req exists; harmless if unused.
    req,
  };
}

/**
 * Helper: origin of this request (proto + host)
 */
function originOf(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host  = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

/**
 * /login — render the login page (never 404)
 */
router.get('/login', (req, res) => {
  const base = process.env.BASE_URL || originOf(req);
  const next = req.query.next || '/dashboard';
  res.status(200).render('login', {
    ...meta(req, 'Login • BookLantern'),
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnon: process.env.SUPABASE_ANON_KEY,
    redirectTo: `${base}/login?confirmed=1&next=${encodeURIComponent(next)}`
  });
});

/**
 * /register — render the register page (never 404)
 */
router.get('/register', (req, res) => {
  const base = process.env.BASE_URL || originOf(req);
  const next = req.query.next || '/dashboard';
  res.status(200).render('register', {
    ...meta(req, 'Create account • BookLantern'),
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnon: process.env.SUPABASE_ANON_KEY,
    redirectTo: `${base}/login?confirmed=1&next=${encodeURIComponent(next)}`
  });
});

/**
 * Lightweight OAuth launcher:
 *   GET /auth/oauth/:provider   (e.g., google, apple)
 *
 * We intentionally do not use the server SDK here; we just build the
 * Supabase authorize URL and bounce the user into PKCE flow. Supabase
 * will return to /auth/callback with ?code=... which auth-callback.ejs
 * exchanges via sb.auth.exchangeCodeForSession().
 */
router.get('/auth/oauth/:provider', (req, res) => {
  try {
    const allowed = new Set([
      'google', 'apple', 'github', 'gitlab', 'bitbucket',
      'facebook', 'discord', 'azure', 'keycloak', 'slack',
    ]);

    const provider = String(req.params.provider || '').toLowerCase();
    if (!allowed.has(provider)) {
      return res.status(400).send('Unsupported provider');
    }

    const sbUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    if (!sbUrl) {
      // Fail closed but with a human-readable message
      return res
        .status(500)
        .send('Auth not configured. Missing SUPABASE_URL on server.');
    }

    const redirect_to = `${originOf(req)}/auth/callback`;
    const qs = new URLSearchParams({
      provider,
      redirect_to,
      // PKCE is recommended; the client completes at /auth/callback
      flow_type: 'pkce',
    });

    const authUrl = `${sbUrl}/auth/v1/authorize?${qs.toString()}`;
    return res.redirect(authUrl);
  } catch (e) {
    console.error('[oauth] failed to build authorize URL', e);
    return res.status(500).send('OAuth init error');
  }
});

/**
 * /auth/open
 * Handles PKCE-style email links: /auth/open?type=recovery&th=<token_hash>
 * Renders a tiny page that runs supabase.auth.verifyOtp(...) in the browser,
 * then forwards to /auth/callback?type=recovery
 */
router.get('/auth/open', (req, res) => {
  const type = String(req.query.type || '');
  const th   = String(req.query.th || '');
  res.render('auth-open', {
    ...meta(req, 'Almost there…', 'Continue resetting your password.'),
    canonicalUrl: originOf(req) + req.originalUrl,
    type,
    th
  });
});

/**
 * /auth/callback
 * Neutral page to finalize auth in the browser (tokens in hash / PKCE exchanges).
 * Your views/auth-callback.ejs can do the rest.
 */
router.get('/auth/callback', (req, res) => {
  res.render('auth-callback', {
    ...meta(req, 'Almost there…', 'Complete your login or password update.'),
    canonicalUrl: originOf(req) + req.originalUrl
  });
});

module.exports = router;
