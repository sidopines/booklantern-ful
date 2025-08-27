// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

/* ────────────────────────── Helpers / Normalizers ────────────────────────── */

function normalizeCard(c = {}) {
  const title   = String(c.title || '(Untitled)');
  const creator = String(c.creator || c.author || '');
  const cover   = c.cover || '';
  const source  = String(c.source || '').toLowerCase();
  const id      = c.identifier || c.id || '';
  const reader  = c.readerUrl || '#';
  const archiveId = c.archiveId || '';
  return { identifier: id, title, creator, cover, source, readerUrl: reader, archiveId };
}

function uniqBy(arr, key) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = key(x);
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

function requireUser(req, res, next) {
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

/* ─────────────────────────── Connectors (imports) ────────────────────────── */

const { searchGutenberg }        = require('../connectors/gutenberg');
const { searchOpenLibrary }      = require('../connectors/openlibrary');
const { searchStandardEbooks }   = require('../connectors/standardebooks');
const { searchWikisource }       = require('../connectors/wikisource');
const { searchHathiTrust }       = require('../connectors/hathitrust');  // full-view only
const { searchLOC }              = require('../connectors/loc');         // public PDFs
const { searchFeedbooks }        = require('../connectors/feedbooks');   // public-domain shelf

/* ─────────────────────── Internet Archive (direct API) ───────────────────── */

/**
 * We hit IA AdvancedSearch, but exclude access-restricted items to avoid
 * "Limited preview / Borrow" results.
 */
async function searchArchive(query, rows = 40) {
  const q = String(query || '').trim();
  if (!q) return [];
  const lucene = `${q} AND mediatype:texts AND -access-restricted:true`;
  const api = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(lucene)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=${rows}&page=1&output=json`;
  const r = await fetch(api);
  if (!r.ok) return [];
  const data = await r.json();
  const docs = data?.response?.docs || [];
  return docs.map(d => {
    const id    = d.identifier;
    const title = d.title || '(Untitled)';
    const author= d.creator || '';
    const cover = `https://archive.org/services/img/${id}`;
    // Open inside our IA template
    const readerUrl = `/read/book/${encodeURIComponent(id)}`;
    return normalizeCard({
      identifier: `archive:${id}`,
      title, creator: author, cover,
      source: 'archive',
      readerUrl, archiveId: id
    });
  });
}

/* ─────────────────────────────── Search (/read) ───────────────────────────── */

router.get('/read', async (req, res) => {
  try {
    const query = (req.query.query || '').trim();

    if (!query) {
      return res.render('read', {
        pageTitle: 'Read Books Online',
        pageDescription: "Browse and read books fetched from multiple free sources using BookLantern's modern reader experience.",
        books: [],
        query
      });
    }

    // Run all sources in parallel; each safely returns [] on failure.
    const tasks = [
      searchStandardEbooks(query).catch(() => []), // OPDS; EPUB inline
      searchGutenberg(query).catch(() => []),      // EPUB inline (via proxy)
      searchArchive(query).catch(() => []),        // IA readable only
      searchOpenLibrary(query).catch(() => []),    // OL (gated for readable items in its own connector)
      searchWikisource(query).catch(() => []),     // HTML inline
      searchHathiTrust(query).catch(() => []),     // Full-view PDFs
      searchFeedbooks(query).catch(() => []),      // Public-domain EPUBs
      searchLOC(query).catch(() => []),            // Library of Congress PDFs
    ];

    const results = await Promise.all(tasks);
    const flat = results.flat().map(normalizeCard);

    // De-dup by (readerUrl) primarily, then by (identifier)
    const dedup = uniqBy(flat, x => x.readerUrl || x.identifier);

    console.log(
      `READ SEARCH "${query}" — ` +
      `se:${results[0].length} gutenberg:${results[1].length} archive:${results[2].length} ` +
      `openlibrary:${results[3].length} wikisource:${results[4].length} ` +
      `hathi:${results[5].length} feedbooks:${results[6].length} loc:${results[7].length} ` +
      `merged:${dedup.length}`
    );

    return res.render('read', {
      pageTitle: `Search • ${query}`,
      pageDescription: `Results for “${query}”`,
      books: dedup,
      query
    });
  } catch (err) {
    console.error('Read search error:', err);
    return res.status(500).render('read', {
      pageTitle: 'Read Books Online',
      pageDescription: "Browse and read books fetched from multiple free sources using BookLantern's modern reader experience.",
      books: [],
      query: req.query.query || '',
      error: 'Something went wrong. Please try again.'
    });
  }
});

