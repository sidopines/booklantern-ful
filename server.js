// server.js (CommonJS, final)

const path = require('path');
const express = require('express');
const compression = require('compression');
const morgan = require('morgan');

const app = express();

// -------- Core setup --------
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static assets (cache-busted by ?v=<buildId> in templates)
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

// Service worker should be at the root scope
app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sw.js'), {
    headers: { 'Content-Type': 'application/javascript' },
  });
});

// -------- Safe locals for all views --------
const BUILD_ID = Date.now().toString();
app.use((req, res, next) => {
  // NEVER let these be undefined in templates
  res.locals.isAuthenticated = Boolean(
    (req.session && req.session.user) || req.user || req.authUser
  );
  res.locals.user =
    (req.session && req.session.user) || req.user || req.authUser || null;

  // for cache-busting <link ... ?v=<%= buildId %>>
  res.locals.buildId = BUILD_ID;

  // Give every view a sane default pageDescription (can be overridden)
  res.locals.pageDescription =
    'Millions of free books from globally trusted libraries. One clean reader.';

  next();
});

// -------- Mount your existing app routes if present --------
(function mountOptionalRoutes() {
  // Try common route entry points. If not found, we just skip.
  const candidates = [
    './routes/index',
    './routes',
    './routes/web',
    './routes/app',
  ];
  let mounted = false;
  for (const rel of candidates) {
    try {
      // route module can be (app)=>void or an express.Router()
      const mod = require(rel);
      if (typeof mod === 'function') {
        // function(routerOrApp)
        // If it expects an app, pass app. If it returns a router, mount it.
        const maybeRouter = mod.length >= 1 ? mod(app) : mod();
        if (maybeRouter && typeof maybeRouter === 'function') {
          app.use(maybeRouter);
        }
        mounted = true;
        break;
      } else if (mod && typeof mod === 'object' && mod.stack && mod.handle) {
        // looks like an express.Router()
        app.use(mod);
        mounted = true;
        break;
      }
    } catch (_) {
      // ignore MODULE_NOT_FOUND or runtime errors here; we'll fallback below
    }
  }

  // If nothing mounted, provide minimal page routes so the site still works.
  if (!mounted) {
    const renderPage = (view, data = {}) => (req, res) =>
      res.render(view, data);

    app.get('/', renderPage('index', { trending: [], philosophy: [], history: [] }));
    app.get('/about', renderPage('about'));
    app.get('/contact', renderPage('contact'));
    app.get('/watch', renderPage('watch', { videos: [] }));
    app.get('/login', renderPage('login', { csrfToken: '', referrer: req => req.get('referer') || '/' }));
    app.get('/register', renderPage('register', { csrfToken: '', referrer: req => req.get('referer') || '/' }));
    app.get('/dashboard', renderPage('dashboard', { user: res.locals.user, saves: [], notes: [], csrfToken: '' }));
    // Lightweight read page (your API route may override this when real routes are mounted)
    app.get('/read/:provider?/:id?', renderPage('read', { provider: '', id: '', referrer: '' }));
  }
})();

// -------- Health check (Render) --------
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

// -------- 404 and error handlers --------
app.use((req, res) => {
  // If you have views/404.ejs it will render; otherwise send text.
  try {
    res.status(404).render('404');
  } catch {
    res.status(404).send('Not Found');
  }
});

app.use((err, req, res, _next) => {
  console.error('🔥 Unhandled error:', err);
  try {
    res.status(500).render('error', { error: err });
  } catch {
    res.status(500).send('Internal Server Error');
  }
});

// -------- Start server --------
const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, () => {
  console.log(`BookLantern listening on :${PORT}`);
});
