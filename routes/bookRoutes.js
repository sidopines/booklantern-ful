// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

// If you have auth middleware and want to gate IA reading, you can import it:
// const { ensureAuthenticated } = require('../middleware/auth');

// Optional local admin-curated model (not required for search)
let Book = null;
try { Book = require('../models/Book'); } catch (_) {}

/* ---------------------------- helpers / normalize --------------------------- */

// Build a unified "card" the views can render
function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title, creator, cover, source, readerUrl, archiveId };
}

/* ------------------------------ Open Library -------------------------------- */

async function searchOpenLibrary(q, limit = 60) {
  const url = `https://openlibrary.org/search.json?mode=everything&limit=${limit}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  const data = await r.json();

  const docs = Array.isArray(data.docs) ? data.docs : [];
  return docs.map(d => {
    const id = d.key || d.work_key || d.edition_key?.[0] || '';
    const author = Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || '');
    let cover = '';
    if (d.cover_i) cover = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
    else if (d.edition_key && d.edition_key[0]) cover = `https://covers.openlibrary.org/b/olid/${d.edition_key[0]}-M.jpg`;
    // For OL, we link back to /read search so users stay in your site
    const readerUrl = `/read?query=${encodeURIComponent(`${d.title || ''} ${author || ''}`)}`;
    return card({
      identifier: `openlibrary:${id}`,
      title: d.title || '(Untitled)',
      creator: author || '',
      cover,
      source: 'openlibrary',
      readerUrl
    });
  });
}

/* -------------------------------- Gutenberg --------------------------------- */

async function searchGutenberg(q, limit = 64) {
  const url = `https://gutendex.com/books?search=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  const data = await r.json();
  const results = Array.isArray(data.results) ? data.results.slice(0, limit) : [];

  return results.map(b => {
    const gid = b.id;
    const title = b.title || '(Untitled)';
    const author = Array.isArray(b.authors) && b.authors[0] ? b.authors[0].name : '';
    const cover = `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.cover.medium.jpg`;
    const startUrl = `https://www.gutenberg.org/ebooks/${gid}`;
    const readerUrl = `/read/gutenberg/${gid}/reader?u=${encodeURIComponent(startUrl)}`;
    return card({
      identifier: `gutenberg:${gid}`,
      title,
      creator: author,
      cover,
      source: 'gutenberg',
      readerUrl
    });
  });
}

/* ----------------------------- Internet Archive ----------------------------- */

async function searchArchive(q, rows = 40) {
  // Simple, book-only text results
  const api = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
    `${q} AND mediatype:texts`
  )}&fl[]=identifier&fl[]=title&fl[]=creator&rows=${rows}&page=1&output=json`;
  const r = await fetch(api);
  const data = await r.json();
  const docs = data?.response?.docs || [];
  return docs.map(d => {
    const id = d.identifier;
    const title = d.title || '(Untitled)';
    const author = d.creator || '';
    const cover = `https://archive.org/services/img/${id}`;
    // For now, link out to IA details; can be swapped to internal viewer easily
    const readerUrl = `https://archive.org/details/${id}`;
    return card({
      identifier: `archive:${id}`,
      title,
      creator: author,
      cover,
      source: 'archive',
      readerUrl,
      archiveId: id
    });
  });
}

/* ------------------------------- READ (search) ------------------------------ */
/**
 * GET /read
 * Renders the search page. With ?query=... it searches OL + Gutenberg + IA.
 */
router.get('/read', async (req, res) => {
  try {
    const query = (req.query.query || '').trim();

    // No query -> render the page with empty results; the view shows "Staff picks"
    if (!query) {
      return res.render('read', {
        pageTitle: 'Read Books Online',
        pageDescription: 'Browse and read books fetched from multiple free sources using BookLantern’s modern reader experience.',
        books: [],
        query
      });
    }

    // Run the three searches in parallel
    const [ol, gb, ia] = await Promise.all([
      searchOpenLibrary(query).catch(() => []),
      searchGutenberg(query).catch(() => []),
      searchArchive(query).catch(() => [])
    ]);

    // Merge — prioritize Gutenberg + Archive first (they’re readable directly),
    // then add Open Library cards.
    const books = [...gb, ...ia, ...ol];

    console.log(`READ SEARCH "${query}" — archive:${ia.length} gutenberg:${gb.length} openlibrary:${ol.length}`);

    return res.render('read', {
      pageTitle: `Search • ${query}`,
      pageDescription: `Results for “${query}”`,
      books,
      query
    });
  } catch (err) {
    console.error('Read search error:', err);
    return res.status(500).render('read', {
      pageTitle: 'Read Books Online',
      pageDescription: 'Browse and read books fetched from multiple free sources using BookLantern’s modern reader experience.',
      books: [],
      query: req.query.query || '',
      error: 'Something went wrong. Please try again.'
    });
  }
});

/* ---------------------------- Internet Archive book ------------------------- */
/**
 * GET /read/book/:identifier
 * Minimal handler that opens the IA details page. If you prefer the internal
 * viewer we built earlier, we can swap this to render `views/book-viewer.ejs`.
 */
router.get('/read/book/:identifier', async (req, res) => {
  const id = String(req.params.identifier || '').trim();
  if (!id) return res.redirect('/read');
  // If you want to require login here, uncomment next line:
  // if (!req.session.user) return res.redirect(`/login?next=${encodeURIComponent('/read/book/' + id)}`);
  return res.redirect(`https://archive.org/details/${encodeURIComponent(id)}`);
});

/* --------------------------- Gutenberg reader + proxy ----------------------- */

// Decide if a URL is a safe Gutenberg origin
function allowGutenberg(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    return ['gutenberg.org', 'gutenberg.net', 'gutenberg.pglaf.org'].includes(host);
  } catch (_) { return false; }
}
function canonicalGutenbergUrl(gid) {
  return `https://www.gutenberg.org/ebooks/${encodeURIComponent(gid)}`;
}

/** Reader shell */
router.get('/read/gutenberg/:gid/reader', (req, res) => {
  const gid = String(req.params.gid || '').trim();
  const startUrl = typeof req.query.u === 'string' && req.query.u ? req.query.u : canonicalGutenbergUrl(gid);
  return res.render('unified-reader', {
    gid,
    startUrl,
    pageTitle: `Read • #${gid}`,
    pageDescription: 'Distraction-free reading'
  });
});

/** Same-origin proxy (HTML only) */
router.get('/read/gutenberg/:gid/proxy', async (req, res) => {
  try {
    const gid = String(req.params.gid || '').trim();
    const q = String(req.query.u || '').trim();
    const target = allowGutenberg(q) ? q : canonicalGutenbergUrl(gid);

    const rsp = await fetch(target, { redirect: 'follow' });
    const html = await rsp.text();

    // Make relative links absolute so images load inside the iframe
    const base = new URL(target);
    const rewritten = html.replace(/(src|href)=["'](\/[^"']*)["']/gi, (m, attr, url) => {
      try { return `${attr}="${new URL(url, base).toString()}"`; } catch { return m; }
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(rewritten);
  } catch (err) {
    console.error('Gutenberg proxy error:', err);
    return res.status(502).send('<!doctype html><meta charset="utf-8"><title>Proxy Error</title><pre>Could not fetch the book page.</pre>');
  }
});

module.exports = router;
