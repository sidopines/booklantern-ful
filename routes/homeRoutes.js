// routes/homeRoutes.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

// Shared axios
const http = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'BookLantern/1.0 (+booklantern.org)',
    'Accept': 'application/json,text/plain,*/*'
  }
});

// Normalize card
function card({ identifier = '', title = '', creator = '', cover = '', readerUrl = '', source = '', archiveId = '' }) {
  return { identifier, title, creator, cover, readerUrl, source, archiveId };
}
const archiveCover  = (id) => `https://archive.org/services/img/${id}`;
const archiveReader = (id, page = 1) => `https://archive.org/stream/${id}?ui=embed#page=${page}`;

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

/** --------- Source fetchers ---------- */

// Internet Archive – public readable only
async function searchArchive(q, rows = 20) {
  try {
    const query = encodeURIComponent(`(${q}) AND mediatype:texts AND access-restricted:false`);
    const fields = ['identifier', 'title', 'creator', 'description'].join(',');
    const url = `https://archive.org/advancedsearch.php?q=${query}&fl[]=${fields}&rows=${rows}&page=1&output=json`;
    const { data } = await http.get(url);
    const docs = data?.response?.docs || [];
    return docs.map(d => card({
      identifier: d.identifier,
      title: d.title || d.identifier || 'Untitled',
      creator: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''),
      cover: archiveCover(d.identifier),
      readerUrl: archiveReader(d.identifier, 1),
      source: 'archive',
      archiveId: d.identifier
    }));
  } catch (e) {
    console.error('[home] Archive error:', e.message);
    return [];
  }
}

// Project Gutenberg (Gutendex)
async function searchGutenberg(q, pages = 1) {
  try {
    const base = `https://gutendex.com/books?search=${encodeURIComponent(q)}&page_size=40`;
    const calls = [];
    for (let p = 1; p <= pages; p++) calls.push(http.get(base + `&page=${p}`));
    const settled = await Promise.allSettled(calls);
    const results = settled.flatMap(s => s.status === 'fulfilled' ? (s.value.data?.results || []) : []);
    return results.map(b => {
      const authors = (b.authors || []).map(a => a.name).join(', ');
      const cover =
        b.formats?.['image/jpeg'] ||
        b.formats?.['image/jpg'] || '';
      const readerUrl =
        b.formats?.['text/html; charset=utf-8'] ||
        b.formats?.['text/html'] ||
        b.formats?.['text/plain; charset=utf-8'] ||
        `https://www.gutenberg.org/ebooks/${b.id}`;
      return card({
        identifier: `gutenberg:${b.id}`,
        title: b.title || `Gutenberg #${b.id}`,
        creator: authors,
        cover,
        readerUrl,
        source: 'gutenberg'
      });
    });
  } catch (e) {
    console.error('[home] Gutenberg error:', e.message);
    return [];
  }
}

// Open Library – public_scan_b, prefer items with IA scan (ia/ocaid)
async function searchOpenLibrary(q, limit = 30) {
  try {
    const params = `has_fulltext=true&public_scan_b=true&mode=ebooks&limit=${limit}`;
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&${params}`;
    const { data } = await http.get(url);
    const docs = data?.docs || [];

    const out = [];
    for (const d of docs) {
      const iaId = Array.isArray(d.ia) && d.ia.length > 0
        ? d.ia[0]
        : (typeof d.ocaid === 'string' && d.ocaid.trim() ? d.ocaid.trim() : null);
      if (!iaId) continue;

      const title  = d.title || 'Untitled';
      const author = Array.isArray(d.author_name) ? d.author_name.join(', ') : (d.author_name || '');
      const cover  = d.cover_i
        ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
        : `https://iiif.archive.org/iiif/${iaId}/full/400,/0/default.jpg`;

      out.push(card({
        identifier: `openlibrary:${(d.key || iaId).replace(/\//g, '_')}`,
        title, creator: author, cover,
        readerUrl: archiveReader(iaId, 1),
        source: 'openlibrary',
        archiveId: iaId
      }));
    }
    return out;
  } catch (e) {
    console.error('[home] OpenLibrary error:', e.message);
    return [];
  }
}

/** ---------- API: Featured Books (returns an ARRAY to match index.ejs) ---------- */
router.get('/api/featured-books', async (req, res) => {
  try {
    const topics = ['classics', 'philosophy', 'science', 'history'];
    const tasks = [];

    for (const t of topics) {
      tasks.push(searchArchive(t, 12));
      tasks.push(searchOpenLibrary(t, 20));
      tasks.push(searchGutenberg(t, 1));
    }

    const settled = await Promise.allSettled(tasks);
    let books = settled.flatMap(s => s.status === 'fulfilled' ? s.value : []);

    const seen = new Map();
    for (const b of books) {
      const key = `${(b.title||'').toLowerCase()}|${(b.creator||'').toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, b);
      } else {
        const prev = seen.get(key);
        const score = (x) => (x.cover ? 1 : 0) + (x.readerUrl ? 1 : 0);
        if (score(b) > score(prev)) seen.set(key, b);
      }
    }
    books = Array.from(seen.values()).slice(0, 16);

    res.json(books); // <-- plain array for your existing front-end code
  } catch (e) {
    console.error('[home] featured fatal:', e);
    res.status(500).json([]);
  }
});

/** ---------- API: Curated Shelves (optional) ---------- */
router.get('/api/shelves', async (req, res) => {
  try {
    const shelves = [
      { title: 'Philosophy Essentials', q: 'Plato' },
      { title: 'Science Classics', q: 'Physics' },
      { title: 'History & Civilization', q: 'Civilization' }
    ];

    const rows = [];
    for (const s of shelves) {
      const [arch, ol, gut] = await Promise.all([
        searchArchive(s.q, 10),
        searchOpenLibrary(s.q, 20),
        searchGutenberg(s.q, 1)
      ]);
      const mixed = uniqBy([...(arch||[]), ...(ol||[]), ...(gut||[])], b =>
        `${(b.title||'').toLowerCase()}|${(b.creator||'').toLowerCase()}`
      ).slice(0, 12);

      rows.push({ title: s.title, q: s.q, items: mixed });
    }

    res.json({ shelves: rows });
  } catch (e) {
    console.error('[home] shelves fatal:', e);
    res.status(500).json({ shelves: [] });
  }
});

module.exports = router;
