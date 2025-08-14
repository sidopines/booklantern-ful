// routes/bookRoutes.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

const Bookmark = require('../models/Bookmark');
const Favorite = require('../models/Favorite');
const Book = require('../models/Book');

// ---------- axios (shared) ----------
const http = axios.create({
  timeout: 20000,
  maxRedirects: 5,
  headers: {
    'User-Agent': 'BookLantern/1.0 (+booklantern.org)',
    'Accept': 'application/json,text/plain,*/*'
  },
  validateStatus: s => s >= 200 && s < 400
});

// small helper to retry transient network calls once
async function withRetry(fn, label = 'op') {
  try {
    return await fn();
  } catch (e1) {
    console.warn(`[search] ${label} failed once: ${e1.message}. Retrying…`);
    await new Promise(r => setTimeout(r, 300));
    try {
      return await fn();
    } catch (e2) {
      console.error(`[search] ${label} failed again:`, e2.message);
      return null;
    }
  }
}

// ---------- helpers ----------
function card({
  identifier = '',
  title = '',
  creator = '',
  cover = '',
  readerUrl = '',
  source = '',
  description = '',
  archiveId = '' // for IA items we can open in our viewer
}) {
  return { identifier, title, creator, cover, readerUrl, source, description, archiveId };
}

function archiveCover(id) {
  return `https://archive.org/services/img/${id}`;
}
function archiveReader(id, page = 1) {
  return `https://archive.org/stream/${id}?ui=embed#page=${page}`;
}
function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of arr) {
    const k = keyFn(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

// ---------- external fetchers ----------
/**
 * Internet Archive
 * Keep borrow-only out via access-restricted:false.
 */
async function searchArchive(q) {
  try {
    const query = encodeURIComponent(`(${q}) AND mediatype:texts AND access-restricted:false`);
    const fields = ['identifier', 'title', 'creator', 'description', 'publicdate', 'access-restricted'].join(',');
    const url = `https://archive.org/advancedsearch.php?q=${query}&fl[]=${fields}&rows=50&page=1&output=json`;

    const data = await withRetry(async () => (await http.get(url)).data, 'archive');
    const docs = data?.response?.docs || [];
    return docs
      .filter(d => String(d['access-restricted']) !== 'true')
      .map(d =>
        card({
          identifier: d.identifier,
          title: d.title || d.identifier || 'Untitled',
          creator: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''),
          cover: archiveCover(d.identifier),
          readerUrl: archiveReader(d.identifier, 1),
          source: 'archive',
          description: (Array.isArray(d.description) ? d.description[0] : d.description) || '',
          archiveId: d.identifier
        })
      );
  } catch (e) {
    console.error('Archive search error:', e.message);
    return [];
  }
}

/**
 * Project Gutenberg (Gutendex)
 * Pull up to 2 pages. If one call fails, the retry wrapper will handle once.
 */
async function searchGutenberg(q) {
  try {
    const base = `https://gutendex.com/books?search=${encodeURIComponent(q)}&page_size=50`;
    const p1 = await withRetry(async () => (await http.get(base + '&page=1')).data, 'gutenberg p1');
    const p2 = await withRetry(async () => (await http.get(base + '&page=2')).data, 'gutenberg p2');

    const results = []
      .concat(Array.isArray(p1?.results) ? p1.results : [])
      .concat(Array.isArray(p2?.results) ? p2.results : []);

    return results.map(b => {
      const authors = (b.authors || []).map(a => a.name).join(', ');
      const cover =
        b.formats?.['image/jpeg'] ||
        b.formats?.['image/jpg'] ||
        '';
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
    console.error('Gutenberg search error:', e.message);
    return [];
  }
}

/**
 * Open Library — return items we can open INSIDE our site.
 * Try strict (public_scan_b=true) first, then relax to has_fulltext=true.
 */
async function searchOpenLibrary(q) {
  try {
    const mkParams = (strict) =>
      `has_fulltext=true&mode=ebooks${strict ? '&public_scan_b=true' : ''}&limit=60`;

    const fetchSet = async (strict) => {
      const params = mkParams(strict);
      const urlQ     = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&${params}`;
      const urlTitle = `https://openlibrary.org/search.json?title=${encodeURIComponent(q)}&${params}`;

      const r1 = await withRetry(async () => (await http.get(urlQ)).data, strict ? 'ol strict q' : 'ol loose q');
      const r2 = await withRetry(async () => (await http.get(urlTitle)).data, strict ? 'ol strict title' : 'ol loose title');

      const docsRaw = []
        .concat(Array.isArray(r1?.docs) ? r1.docs : [])
        .concat(Array.isArray(r2?.docs) ? r2.docs : []);
      return uniqBy(docsRaw, d => `${d.key || ''}|${(d.title || '').toLowerCase()}`);
    };

    let docs = await fetchSet(true);
    if (!docs.length) {
      docs = await fetchSet(false);
    }

    const mkOLCard = (iaId, d) => {
      const title  = d?.title || 'Untitled';
      const author = Array.isArray(d?.author_name) ? d.author_name.join(', ') : (d?.author_name || '');
      const cover =
        d?.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
                   : (iaId ? `https://iiif.archive.org/iiif/${iaId}/full/400,/0/default.jpg` : '');
      return card({
        identifier: `openlibrary:${(d?.key || (Array.isArray(d?.edition_key) ? d.edition_key[0] : title)).replace(/\//g,'_')}`,
        title,
        creator: author,
        cover,
        readerUrl: iaId ? archiveReader(iaId, 1) : '',
        source: 'openlibrary',
        archiveId: iaId || ''
      });
    };

    const direct = [], editions = [];
    for (const d of docs) {
      if (Array.isArray(d.ia) && d.ia.length > 0) {
        direct.push(mkOLCard(d.ia[0], d));
      } else if (Array.isArray(d.edition_key) && d.edition_key.length > 0) {
        editions.push({ d, ed: d.edition_key[0] });
      }
    }

    // Follow up a batch of editions to pull ocaid (IA id)
    const maxFollowups = 50;
    const fetched = await Promise.allSettled(
      editions.slice(0, maxFollowups).map(({ d, ed }) =>
        withRetry(
          async () => (await http.get(`https://openlibrary.org/books/${encodeURIComponent(ed)}.json`, { timeout: 15000 })).data,
          'ol edition'
        ).then(data => ({ d, ed, data }))
      )
    );

    const viaEd = [];
    for (const f of fetched) {
      if (f.status !== 'fulfilled' || !f.value) continue;
      const edJson = f.value.data || {};
      let iaId = null;
      if (typeof edJson.ocaid === 'string' && edJson.ocaid.trim()) {
        iaId = edJson.ocaid.trim();
      } else if (Array.isArray(edJson.source_records)) {
        const iaSrc = edJson.source_records.find(s => typeof s === 'string' && s.startsWith('ia:'));
        if (iaSrc) iaId = iaSrc.replace(/^ia:/, '').trim();
      }
      if (iaId) viaEd.push(mkOLCard(iaId, f.value.d));
    }

    const merged = uniqBy([...direct, ...viaEd], b => `${b.archiveId}|${(b.title||'').toLowerCase()}|${(b.creator||'').toLowerCase()}`)
      .slice(0, 60);

    console.log(`[OL] q="${q}" direct:${direct.length} viaEditions:${viaEd.length} -> ${merged.length}`);
    return merged;
  } catch (e) {
    console.error('OpenLibrary search error:', e.message);
    return [];
  }
}

// ---------- READ LIST / SEARCH ----------
router.get('/read', async (req, res) => {
  const query = (req.query.query || '').trim();

  // No query: show local admin-curated latest (if any)
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
          archiveId: ''
        })
      );
      return res.render('read', { books: normalized, query });
    } catch (e) {
      console.error('Read (no query) error:', e);
      return res.render('read', { books: [], query });
    }
  }

  // With query: fan out to 3 sources with resilience
  try {
    const [arch = [], gut = [], ol = []] = await Promise.all([
      searchArchive(query),
      searchGutenberg(query),
      searchOpenLibrary(query),
    ]);

    console.log(`READ SEARCH "${query}" — archive:${arch.length} gutenberg:${gut.length} openlibrary:${ol.length}`);

    let books = []
      .concat(arch, gut, ol)
      .filter(b => b && (b.title || b.identifier));

    // If absolutely nothing came back, try a last-chance Gutenberg re-query
    if (!books.length) {
      const gut2 = await searchGutenberg(query + ' ');
      console.log(`READ SEARCH fallback gutendex -> ${gut2.length}`);
      books = books.concat(gut2);
    }

    // De-dupe by (title + creator). Prefer entries with cover + readerUrl.
    const seen = new Map();
    for (const b of books) {
      const key = `${(b.title || '').toLowerCase()}|${(b.creator || '').toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, b);
      } else {
        const prev = seen.get(key);
        const score = (x) => (x.cover ? 1 : 0) + (x.readerUrl ? 1 : 0) + (x.archiveId ? 1 : 0);
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

// ---------- GUTENBERG WRAPPERS ----------
router.get('/read/gutenberg/:gid', async (req, res) => {
  // Redirect the simple route to the reader UI so users always get the better template
  const gid = req.params.gid;
  const u = (req.query.u || '').trim();
  const fallback = `https://www.gutenberg.org/ebooks/${gid}`;
  const viewerUrl = u || fallback;
  return res.redirect(`/read/gutenberg/${encodeURIComponent(gid)}/reader?u=${encodeURIComponent(viewerUrl)}`);
});

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
 * Gutenberg Proxy (keeps our domain in the bar, rewrites in-site links)
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
      timeout: 20000
    });
    const contentType = resp.headers['content-type'] || 'text/html; charset=utf-8';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', contentType);
    if (!contentType.includes('text/html')) return res.send(resp.data);

    let html = resp.data.toString('utf8');
    // Strip inline CSP
    html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/ig, '');
    // Inject base + basic readability CSS
    const baseHref = new URL('.', target).toString();
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
    // Re-proxy internal Gutenberg navigation
    const proxify = (absUrl) => `/read/gutenberg/${encodeURIComponent(gid)}/proxy?u=${encodeURIComponent(absUrl)}`;
    html = html.replace(/(<a\b[^>]*\shref=)(['"])([^'"]+)\2/gi, (m, p1, q, url) => {
      try {
        if (/^\s*javascript:/i.test(url)) return m;
        const abs = new URL(url, baseHref).toString();
        const u = new URL(abs);
        if (u.hostname.endsWith('gutenberg.org')) return `${p1}${q}${proxify(abs)}${q}`;
        return m;
      } catch { return m; }
    });
    html = html.replace(/(<form\b[^>]*\saction=)(['"])([^'"]*)\2/gi, (m, p1, q, url) => {
      try {
        if (!url) return m;
        const abs = new URL(url, baseHref).toString();
        const u = new URL(abs);
        if (u.hostname.endsWith('gutenberg.org')) return `${p1}${q}${proxify(abs)}${q}`;
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
