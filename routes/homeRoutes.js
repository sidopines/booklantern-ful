// routes/homeRoutes.js
const express = require('express');
const axios   = require('axios');
const router  = express.Router();

/* ------------------------------------------------------------------ */
/* Axios client                                                        */
/* ------------------------------------------------------------------ */
const http = axios.create({
  timeout: 12000,
  headers: {
    'User-Agent': 'BookLantern/1.0 (+booklantern.org)',
    'Accept': 'application/json,text/plain,*/*'
  }
});

/* ------------------------------------------------------------------ */
/* Simple in-memory cache                                              */
/* ------------------------------------------------------------------ */
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
const shelvesCache  = makeCache(30 * 60 * 1000); // 30m (rotate a bit quicker)

/* ------------------------------------------------------------------ */
/* Helper: normalize a card                                            */
/* ------------------------------------------------------------------ */
function card({ identifier, title, creator, cover, readerUrl, source = 'openlibrary', archiveId = '' }) {
  return { identifier, title, creator, cover, readerUrl, source, archiveId };
}

/* ------------------------------------------------------------------ */
/* Featured: known-good Gutenberg set (stable + with covers)           */
/* ------------------------------------------------------------------ */
function curatedFeatured() {
  const pgCover = id => `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;
  return [
    { id:'1342', title:'Pride and Prejudice', creator:'Jane Austen' },
    { id:'1661', title:'The Adventures of Sherlock Holmes', creator:'Arthur Conan Doyle' },
    { id:'84',   title:'Frankenstein', creator:'Mary Wollstonecraft Shelley' },
    { id:'2701', title:'Moby-Dick; or, The Whale', creator:'Herman Melville' },
    { id:'11',   title:"Alice's Adventures in Wonderland", creator:'Lewis Carroll' },
    { id:'98',   title:'A Tale of Two Cities', creator:'Charles Dickens' },
  ].map(b => card({
    identifier: `gutenberg:${b.id}`,
    title: b.title,
    creator: b.creator,
    cover: pgCover(b.id),
    readerUrl: `https://www.gutenberg.org/ebooks/${b.id}`,
    source: 'gutenberg'
  }));
}

/* ------------------------------------------------------------------ */
/* Open Library subjects (gives covers reliably)                       */
/*  - Example: https://openlibrary.org/subjects/philosophy.json        */
/*  - We require ebooks + public scans where possible.                 */
/* ------------------------------------------------------------------ */
async function fetchSubject(subject, limit = 18) {
  try {
    const url = `https://openlibrary.org/subjects/${encodeURIComponent(subject)}.json?limit=${limit}&ebooks=true`;
    const { data } = await http.get(url);
    const works = Array.isArray(data?.works) ? data.works : [];

    return works.slice(0, limit).map(w => {
      const title = w.title || 'Untitled';
      const author = Array.isArray(w.authors) && w.authors[0]?.name ? w.authors[0].name : 'Various';
      const cover = w.cover_id ? `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg` : '';
      // We link to a read search that tends to find a readable copy quickly.
      const q = encodeURIComponent(`${title} ${author}`);
      return card({
        identifier: `olwork:${w.key || title}`,
        title,
        creator: author,
        cover,
        readerUrl: `/read?query=${q}`,
        source: 'openlibrary'
      });
    });
  } catch (e) {
    console.error(`[OL subject:${subject}]`, e.message);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Category-specific fallbacks (distinct per shelf)                    */
/* ------------------------------------------------------------------ */
function fallbackPhilosophy() {
  // recognizable philosophy PD covers from Gutenberg
  return [
    { id:'1497', title:'The Republic', creator:'Plato' },
    { id:'1404', title:'Meditations', creator:'Marcus Aurelius' },
    { id:'571',  title:'Thus Spake Zarathustra', creator:'Friedrich Nietzsche' },
    { id:'30202',title:'Apology', creator:'Plato' },
    { id:'521',  title:'Beyond Good and Evil', creator:'Friedrich Nietzsche' },
    { id:'authorAristotle', title:'Aristotle Essentials', creator:'Aristotle' }, // search card
  ].map(b => b.id.startsWith('author')
    ? card({
        identifier:`search:aristotle`,
        title:b.title,
        creator:b.creator,
        cover:'https://covers.openlibrary.org/b/subject/philosophy-M.jpg',
        readerUrl:'/read?query=Aristotle'
      })
    : card({
        identifier:`gutenberg:${b.id}`,
        title:b.title, creator:b.creator,
        cover:`https://www.gutenberg.org/cache/epub/${b.id}/pg${b.id}.cover.medium.jpg`,
        readerUrl:`https://www.gutenberg.org/ebooks/${b.id}`,
        source:'gutenberg'
      })
  );
}
function fallbackScience() {
  return [
    { id:'41445', title:'On the Origin of Species', creator:'Charles Darwin' },
    { id:'14988', title:'Relativity: The Special and General Theory', creator:'Albert Einstein' },
    { id:'5001',  title:'A Brief Introduction to Astronomy', creator:'Various' },
  ].map(b => card({
    identifier:`search:${b.title.toLowerCase().replace(/\s+/g,'-')}`,
    title:b.title, creator:b.creator,
    cover:'https://covers.openlibrary.org/b/subject/science-M.jpg',
    readerUrl:`/read?query=${encodeURIComponent(b.title)}`
  }));
}

/* ------------------------------------------------------------------ */
/* Compose shelves                                                     */
/* ------------------------------------------------------------------ */
function uniqBy(arr, keyFn) {
  const seen = new Set(); const out = [];
  for (const it of arr) {
    const k = keyFn(it);
    if (seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
}

async function buildShelves() {
  // Pull distinct sets from OL subjects; each shelf has its own sources
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

  const timeless = curatedFeatured(); // still the classics set, on purpose

  return [
    { title: 'Philosophy Corner', q: 'Philosophy', items: philosophy },
    { title: 'Timeless Classics', q: 'Classics',   items: timeless },
    { title: 'Science Shelf',     q: 'Science',    items: science },
  ];
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

// Lightweight page routes (home/about/contact handled elsewhere if needed)

router.get('/api/featured-books', async (req, res) => {
  try {
    const payload = await featuredCache.get(async () => ({ items: curatedFeatured() }));
    res.set('Cache-Control', 'public, max-age=900');
    res.json(payload);
  } catch (e) {
    console.error('featured endpoint error:', e);
    res.status(500).json({ items: [] });
  }
});

router.get('/api/shelves', async (req, res) => {
  try {
    const payload = await shelvesCache.get(async () => {
      const shelves = await buildShelves();
      return { shelves };
    });
    res.set('Cache-Control', 'public, max-age=600'); // 10 minutes
    res.json(payload);
  } catch (e) {
    console.error('shelves endpoint error:', e);
    res.status(500).json({ shelves: [] });
  }
});

module.exports = router;