/* ──────────────────────── Internet Archive reader page ────────────────────── */

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
    pageDescription: `Read ${title} on BookLantern`
  });
});

/* ───────────────────────────── EPUB reader routes ─────────────────────────── */

/**
 * Generic EPUB route: accepts ?u=<absolute-epub-url>
 * Used by Standard Ebooks, Feedbooks, etc.
 */
router.get('/read/epub', requireUser, async (req, res) => {
  const epubUrl = String(req.query.u || '').trim();
  const title   = String(req.query.title || 'Book');
  const author  = String(req.query.author || '');
  if (!epubUrl) return res.status(400).send('Missing EPUB URL');

  return res.render('unified-reader', {
    mode: 'epub',
    epubUrl,
    title,
    author,
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`
  });
});

// Gutenberg EPUB proxy (for CORS), and reader

router.get('/proxy/gutenberg-epub/:gid', async (req, res) => {
  try {
    const gid = String(req.params.gid).replace(/[^0-9]/g,'');
    if (!gid) return res.status(400).send('Bad id');
    const urls = [
      `https://www.gutenberg.org/ebooks/${gid}.epub.images?download`,
      `https://www.gutenberg.org/ebooks/${gid}.epub.noimages?download`,
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}-images.epub`,
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.epub`
    ];
    let resp;
    for (const u of urls) {
      resp = await fetch(u, { redirect: 'follow' });
      if (resp.ok) { res.set('Content-Type', 'application/epub+zip'); return resp.body.pipe(res); }
    }
    return res.status(404).send('ePub not found');
  } catch (e) {
    console.error('proxy gutenberg epub err', e);
    res.status(500).send('Proxy error');
  }
});

router.get('/read/gutenberg/:gid/reader', requireUser, (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
  const title  = String(req.query.title || `Gutenberg #${gid}`);
  const author = String(req.query.author || '');
  return res.render('unified-reader', {
    mode: 'epub',
    gid,
    // unified-reader will use the proxy URL when gid is present:
    epubUrl: `/proxy/gutenberg-epub/${gid}`,
    title,
    author,
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`
  });
});

/* ─────────────────────────── Wikisource reader pair ───────────────────────── */

/**
 * HTML reader for Wikisource (we fetch/clean the HTML in the connector route below)
 * We re-use unified-reader with mode 'html'.
 */
router.get('/read/wikisource/:lang/:title/reader', requireUser, (req, res) => {
  const lang  = String(req.params.lang || '');
  const title = decodeURIComponent(String(req.params.title || ''));
  return res.render('unified-reader', {
    mode: 'html',
    wsLang: lang,
    wsTitle: title,
    // The template will request /read/wikisource/:lang/:title/text via fetch()
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`
  });
});

/**
 * Serves cleaned HTML for Wikisource pages to the reader template.
 * The connector exports a "getWikisourceHtml" helper for this purpose.
 */
const { getWikisourceHtml } = require('../connectors/wikisource');
router.get('/read/wikisource/:lang/:title/text', requireUser, async (req, res) => {
  try {
    const lang  = String(req.params.lang || '');
    const title = decodeURIComponent(String(req.params.title || ''));
    const html  = await getWikisourceHtml(lang, title);
    if (!html) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Cache-Control','public, max-age=600');
    return res.json({ html });
  } catch (e) {
    console.error('wikisource html err:', e);
    return res.status(502).json({ error: 'Fetch failed' });
  }
});

module.exports = router;
