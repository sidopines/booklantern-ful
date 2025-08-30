// routes/homeRoutes.js
const express = require('express');
const router = express.Router();

/**
 * This route file powers:
 *   GET /api/featured-books  – small curated feed
 *   GET /api/shelves         – homepage shelves (Philosophy, Classics, Science)
 *
 * It is resilient to Open Library outages and will fallback to Gutenberg (Gutendex).
 * Add HOME_SHELVES=off in .env to disable shelves in local dev.
 */

const SHELF_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = {
  featured: { data: null, ts: 0 },
  shelves: { data: null, ts: 0 },
};

// Small helper with timeout & friendly UA
async function fetchJson(url, { timeoutMs = 12000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'BookLanternDev/1.0 (+https://booklantern.org)' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ---------- Mappers to our card shape ----------
function card({ title, creator = '', cover = '', href = '#', source = '' }) {
  return { title, creator, cover, href, source };
}

// Open Library subject -> cards (best effort)
async function fromOpenLibrarySubject(subject, limit = 20) {
  try {
    const url = `https://openlibrary.org/subjects/${encodeURIComponent(subject)}.json?limit=${limit}&details=true`;
    const data = await fetchJson(url, { timeoutMs: 12000 });
    const works = Array.isArray(data.works) ? data.works : [];
    return works.map(w => {
      const title = w.title || '(Untitled)';
      const author = Array.isArray(w.authors) && w.authors[0] ? (w.authors[0].name || '') : '';
      const coverId = w.cover_id;
      const cover = coverId
        ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
        : (w.cover_edition_key ? `https://covers.openlibrary.org/b/olid/${w.cover_edition_key}-M.jpg` : '');
      // Send them to our unified search so reading stays inside our site for supported sources
      const href = `/read?query=${encodeURIComponent(`${title} ${author}`)}`;
      return card({ title, creator: author, cover, href, source: 'openlibrary' });
    });
  } catch (e) {
    console.warn(`[OL subject:${subject}] ${e.message}`);
    return [];
  }
}

// Gutenberg (Gutendex) fallback search -> cards
async function fromGutendex(query, limit = 20) {
  try {
    const url = `https://gutendex.com/books?search=${encodeURIComponent(query)}`;
    const data = await fetchJson(url, { timeoutMs: 12000 });
    const results = Array.isArray(data.results) ? data.results.slice(0, limit) : [];
    return results.map(b => {
      const gid = b.id;
      const title = b.title || '(Untitled)';
      const author = Array.isArray(b.authors) && b.authors[0] ? b.authors[0].name : '';
      const cover =
        (b.formats && (b.formats['image/jpeg'] || b.formats['image/png'])) ||
        `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.cover.medium.jpg`;
      const href = `/read/gutenberg/${gid}/reader?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`;
      return card({ title, creator: author, cover, href, source: 'gutenberg' });
    });
  } catch (e) {
    console.warn(`[Gutendex "${query}"] ${e.message}`);
    return [];
  }
}

// Featured feed (simple, resilient)
async function buildFeatured() {
  // Try some broad popular searches so we always have something
  const picks = await fromGutendex('classic literature', 10);
  // If nothing, just return an empty array (client shows a hint)
  return picks;
}

// Shelves builder with fallbacks & caching
async function buildShelves() {
  const shelvesSpec = [
    { key: 'philosophy', title: 'Philosophy Corner', ol: 'philosophy', gut: 'philosophy' },
    { key: 'classics', title: 'Timeless Classics', ol: 'classics', gut: 'classic literature' },
    { key: 'science', title: 'Science Shelf', ol: 'science', gut: 'science' },
  ];

  const tasks = shelvesSpec.map(async (s) => {
    // First try Open Library, then fallback to Gutenberg
    const [ol, gut] = await Promise.allSettled([
      fromOpenLibrarySubject(s.ol, 18),
      fromGutendex(s.gut, 18),
    ]);

    // Prefer OL results if present; otherwise use Gutenberg fallback
    const items = (ol.status === 'fulfilled' && ol.value && ol.value.length)
      ? ol.value
      : (gut.status === 'fulfilled' ? gut.value : []);

    // Filter out items without any cover to keep the UI clean
    const clean = items.filter(x => x && x.title && x.cover);
    return { key: s.key, title: s.title, items: clean.slice(0, 18) };
  });

  const built = await Promise.all(tasks);
  return built;
}

// ------------- ROUTES ---------------

// Featured
router.get('/api/featured-books', async (req, res) => {
  try {
    // cache
    const now = Date.now();
    if (cache.featured.data && (now - cache.featured.ts) < SHELF_TTL_MS) {
      return res.json(cache.featured.data);
    }
    const items = await buildFeatured();
    const payload = { items };
    cache.featured = { data: payload, ts: now };
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(payload);
  } catch (e) {
    console.error('featured error', e);
    // Never 5xx — return empty payload
    return res.json({ items: [] });
  }
});

// Shelves
router.get('/api/shelves', async (req, res) => {
  try {
    if ((process.env.HOME_SHELVES || '').toLowerCase() === 'off') {
      return res.json({ shelves: [] });
    }

    const now = Date.now();
    if (cache.shelves.data && (now - cache.shelves.ts) < SHELF_TTL_MS) {
      return res.json(cache.shelves.data);
    }

    const shelves = await buildShelves();
    const payload = { shelves };
    cache.shelves = { data: payload, ts: now };
    res.set('Cache-Control', 'public, max-age=300');
    return res.json(payload);
  } catch (e) {
    console.error('shelves error', e);
    // Never 5xx — return empty payload
    return res.json({ shelves: [] });
  }
});

module.exports = router;
