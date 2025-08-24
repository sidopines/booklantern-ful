// routes/bookRoutes.js
const express = require('express');
const { Readable } = require('stream'); // for streaming fetch() bodies in Node 18+/22+
const router = express.Router();

/* Helpers */
function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title, creator, cover, source, readerUrl, archiveId };
}

/* --------------------------- Open Library (open-only) ---------------------- */
/**
 * We only keep OL results that are actually readable without borrowing:
 *  - public_scan_b === true, OR
 *  - availability.status === 'open' / availability.is_readable === true
 * When an IA identifier is present, we deep-link to our /read/book/:id.
 */
async function searchOpenLibrary(q, limit = 60) {
  const url =
    `https://openlibrary.org/search.json?` +
    `mode=everything` +
    `&limit=${limit}` +
    `&q=${encodeURIComponent(q)}` +
    `&fields=key,title,author_name,cover_i,public_scan_b,has_fulltext,ebook_access,availability,ia`;

  const r = await fetch(url);
  const data = await r.json();
  const docs = Array.isArray(data.docs) ? data.docs : [];

  const keep = (d) => {
    const avail = d.availability || {};
    const openish =
      d.public_scan_b === true ||
      avail.status === 'open' ||
      avail.is_readable === true ||
      d.ebook_access === 'public';
    return openish;
  };

  const toCard = (d) => {
    // Prefer an IA identifier if present so we can open our IA reader directly.
    const ia = Array.isArray(d.ia) && d.ia.length ? d.ia[0] : null;
    const author = Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || '');
    let cover = '';
    if (d.cover_i) cover = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;

    const readerUrl = ia ? `/read/book/${encodeURIComponent(ia)}` : ''; // if no IA, we’ll drop this result
    return ia
      ? card({
          identifier: `openlibrary:${d.key || ia}`,
          title: d.title || '(Untitled)',
          creator: author || '',
          cover,
          source: 'openlibrary',
          readerUrl,
          archiveId: ia
        })
      : null;
  };

  return docs.filter(keep).map(toCard).filter(Boolean);
}

/* ------------------------------ Gutenberg search --------------------------- */
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
    // Our internal reader (ePub with fallback)
    const readerUrl = `/read/gutenberg/${gid}/reader`;
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

/* ----------------------------- Internet Archive search --------------------- */
/**
 * Keep truly open reads. We exclude lending/inlibrary/printdisabled collections.
 * Prefer items that have licenseurl or a publicdate (typical public/open scans).
 */
async function searchArchive(q, rows = 40) {
  const query = `(${q}) AND mediatype:texts AND -collection:(inlibrary lendinglibrary printdisabled) AND (licenseurl:* OR publicdate:[* TO *])`;
  const api =
    `https://archive.org/advancedsearch.php` +
    `?q=${encodeURIComponent(query)}` +
    `&fl[]=identifier&fl[]=title&fl[]=creator` +
    `&rows=${rows}&page=1&output=json`;

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

    // Fetch in parallel; each call has its own internal filtering
    const [gb, ia, ol] = await Promise.all([
      searchGutenberg(query).catch(() => []),
      searchArchive(query).catch(() => []),
      searchOpenLibrary(query).catch(() => [])
    ]);

    // Order: Gutenberg (fast/local), IA (scans), then OL (only when it maps to IA open copies)
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

/* --------------------------- Auth guard for readers ------------------------ */
function requireUser(req, res, next){
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

/* --------------------------- Gutenberg reader (internal) ------------------- */
router.get('/read/gutenberg/:gid/reader', requireUser, (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
  return res.render('unified-reader', {
    gid,
    book: {
      title: req.query.title || '',
      creator: req.query.author || ''
    },
    pageTitle: `Read • #${gid}`,
    pageDescription: 'Distraction-free reading'
  });
});

/* --------------------- Gutenberg text/HTML fallback (JSON) ----------------- */
/* 1) Prefer TEXT formats (no inline CSS), else HTML/XHTML. */
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

    // Prefer TEXT first, then HTML
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

/* -------------------- Gutenberg ePub proxy (CORS-safe) --------------------- */
/**
 * Streams a Gutenberg ePub to the client so ePub.js can load it without CORS.
 * IMPORTANT: In Node 18+/22+, fetch() returns a WHATWG ReadableStream; convert
 * it via Readable.fromWeb(...) before piping to res.
 */
router.get('/proxy/gutenberg-epub/:gid', requireUser, async (req, res) => {
  try {
    const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
    if (!gid) return res.status(400).send('Bad id');

    const candidates = [
      `https://www.gutenberg.org/ebooks/${gid}.epub.images?download`,
      `https://www.gutenberg.org/ebooks/${gid}.epub.noimages?download`,
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}-images.epub`,
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.epub`
    ];

    let resp = null;
    for (const u of candidates) {
      const r = await fetch(u, { redirect: 'follow' });
      if (r.ok) { resp = r; break; }
    }
    if (!resp) return res.status(404).send('ePub not found');

    // Content type + inline disposition
    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Disposition', `inline; filename="gutenberg-${gid}.epub"`);

    // Convert WHATWG stream to Node stream
    if (resp.body) {
      return Readable.fromWeb(resp.body).pipe(res);
    } else {
      const buf = Buffer.from(await resp.arrayBuffer());
      return res.end(buf);
    }
  } catch (e) {
    console.error('proxy gutenberg epub err', e);
    res.status(500).send('Proxy error');
  }
});

module.exports = router;
