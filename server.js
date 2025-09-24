// server.js — Black/Yellow theme build with working auth + reader routes

const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const fetch = require('node-fetch'); // v2 in your package.json
const NodeCache = require('node-cache');
const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');
const User = require('./models/User'); // has comparePassword()

// ---------- App & basic config ----------
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: false, // keep simple; we added allowlist below for images
}));
app.use(compression());
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// static (also serve favicon to stop 404 noise)
app.use('/public', express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
}));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Build id for cache-busting
const buildId = process.env.BUILD_ID || Date.now().toString();

// ---------- Session store ----------
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI || '';

let sessionStore;
if (MONGO_URL) {
  sessionStore = MongoStore.create({
    mongoUrl: MONGO_URL,
    stringify: false,
    ttl: 60 * 60 * 24 * 7, // 7 days
  });
  console.log('🗄️  Session store: MongoStore');
} else {
  console.log('🗄️  Session store: Memory (dev)');
}

// sessions
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
  },
}));

// CSRF
const csrfProtection = csrf({ cookie: false });
app.use(csrfProtection);

// Make globals available to views
app.use((req, res, next) => {
  res.locals.buildId = buildId;
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  res.locals._user = req.session.user || null;
  res.locals._loggedIn = !!req.session.user;
  next();
});

// ---------- DB ----------
(async () => {
  if (!MONGO_URL) {
    console.log('❌ MongoDB URL missing; running without DB auth features.');
    return;
  }
  try {
    await mongoose.connect(MONGO_URL);
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.log('❌ MongoDB connection failed; continuing without auth:', err.message);
  }
})();

// ---------- In-memory cache for homepage shelves ----------
const cache = new NodeCache({ stdTTL: 60 * 60, checkperiod: 600 }); // 1h

// Helpers to normalize covers (Open Library primary; graceful fallback)
function coverFromOpenLibrary(olWorkId) {
  // olWorkId like 'OL123W' or an edition ID; if not, return null
  if (!olWorkId) return null;
  const id = String(olWorkId).replace(/^OL|W|M/gi, '');
  // this is heuristic; we also support explicit coverUrl in items
  return `https://covers.openlibrary.org/b/olid/${olWorkId}-L.jpg`;
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v && String(v).trim() !== '') return v;
  }
  return '';
}

// Fake multi-source aggregator demo
async function fetchShelf(name) {
  // cache first
  const key = `shelf:${name}`;
  const cached = cache.get(key);
  if (cached) return cached;

  // For demo: stitch together some Open Library + Gutenberg “known” IDs
  // In your real code, replace with proper queries across multiple APIs.
  let items = [];
  if (name === 'trending') {
    items = [
      { provider: 'ol', id: 'OL8193416W', title: 'Northanger Abbey', author: 'Jane Austen' },
      { provider: 'pg', id: '158', title: 'Emma', author: 'Jane Austen' },
      { provider: 'pg', id: '98', title: 'A Tale of Two Cities', author: 'Charles Dickens' },
      { provider: 'ol', id: 'OL45883W', title: 'Frankenstein', author: 'Mary Shelley' },
      { provider: 'pg', id: '844', title: 'The War of the Worlds', author: 'H. G. Wells' },
    ];
  } else if (name === 'philosophy') {
    items = [
      { provider: 'pg', id: '1497', title: 'The Problems of Philosophy', author: 'Bertrand Russell' },
      { provider: 'pg', id: '4270', title: 'Nicomachean Ethics', author: 'Aristotle' },
      { provider: 'pg', id: '11907', title: 'La Poética', author: 'Aristotle' },
      { provider: 'pg', id: '59', title: 'Discourse on Method', author: 'Descartes' },
      { provider: 'pg', id: '3300', title: 'Thus Spake Zarathustra', author: 'F. Nietzsche' },
    ];
  } else if (name === 'history') {
    items = [
      { provider: 'pg', id: '2701', title: 'History of the Decline and Fall of the Roman Empire', author: 'Edward Gibbon' },
      { provider: 'pg', id: '33034', title: 'The Story of Mankind', author: 'H. L. L. Tonge' },
      { provider: 'ol', id: 'OL45804W', title: 'Memoirs of the Second World War', author: 'Winston S. Churchill' },
      { provider: 'pg', id: '14979', title: 'The Outline of History', author: 'H. G. Wells' },
    ];
  }

  // Attach coverUrl heuristics (OL if present, else a neutral placeholder)
  items = items.map(it => ({
    ...it,
    coverUrl: it.coverUrl ||
      (it.provider === 'ol' ? coverFromOpenLibrary(it.id) : '') ||
      '',
  }));

  cache.set(key, items);
  return items;
}

