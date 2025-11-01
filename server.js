require("dotenv").config();
// server.js — CommonJS, explicit route mounting (final)

const path = require('path');
const express = require('express');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const app = express();

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

// ---------- Express core ----------
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

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
  res.type('text/plain').send('User-agent: *\nAllow: /\n');
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
   /auth/callback — render neutral finalizer
============================================================ */
app.get(/^\/auth\/callback(?:\/.*)?$/, (req, res) => {
  try {
    const canonicalUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    return res.render('auth-callback', {
      canonicalUrl,
      ...meta(req, 'Almost there…'),
    });
  } catch (e) {
    console.error('[auth-callback] render failed:', e);
    return res.status(500).send('Auth callback error');
  }
});

/* ============================================================
   /login — SPECIAL CASE when ?confirmed is present
   Serve a zero-chrome forwarder that carries the fragment.
============================================================ */
app.get('/login', (req, res) => {
  const hasConfirmed = Object.prototype.hasOwnProperty.call(
    req.query,
    'confirmed'
  );
  if (hasConfirmed) {
    // Inline + external for maximum compatibility.
    return res
      .status(200)
      .type('html')
      .send(`<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Redirecting…</title>
</head>
<body style="background:#fff;">
<p style="font:16px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:24px;">
  Redirecting you securely… If nothing happens, <a id="fallback" href="/auth/callback">tap here</a>.
</p>
<script>
(function(){
  try {
    var tgt = "/auth/callback" + (location.search||"") + (location.hash||"");
    // multi-try in case some methods are blocked
    try { location.assign(tgt); } catch(_) {}
    try { if (location.pathname !== "/auth/callback") location.replace(tgt); } catch(_) {}
    try { if (location.pathname !== "/auth/callback") location.href = tgt; } catch(_) {}
    // also set the href for the visible link so it preserves your hash if clicked
    try { document.getElementById('fallback').setAttribute('href', tgt); } catch(_) {}
    setTimeout(function(){ if (location.pathname !== "/auth/callback") location.href = tgt; }, 120);
  } catch(e) {
    location.href = "/auth/callback";
  }
})();
</script>
<script src="/public/js/forward.js"></script>
<noscript><meta http-equiv="refresh" content="0; url=/auth/callback"></noscript>
</body></html>`);
  }
  // Normal render if you just open /login
  return res.status(200).render('login', meta(req, 'Login • BookLantern'));
});

/* ============================================================
   Register + Account
============================================================ */
app.get('/register', (req, res) =>
  res.status(200).render('register', meta(req, 'Create account • BookLantern'))
);
app.get('/account', (_req, res) => {
  try {
    return res.render('account');
  } catch (e) {
    console.error('[account] render failed:', e);
    return res.status(500).send('Account render error');
  }
});

// ---------- Mount routes explicitly ----------
try {
  const loginShim = require('./routes/loginShim');
  app.use('/', loginShim);
  console.log('[routes] mounted loginShim router at /');
} catch (e) {
  console.error('[routes] failed to mount ./routes/loginShim:', e);
}

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

  try {
    app.use('/reader', require('./routes/reader'));
    console.log('[routes] mounted reader router at /reader');
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
});
