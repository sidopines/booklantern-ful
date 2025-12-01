require("dotenv").config();
// server.js — CommonJS, explicit route mounting (final)

const path = require('path');
const express = require('express');
const compression = require('compression');
const morgan = require('morgan');
const csp = require('./middleware/csp'); // ← ADDED

const app = express();





// >>> Hard-stop callback route comes BEFORE everything else (no middleware can hijack it)
app.get('/auth/callback', (req,res)=>{
  res.set({'Cache-Control':'no-store, max-age=0','Pragma':'no-cache'});
  try { return res.status(200).render('auth-callback', { title: 'Completing sign-in…' }); }
  catch(e){ console.error('callback render error', e); return res.status(200).send('<!doctype html><meta charset="utf-8"><meta http-equiv="Cache-Control" content="no-store"><p>Completing sign-in…</p>'); }
});
// <<< Hard-stop
/* SAFE_REDIRECT_LOGGER */
app.use((req, res, next) => {
  const orig = res.redirect.bind(res);
  res.redirect = (...args) => {
    try {
      const status = (args.length === 2) ? args[0] : 302;
      const url    = (args.length === 2) ? args[1] : args[0];
      console.error('[REDIRECT]', req.method, req.originalUrl, '->', url, 'status', status);
      const err = new Error('redirect_trace');
      if (err && err.stack) console.error(String(err.stack));
    } catch (_) { /* ignore */ }
    return orig(...args);
  };
  next();
});
/* /SAFE_REDIRECT_LOGGER */
app.use(csp()); // ← ADDED

// ---- Public allowlist for routes that must remain unauthenticated ----
const PUBLIC_PATHS__ALLOWLIST = new Set([
  '/', '/login', '/register', '/auth/callback',
  '/about', '/contact', '/robots.txt', '/favicon.ico'
]);
function isPublicPath(req) {
  return PUBLIC_PATHS__ALLOWLIST.has(req.path)
      || req.path.startsWith('/public')
      || req.path.startsWith('/img')
      || req.path.startsWith('/css')
      || req.path.startsWith('/js')
      || req.path.startsWith('/assets')
      || req.path.startsWith('/api/search'); // Public search API
}
// ---------------------------------------------------------------------

/* -----------------------------------------------------------
   Supabase env normalization (must run BEFORE any route require)
----------------------------------------------------------- */
(function normalizeSupabaseEnv() {
  const urlRaw =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL ||
    process.env.supabaseUrl ||
    '';

  const serviceRoleRaw =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.supabaseKey ||
    '';

  const anonRaw =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  if (urlRaw) process.env.SUPABASE_URL = urlRaw;
  if (serviceRoleRaw) process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleRaw;

  if (!process.env.SUPABASE_KEY) {
    process.env.SUPABASE_KEY = serviceRoleRaw || anonRaw || '';
  }
  if (!process.env.SUPABASE_SERVICE_KEY && serviceRoleRaw)
    process.env.SUPABASE_SERVICE_KEY = serviceRoleRaw;
  if (!process.env.SUPABASE_ANON_KEY && anonRaw)
    process.env.SUPABASE_ANON_KEY = anonRaw;

  if (!process.env.supabaseKey)
    process.env.supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
  if (!process.env.supabaseUrl)
    process.env.supabaseUrl = process.env.SUPABASE_URL || '';

  const haveUrl = Boolean(process.env.SUPABASE_URL || process.env.supabaseUrl);
  const haveKey = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_KEY ||
      process.env.supabaseKey
  );

  if (haveUrl && haveKey) {
    const keyPreview = (
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_KEY ||
      process.env.supabaseKey
    ).slice(0, 5);
    console.log(
      `[supabaseEnv] Ready (url set, key alias ok, preview ${keyPreview}•••)`
    );
  } else {
    console.warn(
      '[supabaseEnv] Missing SUPABASE URL and/or KEY. Some routers will be skipped.'
    );
  }
})();

/* -----------------------------------------------------------
   APP_SIGNING_SECRET check (required for reader tokens)
----------------------------------------------------------- */
if (!process.env.APP_SIGNING_SECRET) {
  console.warn('[APP_SIGNING_SECRET] ⚠️  Missing! Generating temporary secret...');
  console.warn('[APP_SIGNING_SECRET] Add this to your .env file:');
  const tempSecret = require('crypto').randomBytes(32).toString('base64url');
  console.warn(`APP_SIGNING_SECRET=${tempSecret}`);
  process.env.APP_SIGNING_SECRET = tempSecret;
} else {
  console.log('[APP_SIGNING_SECRET] ✓ Configured');
}

