// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

/* ----------------------------- helpers ----------------------------- */
function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title, creator, cover, source, readerUrl, archiveId };
}
function requireUser(req, res, next) {
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

/* ----------------------------- connectors -------------------------- */
// Our own simple IA search (kept for breadth)
async function searchArchive(q, rows = 40) {
  const api = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
    `${q} AND mediatype:texts`
  )}&fl[]=identifier&fl[]=title&fl[]=creator&rows=${rows}&page=1&output=json`;
  try {
    const r = await fetch(api, { redirect: 'follow' });
    if (!r.ok) throw new Error(`IA status ${r.status}`);
    const data = await r.json();
    const docs = data?.response?.docs || [];
    return docs.map((d) => {
      const id = d.identifier;
      const title = d.title || '(Untitled)';
      const author = d.creator || '';
      const cover = `https://archive.org/services/img/${id}`;
      return card({
        identifier: `archive:${id}`,
        title,
        creator: author,
        cover,
        source: 'archive',
        readerUrl: `/read/book/${encodeURIComponent(id)}`,
        archiveId: id,
      });
    });
  } catch (err) {
    console.error('[IA] search error:', err?.message || err);
    return [];
  }
}

// External connector modules
const { searchGutenberg } = require('../connectors/gutenberg');           // already in your repo
const { searchWikisource } = require('../connectors/wikisource');         // already in your repo
const { searchStandardEbooks } = require('../connectors/standardebooks'); // already in your repo
const { searchFeedbooks } = require('../connectors/feedbooks');           // already in your repo
const { searchOpenLibraryReadable } = require('../connectors/openlibrary');// NEW
const { searchLOC } = require('../connectors/loc');                        // NEW
const { searchHathiFullView } = require('../connectors/hathitrust');       // NEW (scaffold)

/* ------------------------------- /read ------------------------------ */
router.get('/read', async (req, res) => {
  try {
    const query = (req.query.query || '').trim();
    if (!query) {
      return res.render('read', {
        pageTitle: 'Read Books Online',
        pageDescription: 'Browse and read books fetched from multiple free sources using BookLantern’s modern reader experience.',
        books: [],
        query,
      });
    }

    // Run connectors in parallel; each logs its own errors and returns []
    const tasks = [
      searchStandardEbooks(query).catch((e) => (console.error('[SE] fatal', e?.message || e), [])),
      searchFeedbooks(query).catch((e) => (console.error('[Feedbooks] fatal', e?.message || e), [])),
      searchGutenberg(query).catch((e) => (console.error('[Gutenberg] fatal', e?.message || e), [])),
      searchWikisource(query).catch((e) => (console.error('[Wikisource] fatal', e?.message || e), [])),
      searchLOC(query).catch((e) => (console.error('[LOC] fatal', e?.message || e), [])),
      searchArchive(query).catch((e) => (console.error('[IA] fatal', e?.message || e), [])),
      searchOpenLibraryReadable(query).catch((e) => (console.error('[OpenLibrary] fatal', e?.message || e), [])),
      searchHathiFullView(query).catch((e) => (console.error('[HathiTrust] fatal', e?.message || e), [])),
    ];

    const [
      se, fb, gb, ws, loc, ia, ol, ht
    ] = await Promise.all(tasks);

    const merged = [
      ...se,     // curated epub
      ...gb,     // epub (our reader)
      ...loc,    // PDFs (our viewer)
      ...ws,     // html (our reader)
      ...fb,     // epub/html (if any)
      ...ia,     // scanned books via IA embedded viewer
      ...ol,     // OL public ebooks only
      ...ht      // (scaffold - empty until SRU wired)
    ];

    console.log(
      `READ SEARCH "${query}" — se:${se.length} feedbooks:${fb.length} ` +
      `gutenberg:${gb.length} wikisource:${ws.length} loc:${loc.length} ` +
      `archive:${ia.length} openlibrary:${ol.length} hathitrust:${ht.length} merged:${merged.length}`
    );

    return res.render('read', {
      pageTitle: `Search • ${query}`,
      pageDescription: `Results for “${query}”`,
      books: merged,
      query,
    });
  } catch (err) {
    console.error('Read search error:', err);
    return res.status(500).render('read', {
      pageTitle: 'Read Books Online',
      pageDescription: 'Browse and read books fetched from multiple free sources using BookLantern’s modern reader experience.',
      books: [],
      query: req.query.query || '',
      error: 'Something went wrong. Please try again.',
    });
  }
});

