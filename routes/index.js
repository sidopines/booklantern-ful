// routes/index.js
const express = require('express');
const router = express.Router();
const fetch = global.fetch || ((...args) => import('node-fetch').then(m => m.default(...args)));

// --- helpers ---------------------------------------------------------------
const buildId = Date.now(); // cache-buster for /public assets

function referrerFrom(req) {
  // sanitize to same-origin path only
  const r = req.get('referer') || '';
  try {
    const u = new URL(r);
    return u.origin === `${req.protocol}://${req.get('host')}` ? u.pathname + u.search : '/';
  } catch {
    return '/';
  }
}

function pageOpts(req, extra = {}) {
  return {
    buildId,
    user: req.user || null,
    canonicalUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
    referrer: referrerFrom(req),
    ...extra
  };
}

// Minimal “book card” objects: {title, author, cover, href}
const SAMPLE_BOOKS = {
  trending: [
    {
      title: "Alice's Adventures in Wonderland",
      author: "Lewis Carroll",
      cover: "https://covers.openlibrary.org/b/OLID/OL7353617M-M.jpg",
      href: "/read?provider=openlibrary&id=OL7353617M"
    },
    {
      title: "The Picture of Dorian Gray",
      author: "Oscar Wilde",
      cover: "https://covers.openlibrary.org/b/OLID/OL26331930M-M.jpg",
      href: "/read?provider=openlibrary&id=OL26331930M"
    },
    {
      title: "A Tale of Two Cities",
      author: "Charles Dickens",
      cover: "https://covers.openlibrary.org/b/OLID/OL24374622M-M.jpg",
      href: "/read?provider=openlibrary&id=OL24374622M"
    }
  ],
  philosophy: [
    {
      title: "Meditations",
      author: "Marcus Aurelius",
      cover: "https://covers.openlibrary.org/b/OLID/OL24379826M-M.jpg",
      href: "/read?provider=openlibrary&id=OL24379826M"
    },
    {
      title: "Thus Spoke Zarathustra",
      author: "Friedrich Nietzsche",
      cover: "https://covers.openlibrary.org/b/OLID/OL24162224M-M.jpg",
      href: "/read?provider=openlibrary&id=OL24162224M"
    }
  ],
  history: [
    {
      title: "The Art of War",
      author: "Sun Tzu",
      cover: "https://covers.openlibrary.org/b/OLID/OL25430719M-M.jpg",
      href: "/read?provider=openlibrary&id=OL25430719M"
    },
    {
      title: "Gulliver’s Travels",
      author: "Jonathan Swift",
      cover: "https://covers.openlibrary.org/b/OLID/OL25435636M-M.jpg",
      href: "/read?provider=openlibrary&id=OL25435636M"
    }
  ]
};

// --- page routes -----------------------------------------------------------
router.get('/', (req, res) => {
  res.render('index', pageOpts(req, {
    trending: SAMPLE_BOOKS.trending,
    philosophy: SAMPLE_BOOKS.philosophy,
    history: SAMPLE_BOOKS.history
  }));
});

router.get('/about', (req, res) => {
  res.render('about', pageOpts(req));
});

router.get('/contact', (req, res) => {
  res.render('contact', pageOpts(req));
});

router.get('/watch', (req, res) => {
  // You can populate from DB later
  res.status(200).render('watch', pageOpts(req, { videos: [] }));
});

router.get('/login', (req, res) => {
  res.render('login', pageOpts(req, { csrfToken: '', next: req.query.next || '/' }));
});

router.get('/register', (req, res) => {
  res.render('register', pageOpts(req, { csrfToken: '', next: req.query.next || '/' }));
});

// --- read route ------------------------------------------------------------
// Supports /read?provider=openlibrary&id=OLxxxx
// If missing, we show a friendly message instead of throwing 500.
router.get('/read', (req, res) => {
  const provider = (req.query.provider || '').trim();
  const id = (req.query.id || '').trim();

  if (!provider || !id) {
    return res.status(200).render('read-missing', pageOpts(req));
  }
  return res.render('read', pageOpts(req, { provider, id }));
});

// --- very small API for the reader ----------------------------------------
// Returns either EPUB url for openlibrary or simple HTML demo.
router.get('/api/book', async (req, res) => {
  const provider = (req.query.provider || '').trim();
  const id = (req.query.id || '').trim();

  try {
    if (provider === 'openlibrary' && id) {
      // Try to serve an EPUB url when available. If not, send basic HTML.
      // (Open Library doesn’t guarantee a direct epub link per OLID; this is a demo fallback.)
      return res.json({
        type: 'html',
        title: 'Sample Preview',
        author: 'Open Library',
        content: `<h2>Sample Preview</h2>
          <p>This is a preview page for <code>${id}</code>. Integrate your real resolver here
          (for example, fetch EPUB or HTML from your provider and pass its URL or contents).</p>`
      });
    }

    // default demo
    return res.json({
      type: 'text',
      title: 'BookLantern Demo',
      author: '',
      content:
        'Hello from BookLantern.\n\nProvide ?provider=openlibrary&id=OL7353617M to render a specific item.'
    });
  } catch (e) {
    console.error('api/book error', e);
    return res.status(500).json({ type: 'error', error: 'Failed to load book.' });
  }
});

module.exports = router;
