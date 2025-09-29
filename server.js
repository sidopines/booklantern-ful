// server.js — BookLantern (final)
// Bulletproof defaults, one theme toggle, stable routes

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 10000;

// --- Security & perf
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false // keep simple for now (CDN-free build)
}));
app.use(compression());
app.use(morgan('tiny'));

// --- Views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Static
app.use('/public', express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  immutable: true
}));
app.use(express.urlencoded({ extended: true }));

// --- Locals (safe defaults)
app.use((req, res, next) => {
  res.locals.buildId = Date.now();
  res.locals.pageTitle = 'BookLantern';
  res.locals.pageDescription = 'Millions of free books from globally trusted libraries. One clean reader.';
  res.locals.url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  res.locals.referrer = req.get('referer') || '/';
  next();
});

// -----------------------------------------
// Faux data (until your DB/aggregator plugs back in)
const demoCovers = [
  'https://www.gutenberg.org/cache/epub/58596/pg58596.cover.medium.jpg',
  'https://www.gutenberg.org/cache/epub/66638/pg66638.cover.medium.jpg',
  'https://www.gutenberg.org/cache/epub/42884/pg42884.cover.medium.jpg',
  'https://www.gutenberg.org/cache/epub/10471/pg10471.cover.medium.jpg',
  'https://www.gutenberg.org/cache/epub/6593/pg6593.cover.medium.jpg',
  'https://www.gutenberg.org/cache/epub/26659/pg26659.cover.medium.jpg'
];

function fakeBooks(n, prefix) {
  return Array.from({ length: n }).map((_, i) => ({
    id: String(1000 + i),
    provider: 'pg',
    title: `${prefix} ${i + 1}`,
    author: i % 2 ? 'Various' : 'Unknown',
    cover: demoCovers[i % demoCovers.length]
  }));
}

// -----------------------------------------
// Routes (pages)
app.get('/', (req, res) => {
  res.render('index', {
    pageTitle: 'Largest Online Hub of Free Books',
    pageDescription: 'Millions of books from globally trusted libraries. One search, one clean reader.',
    trending: fakeBooks(10, 'Trending Title'),
    philosophy: fakeBooks(10, 'Philosophy Pick'),
    history: fakeBooks(10, 'History Pick')
  });
});

app.get('/read', (req, res) => {
  // landing fallback if no :provider/:id
  res.status(404).render('404', { pageTitle: 'Not Found – BookLantern' });
});

app.get('/read/:provider/:id', (req, res) => {
  const { provider, id } = req.params;
  res.render('read', {
    pageTitle: 'Read – BookLantern',
    provider,
    id
  });
});

app.get('/watch', (req, res) => {
  res.render('watch', {
    pageTitle: 'Watch – BookLantern',
    pageDescription: 'Curated talks & documentaries for readers.',
    videos: [
      { title: 'Public Domain 101', url: 'https://example.com', thumb: 'https://picsum.photos/seed/pd101/480/270' },
      { title: 'How to speed read', url: 'https://example.com', thumb: 'https://picsum.photos/seed/sr/480/270' }
    ]
  });
});

app.get('/about', (req, res) => {
  res.render('about', {
    pageTitle: 'About • BookLantern',
    pageDescription: 'Connecting readers with the world’s largest collection of free books.'
  });
});

app.get('/contact', (req, res) => {
  res.render('contact', {
    pageTitle: 'Contact • BookLantern',
    pageDescription: 'Contact BookLantern — we’d love to hear from you.',
    csrfToken: 'csrf-demo'
  });
});

app.post('/contact', (req, res) => {
  // Pretend success (wire real email later)
  res.render('contact', {
    pageTitle: 'Contact • BookLantern',
    pageDescription: 'Contact BookLantern — we’d love to hear from you.',
    csrfToken: 'csrf-demo',
    messages: { success: 'Thanks! We received your message and will reply soon.' }
  });
});

app.get('/login', (req, res) => {
  res.render('login', {
    pageTitle: 'Login – BookLantern',
    csrfToken: 'csrf-demo',
    next: '/'
  });
});

app.post('/login', (req, res) => {
  // Stub: redirect home
  res.redirect('/');
});

app.get('/register', (req, res) => {
  res.render('register', {
    pageTitle: 'Create Account – BookLantern',
    csrfToken: 'csrf-demo',
    next: '/'
  });
});

app.post('/register', (req, res) => {
  // Stub: redirect home
  res.redirect('/');
});

// -----------------------------------------
// API & proxy

// Minimal /api/book that returns HTML fallback with the Gutenberg text page
app.get('/api/book', async (req, res) => {
  const { provider, id } = req.query;
  if (!provider || !id) {
    return res.json({ type: 'text', content: 'Missing provider or id.' });
  }

  try {
    if (provider === 'pg') {
      // Simple HTML page fallback (not EPUB) so the /read page always works
      const url = `https://www.gutenberg.org/files/${id}/${id}-h/${id}-h.htm`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Failed ${r.status}`);
      const html = await r.text();
      return res.json({ type: 'html', content: html, title: `PG #${id}`, author: 'Unknown' });
    }
    // You can add more providers here (OL/IA/etc.) later:
    return res.json({ type: 'text', content: `Provider ${provider} not implemented yet.` });
  } catch (e) {
    return res.json({ type: 'text', content: 'Book not available.' });
  }
});

// Simple image/file proxy (covers). Use cautiously.
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');
  try {
    const r = await fetch(url, { timeout: 10000 });
    if (!r.ok) return res.status(r.status).end();
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    r.body.pipe(res);
  } catch (e) {
    res.status(500).end();
  }
});

// Service worker & manifest are static
app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.get('/site.webmanifest', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'site.webmanifest'));
});

// -----------------------------------------
// Errors
app.use((req, res) => {
  res.status(404).render('404', { pageTitle: 'Page Not Found – BookLantern' });
});
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err);
  res.status(500).render('error', { pageTitle: 'Error – BookLantern' });
});

// -----------------------------------------
app.listen(PORT, () => {
  console.log(`BookLantern listening on :${PORT}`);
});
