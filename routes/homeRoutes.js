// routes/homeRoutes.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

// Optional local Book model for admin-curated items
let Book = null;
try { Book = require('../models/Book'); } catch (_) {}

// ─────────────────────────────────────────────────────────────
// HTTP client
// ─────────────────────────────────────────────────────────────
const http = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'BookLantern/1.0 (+booklantern.org)',
    Accept: 'application/json,text/plain,*/*',
  },
});

// ─────────────────────────────────────────────────────────────
// Small cache helper
// ─────────────────────────────────────────────────────────────
function makeCache(ttlMs = 30 * 60 * 1000) {
  return {
    value: null,
    expiresAt: 0,
    async get(builder) {
      const now = Date.now();
      if (this.value && now < this.expiresAt) return this.value;
      this.value = await builder();
      this.expiresAt = now + ttlMs;
      return this.value;
    },
    bust() { this.value = null; this.expiresAt = 0; },
  };
}

const featuredCache = makeCache(60 * 60 * 1000); // 1h
const shelvesCache  = makeCache(30 * 60 * 1000); // 30m dynamic shelves

// ─────────────────────────────────────────────────────────────
// Card helpers (normalized shape for homepage)
// ─────────────────────────────────────────────────────────────
function card({ identifier='', title='', creator='', cover='', readerUrl='', source='', description='', archiveId='' }) {
  return { identifier, title, creator, cover, readerUrl, source, description, archiveId };
}

function cardFromLocalBook(b) {
  return card({
    identifier: String(b._id),
    title: b.title,
    creator: b.author || '',
    cover: b.coverImage || '',
    readerUrl: b.sourceUrl || '',
    source: 'local',
    description: b.description || '',
    archiveId: '',
  });
}

function pgCover(gid) {
  // Very reliable for many classics
  return `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.cover.medium.jpg`;
}

function cardFromGutendex(b) {
  const authors = (b.authors || []).map(a => a.name).join(', ');
  const cover =
    b.formats?.['image/jpeg'] ||
    b.formats?.['image/jpg']  ||
    '';
  // We’ll open everything inside our Gutenberg reader
  const gid = b.id;
  const html = b.formats?.['text/html; charset=utf-8'] || b.formats?.['text/html'] || '';
  return card({
    identifier: `gutenberg:${gid}`,
    title: b.title || `Gutenberg #${gid}`,
    creator: authors,
    cover,
    readerUrl: html || `https://www.gutenberg.org/ebooks/${gid}`,
    source: 'gutenberg',
  });
}

// ─────────────────────────────────────────────────────────────
// Data sources for shelves
// ─────────────────────────────────────────────────────────────
async function gutendexSearch(q, take = 10) {
  // Pull a little extra, then filter to items that have a cover
  const url = `https://gutendex.com/books?search=${encodeURIComponent(q)}&page_size=${Math.max(
    take * 2,
    20
  )}`;
  try {
    const { data } = await http.get(url);
    const results = Array.isArray(data?.results) ? data.results : [];
    const withCovers = results.filter(r => !!(r.formats && (r.formats['image/jpeg'] || r.formats['image/jpg'])));
    // light shuffle
    for (let i = withCovers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [withCovers[i], withCovers[j]] = [withCovers[j], withCovers[i]];
    }
    return withCovers.slice(0, take).map(cardFromGutendex);
  } catch (e) {
    console.error('gutendexSearch error:', e.message);
    return [];
  }
}

function timelessClassics() {
  // Hand-picked classics with stable Gutenberg covers
  const ids = [1342, 1661, 84, 2701, 11, 98, 2542, 46]; // Austen, Holmes, Frankenstein, Moby, Alice, Two Cities, Aesop, Dickens
  return ids.map(id =>
    card({
      identifier: `gutenberg:${id}`,
      title: [
        [1342, 'Pride and Prejudice'],
        [1661, 'The Adventures of Sherlock Holmes'],
        [84, 'Frankenstein'],
        [2701, 'Moby-Dick; or, The Whale'],
        [11, "Alice's Adventures in Wonderland"],
        [98, 'A Tale of Two Cities'],
        [2542, 'Aesop’s Fables'],
        [46, 'A Christmas Carol'],
      ].find(([gid]) => gid === id)?.[1] || `Gutenberg #${id}`,
      creator: [
        [1342, 'Jane Austen'],
        [1661, 'Arthur Conan Doyle'],
        [84, 'Mary Wollstonecraft Shelley'],
        [2701, 'Herman Melville'],
        [11, 'Lewis Carroll'],
        [98, 'Charles Dickens'],
        [2542, 'Aesop'],
        [46, 'Charles Dickens'],
      ].find(([gid]) => gid === id)?.[1] || '',
      cover: pgCover(id),
      readerUrl: `https://www.gutenberg.org/ebooks/${id}`,
      source: 'gutenberg',
    })
  );
}

// ─────────────────────────────────────────────────────────────
// Featured endpoint  (used by “Trending now” on homepage)
// ─────────────────────────────────────────────────────────────
router.get('/api/featured-books', async (req, res) => {
  try {
    const payload = await featuredCache.get(async () => {
      // Prefer local admin-curated books if you have any
      if (Book) {
        try {
          const localBooks = await Book.find({}).sort({ createdAt: -1 }).limit(12).lean();
          if (localBooks && localBooks.length) {
            return { items: localBooks.map(cardFromLocalBook) };
          }
        } catch (e) {
          console.error('featured: local Book fetch failed:', e.message);
        }
      }
      // Fall back to a few well-known Gutenberg picks (covers are reliable)
      return {
        items: timelessClassics().slice(0, 6),
      };
    });

    res.set('Cache-Control', 'public, max-age=900'); // 15 minutes to browsers/CDN
    return res.json(payload);
  } catch (e) {
    console.error('featured endpoint error:', e);
    return res.status(500).json({ items: [] });
  }
});

// ─────────────────────────────────────────────────────────────
// Shelves endpoint  (dynamic Philosophy & Science, curated Classics)
// ─────────────────────────────────────────────────────────────
router.get('/api/shelves', async (req, res) => {
  try {
    const payload = await shelvesCache.get(async () => {
      // Pull dynamic titles with real cover JPGs
      const [philo, science] = await Promise.all([
        gutendexSearch('philosophy OR Plato OR Aristotle OR Stoicism', 8),
        gutendexSearch('science OR physics OR biology OR astronomy', 8),
      ]);

      // If API ever returns empty, keep the page pretty
      const fallbackIfEmpty = (arr, alt) => (arr && arr.length ? arr : alt);

      const shelves = [
        {
          title: 'Philosophy Corner',
          q: 'Philosophy',
          items: fallbackIfEmpty(philo, timelessClassics().slice(0, 6)),
        },
        {
          title: 'Timeless Classics',
          q: 'Classics',
          items: timelessClassics().slice(0, 8),
        },
        {
          title: 'Science Shelf',
          q: 'Science',
          items: fallbackIfEmpty(science, timelessClassics().slice(2, 8)),
        },
      ];

      return { shelves };
    });

    res.set('Cache-Control', 'public, max-age=900'); // 15 minutes
    return res.json(payload);
  } catch (e) {
    console.error('shelves endpoint error:', e);
    return res.status(500).json({ shelves: [] });
  }
});

module.exports = router;
