/** server.js — resilient boot with optional Mongo
 *  - If MONGODB_URI is set: use MongoStore + Mongoose (auth enabled)
 *  - If missing: fall back to MemoryStore and skip Mongoose (auth disabled)
 */

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const csrf = require('csurf');
const NodeCache = require('node-cache');
const fetch = global.fetch || ((...args) => import('node-fetch').then(m => m.default(...args)));

const app = express();

// ---------------------------
// Environment & flags
// ---------------------------
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const PROD = NODE_ENV === 'production';

const MONGODB_URI = process.env.MONGODB_URI || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-change-me';

// Build id for cache-busting
const buildId = process.env.BUILD_ID || Date.now().toString(36);

// ---------------------------
// View engine
// ---------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------------------------
// Middleware (security, logs, static)
// ---------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": [
          "'self'",
          "data:",
          "https://covers.openlibrary.org",
          "https://*.*.amazonaws.com",
          "https://i.ytimg.com",
          "https://img.youtube.com",
          "https://images.unsplash.com",
          "https://*.googleusercontent.com"
        ],
        "connect-src": ["'self'", "https://openlibrary.org", "https://covers.openlibrary.org"],
        "frame-src": ["'self'", "https://www.youtube.com", "https://player.vimeo.com"],
        "upgrade-insecure-requests": []
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);

app.use(compression());
app.use(morgan(PROD ? 'combined' : 'dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// ---------------------------
// Sessions (Mongo if available; else memory)
// ---------------------------
let sessionStore;
if (MONGODB_URI) {
  try {
    sessionStore = MongoStore.create({
      mongoUrl: MONGODB_URI,
      collectionName: 'sessions',
      ttl: 60 * 60 * 24 * 14 // 14 days
    });
    // eslint-disable-next-line no-console
    console.log('🗄️  Session store: MongoStore');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  Failed to init MongoStore; falling back to MemoryStore:', e.message);
  }
} else {
  // eslint-disable-next-line no-console
  console.warn('⚠️  MONGODB_URI not set; using MemoryStore (sessions reset on restart).');
}

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: PROD
    },
    store: sessionStore // undefined ⇒ MemoryStore
  })
);

// ---------------------------
// CSRF (after session)
// ---------------------------
const csrfProtection = csrf({ cookie: false });
app.use((req, res, next) => {
  // Safe locals for all views
  res.locals.buildId = buildId;
  res.locals.loggedIn = !!req.session.userId;
  res.locals.user = req.session.user || null;
  next();
});

// ---------------------------
// Static assets
// ---------------------------
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '7d' : 0 }));

// ---------------------------
/** Optional Mongoose boot — only if MONGODB_URI present
 *  Auth routes will be disabled if DB is not available.
 */
let mongoose, User, dbReady = false;

(async () => {
  if (!MONGODB_URI) return;

  try {
    mongoose = require('mongoose');
    await mongoose.connect(MONGODB_URI);
    // eslint-disable-next-line no-console
    console.log('✅ Connected to MongoDB');

    // Lazy-require your model after mongoose exists
    User = require('./models/User');
    dbReady = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('❌ MongoDB connection failed; continuing without auth:', err.message);
  }
})();

// ---------------------------
// Open Library helpers + cache
// ---------------------------
const cache = new NodeCache({ stdTTL: 60 * 60 }); // 1 hour

const pick = (v, fallback = '') => (v === undefined || v === null ? fallback : v);

function normalizeOpenLibraryDoc(doc) {
  const title = pick(doc.title);
  const author = (doc.author_name && doc.author_name[0]) || '';
  const key = doc.key || '';
  let openLibraryId = '';
  if (doc.lending_identifier) openLibraryId = doc.lending_identifier;
  else if (doc.cover_edition_key) openLibraryId = doc.cover_edition_key;
  else if (doc.edition_key && doc.edition_key.length) openLibraryId = doc.edition_key[0];

  // Cover URL
  let cover = '';
  if (doc.cover_i) cover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
  else if (openLibraryId) cover = `https://covers.openlibrary.org/b/olid/${openLibraryId}-L.jpg`;

  return {
    id: key || openLibraryId || title,
    title,
    author,
    openLibraryId,
    cover
  };
}

async function searchOpenLibrary(q, limit = 30) {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${limit}`;
  const res = await fetch(url, { headers: { 'user-agent': 'BookLantern/1.0' } });
  if (!res.ok) throw new Error(`OL ${res.status}`);
  const json = await res.json();
  return (json.docs || []).map(normalizeOpenLibraryDoc);
}

async function seededShelf(queries, per = 10) {
  const results = await Promise.all(queries.map(q => searchOpenLibrary(q, per)));
  // Merge; drop empties; slice to per
  const flat = results.flat().filter(Boolean);
  const seen = new Set();
  const uniq = [];
  for (const it of flat) {
    const key = it.id || `${it.title}|${it.author}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(it);
    }
    if (uniq.length >= per) break;
  }
  return uniq;
}

