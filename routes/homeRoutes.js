// routes/homeRoutes.js
const express = require('express');
const router  = express.Router();

// Optional local Book model (admin-curated)
let Book = null;
try { Book = require('../models/Book'); } catch (_) {}

// simple in-memory cache
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
    bust(){ this.value=null; this.expiresAt=0; }
  };
}

const featuredCache = makeCache(60 * 60 * 1000);
const shelvesCache  = makeCache(60 * 60 * 1000);

// normalize Book -> homepage card
function cardFromLocalBook(b) {
  return {
    identifier: String(b._id),
    title: b.title,
    creator: b.author || '',
    cover: b.coverImage || '',
    readerUrl: b.sourceUrl || '',
    source: 'local',
    description: b.description || '',
    archiveId: '' // set only when opening via IA viewer
  };
}

// known-good Gutenberg covers
function curatedFeatured() {
  const pgCover = (id) => `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;
  return [
    { identifier:'gutenberg:1342', title:'Pride and Prejudice', creator:'Jane Austen', cover:pgCover(1342), source:'gutenberg', readerUrl:'https://www.gutenberg.org/ebooks/1342' },
    { identifier:'gutenberg:1661', title:'The Adventures of Sherlock Holmes', creator:'Arthur Conan Doyle', cover:pgCover(1661), source:'gutenberg', readerUrl:'https://www.gutenberg.org/ebooks/1661' },
    { identifier:'gutenberg:84',   title:'Frankenstein', creator:'Mary Wollstonecraft Shelley', cover:pgCover(84), source:'gutenberg', readerUrl:'https://www.gutenberg.org/ebooks/84' },
    { identifier:'gutenberg:2701', title:'Moby-Dick; or, The Whale', creator:'Herman Melville', cover:pgCover(2701), source:'gutenberg', readerUrl:'https://www.gutenberg.org/ebooks/2701' },
    { identifier:'gutenberg:11',   title:"Alice's Adventures in Wonderland", creator:'Lewis Carroll', cover:pgCover(11), source:'gutenberg', readerUrl:'https://www.gutenberg.org/ebooks/11' },
    { identifier:'gutenberg:98',   title:'A Tale of Two Cities', creator:'Charles Dickens', cover:pgCover(98), source:'gutenberg', readerUrl:'https://www.gutenberg.org/ebooks/98' },
  ];
}

// curated shelves; avoid duplicating what's in “Trending now”
function curatedShelves() {
  const classics = curatedFeatured();

  // “Trending now” shows first 4 if there are no local books.
  const TRENDING_COUNT = 4;
  const trendingIds = new Set(classics.slice(0, TRENDING_COUNT).map(x => x.identifier));
  const timeless = classics.filter(x => !trendingIds.has(x.identifier)); // no duplicates with trending

  const qCard = (title, q, subject) => ({
    identifier: `search:${q}`,
    title,
    creator: 'Various',
    // Use guaranteed subjects so images exist
    cover: `https://covers.openlibrary.org/b/subject/${encodeURIComponent(subject)}-M.jpg`,
    source: 'openlibrary',
    readerUrl: `/read?query=${encodeURIComponent(q)}`
  });

  return [
    {
      title: 'Philosophy Corner',
      q: 'Philosophy',
      // Use a single guaranteed subject image “philosophy” for all four to avoid 404s
      items: [
        qCard('The Republic (Plato)', 'Plato Republic', 'philosophy'),
        qCard('Dialogues on Socrates', 'Socrates', 'philosophy'),
        qCard('Aristotle Essentials', 'Aristotle', 'philosophy'),
        qCard('Stoicism & Wisdom', 'Stoicism', 'philosophy'),
      ],
    },
    {
      title: 'Timeless Classics',
      q: 'Classics',
      items: timeless,
    },
    {
      title: 'Science Shelf',
      q: 'Science',
      items: [
        qCard('Physics Primers', 'Physics', 'science'),
        qCard('Biology Basics', 'Biology', 'biology'),
        qCard('Astronomy & Space', 'Astronomy', 'astronomy'),
        qCard('Mathematics Classics', 'Mathematics', 'mathematics'),
      ],
    },
  ];
}

/* =========================
 * ROUTES
 * =======================*/

router.get('/api/featured-books', async (req, res) => {
  try {
    const payload = await featuredCache.get(async () => {
      if (Book) {
        try {
          const local = await Book.find({}).sort({ createdAt: -1 }).limit(12).lean();
          if (local && local.length) return { items: local.map(cardFromLocalBook) };
        } catch (e) {
          console.error('featured: local Book fetch failed:', e.message);
        }
      }
      // fallback
      return { items: curatedFeatured().slice(0, 4) }; // show 4 in “Trending now”
    });
    res.set('Cache-Control', 'public, max-age=900');
    return res.json(payload);
  } catch (e) {
    console.error('featured endpoint error:', e);
    return res.status(500).json({ items: [] });
  }
});

router.get('/api/shelves', async (req, res) => {
  try {
    const payload = await shelvesCache.get(async () => ({ shelves: curatedShelves() }));
    res.set('Cache-Control', 'public, max-age=900');
    return res.json(payload);
  } catch (e) {
    console.error('shelves endpoint error:', e);
    return res.status(500).json({ shelves: [] });
  }
});

module.exports = router;
