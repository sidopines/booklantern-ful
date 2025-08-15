// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

// Optional: if you want to hard-gate guests before reading IA books, we can
// perform that check directly in the route (implemented below).

/* ---------------------------- helpers / normalize --------------------------- */
function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title, creator, cover, source, readerUrl, archiveId };
}

/* -------------------------------- Open Library ------------------------------ */
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
    const readerUrl = `/read/book/${encodeURIComponent(id)}`;
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
router.get('/read', async (req, res) => {
  try {
    const query = (req.query.query || '').trim();
    if (!query) {
      return res.render('read', {
        pageTitle: 'Read Books Online',
        pageDescription: 'Browse and read books fetched from multiple free sources using BookLantern’s modern reader experience.',
        books: [],
        query
      });
    }
    const [ol, gb, ia] = await Promise.all([
      searchOpenLibrary(query).catch(() => []),
      searchGutenberg(query).catch(() => []),
      searchArchive(query).catch(() => [])
    ]);
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

/* ------------------------ Internet Archive INTERNAL VIEW -------------------- */
/**
 * GET /read/book/:identifier
 * Renders an embedded Internet Archive BookReader inside BookLantern.
 * Guests are gated to login first.
 */
router.get('/read/book/:identifier', async (req, res) => {
  const id = String(req.params.identifier || '').trim();
  if (!id) return res.redirect('/read');

  // Gate guests to login/register
  if (!req.session?.user) {
    return res.redirect(`/login?next=${encodeURIComponent('/read/book/' + id)}`);
  }

  // Fetch minimal metadata for title (best effort)
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

/* --------------------------- Gutenberg reader + proxy ----------------------- */
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

router.get('/read/gutenberg/:gid/proxy', async (req, res) => {
  try {
    const gid = String(req.params.gid || '').trim();
    const q = String(req.query.u || '').trim();
    const target = allowGutenberg(q) ? q : canonicalGutenbergUrl(gid);
    const rsp = await fetch(target, { redirect: 'follow' });
    const html = await rsp.text();
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