// ---------------------------
// Routes (public pages)
// ---------------------------
app.get('/', csrfProtection, async (req, res, next) => {
  try {
    const cached = cache.get('home_shelves');
    let payload = cached;
    if (!payload) {
      const [trending, philosophy, history] = await Promise.all([
        seededShelf(['classic literature', 'children classics', 'popular public domain'], 12),
        seededShelf(['philosophy', 'ethics', 'political philosophy'], 12),
        seededShelf(['world history', 'ancient history', 'biography'], 12)
      ]);
      payload = { trending, philosophy, history };
      cache.set('home_shelves', payload);
    }

    return res.render('index', {
      buildId,
      csrfToken: req.csrfToken(),
      trending: payload.trending,
      philosophy: payload.philosophy,
      history: payload.history,
      pageTitle: 'BookLantern',
      pageDescription: 'Largest Online Hub of Free Books'
    });
  } catch (err) {
    return next(err);
  }
});

app.get('/read', csrfProtection, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    let results = [];
    if (q) {
      const cacheKey = `read:${q.toLowerCase()}`;
      results = cache.get(cacheKey) || await searchOpenLibrary(q, 40);
      cache.set(cacheKey, results);
    }
    return res.render('read', {
      buildId,
      csrfToken: req.csrfToken(),
      q,
      results,
      pageTitle: 'Explore Free Books',
      pageDescription: 'Search millions of books from globally trusted libraries.'
    });
  } catch (err) {
    return next(err);
  }
});

app.get('/watch', csrfProtection, (req, res) => {
  // Render whatever videos.json you have (or empty state)
  let videos = [];
  try {
    videos = require('./data/videos.json');
  } catch (_) { /* optional */ }
  return res.render('watch', {
    buildId,
    csrfToken: req.csrfToken(),
    videos,
    pageTitle: 'Watch',
    pageDescription: 'Educational videos and talks.'
  });
});

app.get('/about', csrfProtection, (req, res) =>
  res.render('about', {
    buildId,
    csrfToken: req.csrfToken(),
    pageTitle: 'About',
    pageDescription: 'About BookLantern'
  })
);

app.get('/contact', csrfProtection, (req, res) =>
  res.render('contact', {
    buildId,
    csrfToken: req.csrfToken(),
    pageTitle: 'Contact',
    pageDescription: 'Contact BookLantern'
  })
);

// ---------------------------
// Auth pages (degrade gracefully if DB missing)
// ---------------------------
app.get('/login', csrfProtection, (req, res) => {
  res.render('login', {
    buildId,
    csrfToken: req.csrfToken(),
    messages: {},
    authDisabled: !dbReady, // view can show a notice
    pageTitle: 'Login'
  });
});

app.get('/register', csrfProtection, (req, res) => {
  res.render('register', {
    buildId,
    csrfToken: req.csrfToken(),
    messages: {},
    authDisabled: !dbReady,
    pageTitle: 'Register'
  });
});

// POST login/register only when DB is ready; otherwise 403 with friendly message
app.post('/login', csrfProtection, async (req, res) => {
  if (!dbReady) {
    return res.status(403).render('login', {
      buildId,
      csrfToken: req.csrfToken(),
      messages: { error: 'Login is temporarily unavailable. Set MONGODB_URI to enable auth.' },
      authDisabled: true
    });
  }
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: (email || '').trim().toLowerCase() });
    if (!user) {
      return res.status(400).render('login', {
        buildId, csrfToken: req.csrfToken(),
        messages: { error: 'Invalid email or password.' }
      });
    }
    const ok = await user.comparePassword(password || '');
    if (!ok) {
      return res.status(400).render('login', {
        buildId, csrfToken: req.csrfToken(),
        messages: { error: 'Invalid email or password.' }
      });
    }
    req.session.userId = user._id.toString();
    req.session.user = { id: user._id.toString(), email: user.email };
    return res.redirect('/');
  } catch (err) {
    return res.status(500).render('login', {
      buildId, csrfToken: req.csrfToken(),
      messages: { error: 'Something went wrong. Please try again.' }
    });
  }
});

app.post('/register', csrfProtection, async (req, res) => {
  if (!dbReady) {
    return res.status(403).render('register', {
      buildId,
      csrfToken: req.csrfToken(),
      messages: { error: 'Registration is temporarily unavailable. Set MONGODB_URI to enable auth.' },
      authDisabled: true
    });
  }
  try {
    const { name, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).render('register', {
        buildId, csrfToken: req.csrfToken(),
        messages: { error: 'Email and password are required.' }
      });
    }
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) {
      return res.status(400).render('register', {
        buildId, csrfToken: req.csrfToken(),
        messages: { error: 'An account with that email already exists.' }
      });
    }
    const user = new User({ name: name || '', email: email.toLowerCase(), password });
    await user.save();
    req.session.userId = user._id.toString();
    req.session.user = { id: user._id.toString(), email: user.email };
    return res.redirect('/');
  } catch (err) {
    return res.status(500).render('register', {
      buildId, csrfToken: req.csrfToken(),
      messages: { error: 'Something went wrong. Please try again.' }
    });
  }
});

app.post('/logout', csrfProtection, (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------------------------
// 404 / Error handlers
// ---------------------------
app.use((req, res) => {
  res.status(404).render('404', {
    buildId,
    pageTitle: 'Page not found',
    pageDescription: 'The page you were looking for does not exist.'
  });
});

app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('🔥 Unhandled error:', err);
  res.status(500).render('error', {
    buildId,
    message: 'Something went wrong',
    details: `${err.message || err}`
  });
});

// ---------------------------
// Listen
// ---------------------------
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`🚀 Server running on port ${PORT}`);
});
