// server.js (CommonJS, final-no-fallbacks)

const path = require('path');
const express = require('express');
const compression = require('compression');
const morgan = require('morgan');

const app = express();

// ---------- Core ----------
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static / public
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

// Service worker at root scope
app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sw.js'), {
    headers: { 'Content-Type': 'application/javascript' },
  });
});

// ---------- Safe locals for all EJS templates ----------
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

// ---------- Mount your real routes (no fallbacks) ----------
(function mountRoutes() {
  const candidates = ['./routes/index', './routes']; // add more if needed

  let mounted = false;
  for (const rel of candidates) {
    try {
      const mod = require(rel);
      if (typeof mod === 'function') {
        // It might be (app)=>void or an express.Router factory
        const ret = mod.length >= 1 ? mod(app) : mod();
        if (ret && typeof ret === 'function') app.use(ret);
        mounted = true;
        console.log(`[routes] mounted from ${rel}`);
        break;
      }
      // Or a plain express.Router instance
      if (mod && typeof mod === 'object' && mod.handle && mod.stack) {
        app.use(mod);
        mounted = true;
        console.log(`[routes] mounted Router from ${rel}`);
        break;
      }
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') {
        console.error(`[routes] error loading ${rel}:`, e);
      }
    }
  }

  if (!mounted) {
    console.error(
      '[routes] No app routes mounted. Ensure you have routes/index.js or routes.js exporting a router or (app)=>void.'
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
