// server.js  — CommonJS build (matches your package.json)

require('dotenv').config();

const path = require('path');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const csrf = require('csurf');
const NodeCache = require('node-cache');
const fetch = require('node-fetch'); // v2 (CommonJS)
const { v4: uuidv4 } = require('uuid');

// ----- App & config ----------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 10000;

const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  process.env.MONGODB_URL ||
  '';

const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me';
const NODE_ENV = process.env.NODE_ENV || 'production';

const cache = new NodeCache({ stdTTL: 60 * 60, checkperiod: 120 }); // 1h

// ----- Mongoose (optional but enabled if URI present) ------------------------
let mongoOk = false;
if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI)
    .then(() => {
      mongoOk = true;
      console.log('✅ Connected to MongoDB');
    })
    .catch((err) => {
      console.log('❌ MongoDB connection failed; continuing without auth:', err.message);
    });
} else {
  console.log('ℹ️  No MONGODB_URI provided — auth features disabled.');
}

// Lazy-load User model only if mongo is connected
let User = null;
if (mongoOk) {
  try {
    // if models/User.js exists in your repo (from earlier step)
    // eslint-disable-next-line global-require
    User = require('./models/User');
  } catch (e) {
    console.log('ℹ️  User model not found; login/register routes will render but not create users.');
  }
}

// ----- View engine & static --------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

// ----- Security / perf middlewares ------------------------------------------
app.use(compression());
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'img-src': [
          "'self'",
          'data:',
          'https:',
          // allow proxied images from our /proxy route
        ],
        'media-src': ["'self'", 'https:', 'data:'],
        'script-src': ["'self'", "'unsafe-inline'"],
        'connect-src': ["'self'", 'https:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(morgan('dev'));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ----- Sessions (only if Mongo configured) -----------------------------------
if (MONGODB_URI) {
  app.use(
    session({
      name: 'bl.sid',
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      },
      store: MongoStore.create({ mongoUrl: MONGODB_URI }),
    })
  );
}

// CSRF (only when sessions available)
if (MONGODB_URI) {
  app.use(csrf());
  app.use((req, res, next) => {
    res.locals.csrfToken = req.csrfToken();
    next();
  });
}

// ----- Small helpers ---------------------------------------------------------
const buildId = process.env.BUILD_ID || uuidv4().slice(0, 8);
app.use((req, res, next) => {
  res.locals.buildId = buildId;
  res.locals.loggedIn = !!(req.session && req.session.userId);
  next();
});

function ok(x) {
  return Array.isArray(x) ? x.length > 0 : !!x;
}

function pickCoverUrl({ provider, id, coverId, olCoverId, image }) {
  // Always return a proxied https image wherever possible to avoid mixed-content/CORS
  // Open Library covers
  if (provider === 'ol' && (coverId || olCoverId)) {
    const cid = coverId || olCoverId;
    const url = `https://covers.openlibrary.org/b/id/${cid}-M.jpg`;
    return `/proxy?url=${encodeURIComponent(url)}`;
  }
  // Gutendex (Project Gutenberg)
  if (provider === 'pg' && image && image !== '') {
    return `/proxy?url=${encodeURIComponent(image)}`;
  }
  // Internet Archive (if you wire later)
  if (provider === 'ia' && image && image !== '') {
    return `/proxy?url=${encodeURIComponent(image)}`;
  }
  return ''; // client will render placeholder initials
}

function normalizeItem(raw, provider) {
  if (provider === 'ol') {
    const workKey = raw.key || ''; // "/works/OL123W"
    const id = workKey.replace('/works/', '');
    const authors = (raw.authors || []).map((a) => a.name).filter(Boolean);
    return {
      provider,
      id,
      title: raw.title || 'Untitled',
      author: authors.join(', ') || 'Unknown',
      coverUrl: pickCoverUrl({
        provider,
        coverId: raw.cover_i || (raw.covers && raw.covers[0]),
      }),
    };
  }
  if (provider === 'pg') {
    const authors =
      (raw.authors || [])
        .map((a) => a.name)
        .filter(Boolean)
        .join(', ') || 'Unknown';
    // Gutendex gives multiple image sizes; choose "image" or first available
    const image =
      raw.formats?.['image/jpeg'] ||
      raw.formats?.['image/png'] ||
      '';
    return {
      provider,
      id: String(raw.id),
      title: raw.title || 'Untitled',
      author: authors,
      coverUrl: pickCoverUrl({ provider, image }),
    };
  }
  if (provider === 'ia') {
    // Example normalization if you add Internet Archive search later
    const authors = raw.creator || raw.author || 'Unknown';
    return {
      provider,
      id: raw.identifier,
      title: raw.title || 'Untitled',
      author: Array.isArray(authors) ? authors.join(', ') : authors,
      coverUrl: pickCoverUrl({ provider, image: raw.coverUrl }),
    };
  }
  return null;
}

