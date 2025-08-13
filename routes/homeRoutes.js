// routes/homeRoutes.js
const express = require('express');
const axios   = require('axios');
const router  = express.Router();

// ────────────────────────────────────────────────────────────
// Optional local Book model (admin-curated)
// ────────────────────────────────────────────────────────────
let Book = null;
try {
  Book = require('../models/Book');
} catch (_) {
  // ok if missing
}

// ────────────────────────────────────────────────────────────
// HTTP client
// ────────────────────────────────────────────────────────────
const http = axios.create({
  timeout: 12000,
  headers: {
    'User-Agent': 'BookLantern/1.0 (+booklantern.org)',
    'Accept': 'application/json,text/plain,*/*'
  }
});

// ────────────────────────────────────────────────────────────
// Tiny in-memory cache
// ────────────────────────────────────────────────────────────
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
const featuredCache = makeCache(60 * 60 * 1000); // 1h
const shelvesCache  = makeCache(30 * 60 * 1000); // 30m

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function card({ identifier, title, creator, cover, readerUrl, source = 'openlibrary', archiveId = '' }) {
  return { identifier, title, creator, cover, readerUrl, source, archiveId };
}
function uniqBy(arr, keyFn) {
  const seen = new Set(); const out = [];
  for (const it of arr) {
    const k = keyFn(it); if (seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
}

// Local Book → homepage card (Trending now)
function cardFromLocalBook(b) {
  return card({
    identifier: String(b._id),
    title: b.title,
    creator: b.author || '',
    cover: b.coverImage || '',
    readerUrl: b.sourceUrl || '#',
    source: 'local'
  });
}

// Fixed classics set (used only for “Timeless Classics”)
function curatedFeatured() {
  const pgCover = id => `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;
  const base = [
    { id:'1342', title:'Pride and Prejudice', creator:'Jane Austen' },
    { id:'1661', title:'The Adventures of Sherlock Holmes', creator:'Arthur Conan Doyle' },
    { id:'84',   title:'Frankenstein', creator:'Mary Wollstonecraft Shelley' },
    { id:'2701', title:'Moby-Dick; or, The Whale', creator:'Herman Melville' },
    { id:'11',   title:"Alice's Adventures in Wonderland", creator:'Lewis Carroll' },
    { id:'98',   title:'A Tale of Two Cities', creator:'Charles Dickens' },
  ];
  return base.map(b => card({
    identifier: `gutenberg:${b.id}`,
    title: b.title,
    creator: b.creator,
    cover: pgCover(b.id),
    readerUrl: `https://www.gutenberg.org/ebooks/${b.id}`,
    source: 'gutenberg'
  }));
}

// Open Library subject feeds (for Philosophy & Science shelves)
async function fetchSubject(subject, limit = 18) {
  try {
    const url = `https://openlibrary.org/subjects/${encodeURIComponent(subject)}.json?limit=${limit}&ebooks=true`;
    const { data } = await http.get(url);
    const works = Array.isArray(data?.works) ? data.works : [];
    return works.slice(0, limit).map(w => {
      const title  = w.title || 'Untitled';
      const author = Array.isArray(w.authors) && w.authors[0]?.name ? w.authors[0].name : 'Various';
      const cover  = w.cover_id ? `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg` : '';
      const q      = encodeURIComponent(`${title} ${author}`);
      return card({
        identifier: `olwork:${w.key || title}`,
        title, creator: author, cover,
        readerUrl: `/read?query=${q}`,
        source: 'openlibrary'
      });
    });
  } catch (e) {
    console.error(`[OL subject:${subject}]`, e.message);
    return [];
  }
}

