// routes/bookRoutes.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

const Bookmark = require('../models/Bookmark');
const Favorite = require('../models/Favorite');
const Book = require('../models/Book'); // optional, for local/admin-curated items

// ---------- axios (shared) ----------
const http = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'BookLantern/1.0 (+booklantern.org)',
    'Accept': 'application/json,text/plain,*/*'
  }
});

// ---------- helpers ----------
function card({
  identifier = '',
  title = '',
  creator = '',
  cover = '',
  readerUrl = '',
  source = '',
  description = '',
}) {
  return { identifier, title, creator, cover, readerUrl, source, description };
}

function archiveCover(id) {
  return `https://archive.org/services/img/${id}`;
}
function archiveReader(id, page = 1) {
  return `https://archive.org/stream/${id}?ui=embed#page=${page}`;
}

// ---------- external fetchers (ALWAYS return an array) ----------
async function searchArchive(q) {
  try {
    const query = encodeURIComponent(`(${q}) AND mediatype:texts`);
    const fields = ['identifier', 'title', 'creator', 'description', 'publicdate'].join(',');
    const url = `https://archive.org/advancedsearch.php?q=${query}&fl[]=${fields}&rows=30&page=1&output=json`;
    const { data } = await http.get(url);
    const docs = data?.response?.docs || [];
    return docs.map(d =>
      card({
        identifier: d.identifier,
        title: d.title || d.identifier || 'Untitled',
        creator: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''),
        cover: archiveCover(d.identifier),
        readerUrl: archiveReader(d.identifier, 1),
        source: 'archive',
        description: (Array.isArray(d.description) ? d.description[0] : d.description) || '',
      })
    );
  } catch (e) {
    console.error('Archive search error:', e.message);
    return [];
  }
}

async function searchGutenberg(q) {
  try {
    const base = `https://gutendex.com/books?search=${encodeURIComponent(q)}&page_size=50`;
    const [p1, p2] = await Promise.allSettled([http.get(base + '&page=1'), http.get(base + '&page=2')]);
    const results = []
      .concat(p1.status === 'fulfilled' ? (p1.value.data?.results || []) : [])
      .concat(p2.status === 'fulfilled' ? (p2.value.data?.results || []) : []);
    return results.map(b => {
      const authors = (b.authors || []).map(a => a.name).join(', ');
      const cover =
        b.formats?.['image/jpeg'] ||
        b.formats?.['image/jpg'] ||
        '';
      // Prefer HTML reader if available, else text/plain, else fallback to book page
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
        source: 'gutenberg',
      });
    });
  } catch (e) {
    console.error('Gutenberg search error:', e.message);
    return [];
  }
}

// Open Library: show items that are actually readable without login
// Keep those with an Internet Archive scan: docs having `ia[]` or `ocaid`, or `public_scan_b === true`
async function searchOpenLibrary(q) {
  try {
    const url =
      `https://openlibrary.org/search.json` +
      `?q=${encodeURIComponent(q)}` +
      `&limit=30` +
      `&fields=title,author_name,cover_i,ia,ocaid,public_scan_b,edition_key,key`;
    const { data } = await http.get(url);
    const docs = data?.docs || [];

    const readable = docs.filter(d =>
      (Array.isArray(d.ia) && d.ia.length > 0) ||
      (typeof d.ocaid === 'string' && d.ocaid.trim() !== '') ||
      d.public_scan_b === true
    );

    return readable.map(d => {
      const title  = d.title || 'Untitled';
      const author = Array.isArray(d.author_name) ? d.author_name.join(', ') : (d.author_name || '');

      // Determine an Archive.org identifier we can open internally
      const iaId = (Array.isArray(d.ia) && d.ia.length > 0)
        ? d.ia[0]
        : (typeof d.ocaid === 'string' ? d.ocaid : null);

      if (!iaId) return null;

      const cover  = d.cover_i
        ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
        : `https://iiif.archive.org/iiif/${iaId}/full/400,/0/default.jpg`;

      return card({
        identifier: iaId,
        title,
        creator: author,
        cover,
        readerUrl: archiveReader(iaId, 1),
        source: 'archive', // treat as archive so /read/book/:identifier handles it
      });
    }).filter(Boolean);
  } catch (e) {
    console.error('OpenLibrary search error:', e.message);
    return [];
  }
}