// ----- External fetchers (OL + Gutendex) ------------------------------------
async function fetchOpenLibrarySeeds(seed, limit = 10) {
  const u = `https://openlibrary.org/subjects/${encodeURIComponent(seed)}.json?limit=${limit}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`OL seed failed: ${r.status}`);
  const j = await r.json();
  const works = j.works || [];
  return works.map((w) =>
    normalizeItem(
      {
        key: w.key,
        title: w.title,
        authors: w.authors,
        covers: w.cover_id ? [w.cover_id] : w.cover_i ? [w.cover_i] : w.covers,
        cover_i: w.cover_id || w.cover_i,
      },
      'ol'
    )
  );
}

async function fetchGutendex(query = 'philosophy', limit = 10) {
  const u = `https://gutendex.com/books/?search=${encodeURIComponent(query)}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Gutendex failed: ${r.status}`);
  const j = await r.json();
  const books = (j.results || []).slice(0, limit);
  return books.map((b) => normalizeItem(b, 'pg'));
}

// Multi-source shelves with caching
async function getShelves() {
  const cached = cache.get('shelves');
  if (cached) return cached;

  // Two sources for each shelf (OL + PG) to keep things varied
  const [trOl, trPg, phOl, phPg, hiOl, hiPg] = await Promise.all([
    fetchOpenLibrarySeeds('trending', 8).catch(() => []),
    fetchGutendex('fiction', 8).catch(() => []),
    fetchOpenLibrarySeeds('philosophy', 8).catch(() => []),
    fetchGutendex('philosophy', 8).catch(() => []),
    fetchOpenLibrarySeeds('history', 8).catch(() => []),
    fetchGutendex('history', 8).catch(() => []),
  ]);

  const shelves = {
    trending: [...trOl, ...trPg].slice(0, 12),
    philosophy: [...phOl, ...phPg].slice(0, 12),
    history: [...hiOl, ...hiPg].slice(0, 12),
  };

  cache.set('shelves', shelves, 60 * 60); // 1h
  return shelves;
}