/* -------------------- Internet Archive internal view ------------------- */
router.get('/read/book/:identifier', requireUser, async (req, res) => {
  const id = String(req.params.identifier || '').trim();
  if (!id) return res.redirect('/read');

  let title = id;
  try {
    const metaR = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`);
    if (metaR.ok) {
      const meta = await metaR.json();
      if (meta?.metadata?.title) title = meta.metadata.title;
    }
  } catch (_) {}
  return res.render('book-viewer', {
    iaId: id,
    title,
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`,
  });
});

/* --------------------- Gutenberg reader (internal) --------------------- */
router.get('/read/gutenberg/:gid/reader', requireUser, (req, res) => {
  const gid = String(req.params.gid || '').trim();
  const startUrl =
    typeof req.query.u === 'string' && req.query.u
      ? req.query.u
      : `https://www.gutenberg.org/ebooks/${gid}`;
  return res.render('unified-reader', {
    gid,
    startUrl,
    pageTitle: `Read • #${gid}`,
    pageDescription: 'Distraction-free reading',
  });
});

// Server-side text provider (Gutenberg)
router.get('/read/gutenberg/:gid/text', requireUser, async (req, res) => {
  try {
    const gid = String(req.params.gid || '').trim();
    const metaR = await fetch(`https://gutendex.com/books/${gid}`);
    if (!metaR.ok) throw new Error('meta not ok');
    const meta = await metaR.json();
    const title = meta?.title || `Project Gutenberg #${gid}`;
    const formats = meta?.formats || {};

    const pick = (...keys) => {
      for (const k of keys) {
        const url = formats[k];
        if (url && !/\.zip($|\?)/i.test(url)) return url;
      }
      return null;
    };

    const url =
      pick('text/plain; charset=utf-8', 'text/plain; charset=us-ascii', 'text/plain') ||
      pick('text/html; charset=utf-8', 'text/html', 'application/xhtml+xml');

    if (!url) return res.status(404).json({ error: 'No readable format found' });

    const bookR = await fetch(url, { redirect: 'follow' });
    const ctype = (bookR.headers.get('content-type') || '').toLowerCase();
    const raw = await bookR.text();

    res.setHeader('Cache-Control', 'public, max-age=600');
    if (ctype.includes('html') || /<\/?[a-z][\s\S]*>/i.test(raw)) {
      return res.json({ type: 'html', content: raw, title });
    } else {
      return res.json({ type: 'text', content: raw, title });
    }
  } catch (err) {
    console.error('gutenberg text error:', err);
    return res.status(502).json({ error: 'Fetch failed' });
  }
});

/* ------------------------- PDF reader & proxy -------------------------- */
// Simple PDF reader shell
router.get('/read/pdf', requireUser, (req, res) => {
  const url = String(req.query.u || '');
  if (!/^https?:\/\//i.test(url)) return res.status(400).send('Bad URL');
  res.render('pdf-viewer', {
    url,
    title: req.query.title || '',
    pageTitle: `Read • PDF`,
    pageDescription: 'PDF document',
  });
});

// Stream PDF through our server to avoid iframe/X-Frame issues
router.get('/proxy/pdf', requireUser, async (req, res) => {
  try {
    const url = String(req.query.u || '');
    if (!/^https?:\/\//i.test(url)) return res.status(400).send('Bad URL');
    const upstream = await fetch(url, { redirect: 'follow' });
    if (!upstream.ok) {
      console.error('[PDF proxy] upstream status', upstream.status, 'for', url);
      return res.status(502).send('Upstream error');
    }
    // Pass through basic headers
    const ctype =
      upstream.headers.get('content-type') || 'application/pdf';
    const clen = upstream.headers.get('content-length');
    res.setHeader('Content-Type', ctype);
    if (clen) res.setHeader('Content-Length', clen);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    // Stream
    upstream.body.pipe(res);
  } catch (err) {
    console.error('[PDF proxy] error:', err?.message || err);
    res.status(500).send('Proxy error');
  }
});

module.exports = router;
