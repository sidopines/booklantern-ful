// server.js — CommonJS, hardened route mounting (no fallback pages)

const path = require('path');
const fs = require('fs');
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

// Static assets
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

  next();
});

// ---------- Utils to recognize routers / middleware ----------
function isExpressRouter(obj) {
  return !!(obj && typeof obj === 'function' && obj.handle && obj.stack);
}
function isMiddlewareFn(fn) {
  return typeof fn === 'function';
}
function tryMount(candidate, label) {
  // candidate may be:
  // - express.Router instance
  // - middleware function (req,res,next)
  // - (app) => void
  // - factory returning a Router
  // - object containing { router } or { routes } or { default }
  if (!candidate) return false;

  // unwrap common containers
  const variants = [
    candidate,
    candidate.default,
    candidate.router,
    candidate.routes,
  ].filter(Boolean);

  for (const v of variants) {
    // Router instance
    if (isExpressRouter(v)) {
      app.use(v);
      console.log(`[routes] mounted Router from ${label}`);
      return true;
    }

    // Middleware function (req,res,next)
    if (isMiddlewareFn(v) && v.length >= 2) {
      app.use(v);
      console.log(`[routes] mounted middleware from ${label}`);
      return true;
    }

    // Init function (app) => void
    if (isMiddlewareFn(v) && v.length === 1) {
      try {
        v(app);
        console.log(`[routes] ran init(app) from ${label}`);
        return true;
      } catch (e) {
        console.error(`[routes] init(app) failed in ${label}:`, e);
      }
    }

    // Factory that returns a Router/middleware
    if (isMiddlewareFn(v) && v.length === 0) {
      try {
        const produced = v();
        if (isExpressRouter(produced)) {
          app.use(produced);
          console.log(`[routes] mounted factory Router from ${label}`);
          return true;
        }
        if (isMiddlewareFn(produced)) {
          app.use(produced);
          console.log(`[routes] mounted factory middleware from ${label}`);
          return true;
        }
      } catch (e) {
        console.error(`[routes] factory() failed in ${label}:`, e);
      }
    }
  }

  return false;
}

// ---------- Mount routes from common entry points, then fallback to folder scan ----------
(function mountRoutes() {
  const entryCandidates = [
    './routes/index',
    './routes',
    './routes/app',
    './routes/main',
  ];

  let mounted = false;

  for (const rel of entryCandidates) {
    try {
      const mod = require(rel);
      if (tryMount(mod, rel)) {
        mounted = true;
        break;
      }
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') {
        console.error(`[routes] error loading ${rel}:`, e);
      }
    }
  }

  if (!mounted) {
    const routesDir = path.join(__dirname, 'routes');
    if (fs.existsSync(routesDir) && fs.statSync(routesDir).isDirectory()) {
      const files = fs
        .readdirSync(routesDir)
        .filter((f) => f.endsWith('.js') || f.endsWith('.cjs'));
      for (const f of files) {
        const rel = `./routes/${f}`;
        try {
          const mod = require(rel);
          if (tryMount(mod, rel)) {
            mounted = true;
          }
        } catch (e) {
          console.error(`[routes] error loading ${rel}:`, e);
        }
      }
    }
  }

  if (!mounted) {
    console.error(
      '[routes] No app routes mounted. Ensure a file in /routes exports an express Router, a middleware, or (app)=>void.'
    );
  }
})();

// ---------- Health check ----------
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

// ---------- 404 / 500 ----------
app.use((req, res) => {
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

// ---------- Start ----------
const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, () => {
  console.log(`BookLantern listening on :${PORT}`);
});
