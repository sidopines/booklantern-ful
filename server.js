/**
 * BookLantern — server.js (full, final)
 * Frontend-focused Express app with EJS views
 * - Safe locals for templates
 * - Build cache-busting
 * - Strong CSP for covers/fonts/scripts
 * - Open Library fetch with retry + 1h cache
 * - Optional local fallback for Homepage shelves
 * - Search route (/read)
 * - Watch route reading optional data/videos.json
 * - Login shim (prevents "Cannot POST /login")
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();

/* ---------------------------- Basic configuration --------------------------- */

const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const BUILD_ID = process.env.BUILD_ID || Date.now().toString(36);

/* --------------------------------- Middleware ------------------------------- */

app.disable('x-powered-by');
app.use(compression());

// Body parsing for forms / JSON (do NOT remove; login/register or admin forms may rely on this)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Views and static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '7d', etag: true }));

/* ------------------------------------ CSP ---------------------------------- */
/**
 * Allow:
 *  - Only self for HTML/JS by default
 *  - Google Fonts (styles + font files)
 *  - Open Library cover images
 *  - YouTube thumbnails (for watch page) and iframes
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": [
          "'self'",
          // allow EJS-inlined small scripts if any
          "'unsafe-inline'",
        ],
        "style-src": [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
        ],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": [
          "'self'",
          "data:",
          "blob:",
          "https://covers.openlibrary.org",
          "https://i.ytimg.com",
          "https://img.youtube.com",
          // add any other cover hosts if needed
        ],
        "media-src": ["'self'", "blob:"],
        "connect-src": [
          "'self'",
          "https://openlibrary.org",
        ],
        "frame-src": [
          "'self'",
          "https://www.youtube.com",
          "https://youtube.com",
          "https://youtu.be",
        ],
        "object-src": ["'none'"],
        "upgrade-insecure-requests": null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

/* ------------------------------- Safe locals -------------------------------- */

app.use((req, res, next) => {
  res.locals.buildId = BUILD_ID;

  // Safe auth indicator (don’t assume a session)
  // If your auth middleware sets req.user, this will show "Account" in navbar.
  res.locals.loggedIn = !!(req.user && (req.user.id || req.user._id));

  // Title/description defaults (overridable per render)
  res.locals.pageTitle = 'BookLantern';
  res.locals.pageDescription = 'Discover millions of free books from globally trusted libraries.';

  next();
});

/* --------------------------- Fetch helpers + cache -------------------------- */

const ONE_HOUR = 1000 * 60 * 60;
const cache = new Map(); // key -> { expires, data }

function setCache(key, data, ttlMs = ONE_HOUR) {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}
function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

async function retryFetchJson(url, opts = {}, retries = 2) {
  let err;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { timeout: 12000, ...opts });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      err = e;
      await new Promise((res) => setTimeout(res, 600 * (i + 1)));
    }
  }
  throw err;
}

/* ------------------------------- Normalizers -------------------------------- */

function olCover(cover_i) {
  return cover_i ? `https://covers.openlibrary.org/b/id/${cover_i}-L.jpg` : null;
}

function normalizeOL(doc) {
  const title = doc.title || 'Untitled';
  const author =
    (Array.isArray(doc.author_name) && doc.author_name[0]) ||
    doc.author_name ||
    'Unknown author';
  const cover =
    olCover(doc.cover_i) ||
    (doc.isbn && doc.isbn.length ? `https://covers.openlibrary.org/b/isbn/${doc.isbn[0]}-L.jpg` : null);
  // small snippet—first sentence or subject for the Listen preview
  const snippet =
    (Array.isArray(doc.first_sentence) && doc.first_sentence[0]) ||
    (doc.subtitle ? String(doc.subtitle) : '') ||
    (Array.isArray(doc.subject) && doc.subject[0]) ||
    '';
  const initials = title.slice(0, 2).toUpperCase();
  const readUrl = doc.key ? `https://openlibrary.org${doc.key}` : null;

  return { title, author, cover, readUrl, initials, snippet };
}