// ---------- READ LIST / SEARCH ----------
router.get('/read', async (req, res) => {
  const query = (req.query.query || '').trim();

  // If empty query: show locally saved/admin books (if any)
  if (!query) {
    try {
      const books = await Book.find({}).sort({ createdAt: -1 }).limit(24);
      const normalized = books.map(b =>
        card({
          identifier: String(b._id),
          title: b.title,
          creator: b.author || '',
          cover: b.coverImage || '',
          readerUrl: b.sourceUrl || '',
          source: 'local',
          description: b.description || '',
        })
      );
      return res.render('read', { books: normalized, query });
    } catch (e) {
      console.error('Read (no query) error:', e);
      return res.render('read', { books: [], query });
    }
  }

  try {
    const [arch = [], gut = [], olAsArchive = []] = await Promise.all([
      searchArchive(query),
      searchGutenberg(query),
      searchOpenLibrary(query), // returns archive-like items
    ]);

    console.log(`READ SEARCH "${query}" — archive:${arch.length} gutenberg:${gut.length} openlibrary->archive:${olAsArchive.length}`);

    let books = []
      .concat(arch, gut, olAsArchive)
      .filter(b => b && (b.title || b.identifier));

    // De-dupe by (title + creator). Prefer entries with cover + readerUrl.
    const seen = new Map();
    for (const b of books) {
      const key = `${(b.title || '').toLowerCase()}|${(b.creator || '').toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, b);
      } else {
        const prev = seen.get(key);
        const score = (x) => (x.cover ? 1 : 0) + (x.readerUrl ? 1 : 0);
        if (score(b) > score(prev)) seen.set(key, b);
      }
    }
    books = Array.from(seen.values()).slice(0, 60);

    return res.render('read', { books, query });
  } catch (err) {
    console.error('Read search fatal error:', err);
    return res.render('read', { books: [], query });
  }
});

// ---------- VIEWER (ARCHIVE-ONLY INTERNAL READER) ----------
router.get('/read/book/:identifier', async (req, res) => {
  const identifier = req.params.identifier;

  if (identifier.startsWith('gutenberg:')) {
    const gid = identifier.replace(/^gutenberg:/, '');
    return res.redirect(`/read/gutenberg/${encodeURIComponent(gid)}`);
  }
  if (identifier.startsWith('openlibrary:')) {
    return res.redirect(`/read?query=${encodeURIComponent(identifier.replace(/^openlibrary:/, ''))}`);
  }

  let isFavorite = false;
  try {
    if (req.session.user) {
      const byArchive = await Favorite.exists({
        user: req.session.user._id,
        archiveId: identifier,
      });
      const byBook = await Favorite.exists({ user: req.session.user._id });
      isFavorite = !!(byArchive || byBook);
    }
  } catch (e) {
    console.error('Favorite lookup error:', e.message);
  }

  const book = { title: identifier, archiveId: identifier };
  return res.render('book-viewer', {
    book,
    isFavorite,
    user: req.session.user || null,
  });
});

// ---------- VIEWER (GUTENBERG — INTERNAL WRAPPER LEGACY) ----------
router.get('/read/gutenberg/:gid', async (req, res) => {
  const gid = req.params.gid;
  const fromQuery = (req.query.u || '').trim();
  const fallback = `https://www.gutenberg.org/ebooks/${gid}`;
  const viewerUrl = fromQuery || fallback;

  return res.render('gutenberg-viewer', {
    viewerUrl,
    gid,
    user: req.session.user || null,
    pageTitle: `Gutenberg #${gid} | Read`,
    pageDescription: `Read Gutenberg #${gid} on BookLantern`
  });
});

// ---------- UNIFIED PAGINATED READER (GUTENBERG) ----------
router.get('/read/gutenberg/:gid/reader', async (req, res) => {
  const gid = req.params.gid;
  const fromQuery = (req.query.u || '').trim();
  const fallback = `https://www.gutenberg.org/ebooks/${gid}`;
  const viewerUrl = fromQuery || fallback;

  return res.render('unified-reader', {
    source: 'gutenberg',
    gid,
    startUrl: viewerUrl,
    pageTitle: `Gutenberg #${gid} | Reader`,
    pageDescription: `Paginated reader for Gutenberg #${gid}`
  });
});

/**
 * ---------- VIEWER (GUTENBERG — PROXY) ----------
 * Proxies Gutenberg HTML through our domain and rewrites navigation links (<a>, <form action>)
 * back to this proxy, so the address bar always stays on booklantern.org.
 * Static assets (img/css/js) are left pointing to Gutenberg by using a <base> tag.
 * Also inject a minimal readability shell when used standalone.
 */
router.get('/read/gutenberg/:gid/proxy', async (req, res) => {
  try {
    const gid = req.params.gid;
    const raw = (req.query.u || '').trim();
    const fallback = `https://www.gutenberg.org/ebooks/${encodeURIComponent(gid)}`;
    const target = new URL(raw || fallback);

    const allowedHosts = new Set(['www.gutenberg.org', 'gutenberg.org']);
    if (!allowedHosts.has(target.hostname) || !/^https?:$/.test(target.protocol)) {
      return res.status(400).send('Invalid target');
    }

    const resp = await axios.get(target.toString(), {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'BookLantern/1.0 (+booklantern.org)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.gutenberg.org/'
      },
      timeout: 15000
    });

    const contentType = resp.headers['content-type'] || 'text/html; charset=utf-8';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', contentType);

    if (!contentType.includes('text/html')) {
      return res.send(resp.data); // passthrough
    }

    let html = resp.data.toString('utf8');

    // Strip inline meta CSP if present
    html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/ig, '');

    // Inject <base> so relative assets (img/css/js) load correctly from Gutenberg
    const baseHref = new URL('.', target).toString();

    // Minimal readability CSS injection (used when opening /viewer, not the paginated reader)
    const injectCss = `
      <style id="bl-proxy-style">
        html, body { background: #fff !important; color: #000 !important; }
        img, svg, video { max-width: 100%; height: auto; }
        pre { white-space: pre-wrap; word-wrap: break-word; }
        a { color: #0645ad; }
      </style>`;

    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">${injectCss}`);
    } else {
      html = `<base href="${baseHref}">${injectCss}` + html;
    }

    // Helper to proxy a URL back through us
    const proxify = (absUrl) =>
      `/read/gutenberg/${encodeURIComponent(gid)}/proxy?u=${encodeURIComponent(absUrl)}`;

    // Rewrite navigation links: <a href="...">
    html = html.replace(/(<a\b[^>]*\shref=)(['"])([^'"]+)\2/gi, (m, p1, q, url) => {
      try {
        if (/^\s*javascript:/i.test(url)) return m;
        const abs = new URL(url, baseHref).toString();
        const u = new URL(abs);
        if (u.hostname.endsWith('gutenberg.org')) {
          return `${p1}${q}${proxify(abs)}${q}`;
        }
        return m;
      } catch { return m; }
    });

    // Rewrite <form action="...">
    html = html.replace(/(<form\b[^>]*\saction=)(['"])([^'"]*)\2/gi, (m, p1, q, url) => {
      try {
        if (!url) return m;
        const abs = new URL(url, baseHref).toString();
        const u = new URL(abs);
        if (u.hostname.endsWith('gutenberg.org')) {
          return `${p1}${q}${proxify(abs)}${q}`;
        }
        return m;
      } catch { return m; }
    });

    return res.send(html);
  } catch (e) {
    console.error('Gutenberg proxy error:', e.message);
    return res.status(502).send('Failed to load book');
  }
});

// ---------- BOOKMARKS (ARCHIVE-ONLY) ----------
router.post('/read/book/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  const { page } = req.body;
  try {
    const existing = await Bookmark.findOne({
      user: req.session.user._id,
      archiveId: req.params.identifier,
    });
    if (existing) {
      existing.currentPage = page;
      await existing.save();
    } else {
      await Bookmark.create({
        user: req.session.user._id,
        archiveId: req.params.identifier,
        currentPage: page,
      });
    }
    res.send('✅ Bookmark saved!');
  } catch (err) {
    console.error('Bookmark error:', err);
    res.status(500).send('Server error');
  }
});

router.get('/read/book/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  try {
    const bookmark = await Bookmark.findOne({
      user: req.session.user._id,
      archiveId: req.params.identifier,
    });
    res.json({ page: bookmark?.currentPage || 1 });
  } catch (err) {
    console.error('Bookmark fetch error:', err);
    res.status(500).send('Error loading bookmark');
  }
});

// ---------- FAVORITES TOGGLE (ARCHIVE-ONLY HERE) ----------
router.post('/read/book/:identifier/favorite', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  try {
    const existing = await Favorite.findOne({
      user: req.session.user._id,
      archiveId: req.params.identifier,
    });

    if (existing) {
      await existing.deleteOne();
      res.send('❌ Removed from favorites');
    } else {
      await Favorite.create({
        user: req.session.user._id,
        archiveId: req.params.identifier,
      });
      res.send('❤️ Added to favorites');
    }
  } catch (err) {
    console.error('Favorite toggle error:', err);
    res.status(500).send('Failed to toggle favorite');
  }
});

module.exports = router;
