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

try {
  const indexRoutes = require('./routes/index');
  app.use('/', indexRoutes); // static pages, home, read, etc.
  console.log('[routes] mounted index router at /');
} catch (e) {
  console.error('[routes] failed to mount ./routes/index:', e);
}

try {
  const playerRoutes = require('./routes/player');
  app.use('/', playerRoutes); // /player/:id
  console.log('[routes] mounted player router at /');
} catch (e) {
  console.error('[routes] failed to mount ./routes/player:', e);
}

try {
  const watchRoutes = require('./routes/watch');
  app.use('/watch', watchRoutes); // dedicated /watch router
  console.log('[routes] mounted watch router at /watch');
} catch (e) {
  console.error('[routes] failed to mount ./routes/watch:', e);
}

try {
  const adminRoutes = require('./routes/admin');
  app.use('/admin', adminRoutes); // legacy/general admin dashboard
  console.log('[routes] mounted admin router at /admin');
} catch (e) {
  console.error('[routes] failed to mount ./routes/admin:', e);
}

/* ---------- NEW: dedicated admin + reader routes ----------
   These make /admin/books, /admin/genres, and /reader/:id
   work even if the legacy admin router does not mount them.
----------------------------------------------------------- */
try {
  app.use('/admin', require('./routes/admin-books'));   // /admin/books
  app.use('/admin', require('./routes/admin-genres'));  // /admin/genres
  console.log('[routes] mounted admin-books and admin-genres at /admin');
} catch (e) {
  console.error('[routes] failed to mount admin-books/admin-genres:', e);
}

try {
  app.use('/reader', require('./routes/reader'));       // /reader/:id — in-site EPUB reader
  console.log('[routes] mounted reader router at /reader');
} catch (e) {
  console.error('[routes] failed to mount ./routes/reader:', e);
}

// ---------- Health check ----------
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

// ---------- 404 ----------
app.use((req, res) => {
  try { res.status(404).render('404', { ...meta(req, 'Not Found') }); }
  catch { res.status(404).send('Not Found'); }
});

// ---------- 500 ----------
app.use((err, req, res, _next) => {
  console.error('🔥 Unhandled error:', err);
  try {
    res
      .status(500)
      .render('error', {
        ...meta(req, 'Something went wrong'),
        statusCode: 500,
        error: err,
        showStack: process.env.NODE_ENV !== 'production'
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
