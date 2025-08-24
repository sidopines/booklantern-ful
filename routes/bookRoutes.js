// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

/* -------------------- tiny fetch helpers with timeout + UA ----------------- */
const UA = 'BookLantern/1.0 (+https://booklantern.org)';
async function fetchJson(url, opts = {}, timeoutMs = 10000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
      signal: ac.signal,
      ...opts
    });
    if (!res.ok) throw new Error(`bad status ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}
async function fetchText(url, opts = {}, timeoutMs = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
      signal: ac.signal,
      ...opts
    });
    if (!res.ok) throw new Error(`bad status ${res.status}`);
    return { text: await res.text(), ctype: (res.headers.get('content-type') || '').toLowerCase() };
  } finally { clearTimeout(t); }
}

/* --------------------------------- helpers --------------------------------- */
function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title, creator, cover, source, readerUrl, archiveId };
}
function onlyUnique(arr) { return Array.from(new Set(arr.filter(Boolean))); }

/* --------------------------- Internet Archive search ----------------------- */
/** Keep only OPEN texts (no borrow / limited preview). */
async function searchArchive(q, rows = 48) {
  const query = `${q} AND mediatype:texts AND -collection:(inlibrary) AND -access-restricted-item:true`;
  const api = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=${rows}&page=1&output=json`;
  const data = await fetchJson(api);
  const docs = data?.response?.docs || [];
  return docs.map(d => {
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
      archiveId: id
    });
  });
}

/* ------------------------------ Gutenberg search --------------------------- */
async function searchGutenberg(q, limit = 64) {
  const url = `https://gutendex.com/books?search=${encodeURIComponent(q)}`;
  const data = await fetchJson(url);
  const results = Array.isArray(data.results) ? data.results.slice(0, limit) : [];
  return results.map(b => {
    const gid = b.id;
    const title = b.title || '(Untitled)';
    const author = Array.isArray(b.authors) && b.authors[0] ? b.authors[0].name : '';
    const cover = `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.cover.medium.jpg`;
    return card({
      identifier: `gutenberg:${gid}`,
      title,
      creator: author,
      cover,
      source: 'gutenberg',
      readerUrl: `/read/gutenberg/${gid}/reader`
    });
  });
}

/* --------------------------- Open Library search --------------------------- */
/**
 * 1) Search OL
 * 2) Batch-check availability for edition keys
 * 3) Keep only editions with full open access (is_readable)
 * 4) Resolve IA id (ocaid) to open inside our /read/book/:identifier
 */
async function searchOpenLibrary(q, limit = 60) {
  const url = `https://openlibrary.org/search.json?mode=everything&limit=${limit}&q=${encodeURIComponent(q)}`;
  const data = await fetchJson(url);
  const docs = Array.isArray(data.docs) ? data.docs : [];
  if (!docs.length) return [];

  // Collect edition keys to check availability
  const ek = onlyUnique(
    docs.flatMap(d => Array.isArray(d.edition_key) ? d.edition_key.slice(0, 1) : (d.edition_key ? [d.edition_key] : []))
  );
  const batch = ek.slice(0, 50).map(k => `OLID:${k}`).join(',');
  let avail = {};
  if (batch) {
    // availability api: jscmd=availability
    const av = await fetchJson(`https://openlibrary.org/api/books?bibkeys=${batch}&format=json&jscmd=availability`);
    avail = av || {};
  }

  // Helper to resolve IA id (ocaid) for an edition
  async function resolveOcaid(olid) {
    try {
      const ed = await fetchJson(`https://openlibrary.org/books/${olid}.json`);
      return ed?.ocaid || null;
    } catch (_) { return null; }
  }

  const out = [];
  for (const d of docs) {
    const title = d.title || '(Untitled)';
    const author = Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || '');
    const cover = d.cover_i
      ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
      : (d.edition_key && d.edition_key[0]
          ? `https://covers.openlibrary.org/b/olid/${d.edition_key[0]}-M.jpg`
          : '');

    const ek0 = Array.isArray(d.edition_key) ? d.edition_key[0] : d.edition_key;
    if (!ek0) continue;

    const a = avail[`OLID:${ek0}`]?.availability;
    const isReadable = a?.is_readable || a?.status === 'full access' || a?.status === 'open';
    if (!isReadable) continue; // drop borrow/preview items

    // Try to get an IA id quickly
    let ia = null;
    if (Array.isArray(d.ia) && d.ia[0]) ia = d.ia[0];
    if (!ia && d.ocaid) ia = d.ocaid;
    if (!ia) ia = await resolveOcaid(ek0);
    if (!ia) continue; // if we can't read it internally, skip it

    out.push(card({
      identifier: `openlibrary:${d.key || ek0}`,
      title,
      creator: author || '',
      cover,
      source: 'openlibrary',
      readerUrl: `/read/book/${encodeURIComponent(ia)}`,
      archiveId: ia
    }));
  }
  return out;
}

