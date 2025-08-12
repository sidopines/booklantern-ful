// routes/homeRoutes.js
const express = require('express');
const router = express.Router();

// Optional models (app runs even if some are missing)
let Book = null;
try { Book = require('../models/Book'); } catch (_) {}

/** Simple TTL cache */
function makeCache(ttlMs = 60 * 60 * 1000) {
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
    bust() { this.value = null; this.expiresAt = 0; }
  };
}
const featuredCache = makeCache(60 * 60 * 1000);
const shelvesCache  = makeCache(60 * 60 * 1000);

/** Normalize a local Book doc into a homepage card */
function cardFromLocalBook(b) {
  return {
    identifier: String(b._id),
    title: b.title,
    creator: b.author || '',
    cover: b.coverImage || '',
    readerUrl: b.sourceUrl || '',
    source: 'local',
    description: b.description || '',
    archiveId: ''
  };
}

/** Curated, zero-network “featured” items */
function curatedFeatured() {
  const pgCover = (id) => `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;
  return [
    { identifier: 'gutenberg:1342', title: 'Pride and Prejudice', creator: 'Jane Austen', cover: pgCover(1342), source: 'gutenberg', readerUrl: 'https://www.gutenberg.org/ebooks/1342' },
    { identifier: 'gutenberg:1661', title: 'The Adventures of Sherlock Holmes', creator: 'Arthur Conan Doyle', cover: pgCover(1661), source: 'gutenberg', readerUrl: 'https://www.gutenberg.org/ebooks/1661' },
    { identifier: 'gutenberg:84',   title: 'Frankenstein', creator: 'Mary Wollstonecraft Shelley', cover: pgCover(84), source: 'gutenberg', readerUrl: 'https://www.gutenberg.org/ebooks/84' },
    { identifier: 'gutenberg:2701', title: 'Moby-Dick; or, The Whale', creator: 'Herman Melville', cover: pgCover(2701), source: 'gutenberg', readerUrl: 'https://www.gutenberg.org/ebooks/2701' },
    { identifier: 'gutenberg:11',   title: "Alice's Adventures in Wonderland", creator: 'Lewis Carroll', cover: pgCover(11), source: 'gutenberg', readerUrl: 'https://www.gutenberg.org/ebooks/11' },
    { identifier: 'gutenberg:98',   title: 'A Tale of Two Cities', creator: 'Charles Dickens', cover: pgCover(98), source: 'gutenberg', readerUrl: 'https://www.gutenberg.org/ebooks/98' },
    // Search cards
    { identifier: 'search:plato',   title: 'The Republic (Plato)', creator: 'Plato',    cover: 'https://covers.openlibrary.org/b/subject/plato-M.jpg',    source: 'openlibrary', readerUrl: '/read?query=Plato%20Republic' },
    { identifier: 'search:socrates',title: 'Dialogues on Socrates', creator: 'Various', cover: 'https://covers.openlibrary.org/b/subject/philosophy-M.jpg',source: 'openlibrary', readerUrl: '/read?query=Socrates' },
    { identifier: 'search:bible',   title: 'King James Bible (Public Domain)', creator: 'KJV (Public Domain)', cover: 'https://covers.openlibrary.org/b/subject/bible-M.jpg', source: 'openlibrary', readerUrl: '/read?query=King%20James%20Bible' },
    { identifier: 'search:science', title: 'Popular Science Classics', creator: 'Various', cover: 'https://covers.openlibrary.org/b/subject/science-M.jpg', source: 'openlibrary', readerUrl: '/read?query=Science' },
    { identifier: 'search:history', title: 'Great Works of History', creator: 'Various', cover: 'https://covers.openlibrary.org/b/subject/history-M.jpg', source: 'openlibrary', readerUrl: '/read?query=History' },
    { identifier: 'search:poetry',  title: 'Poetry Anthologies', creator: 'Various', cover: 'https://covers.openlibrary.org/b/subject/poetry-M.jpg', source: 'openlibrary', readerUrl: '/read?query=Poetry' },
  ];
}

/** Static themed shelves (we’ll prepend a dynamic “Trending now” if any local books exist) */
function curatedShelves() {
  const quickQueryCard = (title, q, subject) => ({
    identifier: `search:${q}`,
    title,
    creator: 'Various',
    cover: `https://covers.openlibrary.org/b/subject/${encodeURIComponent(subject)}-M.jpg`,
    source: 'openlibrary',
    readerUrl: `/read?query=${encodeURIComponent(q)}`
  });

  const F = curatedFeatured();
  return [
    {
      title: 'Philosophy Corner',
      q: 'Philosophy',
      items: [
        quickQueryCard('The Republic (Plato)', 'Plato Republic', 'philosophy'),
        quickQueryCard('Dialogues on Socrates', 'Socrates', 'plato'),
        quickQueryCard('Aristotle Essentials', 'Aristotle', 'philosophy'),
        quickQueryCard('Stoicism & Wisdom', 'Stoicism', 'ethics'),
      ],
    },
    {
      title: 'Timeless Classics',
      q: 'Classics',
      items: F.filter(x => x.source === 'gutenberg').slice(0, 6),
    },
    {
      title: 'Science Shelf',
      q: 'Science',
      items: [
        quickQueryCard('Physics Primers', 'Physics', 'science'),
        quickQueryCard('Biology Basics',  'Biology', 'biology'),
        quickQueryCard('Astronomy & Space','Astronomy','astronomy'),
        quickQueryCard('Mathematics Classics','Mathematics','mathematics'),
      ],
    },
  ];
}

/* =========================
 * Routes
 * =======================*/

// Homepage (server-rendered)
router.get('/', (req, res) => {
  res.render('index', {
    pageTitle: 'Home',
    pageDescription: 'Discover free books and knowledge on BookLantern.'
  });
});

// Lightweight featured endpoint (cached). Prefer local admin books if present.
router.get('/api/featured-books', async (req, res) => {
  try {
    const payload = await featuredCache.get(async () => {
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
      return { items: curatedFeatured() };
    });
    res.set('Cache-Control', 'public, max-age=900');
    res.json(payload);
  } catch (e) {
    console.error('featured endpoint error:', e);
    res.status(500).json({ items: [] });
  }
});

// Curated shelves (cached) + prepend “Trending now” from newest local books if available.
router.get('/api/shelves', async (req, res) => {
  try {
    const payload = await shelvesCache.get(async () => {
      let shelves = curatedShelves();
      if (Book) {
        try {
          const latest = await Book.find({}).sort({ createdAt: -1 }).limit(12).lean();
          if (latest && latest.length) {
            shelves = [
              { title: 'Trending now', q: 'latest', items: latest.map(cardFromLocalBook) },
              ...shelves
            ];
          }
        } catch (e) {
          console.error('shelves: local Book fetch failed:', e.message);
        }
      }
      return { shelves };
    });
    res.set('Cache-Control', 'public, max-age=900');
    res.json(payload);
  } catch (e) {
    console.error('shelves endpoint error:', e);
    res.status(500).json({ shelves: [] });
  }
});

/** Export router + a tiny hook admin can call to bust homepage caches */
router.bustHomeCaches = function bustHomeCaches() {
  featuredCache.bust();
  shelvesCache.bust();
};

module.exports = router;
