// routes/bookRoutes.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

let Bookmark = null;
let Favorite = null;
let Book = null;
try { Bookmark = require('../models/Bookmark'); } catch (_) {}
try { Favorite = require('../models/Favorite'); } catch (_) {}
try { Book     = require('../models/Book'); } catch (_) {}

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
  archiveId = '' // for OL items that open via Archive viewer
}) {
  return { identifier, title, creator, cover, readerUrl, source, description, archiveId };
}
const archiveCover  = (id) => `https://archive.org/services/img/${id}`;
const archiveReader = (id, page = 1) => `https://archive.org/stream/${id}?ui=embed#page=${page}`;

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of (arr || [])) {
    try {
      const k = keyFn(it);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    } catch (_) { /* skip bad rows */ }
  }
  return out;
}

// ---------- external fetchers ----------
async function searchArchive(q) {
  try {
    const query = encodeURIComponent(`(${q}) AND mediatype:texts AND access-restricted:false`);
    const fields = ['identifier', 'title', 'creator', 'description', 'publicdate', 'access-restricted'].join(',');
    const url = `https://archive.org/advancedsearch.php?q=${query}&fl[]=${fields}&rows=40&page=1&output=json`;
    const { data } = await http.get(url);
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
    console.error('Archive search error:', e?.message || e);
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
    console.error('Gutenberg search error:', e?.message || e);
    return [];
  }
}

/**
 * Open Library — return items we can open INSIDE our site.
 */
