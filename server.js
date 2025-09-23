/* server.js — BookLantern (minimal dependencies) */
const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;

/* ---------- View engine & static ---------- */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use('/public', express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  index: false
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ---------- Very lenient CSP for images (covers) ---------- */
app.use((req, res, next) => {
  // Allow images from anywhere + data: URIs
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src * data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src *; frame-ancestors 'self';"
  );
  next();
});

/* ---------- Res.locals defaults ---------- */
app.use((req, res, next) => {
  res.locals.buildId = process.env.BUILD_ID || Date.now().toString(36);
  res.locals.loggedIn = false; // if you wire auth later, set this via middleware
  next();
});

/* ---------- Helpers ---------- */
const OL = {
  subject: (name, limit = 24) =>
    `https://openlibrary.org/subjects/${encodeURIComponent(name)}.json?limit=${limit}`,
  coverById: (coverId) =>
    coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : ''
};

function normalizeBooks(docs = []) {
  return docs.map(d => {
    const title = d.title || d.title_suggest || 'Untitled';
    const author =
      (Array.isArray(d.authors) && d.authors[0]?.name) ||
      (Array.isArray(d.author_name) && d.author_name[0]) ||
      d.author || 'Unknown';
    const cover =
      (d.cover && (d.cover.large || d.cover.medium || d.cover.small)) ||
      (d.cover_i && OL.coverById(d.cover_i)) ||
      (d.edition_key && OL.coverById(d.edition_key[0])) ||
      d.coverUrl || '';
    const url =
      (d.key && `https://openlibrary.org${d.key}`) ||
      d.url || d.href || '';
    return {
      title,
      author,
      cover: cover ? String(cover).replace(/^http:/, 'https:') : '',
      href: url
    };
  });
}

function fallbackBooks() {
  // Simple static fallback to avoid empty homepage if OL is down
  return [
    { title: 'Pride and Prejudice', author: 'Jane Austen', cover: 'https://covers.openlibrary.org/b/id/8225636-M.jpg', href: 'https://openlibrary.org/works/OL14964254W' },
    { title: 'Moby-Dick', author: 'Herman Melville', cover: 'https://covers.openlibrary.org/b/id/7222246-M.jpg', href: 'https://openlibrary.org/works/OL45883W' },
    { title: 'Meditations', author: 'Marcus Aurelius', cover: 'https://covers.openlibrary.org/b/id/11153253-M.jpg', href: 'https://openlibrary.org/works/OL82563W' },
    { title: 'The Republic', author: 'Plato', cover: 'https://covers.openlibrary.org/b/id/240726-M.jpg', href: 'https://openlibrary.org/works/OL37210W' }
  ];
}

async function fetchJson(url, { timeoutMs = 4000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- In-memory cache for homepage ---------- */
const cache = {
  shelves: null,
  ts: 0,
  maxAgeMs: 60 * 60 * 1000 // 1 hour
};

async function getShelves() {
  const now = Date.now();
  if (cache.shelves && now - cache.ts < cache.maxAgeMs) return cache.shelves;

  try {
    const [trRaw, phRaw, hiRaw] = await Promise.all([
      fetchJson(OL.subject('trending', 24)).catch(() => null),
      fetchJson(OL.subject('philosophy', 24)).catch(() => null),
      fetchJson(OL.subject('history', 24)).catch(() => null)
    ]);

    const trending = normalizeBooks(trRaw?.works || trRaw?.docs || []);
    const philosophy = normalizeBooks(phRaw?.works || phRaw?.docs || []);
    const history = normalizeBooks(hiRaw?.works || hiRaw?.docs || []);

    const shelves = {
      trending: trending.length ? trending : fallbackBooks(),
      philosophy: philosophy.length ? philosophy : fallbackBooks(),
      history: history.length ? history : fallbackBooks()
    };

    cache.shelves = shelves;
    cache.ts = now;
    return shelves;
  } catch {
    const fb = fallbackBooks();
    const shelves = { trending: fb, philosophy: fb, history: fb };
    cache.shelves = shelves;
    cache.ts = now;
    return shelves;
  }
}

/* ---------- Routes ---------- */

// Home
app.get('/', async (req, res, next) => {
  try {
    const shelves = await getShelves();
    res.render('index', {
      trending: shelves.trending,
      philosophy: shelves.philosophy,
      history: shelves.history
    });
  } catch (err) {
    next(err);
  }
});

// Read (search)
app.get('/read', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim();
    let results = [];
    if (q) {
      const url = `https://openlibrary.org/search.json?limit=24&q=${encodeURIComponent(q)}`;
      const data = await fetchJson(url).catch(() => null);
      results = normalizeBooks(data?.docs || []);
    }
    res.render('read', { q, results });
  } catch (err) {
    next(err);
  }
});

// Watch (optional JSON source)
app.get('/watch', (req, res) => {
  const file = path.join(__dirname, 'data', 'videos.json');
  let videos = [];
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(raw)) videos = raw;
      else if (raw && Array.isArray(raw.videos)) videos = raw.videos;
    } catch {
      videos = [];
    }
  }
  res.render('watch', { videos });
});

// About / Contact
app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));
app.post('/contact', (req, res) => {
  // You can send an email, store DB, etc. For now show a success banner.
  res.render('contact', { messages: { success: 'Thanks! We received your message.' } });
});

// Auth bridges to avoid "Cannot POST /login"
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.post('/login', (req, res) => {
  // Bridge to your existing auth or show a friendly message
  // Example: res.redirect(307, '/auth/login');
  res.render('login', { messages: { error: 'Auth not wired yet. Please use Admin tool or connect auth.' } });
});
app.post('/register', (req, res) => {
  // Example: res.redirect(307, '/auth/register');
  res.render('register', { messages: { error: 'Registration not wired yet. Please use Admin tool or connect auth.' } });
});

// Health
app.get('/health', (req, res) => res.type('text').send('OK'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { message: 'Page not found.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('🔥 Error:', err);
  res.status(500).render('error', { message: err.message || 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
