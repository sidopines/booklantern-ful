// server.js — CommonJS, explicit route mounting

const path = require('path');
const express = require('express');
const compression = require('compression');
const morgan = require('morgan');

const app = express();

// ---------- Express core ----------
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

// ---------- Safe locals for EJS (theme/footer rely on buildId) ----------
const BUILD_ID = Date.now().toString();
app.use((req, res, next) => {
  // If you add sessions/auth later, this won’t error:
  res.locals.isAuthenticated = Boolean(
    (req.session && req.session.user) || req.user || req.authUser
  );
  res.locals.user =
    (req.session && req.session.user) || req.user || req.authUser || null;

  res.locals.buildId = BUILD_ID;
  res.locals.pageDescription =
    'Millions of free books from globally trusted libraries. One clean reader.';

  next();
});

// ---------- Minimal first-party pages ----------
app.get('/login', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.render('login'); // views/login.ejs you shared
  } catch (e) {
    res.status(500).send('Login page error.');
  }
});

// Real /account route (server page, populated client-side via Supabase)
app.get('/account', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    // We pass along any server-side user if you later add sessions; the page also hydrates via Supabase JS.
    res.render('account', { user: res.locals.user || null });
  } catch (e) {
    res.status(500).send('Account page error.');
  }
});

// Supabase OAuth/email links land here; redirect to friendly URLs used by login.ejs
app.get('/auth/callback', (req, res) => {
  const { type, error_description } = req.query || {};
  if (error_description) {
    return res.redirect('/login?error=' + encodeURIComponent(error_description));
  }

  // Password recovery email
  if (type === 'recovery') return res.redirect('/login?reset=1');

  // New signup / magic link / email verification confirmation
  if (type === 'signup' || type === 'magiclink' || type === 'email_verification') {
    return res.redirect('/login?confirmed=1');
  }

  // Default: just send to login (the page will show nothing special)
  return res.redirect('/login');
});

// ---------- Mount routes explicitly ----------
try {
  const indexRoutes = require('./routes/index'); // exports an express.Router()
  app.use('/', indexRoutes);
  console.log('[routes] mounted index router at /');
} catch (e) {
  console.error('[routes] failed to mount ./routes/index:', e);
}

try {
  const adminRoutes = require('./routes/admin'); // exports an express.Router()
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
    res.status(404).render('404');
  } catch {
    res.status(404).send('Not Found');
  }
});

// ---------- 500 ----------
app.use((err, req, res, _next) => {
  console.error('🔥 Unhandled error:', err);
  try {
    res.status(500).render('error', { error: err });
  } catch {
    res.status(500).send('Internal Server Error');
  }
});

// ---------- Start ----------
const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, () => {
  console.log(`BookLantern listening on :${PORT}`);
});