function shuffle(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* --------------------------- Local fallback catalog -------------------------- */

function readFallbackCatalog() {
  const fp = path.join(__dirname, 'data', 'fallbackCatalog.json');
  if (fs.existsSync(fp)) {
    try {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (raw && typeof raw === 'object') return raw;
    } catch (_) {}
  }
  return {
    trending: [
      { title: 'Alice’s Adventures in Wonderland', author: 'Lewis Carroll' },
      { title: 'The Picture of Dorian Gray', author: 'Oscar Wilde' },
      { title: 'A Christmas Carol', author: 'Charles Dickens' },
      { title: 'Emma', author: 'Jane Austen' },
      { title: 'Frankenstein', author: 'Mary Shelley' },
    ],
    philosophy: [
      { title: 'The Art of War', author: 'Sun Tzu' },
      { title: 'The Prince', author: 'Niccolò Machiavelli' },
      { title: 'Through the Looking-Glass', author: 'Lewis Carroll' },
      { title: 'Candide', author: 'Voltaire' },
      { title: 'Utopia', author: 'Thomas More' },
    ],
    history: [
      { title: 'Pride and Prejudice', author: 'Jane Austen' },
      { title: 'Bible', author: 'Various' },
      { title: 'The Histories', author: 'Herodotus' },
      { title: 'A History of England', author: 'Charles Dickens' },
      { title: 'A Christmas Carol', author: 'Charles Dickens' },
    ],
  };
}

/* ------------------------------ Shelves (Home) ------------------------------ */

async function getShelfFromOL(query, limit = 10) {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit}`;
  const j = await retryFetchJson(url);
  const docs = Array.isArray(j.docs) ? j.docs : [];
  return docs.map(normalizeOL);
}

async function buildHomeShelves() {
  // Try cache first
  const cached = getCache('homeShelves');
  if (cached) return cached;

  let trending = [];
  let philosophy = [];
  let history = [];

  try {
    // Use loose topical queries; shuffle to add variety every deploy/hour
    const [a, b, c] = await Promise.all([
      getShelfFromOL('classic literature OR public domain', 12),
      getShelfFromOL('philosophy OR ethics OR metaphysics', 12),
      getShelfFromOL('history OR biography', 12),
    ]);
    trending = shuffle(a).slice(0, 10);
    philosophy = shuffle(b).slice(0, 10);
    history = shuffle(c).slice(0, 10);
  } catch (e) {
    console.error('Open Library fetch failed, using fallback catalog:', e.message);
    const fallback = readFallbackCatalog();
    const project = (arr) =>
      arr.map((it) => ({
        title: it.title,
        author: it.author || 'Unknown author',
        cover: null,
        readUrl: null,
        initials: (it.title || 'BL').slice(0, 2).toUpperCase(),
        snippet: '',
      }));
    trending = project(fallback.trending || []);
    philosophy = project(fallback.philosophy || []);
    history = project(fallback.history || []);
  }

  const data = { trending, philosophy, history };
  setCache('homeShelves', data, ONE_HOUR);
  return data;
}

/* ---------------------------------- Routes --------------------------------- */

// Navbar brand + pages rely on these EJS files existing:
//   - views/index.ejs
//   - views/read.ejs
//   - views/watch.ejs
//   - views/about.ejs
//   - views/contact.ejs
//   - views/login.ejs
//   - views/register.ejs
// Partials are in views/partials/* (head, navbar, hero, bookCarousel, footer)

app.get('/', async (req, res, next) => {
  try {
    const { trending, philosophy, history } = await buildHomeShelves();
    return res.render('index', {
      pageTitle: 'BookLantern – Free Books from Global Libraries',
      trending,
      philosophy,
      history,
    });
  } catch (e) {
    next(e);
  }
});

app.get('/read', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      return res.render('read', {
        pageTitle: 'Explore Free Books',
        q: '',
        items: [],
      });
    }
    const key = `read:${q}`;
    const cached = getCache(key);
    if (cached) {
      return res.render('read', {
        pageTitle: `Search • ${q} • BookLantern`,
        q,
        items: cached,
      });
    }

    const j = await retryFetchJson(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=30`
    );
    const docs = Array.isArray(j.docs) ? j.docs : [];
    const items = docs.map(normalizeOL);
    setCache(key, items, ONE_HOUR / 2);
    return res.render('read', {
      pageTitle: `Search • ${q} • BookLantern`,
      q,
      items,
    });
  } catch (e) {
    next(e);
  }
});

/* ---------------------------- Watch (videos list) --------------------------- */
/**
 * We support a simple JSON file at data/videos.json:
 *   [{ "title": "...", "thumb": "...", "url": "https://youtu.be/..." }, ...]
 * If it’s missing, we render an empty state (your admin can repopulate separately).
 */
function loadVideosList() {
  const fp = path.join(__dirname, 'data', 'videos.json');
  if (fs.existsSync(fp)) {
    try {
      const arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (Array.isArray(arr)) return arr;
    } catch (e) {
      console.error('Invalid data/videos.json:', e.message);
    }
  }
  return [];
}

app.get('/watch', (req, res) => {
  const items = loadVideosList();
  res.render('watch', {
    pageTitle: 'Educational Videos • BookLantern',
    items,
  });
});

/* ----------------------------- Informational pages -------------------------- */

app.get('/about', (req, res) => {
  res.render('about', { pageTitle: 'About • BookLantern' });
});

app.get('/contact', (req, res) => {
  res.render('contact', { pageTitle: 'Contact • BookLantern' });
});

/* ----------------------------- Auth UI pages only --------------------------- */

app.get('/login', (req, res) => {
  res.render('login', {
    pageTitle: 'Login • BookLantern',
    messages: {}, // keep safe default
  });
});

app.get('/register', (req, res) => {
  res.render('register', {
    pageTitle: 'Register • BookLantern',
    messages: {},
  });
});

/* ------------------------------ Mount your auth ----------------------------- */
/**
 * If you already have real auth routes (sessions/JWT etc.), mount them here:
 *   const authRoutes = require('./routes/auth');
 *   app.use('/auth', authRoutes);
 *
 * Our login shim below only ensures POST /login doesn't 404 if your form points to it.
 */

/* ------------------------------- Login shim -------------------------------- */
try {
  const loginShim = require('./routes/loginShim');
  app.use(loginShim);
} catch (e) {
  // If file not present, it’s fine.
}

/* --------------------------------- Errors ---------------------------------- */

app.use((req, res) => {
  res.status(404);
  // Render your 404 page if you have one, else a simple message
  res.send('Not Found');
});

app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err);
  res.status(500);
  try {
    res.render('error', {
      pageTitle: 'Error • BookLantern',
      message: 'Something went wrong.',
    });
  } catch {
    res.send('Internal Server Error');
  }
});

/* --------------------------------- Launch ---------------------------------- */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