async function searchOpenLibrary(q) {
  try {
    const params = `has_fulltext=true&public_scan_b=true&mode=ebooks&limit=50`;
    const urlQ     = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&${params}`;
    const urlTitle = `https://openlibrary.org/search.json?title=${encodeURIComponent(q)}&${params}`;

    const [r1, r2] = await Promise.allSettled([http.get(urlQ), http.get(urlTitle)]);
    const docsRaw = []
      .concat(r1.status === 'fulfilled' ? (r1.value.data?.docs || []) : [])
      .concat(r2.status === 'fulfilled' ? (r2.value.data?.docs || []) : []);
    const docs = uniqBy(docsRaw, d => `${d?.key || ''}|${(d?.title || '').toLowerCase()}`);

    const mkOLCard = (iaId, d) => {
      const title  = d?.title || 'Untitled';
      const author = Array.isArray(d?.author_name) ? d.author_name.join(', ') : (d?.author_name || '');
      const cover =
        d?.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
                   : `https://iiif.archive.org/iiif/${iaId}/full/400,/0/default.jpg`;
      return card({
        identifier: `openlibrary:${(d?.key || (Array.isArray(d?.edition_key) ? d.edition_key[0] : title)).replace(/\//g,'_')}`,
        title,
        creator: author,
        cover,
        readerUrl: archiveReader(iaId, 1),
        source: 'openlibrary',
        archiveId: iaId
      });
    };

    const direct = [];
    const editions = [];
    for (const d of docs) {
      if (Array.isArray(d?.ia) && d.ia.length > 0) {
        direct.push(mkOLCard(d.ia[0], d));
      } else if (Array.isArray(d?.edition_key) && d.edition_key.length > 0) {
        editions.push({ d, ed: d.edition_key[0] });
      }
    }

    const maxFollowups = 60;
    const fetched = await Promise.allSettled(
      editions.slice(0, maxFollowups).map(({ d, ed }) =>
        http.get(`https://openlibrary.org/books/${encodeURIComponent(ed)}.json`, { timeout: 12000 })
          .then(r => ({ d, ed, data: r.data }))
      )
    );

    const viaEd = [];
    for (const f of fetched) {
      if (f.status !== 'fulfilled') continue;
      const edJson = f.value?.data || {};
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
      .slice(0, 50);

    console.log(`[OL] q="${q}" direct:${direct.length} viaEditions:${viaEd.length} -> ${merged.length}`);
    return merged;
  } catch (e) {
    console.error('OpenLibrary search error:', e?.message || e);
    return [];
  }
}

// ---------- READ LIST / SEARCH ----------
router.get('/read', async (req, res) => {
  const query = (req.query.query || '').trim();

  // No query: show local/admin-curated books if model present
  if (!query) {
    try {
      let normalized = [];
      if (Book) {
        const books = await Book.find({}).sort({ createdAt: -1 }).limit(24).lean();
        normalized = (books || []).map(b =>
          card({
            identifier: String(b._id || ''),
            title: b.title || '',
            creator: b.author || '',
            cover: b.coverImage || '',
            readerUrl: b.sourceUrl || '',
            source: 'local',
            description: b.description || '',
            archiveId: ''
          })
        );
      }
      return res.render('read', { books: normalized, query });
    } catch (e) {
      console.error('Read (no query) error:', e?.message || e);
      return res.render('read', { books: [], query });
    }
  }

  // With a query: merge three sources
  try {
    const [arch = [], gut = [], ol = []] = await Promise.allSettled([
      searchArchive(query),
      searchGutenberg(query),
      searchOpenLibrary(query),
    ]).then(all =>
      all.map(x => (x.status === 'fulfilled' ? x.value : []))
    );

    console.log(`READ SEARCH "${query}" — archive:${arch.length} gutenberg:${gut.length} openlibrary:${ol.length}`);

    let books = []
      .concat(arch, gut, ol)
      .filter(b => b && (b.title || b.identifier));

    // De-dupe by (title + creator). Prefer entries with cover + readerUrl.
    const seen = new Map();
    for (const b of books) {
      try {
        const key = `${(b.title || '').toLowerCase()}|${(b.creator || '').toLowerCase()}`;
        if (!seen.has(key)) {
          seen.set(key, b);
        } else {
          const prev = seen.get(key);
          const score = (x) => (x.cover ? 1 : 0) + (x.readerUrl ? 1 : 0);
          if (score(b) > score(prev)) seen.set(key, b);
        }
      } catch (_) {}
    }
    books = Array.from(seen.values()).slice(0, 60);

    return res.render('read', { books, query });
  } catch (err) {
    console.error('Read search fatal error:', err?.message || err);
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
    if (req.session.user && Favorite) {
      const byArchive = await Favorite.exists({
        user: req.session.user._id,
        archiveId: identifier,
      });
      // keep compatibility with local Book favorites if ever used:
      const byBook = await Favorite.exists({ user: req.session.user._id });
      isFavorite = !!(byArchive || byBook);
    }
  } catch (e) {
    console.error('Favorite lookup error:', e?.message || e);
  }

  const book = { title: identifier, archiveId: identifier };
  return res.render('book-viewer', {
    book,
    isFavorite,
    user: req.session.user || null,
  });
});

// ---------- GUTENBERG WRAPPERS ----------
router.get('/read/gutenberg/:gid', (req, res) => {
  const gid = req.params.gid;
  const u = (req.query.u || '').trim();
  const fallback = `https://www.gutenberg.org/ebooks/${gid}`;
  const viewerUrl = u || fallback;
  return res.redirect(`/read/gutenberg/${encodeURIComponent(gid)}/reader?u=${encodeURIComponent(viewerUrl)}`);
});

router.get('/read/gutenberg/:gid/reader', (req, res) => {
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

// Proxy keeps Gutenberg inside our chrome, rewrites links/forms
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
    if (!contentType.includes('text/html')) return res.send(resp.data);

    let html = resp.data.toString('utf8');
    html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/ig, '');
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
    console.error('Gutenberg proxy error:', e?.message || e);
    return res.status(502).send('Failed to load book');
  }
});

// ---------- BOOKMARKS (ARCHIVE-ONLY) ----------
router.post('/read/book/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  if (!Bookmark) return res.status(500).send('Bookmarks not available');
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
    console.error('Bookmark error:', err?.message || err);
    res.status(500).send('Server error');
  }
});

router.get('/read/book/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  if (!Bookmark) return res.status(500).json({ page: 1 });
  try {
    const bookmark = await Bookmark.findOne({
      user: req.session.user._id,
      archiveId: req.params.identifier,
    });
    res.json({ page: bookmark?.currentPage || 1 });
  } catch (err) {
    console.error('Bookmark fetch error:', err?.message || err);
    res.status(500).send('Error loading bookmark');
  }
});

// ---------- FAVORITES TOGGLE (ARCHIVE-ONLY HERE) ----------
router.post('/read/book/:identifier/favorite', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  if (!Favorite) return res.status(500).send('Favorites not available');
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
    console.error('Favorite toggle error:', err?.message || err);
    res.status(500).send('Failed to toggle favorite');
  }
});

module.exports = router;
