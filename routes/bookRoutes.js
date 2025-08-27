// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

/* ───────── Helpers ───────── */
function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title, creator, cover, source, readerUrl, archiveId };
}
function requireUser(req, res, next){
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

/* ───────── Standard Ebooks connector ───────── */
let searchStandardEbooks = null;
try {
  const se = require('../connectors/standardebooks');
  searchStandardEbooks = typeof se === 'function' ? se : se.search;
} catch {
  searchStandardEbooks = async () => [];
}

/* ───────── Open Library (readable leaning) ───────── */
async function searchOpenLibraryReadable(q, { limit = 40 } = {}) {
  const u = `https://openlibrary.org/search.json?mode=ebooks&has_fulltext=true&limit=${limit}&q=${encodeURIComponent(q)}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`OL ${r.status}`);
  const data = await r.json();
  const docs = Array.isArray(data.docs) ? data.docs : [];

  return docs.map(d => {
    const id = d.key || d.work_key || d.edition_key?.[0] || '';
    const author = Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || '');
    let cover = '';
    if (d.cover_i) cover = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
    else if (d.edition_key && d.edition_key[0]) cover = `https://covers.openlibrary.org/b/olid/${d.edition_key[0]}-M.jpg`;

    const iaId = Array.isArray(d.ia) && d.ia.length ? d.ia[0] : null;
    const publicScan = !!d.public_scan_b && !!iaId;

    const readerUrl = publicScan
      ? `/read/book/${encodeURIComponent(iaId)}`
      : `/read?query=${encodeURIComponent(`${d.title || ''} ${author || ''}`)}`;

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

/* ───────── Gutenberg (Gutendex) ───────── */
async function searchGutenberg(q, { limit = 40 } = {}) {
  const url = `https://gutendex.com/books?search=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Gutendex ${r.status}`);
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

/* ───────── Internet Archive (public access only) ───────── */
async function searchArchive(q, { rows = 40 } = {}) {
  const query = `(${q}) AND mediatype:texts AND access:public`;
  const api = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=${rows}&page=1&output=json`;
  const r = await fetch(api);
  if (!r.ok) throw new Error(`IA ${r.status}`);
  const data = await r.json();
  const docs = data?.response?.docs || [];
  return docs.map(d => {
    const id = d.identifier;
    return card({
      identifier: `archive:${id}`,
      title: d.title || '(Untitled)',
      creator: d.creator || '',
      cover: `https://archive.org/services/img/${id}`,
      source: 'archive',
      readerUrl: `/read/book/${encodeURIComponent(id)}`,
      archiveId: id
    });
  });
}

/* ───────── /read (search) ───────── */
router.get('/read', async (req, res) => {
  const query = (req.query.query || '').trim();
  if (!query) {
    return res.render('read', {
      pageTitle: 'Read Books Online',
      pageDescription: 'Browse and read books fetched from multiple free sources using BookLantern’s modern reader experience.',
      books: [],
      query
    });
  }

  const safe = async (label, fn) => {
    try { return await fn(); }
    catch (e) { console.warn(`[search] ${label} failed:`, e?.message || e); return []; }
  };

  try {
    const [gb, ia, ol, se] = await Promise.all([
      safe('gutenberg', () => searchGutenberg(query, { limit: 32 })),
      safe('archive',   () => searchArchive(query,   { rows: 40 })),
      safe('openlib',   () => searchOpenLibraryReadable(query, { limit: 40 })),
      safe('std-ebooks',() => searchStandardEbooks(query, { limit: 24 }))
    ]);

    const books = [...gb, ...ia, ...ol, ...se];
    console.log(`READ SEARCH "${query}" — gutenberg:${gb.length} archive:${ia.length} openlibrary:${ol.length} standardebooks:${se.length} merged:${books.length}`);

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
      query,
      error: 'Something went wrong. Please try again.'
    });
  }
});

/* ───────── IA reader (internal) ───────── */
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
  } catch {}

  return res.render('book-viewer', {
    iaId: id,
    title,
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`
  });
});

/* ───────── Gutenberg reader (TEXT/HTML) ───────── */
router.get('/read/gutenberg/:gid/reader', requireUser, (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
  return res.render('unified-reader', {
    mode: 'gutenberg',
    src: `/read/gutenberg/${gid}/text`,
    pageTitle: `Read • #${gid}`,
    pageDescription: 'Distraction-free reading'
  });
});

router.get('/read/gutenberg/:gid/text', requireUser, async (req, res) => {
  try{
    const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
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
      pick('text/plain; charset=utf-8','text/plain; charset=us-ascii','text/plain') ||
      pick('text/html; charset=utf-8','text/html','application/xhtml+xml');

    if (!url) return res.status(404).json({ error:'No readable format found' });

    const bookR = await fetch(url, { redirect:'follow' });
    const ctype = (bookR.headers.get('content-type') || '').toLowerCase();
    const raw = await bookR.text();

    res.setHeader('Cache-Control','public, max-age=600');
    if (ctype.includes('html') || /<\/?[a-z][\s\S]*>/i.test(raw)) {
      return res.json({ type:'html', content: raw, title });
    } else {
      return res.json({ type:'text', content: raw, title });
    }
  }catch(err){
    console.error('gutenberg text error:', err);
    return res.status(502).json({ error:'Fetch failed' });
  }
});

/* ───────── Generic HTML proxy for on-site reading (SE, Wikisource, etc.) ───────── */
router.get('/read/html', requireUser, async (req, res) => {
  try{
    const raw = String(req.query.u || '').trim();
    if (!raw) return res.status(400).json({ error:'Missing URL' });
    // very small allowlist
    const ok = /^https:\/\/(standardebooks\.org|.*wikisource\.org)\//i.test(raw);
    if (!ok) return res.status(400).json({ error:'Host not allowed' });

    const r = await fetch(raw, { redirect:'follow' });
    if (!r.ok) throw new Error('fetch failed');
    let html = await r.text();

    // crude sanitization: strip script/style
    html = html.replace(/<script[\s\S]*?<\/script>/gi,'')
               .replace(/<style[\s\S]*?<\/style>/gi,'');

    // try to pull <title>
    const title = (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g,' ').trim();

    res.setHeader('Cache-Control','public, max-age=600');
    return res.json({ title, html });
  }catch(err){
    console.error('html proxy error:', err);
    return res.status(502).json({ error:'Proxy failed' });
  }
});

/* ───────── Standard Ebooks reader (HTML mode) ───────── */
router.get('/read/se/:slug/reader', requireUser, (req, res) => {
  const url = String(req.query.u || '').trim();
  return res.render('unified-reader', {
    mode: 'html',
    src: `/read/html?u=${encodeURIComponent(url)}`,
    pageTitle: 'Read • Standard Ebooks',
    pageDescription: 'Distraction-free reading'
  });
});

module.exports = router;
