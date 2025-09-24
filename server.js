// server.js — CommonJS with unified /api/book (OL, Gutenberg, IA, Standard Ebooks)

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
const fetch = require('node-fetch'); // v2 CommonJS
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 10000;

const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  process.env.MONGODB_URL ||
  '';

const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me';
const NODE_ENV = process.env.NODE_ENV || 'production';

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 }); // 1h shelves cache

// ---------- Mongo (optional) ----------
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

// Lazy-load User model if exists
let User = null;
if (mongoOk) {
  try {
    User = require('./models/User');
  } catch (e) {
    console.log('ℹ️  User model not found; login/register will be limited.');
  }
}

// ---------- Views / static ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

// ---------- Security / perf ----------
app.use(compression());
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // allow loading covers and miscellaneous images
        'img-src': [
          "'self'",
          'data:',
          'https:',
        ],
        // allow iframe embeds from books sources
        'frame-src': [
          "'self'",
          'https://www.gutenberg.org',
          'https://gutenberg.org',
          'https://standardebooks.org',
          'https://archive.org',
          'https://openlibrary.org',
        ],
        'script-src': ["'self'", "'unsafe-inline'"],
        'connect-src': ["'self'", 'https:', 'data:'],
        'media-src': ["'self'", 'https:', 'data:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(morgan('dev'));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---------- Sessions ----------
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

// CSRF tokens when sessions available
if (MONGODB_URI) {
  app.use(csrf());
  app.use((req, res, next) => {
    res.locals.csrfToken = req.csrfToken();
    next();
  });
}

// ---------- Locals ----------
const buildId = process.env.BUILD_ID || uuidv4().slice(0, 8);
app.use((req, res, next) => {
  res.locals.buildId = buildId;
  res.locals.loggedIn = !!(req.session && req.session.userId);
  next();
});

// ---------- Helpers ----------
function initials(title = '') {
  const t = String(title || '').trim();
  if (!t) return 'BK';
  const parts = t.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase();
}

function pickCoverUrl({ provider, coverId, image }) {
  if (provider === 'ol' && coverId) {
    const url = `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
    return `/proxy?url=${encodeURIComponent(url)}`;
  }
  if (provider === 'pg' && image) {
    return `/proxy?url=${encodeURIComponent(image)}`;
  }
  return '';
}

function normalizeOLWorkToCard(w) {
  return {
    provider: 'ol',
    id: String((w.key || '').replace('/works/', '')),
    title: w.title || 'Untitled',
    author: (w.authors && w.authors[0] && w.authors[0].name) || '',
    coverUrl: pickCoverUrl({ provider: 'ol', coverId: w.cover_id || w.cover_i }),
    initials: initials(w.title),
  };
}
function normalizePGToCard(b) {
  const fm = b.formats || {};
  const img = fm['image/jpeg'] || fm['image/png'] || '';
  return {
    provider: 'pg',
    id: String(b.id),
    title: b.title || 'Untitled',
    author: (b.authors && b.authors[0] && b.authors[0].name) || '',
    coverUrl: pickCoverUrl({ provider: 'pg', image: img }),
    initials: initials(b.title),
  };
}

// ---------- External shelves ----------
async function fetchOpenLibrarySeed(seed, limit = 10) {
  const u = `https://openlibrary.org/subjects/${encodeURIComponent(seed)}.json?limit=${limit}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`OL subjects ${seed} failed: ${r.status}`);
  const j = await r.json();
  const works = j.works || [];
  return works.map(normalizeOLWorkToCard);
}

async function fetchGutendex(query, limit = 10) {
  const u = `https://gutendex.com/books/?search=${encodeURIComponent(query)}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Gutendex ${query} failed: ${r.status}`);
  const j = await r.json();
  const books = (j.results || []).slice(0, limit);
  return books.map(normalizePGToCard);
}

async function getShelves() {
  const cached = cache.get('shelves');
  if (cached) return cached;

  const [trOl, trPg, phOl, phPg, hiOl, hiPg] = await Promise.all([
    fetchOpenLibrarySeed('trending', 8).catch(() => []),
    fetchGutendex('fiction', 8).catch(() => []),
    fetchOpenLibrarySeed('philosophy', 8).catch(() => []),
    fetchGutendex('philosophy', 8).catch(() => []),
    fetchOpenLibrarySeed('history', 8).catch(() => []),
    fetchGutendex('history', 8).catch(() => []),
  ]);

  const shelves = {
    trending: [...trOl, ...trPg].slice(0, 12),
    philosophy: [...phOl, ...phPg].slice(0, 12),
    history: [...hiOl, ...hiPg].slice(0, 12),
  };

  cache.set('shelves', shelves, 3600);
  return shelves;
}

// ---------- Auth helpers ----------
function requireLogin(req, res, next) {
  if (!MONGODB_URI) return next(); // auth disabled in dev
  if (req.session && req.session.userId) return next();
  return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

// ---------- Pages ----------
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

app.get('/about', (req, res) => res.render('about', { pageTitle: 'About' }));
app.get('/contact', (req, res) => res.render('contact', { pageTitle: 'Contact' }));
app.get('/watch', (req, res) => res.render('watch', { pageTitle: 'Watch' }));

// Reader (login-gated)
app.get('/read/:provider/:id', requireLogin, (req, res) => {
  const { provider, id } = req.params;
  res.render('read', { provider, id });
});

// ---------- Unified /api/book ----------
/*
  Returns one of:
  { ok:true, type:'html', content, title }
  { ok:true, type:'url',  url,     title }
  { ok:false, message }
*/
app.get('/api/book', async (req, res) => {
  const provider = String(req.query.provider || '').toLowerCase();
  const id = String(req.query.id || '').trim();

  try {
    if (!provider || !id) {
      return res.json({ ok: false, message: 'Missing provider or id' });
    }

    // --- Project Gutenberg via Gutendex ---
    if (provider === 'pg') {
      const r = await fetch(`https://gutendex.com/books/${encodeURIComponent(id)}`);
      if (!r.ok) return res.json({ ok: false, message: 'Gutendex lookup failed' });
      const j = await r.json();
      const fm = j.formats || {};

      // Prefer HTML → inject
      const html =
        fm['text/html; charset=utf-8'] ||
        fm['text/html'] ||
        null;

      if (html) {
        // Fetch and inline (best reading + TTS)
        const proxied = await fetch(html);
        if (proxied.ok) {
          const contentType = (proxied.headers.get('content-type') || '').toLowerCase();
          if (contentType.includes('text/html')) {
            const raw = await proxied.text();
            // Light clean: strip scripts/links (security, noise)
            const sanitized = raw
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<link[\s\S]*?>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '');
            return res.json({
              ok: true,
              type: 'html',
              title: j.title || 'Untitled',
              content: sanitized,
            });
          }
        }
      }

      // Plain text fallback → inject
      const txt =
        fm['text/plain; charset=utf-8'] ||
        fm['text/plain'] ||
        null;
      if (txt) {
        const t = await (await fetch(txt)).text();
        return res.json({
          ok: true,
          type: 'html',
          title: j.title || 'Untitled',
          content: `<pre>${escapeHtml(t)}</pre>`,
        });
      }

      // PDF/EPUB fallback → open in iframe (remote)
      const pdf = fm['application/pdf'];
      if (pdf) {
        return res.json({ ok: true, type: 'url', title: j.title || 'Untitled', url: pdf });
      }
      const epub = fm['application/epub+zip'];
      if (epub) {
        // Let browser handle via plugin/extension/OS; still iframe
        return res.json({ ok: true, type: 'url', title: j.title || 'Untitled', url: epub });
      }

      return res.json({ ok: false, message: 'No readable format found for this PG id.' });
    }

    // --- Open Library (try to resolve to IA viewer or readable HTML) ---
    if (provider === 'ol') {
      // Try editions to find an IA/ocaid
      const ed = await fetch(`https://openlibrary.org/works/${encodeURIComponent(id)}/editions.json?limit=10`);
      if (ed.ok) {
        const ej = await ed.json();
        const entries = ej.entries || [];
        const found = entries.find(e => e.ocaid || (Array.isArray(e.ia) && e.ia.length));
        const ocaid = found?.ocaid || (Array.isArray(found?.ia) ? found.ia[0] : null);
        if (ocaid) {
          // IA viewer (remote). CSP allows frame-src archive.org.
          const viewer = `https://archive.org/details/${encodeURIComponent(ocaid)}?view=theater&ui=embed`;
          return res.json({ ok: true, type: 'url', title: found.title || 'Open Library', url: viewer });
        }
      }
      // Fallback: OL work page (not ideal UX, but displays metadata; your proxy/reader will still contain it)
      const olWork = `https://openlibrary.org/works/${encodeURIComponent(id)}`;
      return res.json({ ok: true, type: 'url', title: 'Open Library', url: olWork });
    }

    // --- Internet Archive direct (if you call with provider=ia&id=<identifier>) ---
    if (provider === 'ia') {
      const viewer = `https://archive.org/details/${encodeURIComponent(id)}?view=theater&ui=embed`;
      return res.json({ ok: true, type: 'url', title: id, url: viewer });
    }

    // --- Standard Ebooks: prefer the HTML page for the book if id is full slug ---
    if (provider === 'se') {
      // If id looks like "author-name/book-title" (slug), direct to book page
      // Ex: https://standardebooks.org/ebooks/mark-twain/adventures-of-huckleberry-finn
      const base = `https://standardebooks.org/ebooks/${id}`;
      return res.json({ ok: true, type: 'url', title: id, url: base });
    }

    return res.json({ ok: false, message: 'Unknown provider' });
  } catch (err) {
    console.error('api/book error:', err);
    return res.json({ ok: false, message: 'Resolver error' });
  }
});

// ---------- Proxy (images or generic passthrough) ----------
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) return res.sendStatus(400);
  try {
    const r = await fetch(url);
    if (!r.ok) return res.sendStatus(502);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    r.body.pipe(res);
  } catch (e) {
    res.sendStatus(502);
  }
});

// ---------- Auth ----------
app.get('/login', (req, res) => {
  res.render('login', {
    pageTitle: 'Login',
    messages: {},
    next: req.query.next || '/',
  });
});

app.post('/login', async (req, res) => {
  if (!mongoOk || !User) return res.redirect(req.body.next || '/');
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

// ---------- 404 & errors ----------
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

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ---------- tiny util ----------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
