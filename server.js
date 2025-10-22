// server.js — CommonJS, explicit route mounting

const path = require('path');
const express = require('express');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const app = express();

// ---------- Express core ----------
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser()); // needed so adminGate can read req.cookies

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

// Minimal robots.txt to avoid 404 noise
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

// Small helper for meta locals (null-safe)
function meta(req, title, desc = 'Free books & educational videos.') {
  return { pageTitle: title, pageDescription: desc, req };
}

/* ============================================================
   Auth callback FIRST (magic link / recovery / email confirm)
   ============================================================ */
app.get(/^\/auth\/callback(?:\/.*)?$/, (req, res) => {
  try {
    const canonicalUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    return res.render('auth-callback', { canonicalUrl, ...meta(req, 'Almost there…') });
  } catch (e) {
    console.error('[auth-callback] render failed:', e);
    return res.status(500).send('Auth callback error');
  }
});

/* ============================================================
   Hard-stop pages so they NEVER 404
   ============================================================ */
app.get('/login', (req, res) => res.status(200).render('login', meta(req, 'Login • BookLantern')));
app.get('/register', (req, res) => res.status(200).render('register', meta(req, 'Create account • BookLantern')));
app.get('/account', (_req, res) => {
  try { return res.render('account'); }
  catch (e) {
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

/**
 * Mount /watch (grid) and /player/:id (single player) explicitly.
 * We mount these BEFORE index to prevent any overlap with legacy definitions.
 */
try {
  const watchRoutes = require('./routes/watch');
  app.use('/watch', watchRoutes);
  console.log('[routes] mounted watch router at /watch');
} catch (e) {
  console.error('[routes] failed to mount ./routes/watch:', e);
}

try {
  const playerRoutes = require('./routes/player');
  app.use('/', playerRoutes); // exposes /player/:id
  console.log('[routes] mounted player router at /');
} catch (e) {
  console.error('[routes] failed to mount ./routes/player:', e);
}

/**
 * Legacy redirect: /video/:id → /player/:id
 * This preserves any old links while ensuring we always hit the safe embed route.
 */
app.get('/video/:id', (req, res) => {
  try {
    return res.redirect(301, `/player/${encodeURIComponent(req.params.id)}`);
  } catch {
    return res.redirect(302, `/player/${req.params.id}`);
  }
});

try {
  const indexRoutes = require('./routes/index');
  app.use('/', indexRoutes); // homepage, static pages, other routes
  console.log('[routes] mounted index router at /');
} catch (e) {
  console.error('[routes] failed to mount ./routes/index:', e);
}

try {
  const adminRoutes = require('./routes/admin');
  app.use('/admin', adminRoutes); // admin mounts /books, /videos, /genres, /users internally
  console.log('[routes] mounted admin router at /admin');
} catch (e) {
  console.error('[routes] failed to mount ./routes/admin:', e);
}

// ---------- Health check ----------
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

// ---------- 404 ----------
app.use((req, res) => {
  try { res.status(404).render('404'); }
  catch { res.status(404).send('Not Found'); }
});

// ---------- 500 ----------
app.use((err, req, res, _next) => {
  console.error('🔥 Unhandled error:', err);
  try { res.status(500).render('error', { error: err }); }
  catch { res.status(500).send('Internal Server Error'); }
});

// ---------- Start ----------
const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, () => {
  console.log(`BookLantern listening on :${PORT}`);
});