// ----- Login-gate middleware for reading ------------------------------------
function requireLogin(req, res, next) {
  if (!MONGODB_URI) return next(); // auth disabled
  if (req.session && req.session.userId) return next();
  // bounce to login, but keep intended URL
  return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

// ----- Routes: pages ---------------------------------------------------------
app.get('/', async (req, res, next) => {
  try {
    const { trending, philosophy, history } = await getShelves();
    res.render('index', {
      pageTitle: 'BookLantern — Largest Online Hub of Free Books',
      trending,
      philosophy,
      history,
    });
  } catch (e) {
    next(e);
  }
});

app.get('/read', (req, res) => {
  res.render('read', { pageTitle: 'Explore Free Books' });
});

app.get('/watch', (req, res) => {
  // your existing watch.ejs reads videos from DB or data/videos.json
  res.render('watch', { pageTitle: 'Watch' });
});

app.get('/about', (req, res) => {
  res.render('about', { pageTitle: 'About' });
});

app.get('/contact', (req, res) => {
  res.render('contact', { pageTitle: 'Contact' });
});

// Reader route (opens our internal reader; never sends users to OL/PG)
app.get('/read/:provider/:id', requireLogin, async (req, res) => {
  const { provider, id } = req.params;
  // Render your reader template; the client can fetch content by provider/id
  res.render('reader', {
    pageTitle: 'Reader',
    provider,
    id,
  });
});

// ----- API: resolve book → Open content URL we can embed --------------------
// NOTE: This returns a *viewable* URL that your reader can fetch/embed in an <iframe>
// without sending users away. We keep the user on booklantern.org.
app.get('/api/book', async (req, res) => {
  const { provider, id } = req.query;
  try {
    if (provider === 'ol') {
      // We try to fetch OL readable URL (if any). For many OL works, the
      // readable file is on Archive; you can expand this later.
      const u = `https://openlibrary.org/works/${id}.json`;
      const r = await fetch(u);
      if (!r.ok) return res.json({ ok: false });
      const j = await r.json();
      // naive attempt at an IA id if present
      const ia = (j.covers && j.covers[0]) ? null : null;
      return res.json({ ok: true, provider, id, readerUrl: `https://openlibrary.org/works/${id}` });
    }
    if (provider === 'pg') {
      // Gutendex → find best HTML/plain text url to embed in our reader
      const r = await fetch(`https://gutendex.com/books/${id}`);
      if (!r.ok) return res.json({ ok: false });
      const j = await r.json();
      const fm = j.formats || {};
      const html = fm['text/html; charset=utf-8'] || fm['text/html'] || '';
      const txt = fm['text/plain; charset=utf-8'] || fm['text/plain'] || '';
      const pdf = fm['application/pdf'] || '';
      const readerUrl = html || txt || pdf || '';
      return res.json({ ok: !!readerUrl, provider, id, readerUrl });
    }
    return res.json({ ok: false });
  } catch (e) {
    return res.json({ ok: false });
  }
});

// ----- Proxy for images (and optionally for reader embeds if needed) --------
app.get('/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//i.test(url)) return res.sendStatus(400);
  try {
    const r = await fetch(url);
    if (!r.ok) return res.sendStatus(502);
    // forward content-type for images; default to octet-stream
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    r.body.pipe(res);
  } catch (e) {
    res.sendStatus(502);
  }
});

// ----- Auth (only active if MongoDB available) -------------------------------
app.get('/login', (req, res) => {
  res.render('login', {
    pageTitle: 'Login',
    messages: {},
    next: req.query.next || '/',
  });
});

app.post('/login', async (req, res) => {
  if (!mongoOk || !User) return res.redirect('/');
  const { email, password } = req.body || {};
  try {
    const user = await User.findOne({ email: (email || '').toLowerCase().trim() });
    if (!user) {
      return res.status(400).render('login', {
        pageTitle: 'Login',
        messages: { error: 'Invalid email or password.' },
        next: req.body.next || '/',
      });
    }
    const okPw = await user.comparePassword(password || '');
    if (!okPw) {
      return res.status(400).render('login', {
        pageTitle: 'Login',
        messages: { error: 'Invalid email or password.' },
        next: req.body.next || '/',
      });
    }
    req.session.userId = String(user._id);
    return res.redirect(req.body.next || '/');
  } catch (e) {
    return res.status(500).render('login', {
      pageTitle: 'Login',
      messages: { error: 'Something went wrong. Please try again.' },
      next: req.body.next || '/',
    });
  }
});

app.get('/register', (req, res) => {
  res.render('register', {
    pageTitle: 'Register',
    messages: {},
  });
});

app.post('/register', async (req, res) => {
  if (!mongoOk || !User) return res.redirect('/');
  const { name, email, password } = req.body || {};
  try {
    const exists = await User.findOne({ email: (email || '').toLowerCase().trim() });
    if (exists) {
      return res.status(400).render('register', {
        pageTitle: 'Register',
        messages: { error: 'That email is already registered.' },
      });
    }
    const user = await User.create({
      name: (name || '').trim() || 'Reader',
      email: (email || '').toLowerCase().trim(),
      password: password || '',
    });
    req.session.userId = String(user._id);
    return res.redirect('/');
  } catch (e) {
    return res.status(500).render('register', {
      pageTitle: 'Register',
      messages: { error: 'Something went wrong. Please try again.' },
    });
  }
});

app.post('/logout', (req, res) => {
  if (!req.session) return res.redirect('/');
  req.session.destroy(() => res.redirect('/'));
});

// ----- 404 & error handlers --------------------------------------------------
app.use((req, res) => {
  res.status(404).render('404', { pageTitle: 'Page not found' });
});

app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).render('error', {
    pageTitle: 'Something went wrong',
    message: NODE_ENV === 'production' ? 'Unexpected error' : err.message,
    stack: NODE_ENV === 'production' ? null : err.stack,
  });
});

// ----- Start -----------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