function fallbackPhilosophy() {
  return [
    { id:'1497', title:'The Republic', creator:'Plato' },
    { id:'1404', title:'Meditations', creator:'Marcus Aurelius' },
    { id:'571',  title:'Thus Spake Zarathustra', creator:'Friedrich Nietzsche' },
    { id:'30202',title:'Apology', creator:'Plato' },
    { id:'521',  title:'Beyond Good and Evil', creator:'Friedrich Nietzsche' },
  ].map(b => card({
    identifier:`gutenberg:${b.id}`,
    title:b.title, creator:b.creator,
    cover:`https://www.gutenberg.org/cache/epub/${b.id}/pg${b.id}.cover.medium.jpg`,
    readerUrl:`https://www.gutenberg.org/ebooks/${b.id}`,
    source:'gutenberg'
  }));
}
function fallbackScience() {
  // use Open Library subject cover as generic visual
  const mk = (title) => card({
    identifier:`search:${title.toLowerCase().replace(/\s+/g,'-')}`,
    title, creator:'Various',
    cover:'https://covers.openlibrary.org/b/subject/science-M.jpg',
    readerUrl:`/read?query=${encodeURIComponent(title)}`,
    source:'openlibrary'
  });
  return [mk('Physics'), mk('Astronomy'), mk('Biology'), mk('Mathematics')];
}

// Build distinct shelves
async function buildShelves() {
  const [philosophy, science] = await Promise.all([
    (async () => {
      const a = await fetchSubject('philosophy', 24);
      const b = await fetchSubject('greek_philosophy', 18);
      const c = await fetchSubject('stoicism', 12);
      const merged = uniqBy([...a, ...b, ...c], x => (x.title||'').toLowerCase()).slice(0, 12);
      return merged.length ? merged : fallbackPhilosophy().slice(0, 12);
    })(),
    (async () => {
      const a = await fetchSubject('science', 24);
      const b = await fetchSubject('physics', 18);
      const c = await fetchSubject('astronomy', 18);
      const d = await fetchSubject('biology', 18);
      const merged = uniqBy([...a, ...b, ...c, ...d], x => (x.title||'').toLowerCase()).slice(0, 12);
      return merged.length ? merged : fallbackScience().slice(0, 12);
    })()
  ]);

  const timeless = curatedFeatured(); // distinct classics list

  return [
    { title: 'Philosophy Corner', q: 'Philosophy', items: philosophy },
    { title: 'Timeless Classics', q: 'Classics',   items: timeless },
    { title: 'Science Shelf',     q: 'Science',    items: science },
  ];
}

// ────────────────────────────────────────────────────────────
// Endpoints
// ────────────────────────────────────────────────────────────

// “Trending now” → prefers latest local/admin books, else a small non-classics fallback
router.get('/api/featured-books', async (req, res) => {
  try {
    const payload = await featuredCache.get(async () => {
      // 1) Try local books (admin-curated)
      if (Book) {
        try {
          const local = await Book.find({}).sort({ createdAt: -1 }).limit(12).lean();
          if (local && local.length) {
            return { items: local.map(cardFromLocalBook) };
          }
        } catch (e) {
          console.error('featured: local Book fetch failed:', e.message);
        }
      }
      // 2) Fallback: use Open Library “literature” subject so it differs from Classics
      const alt = await fetchSubject('literature', 12);
      if (alt.length) return { items: alt };

      // 3) Last resort: a randomized slice of classics (still try to differ)
      const classics = curatedFeatured();
      const shuffled = classics.slice().sort(() => Math.random() - 0.5);
      return { items: shuffled.slice(0, 6) };
    });

    res.set('Cache-Control', 'public, max-age=900'); // 15 min
    res.json(payload);
  } catch (e) {
    console.error('featured endpoint error:', e);
    res.status(500).json({ items: [] });
  }
});

// Distinct category shelves
router.get('/api/shelves', async (req, res) => {
  try {
    const payload = await shelvesCache.get(async () => {
      const shelves = await buildShelves();
      return { shelves };
    });
    res.set('Cache-Control', 'public, max-age=600'); // 10 min
    res.json(payload);
  } catch (e) {
    console.error('shelves endpoint error:', e);
    res.status(500).json({ shelves: [] });
  }
});

module.exports = router;