// ---------- Express core ----------
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- Auth view locals (forces required vars on /login, /register) ----------
app.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/register') {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https');
    const host = req.get('host');
    res.locals.redirectTo = `${proto}://${host}/auth/callback`;
    res.locals.supabaseUrl = process.env.SUPABASE_URL;
    res.locals.supabaseAnon = process.env.SUPABASE_ANON_KEY;
  }
  return next();
});
// -------------------------------------------------------------------------------
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(require('cookie-parser')(process.env.COOKIE_SECRET || 'dev_fallback_cookie_secret'));

// ---------- Subscriber status middleware ----------
app.use((req, res, next) => {
  const isSub = (req.user?.is_subscriber === true) || (req.signedCookies?.bl_sub === '1');
  res.locals.is_subscriber = !!isSub;
  // For older templates that check `user`, synthesize a minimal user object
  if (isSub && !res.locals.user) res.locals.user = { is_subscriber: true };
  res.locals.loginGate = (url) => (isSub ? url : ('/login?next=' + encodeURIComponent(url)));
  next();
});

// ---------- Static assets ----------
app.use(
  '/public',
  express.static(path.join(__dirname, 'public'), {
    maxAge: '1y',
    etag: true,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  })
);

// Service worker at scope /
app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sw.js'), {
    headers: { 'Content-Type': 'application/javascript' },
  });
});