/* --------------------------------- /read ----------------------------------- */
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
    // Parallel, each guarded
    const [ol, gb, ia] = await Promise.all([
      searchOpenLibrary(query).catch(() => []),
      searchGutenberg(query).catch(() => []),
      searchArchive(query).catch(() => [])
    ]);

    // Merge with preference: Gutenberg (internal), IA (open), OL (open)
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

/* ------------------------ Internet Archive internal view ------------------- */
router.get('/read/book/:identifier', async (req, res) => {
  const id = String(req.params.identifier || '').trim();
  if (!id) return res.redirect('/read');
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent('/read/book/' + id)}`);

  let title = id;
  try {
    const meta = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(id)}`);
    if (meta?.metadata?.title) title = meta.metadata.title;
  } catch (_) {}
  return res.render('book-viewer', {
    iaId: id,
    title,
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`
  });
});

/* ----------------------------- Auth guard helper --------------------------- */
function requireUser(req, res, next){
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

/* ── Gutenberg: ePub proxy (avoids CORS) ──────────────────────────────────── */
router.get('/proxy/gutenberg-epub/:gid', async (req, res) => {
  try {
    const gid = String(req.params.gid).replace(/[^0-9]/g,'');
    if (!gid) return res.status(400).send('Bad id');

    const candidates = [
      `https://www.gutenberg.org/ebooks/${gid}.epub.images?download`,
      `https://www.gutenberg.org/ebooks/${gid}.epub.noimages?download`,
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}-images.epub`,
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.epub`
    ];

    for (const u of candidates) {
      try {
        const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': UA } });
        if (r.ok && (r.headers.get('content-type') || '').includes('epub')) {
          res.set('Content-Type', 'application/epub+zip');
          return r.body.pipe(res);
        }
      } catch (_) {}
    }
    return res.status(404).send('ePub not found');
  } catch (e) {
    console.error('proxy gutenberg epub err', e);
    res.status(500).send('Proxy error');
  }
});

/* ── Gutenberg: reader page (our unified reader) ──────────────────────────── */
router.get('/read/gutenberg/:gid/reader', requireUser, (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
  return res.render('unified-reader', {
    gid,
    pageTitle: `Read • #${gid}`,
    pageDescription: 'Distraction-free reading'
  });
});

/* ── Gutenberg: server-side text/html provider with robust fallbacks ──────── */
router.get('/read/gutenberg/:gid/text', requireUser, async (req, res) => {
  try{
    const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
    if (!gid) return res.status(400).json({ error:'bad id' });

    // 1) Try Gutendex for official format links
    let title = `Project Gutenberg #${gid}`;
    let formats = null;
    try {
      const meta = await fetchJson(`https://gutendex.com/books/${gid}`);
      title = meta?.title || title;
      formats = meta?.formats || null;
    } catch (_) {}

    const pickFromFormats = (...keys) => {
      if (!formats) return null;
      for (const k of keys) {
        const url = formats[k];
        if (url && !/\.zip($|\?)/i.test(url)) return url;
      }
      return null;
    };

    // 2) Preferred links from formats
    let url =
      pickFromFormats('text/plain; charset=utf-8','text/plain; charset=us-ascii','text/plain') ||
      pickFromFormats('text/html; charset=utf-8','text/html','application/xhtml+xml');

    // 3) If still missing, try well-known static paths
    const fallbacks = [
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}-h.htm`,
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}-images.html`,
      `https://www.gutenberg.org/files/${gid}/${gid}-h/${gid}-h.htm`,
      `https://www.gutenberg.org/files/${gid}/${gid}-h.htm`,
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.txt`,
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.txt.utf8`,
      `https://www.gutenberg.org/files/${gid}/${gid}.txt`,
      `https://www.gutenberg.org/files/${gid}/${gid}-0.txt`
    ];

    let content = null, ctype = '';
    if (url) {
      try { const r = await fetchText(url); content = r.text; ctype = r.ctype; } catch (_) {}
    }
    if (!content) {
      for (const u of fallbacks) {
        try { const r = await fetchText(u); content = r.text; ctype = r.ctype; url = u; break; } catch (_) {}
      }
    }
    if (!content) return res.status(404).json({ error:'No readable format found' });

    if (ctype.includes('html') || /<\/?[a-z][\s\S]*>/i.test(content)) {
      res.setHeader('Cache-Control','public, max-age=900');
      return res.json({ type:'html', content, title, url });
    } else {
      res.setHeader('Cache-Control','public, max-age=900');
      return res.json({ type:'text', content, title, url });
    }
  }catch(err){
    console.error('gutenberg text error:', err);
    return res.status(502).json({ error:'Fetch failed' });
  }
});

module.exports = router;