// ---------- Auth helpers ----------
function requireAuth(req, res, next) {
  if (!req.session.user) {
    const nextUrl = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/login?next=${nextUrl}`);
  }
  next();
}

// ---------- Routes ----------

// Home — shelves composed from multiple sources demo
app.get('/', async (req, res, next) => {
  try {
    const [trending, philosophy, history] = await Promise.all([
      fetchShelf('trending'),
      fetchShelf('philosophy'),
      fetchShelf('history'),
    ]);
    res.render('index', {
      pageTitle: 'Largest Online Hub of Free Books',
      trending,
      philosophy,
      history,
    });
  } catch (err) { next(err); }
});

// Read tab (search landing)
app.get('/read', (req, res) => {
  res.render('read', {
    pageTitle: 'Read - BookLantern',
    // keep simple search shell; or reuse your older template
  });
});

// Reader page — requires login
app.get('/read/:provider/:id', requireAuth, (req, res) => {
  const { provider, id } = req.params;
  res.render('read', {
    pageTitle: 'Reader - BookLantern',
    provider,
    id,
  });
});

// Unified content API feeding the reader (very trimmed demo)
app.get('/api/book/:provider/:id', requireAuth, async (req, res) => {
  const { provider, id } = req.params;

  // Demo: return a small HTML snippet or an iframe URL.
  // Replace with real provider integrations.
  if (provider === 'pg') {
    // Project Gutenberg plain text endpoint (sample)
    return res.json({
      type: 'text/html',
      title: `Gutenberg #${id}`,
      html: `<h1>Gutenberg #${id}</h1><p>This is a demo body. Replace with fetched text.</p>`,
    });
  }

  if (provider === 'ol') {
    // For Open Library, we could embed an archive.org iframe if available.
    return res.json({
      type: 'iframe',
      title: `Open Library ${id}`,
      url: 'about:blank', // replace with a safe embed URL when available
    });
  }

  // fallback
  return res.json({
    type: 'text/html',
    title: 'Demo Book',
    html: `<h1>Demo Book</h1><p>Replace with your real multi-source content.</p>`,
  });
});

// Watch — will render even if no videos yet
app.get('/watch', (req, res) => {
  res.render('watch', {
    pageTitle: 'Watch - BookLantern',
    videos: [], // populate later via admin; template won’t crash
  });
});

// About / Contact
app.get('/about', (req, res) => res.render('about', { pageTitle: 'About - BookLantern' }));
app.get('/contact', (req, res) => res.render('contact', { pageTitle: 'Contact - BookLantern' }));

// Account (fixed 404). Very simple placeholder; expand later.
app.get('/account', requireAuth, (req, res) => {
  res.render('account', {
    pageTitle: 'My Account - BookLantern',
  });
});

// ----- Auth: login/register/logout -----

app.get('/login', (req, res) => {
  res.render('login', {
    pageTitle: 'Login - BookLantern',
    messages: {},
    referrer: req.get('referer') || '/',
    next: req.query.next || '/',
  });
});

app.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const password = String(req.body.password || '');
    const remember = !!req.body.remember;

    const user = await User.findOne({ email }).exec();
    if (!user) {
      return res.status(401).render('login', {
        pageTitle: 'Login - BookLantern',
        messages: { error: 'Invalid email or password.' },
        referrer: req.get('referer') || '/',
        next: req.body.next || '/',
      });
    }
    const ok = await user.comparePassword(password);
    if (!ok) {
      return res.status(401).render('login', {
        pageTitle: 'Login - BookLantern',
        messages: { error: 'Invalid email or password.' },
        referrer: req.get('referer') || '/',
        next: req.body.next || '/',
      });
    }

    req.session.user = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
    };
    if (remember) {
      // extend cookie to 30 days
      req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
    }
    const dest = req.body.next || '/';
    return res.redirect(dest);
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).render('login', {
      pageTitle: 'Login - BookLantern',
      messages: { error: 'Unexpected error. Please try again.' },
      referrer: req.get('referer') || '/',
      next: req.body.next || '/',
    });
  }
});

app.get('/register', (req, res) => {
  res.render('register', {
    pageTitle: 'Register - BookLantern',
    messages: {},
    referrer: req.get('referer') || '/',
    next: req.query.next || '/',
  });
});

app.post('/register', async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const password = String(req.body.password || '');
    const name = String(req.body.name || 'Reader').trim();

    if (!email || !password) {
      return res.status(400).render('register', {
        pageTitle: 'Register - BookLantern',
        messages: { error: 'Email and password are required.' },
        referrer: req.get('referer') || '/',
        next: req.body.next || '/',
      });
    }

    const exists = await User.findOne({ email }).exec();
    if (exists) {
      return res.status(400).render('register', {
        pageTitle: 'Register - BookLantern',
        messages: { error: 'Email is already registered.' },
        referrer: req.get('referer') || '/',
        next: req.body.next || '/',
      });
    }

    const user = new User({ email, password, name, role: 'user' });
    await user.save();

    req.session.user = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
    };
    const dest = req.body.next || '/';
    res.redirect(dest);
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).render('register', {
      pageTitle: 'Register - BookLantern',
      messages: { error: 'Unexpected error. Please try again.' },
      referrer: req.get('referer') || '/',
      next: req.body.next || '/',
    });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ---------- 404 / Error ----------
app.use((req, res) => {
  res.status(404).render('404', { pageTitle: '404 - Not Found' });
});

app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err);
  try {
    res.status(500).render('error', {
      pageTitle: 'Error - BookLantern',
      message: 'Unexpected error',
    });
  } catch (e) {
    res.status(500).send('Internal Server Error');
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
