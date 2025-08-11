// routes/index.js
const express = require('express');
const router = express.Router();

// If you have local, admin-curated books, we can feature those too:
let Book = null;
try {
  Book = require('../models/Book');
} catch (_) {
  // Optional model; ignore if not present
}

/**
 * In-memory cache helpers
 */
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
    bust() {
      this.value = null;
      this.expiresAt = 0;
    },
  };
}

const featuredCache = makeCache(60 * 60 * 1000); // 1 hour
const shelvesCache  = makeCache(60 * 60 * 1000); // 1 hour

/**
 * Normalizer for local Book docs -> homepage card
 */
function cardFromLocalBook(b) {
  return {
    identifier: String(b._id),
    title: b.title,
    creator: b.author || '',
    cover: b.coverImage || '',
    readerUrl: b.sourceUrl || '',
    source: 'local',
    description: b.description || '',
    archiveId: '', // only for items we can open inside /read/book/:id
  };
}

/**
 * Curated, known-good, ZERO-network “featured” items.
 * We intentionally prefer Gutenberg IDs here because they’re stable.
 * Covers use Gutenberg’s predictable pattern. Archive/Open Library show up on search.
 */
function curatedFeatured() {
  const pgCover = (id) =>
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;

  return [
    { // Pride and Prejudice
      identifier: 'gutenberg:1342',
      title: 'Pride and Prejudice',
      creator: 'Jane Austen',
      cover: pgCover(1342),
      source: 'gutenberg',
      readerUrl: 'https://www.gutenberg.org/ebooks/1342'
    },
    { // Sherlock Holmes
      identifier: 'gutenberg:1661',
      title: 'The Adventures of Sherlock Holmes',
      creator: 'Arthur Conan Doyle',
      cover: pgCover(1661),
      source: 'gutenberg',
      readerUrl: 'https://www.gutenberg.org/ebooks/1661'
    },
    { // Frankenstein
      identifier: 'gutenberg:84',
      title: 'Frankenstein',
      creator: 'Mary Wollstonecraft Shelley',
      cover: pgCover(84),
      source: 'gutenberg',
      readerUrl: 'https://www.gutenberg.org/ebooks/84'
    },
    { // Moby-Dick
      identifier: 'gutenberg:2701',
      title: 'Moby-Dick; or, The Whale',
      creator: 'Herman Melville',
      cover: pgCover(2701),
      source: 'gutenberg',
      readerUrl: 'https://www.gutenberg.org/ebooks/2701'
    },
    { // Alice
      identifier: 'gutenberg:11',
      title: "Alice's Adventures in Wonderland",
      creator: 'Lewis Carroll',
      cover: pgCover(11),
      source: 'gutenberg',
      readerUrl: 'https://www.gutenberg.org/ebooks/11'
    },
    { // Tale of Two Cities
      identifier: 'gutenberg:98',
      title: 'A Tale of Two Cities',
      creator: 'Charles Dickens',
      cover: pgCover(98),
      source: 'gutenberg',
      readerUrl: 'https://www.gutenberg.org/ebooks/98'
    },
    // A few “search cards” that link to /read with a query (good variety)
    {
      identifier: 'search:plato',
      title: 'The Republic (Plato)',
      creator: 'Plato',
      cover: 'https://covers.openlibrary.org/b/subject/plato-M.jpg',
      source: 'openlibrary',
      readerUrl: '/read?query=Plato%20Republic'
    },
    {
      identifier: 'search:socrates',
      title: 'Dialogues on Socrates',
      creator: 'Plato, Xenophon (various)',
      cover: 'https://covers.openlibrary.org/b/subject/philosophy-M.jpg',
      source: 'openlibrary',
      readerUrl: '/read?query=Socrates'
    },
    {
      identifier: 'search:bible',
      title: 'King James Bible (Public Domain)',
      creator: 'KJV (Public Domain)',
      cover: 'https://covers.openlibrary.org/b/subject/bible-M.jpg',
      source: 'openlibrary',
      readerUrl: '/read?query=King%20James%20Bible'
    },
    {
      identifier: 'search:science',
      title: 'Popular Science Classics',
      creator: 'Various',
      cover: 'https://covers.openlibrary.org/b/subject/science-M.jpg',
      source: 'openlibrary',
      readerUrl: '/read?query=Science'
    },
    {
      identifier: 'search:history',
      title: 'Great Works of History',
      creator: 'Various',
      cover: 'https://covers.openlibrary.org/b/subject/history-M.jpg',
      source: 'openlibrary',
      readerUrl: '/read?query=History'
    },
    {
      identifier: 'search:poetry',
      title: 'Poetry Anthologies',
      creator: 'Various',
      cover: 'https://covers.openlibrary.org/b/subject/poetry-M.jpg',
      source: 'openlibrary',
      readerUrl: '/read?query=Poetry'
    },
  ];
}