// Minimal robots.txt
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /proxy
Disallow: /unified-reader
`);
});

// Serve favicon.ico at root
app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// ---------- Safe locals for EJS ----------
const BUILD_ID = Date.now().toString();
app.use((req, res, next) => {
  res.locals.isAuthenticated = Boolean(
    (req.session && req.session.user) || req.user || req.authUser
  );
  res.locals.user =
    (req.session && req.session.user) || req.user || req.authUser || null;

  res.locals.buildId = BUILD_ID;
  res.locals.pageDescription =
    'Millions of free books from globally trusted libraries. One clean reader.';

  try {
    res.locals.categories = require('./config/categories');
  } catch {
    res.locals.categories = ['trending', 'philosophy', 'history', 'science'];
  }

  next();
});

function meta(req, title, desc = 'Free books & educational videos.') {
  return { pageTitle: title, pageDescription: desc, req };
}

/* ============================================================
   /auth/callback — now handled by routes/auth.js (mounted above)
============================================================ */

/* /login special-case forwarder removed: handled in routes/loginShim.js */

/* ============================================================
  Register + Account
  (legacy /register handler removed; handled by routes/loginShim.js)
============================================================ */
app.get('/account', (_req, res) => {
  try {
    return res.render('account');
  } catch (e) {
    console.error('[account] render failed:', e);
    return res.status(500).send('Account render error');
  }
});

// ---------- EPUB Proxy (CORS workaround) ----------
const allowedHosts = new Set(['www.gutenberg.org','gutenberg.org','archive.org']);
app.get('/proxy', async (req, res) => {
  try {
    const u = new URL(req.query.u);
    if (!allowedHosts.has(u.hostname)) return res.status(400).send('host not allowed');
    const r = await fetch(u.toString(), { redirect: 'follow' });
    if (!r.ok) return res.status(r.status).send('upstream error');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=86400');
    if (r.headers.get('content-type')) res.type(r.headers.get('content-type'));
    r.body.pipe(res);
  } catch (e) {
    res.status(400).send('bad url');
  }
});

// ---------- Mount routes explicitly ----------
try {
  const authRouter = require('./routes/auth');
  app.use('/', authRouter);
  console.log('[routes] mounted auth router at /');
} catch (e) {
  console.error('[routes] failed to mount ./routes/auth:', e);
}

// loginShim disabled: auth.js now handles /login, /register, /auth/callback
// try {
//   const loginShim = require('./routes/loginShim');
//   app.use('/', loginShim);
//   console.log('[routes] mounted loginShim router at /');
// } catch (e) {
//   console.error('[routes] failed to mount ./routes/loginShim:', e);
// }

// Redirect /search to /read with query param (BEFORE index routes)
app.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  return res.redirect(303, '/read?q=' + encodeURIComponent(q));
});

try {
  const indexRoutes = require('./routes/index');
  app.use('/', indexRoutes);
  console.log('[routes] mounted index router at /');
} catch (e) {
  console.error('[routes] failed to mount ./routes/index:', e);
}

try {
  const contactRoutes = require('./routes/contact');
  app.use('/', contactRoutes);
  console.log('[routes] mounted contact router at /');
} catch (e) {
  console.error('[routes] failed to mount ./routes/contact:', e);
}

try {
  const playerRoutes = require('./routes/player');
  app.use('/', playerRoutes);
  console.log('[routes] mounted player router at /');
} catch (e) {
  console.error('[routes] failed to mount ./routes/player:', e);
}

try {
  const watchRoutes = require('./routes/watch');
  app.use('/watch', watchRoutes);
  console.log('[routes] mounted watch router at /watch');
} catch (e) {
  console.error('[routes] failed to mount ./routes/watch:', e);
}

// Mount search router (public federated search API)
try {
  const searchRoutes = require('./routes/search');
  app.use('/', searchRoutes);
  console.log('[routes] mounted search router at /');
} catch (e) {
  console.error('[routes] failed to mount ./routes/search:', e);
}

const hasSB = Boolean(
  (process.env.SUPABASE_URL || process.env.supabaseUrl) &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_KEY ||
      process.env.supabaseKey)
);

if (hasSB) {
  try {
    app.use('/admin', require('./routes/admin-books'));
    app.use('/admin', require('./routes/admin-genres'));
    console.log('[routes] mounted admin-books and admin-genres at /admin');
  } catch (e) {
    console.error('[routes] failed to mount admin-books/admin-genres:', e);
  }

  // Mount reader routes (unified-reader, proxy/epub, library, reader APIs)
  try {
    const readerRoutes = require('./routes/reader');
    app.use('/', readerRoutes);
    console.log('[routes] mounted reader router at /');
  } catch (e) {
    console.error('[routes] failed to mount ./routes/reader:', e);
  }
} else {
  console.warn(
    '[routes] Skipping admin-books/admin-genres/reader because Supabase URL/Key not detected.'
  );
}

try {
  const adminRoutes = require('./routes/admin');
  app.use('/admin', adminRoutes);
  console.log('[routes] mounted admin router at /admin');
} catch (e) {
  console.error('[routes] failed to mount ./routes/admin:', e);
}

// ---------- Session cookie endpoint ----------
const supabaseAdmin = require('./supabaseAdmin');

app.post('/api/auth/session-cookie', async (req, res) => {
  try {
    const hdr = req.get('authorization') || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    if (!token) return res.status(400).json({ ok:false, error:'missing token' });
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ ok:false });
    const isSub =
      process.env.AUTO_SUBSCRIBE_NEW_USERS === '1'
        ? true
        : (data.user.user_metadata && data.user.user_metadata.is_subscriber === true);
    // optional auto-subscribe write-through when flag is on
    if (process.env.AUTO_SUBSCRIBE_NEW_USERS === '1' && data.user.user_metadata?.is_subscriber !== true) {
      await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
        user_metadata: { ...(data.user.user_metadata||{}), is_subscriber: true }
      }).catch(()=>{});
    }
    res.cookie('bl_sub', isSub ? '1' : '0', {
      httpOnly: true, signed: true, sameSite: 'lax',
      secure: true, maxAge: 30*24*60*60*1000, path: '/'
    });
    return res.json({ ok:true, sub:isSub ? 1 : 0 });
  } catch (e) { return res.status(500).json({ ok:false }); }
});

// Logout route
app.get('/logout', (req,res)=>{ res.clearCookie('bl_sub',{ httpOnly:true, signed:true, sameSite:'lax', secure:true, path:'/' }); res.redirect('/'); });

// ---------- Health check ----------
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

// ---------- 404 ----------
app.use((req, res) => {
  try {
    res.status(404).render('404', { ...meta(req, 'Not Found') });
  } catch {
    res.status(404).send('Not Found');
  }
});

// ---------- 500 ----------
app.use((err, req, res, _next) => {
  console.error('🔥 Unhandled error:', err);
  try {
    res.status(500).render('error', {
      ...meta(req, 'Something went wrong'),
      statusCode: 500,
      error: err,
      showStack: process.env.NODE_ENV !== 'production',
    });
  } catch {
    res.status(500).send('Internal Server Error');
  }
});

// ---------- Start ----------
const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, () => {
  console.log(`BookLantern listening on :${PORT}`);

// one-off debug route map (disable later)
app.get('/debug-routes', (req,res)=>{
  const stack = app._router?.stack?.flatMap(l=> l.route ? [{ path: l.route.path, methods: l.route.methods }] : []);
  res.type('application/json').send(JSON.stringify(stack, null, 2));
});
});