/**
 * Curated shelves — instant, cached, and theme-based.
 * Each item uses the same card shape as featured.
 */
function curatedShelves() {
  const F = curatedFeatured();

  // Helpers to clone a card with a different “title/cover/q”
  const quickQueryCard = (title, q, coverSubject) => ({
    identifier: `search:${q}`,
    title,
    creator: 'Various',
    cover: `https://covers.openlibrary.org/b/subject/${encodeURIComponent(coverSubject)}-M.jpg`,
    source: 'openlibrary',
    readerUrl: `/read?query=${encodeURIComponent(q)}`
  });

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
      items: F.filter(x => (x.source === 'gutenberg')).slice(0, 6),
    },
    {
      title: 'Science Shelf',
      q: 'Science',
      items: [
        quickQueryCard('Physics Primers', 'Physics', 'science'),
        quickQueryCard('Biology Basics', 'Biology', 'biology'),
        quickQueryCard('Astronomy & Space', 'Astronomy', 'astronomy'),
        quickQueryCard('Mathematics Classics', 'Mathematics', 'mathematics'),
      ],
    },
  ];
}

/* =========================
 * ROUTES
 * =======================*/

// Home: now renders with server-side Featured list for instant paint
router.get('/', async (req, res) => {
  try {
    const featuredSSR = await featuredCache.get(async () => {
      // Prefer local admin-curated books if present
      if (Book) {
        try {
          const localBooks = await Book.find({}).sort({ createdAt: -1 }).limit(12).lean();
          if (localBooks && localBooks.length) {
            return localBooks.map(cardFromLocalBook);
          }
        } catch (e) {
          console.error('home: local Book fetch failed:', e.message);
        }
      }
      // Fallback to static curated list (no network, instant)
      return curatedFeatured();
    });

    res.render('index', {
      pageTitle: 'Home',
      pageDescription: 'Discover free books and knowledge on BookLantern.',
      featuredSSR
    });
  } catch (e) {
    console.error('home error:', e);
    // Render without featuredSSR (client will hydrate from /api/featured-books)
    res.render('index', {
      pageTitle: 'Home',
      pageDescription: 'Discover free books and knowledge on BookLantern.'
    });
  }
});

router.get('/about', (req, res) => {
  res.render('about', {
    pageTitle: 'About',
    pageDescription: 'Learn more about BookLantern\'s mission to make books accessible.'
  });
});

router.get('/contact', (req, res) => {
  res.render('contact', {
    pageTitle: 'Contact',
    pageDescription: 'Get in touch with the BookLantern team.'
  });
});

/**
 * Fast, cached endpoint for the homepage Featured grid.
 * 1) Prefer your local admin-curated Book docs (if any exist)
 * 2) Else fall back to a static curated list of known-good public domain items
 */
router.get('/api/featured-books', async (req, res) => {
  try {
    const payload = await featuredCache.get(async () => {
      // Try local DB first (admin-curated)
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
      // Fallback to curated zero-network list
      return { items: curatedFeatured() };
    });

    res.set('Cache-Control', 'public, max-age=900'); // 15 minutes for browsers/CDN
    return res.json(payload);
  } catch (e) {
    console.error('featured endpoint error:', e);
    return res.status(500).json({ items: [] });
  }
});

/**
 * Curated shelves endpoint for the homepage.
 * Fully static + cached, instant response.
 */
router.get('/api/shelves', async (req, res) => {
  try {
    const payload = await shelvesCache.get(async () => {
      return { shelves: curatedShelves() };
    });
    res.set('Cache-Control', 'public, max-age=900');
    return res.json(payload);
  } catch (e) {
    console.error('shelves endpoint error:', e);
    return res.status(500).json({ shelves: [] });
  }
});

module.exports = router;
