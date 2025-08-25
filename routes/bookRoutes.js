// routes/bookRoutes.js
const express = require('express');
const { Readable } = require('stream');
const router = express.Router();

/* Helpers */
function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title, creator, cover, source, readerUrl, archiveId };
}

function dedupeByKey(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = keyFn(it);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it);
    }
  }
  return out;
}

/* --------------------------- Open Library (OPEN copies only) --------------- */
/**
 * Strategy:
 * - Query with extra fields, prefer docs that expose an Internet Archive item (ia[])
 * - Only surface ones that look openly readable (availability.status === 'open' OR ia[] exists)
 * - Link directly to our IA reader (/read/book/:iaId) so users stay on site
 */
async function searchOpenLibrary(q, limit = 50) {
  const url =
    `https://openlibrary.org/search.json?` +
    `mode=everything&limit=${limit}&q=${encodeURIComponent(q)}` +
    `&fields=key,title,author_name,cover_i,edition_key,ia,ebook_access,availability`;

  const r = await fetch(url);
  const data = await r.json();
  const docs = Array.isArray(data.docs) ? data.docs : [];

  const out = [];
  for (const d of docs) {
    const title = d.title || '(Untitled)';
    const author = Array.isArray(d.author_name) ? d.author_name[0] : d.author_name || '';
    const cover =
      d.cover_i
        ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
        : (d.edition_key && d.edition_key[0]
            ? `https://covers.openlibrary.org/b/olid/${d.edition_key[0]}-M.jpg`
            : '');

    // Prefer IA-backed open items
    const iaList = Array.isArray(d.ia) ? d.ia : [];
    const hasIA = iaList.length > 0;

    const isOpen =
      (d.availability && d.availability.status === 'open') || hasIA;

    if (!isOpen) continue;

    const iaId = hasIA ? iaList[0] : null;
    // If we have an IA id, link straight to our IA reader
    if (iaId) {
      out.push(card({
        identifier: `openlibrary:${d.key || iaId}`,
        title,
        creator: author,
        cover,
        source: 'openlibrary',
        readerUrl: `/read/book/${encodeURIComponent(iaId)}`,
        archiveId: iaId
      }));
    } else {
      // Fallback: keep it as a search jump (rare)
      out.push(card({
        identifier: `openlibrary:${d.key || '(unknown)'}`,
        title,
        creator: author,
        cover,
        source: 'openlibrary',
        readerUrl: `/read?query=${encodeURIComponent(title + (author ? ' ' + author : ''))}`
      }));
    }
  }
  return out;
}

/* ------------------------------ Gutenberg search --------------------------- */
/**
 * Always internal: link to our EPUB reader.
 */
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
    // Reader route (internal)
    const readerUrl = `/read/gutenberg/${gid}/reader?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`;
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

/* ----------------------------- Internet Archive ---------------------------- */
/**
 * Tighten query to avoid borrow/limited-preview collections.
 * We still do a best-effort filter client-side too.
 */
async function searchArchive(q, rows = 40) {
  const query = [
    `${q}`,
    'mediatype:(texts)',
    '-collection:(printdisabled)',
    '-collection:(inlibrary)',
    '-collection:(lendinglibrary)',
    '-collection:(internetarchivebooks)', // often lending-only scans
    'NOT access-restricted-item:true'
  ].join(' AND ');

  const api = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&` +
              `fl[]=identifier&fl[]=title&fl[]=creator&fl[]=collection&fl[]=access-restricted-item&` +
              `rows=${rows}&page=1&output=json`;

  const r = await fetch(api);
  const data = await r.json();
  const docs = data?.response?.docs || [];

  const out = [];
  for (const d of docs) {
    const id = d.identifier;
    if (!id) continue;

    const collections = Array.isArray(d.collection) ? d.collection : [];
    const restricted = d['access-restricted-item'] === true;

    // Defensive filter against borrow-ish collections
    const badColl = collections.some(c =>
      ['printdisabled','inlibrary','lendinglibrary','internetarchivebooks'].includes(String(c).toLowerCase())
    );
    if (restricted || badColl) continue;

    const title = d.title || '(Untitled)';
    const author = d.creator || '';
    const cover = `https://archive.org/services/img/${id}`;
    const readerUrl = `/read/book/${encodeURIComponent(id)}`;

    out.push(card({
      identifier: `archive:${id}`,
      title,
      creator: author,
      cover,
      source: 'archive',
      readerUrl,
      archiveId: id
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

    const [gb, ia, ol] = await Promise.all([
      searchGutenberg(query).catch(() => []),
      searchArchive(query).catch(() => []),
      searchOpenLibrary(query).catch(() => [])
    ]);

    // Merge + de-duplicate by destination (readerUrl) to avoid duplicates
    const merged = dedupeByKey([...gb, ...ia, ...ol], it => it.readerUrl || it.identifier);

    console.log(`READ SEARCH "${query}" — archive:${ia.length} gutenberg:${gb.length} openlibrary:${ol.length} merged:${merged.length}`);

    return res.render('read', {
      pageTitle: `Search • ${query}`,
      pageDescription: `Results for “${query}”`,
      books: merged,
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

/* --------------------------- Gutenberg reader (internal) ------------------- */
function requireUser(req, res, next){
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

/**
 * EPUB proxy — FIXED for Node 22: bridge web stream -> Node stream.
 * Also sets proper headers so EPUB.js can load it reliably.
 */
router.get('/proxy/gutenberg-epub/:gid', async (req, res) => {
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

    res.set('Content-Type', 'application/epub+zip');
    res.set('Cache-Control', 'public, max-age=1800');
    res.set('Content-Disposition', `inline; filename="pg${gid}.epub"`);

    // IMPORTANT: Node 22 bridge
    const webStream = resp.body; // WHATWG stream
    const nodeStream = Readable.fromWeb(webStream);
    nodeStream.pipe(res);
  } catch (e) {
    console.error('proxy gutenberg epub err', e);
    res.status(500).send('Proxy error');
  }
});

router.get('/read/gutenberg/:gid/reader', requireUser, (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
  const title = req.query.title || `Project Gutenberg #${gid}`;
  const author = req.query.author || '';
  return res.render('unified-reader', {
    gid,
    book: { title, creator: author },
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`
  });
});

/* ---------------- Gutenberg server-side text (for Listen previews) --------- */
router.get('/read/gutenberg/:gid/text', requireUser, async (req, res) => {
  try{
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

    // Prefer TEXT first, then HTML
    const url =
      pick('text/plain; charset=utf-8','text/plain; charset=us-ascii','text/plain') ||
      pick('text/html; charset=utf-8','text/html','application/xhtml+xml');

    if (!url) return res.status(404).json({ error:'No readable format found' });

    const bookR = await fetch(url, { redirect:'follow' });
    const ctype = (bookR.headers.get('content-type') || '').toLowerCase();
    const raw = await bookR.text();

    if (ctype.includes('html') || /<\/?[a-z][\s\S]*>/i.test(raw)) {
      res.setHeader('Cache-Control','public, max-age=600');
      return res.json({ type:'html', content: raw, title });
    } else {
      res.setHeader('Cache-Control','public, max-age=600');
      return res.json({ type:'text', content: raw, title });
    }
  }catch(err){
    console.error('gutenberg text error:', err);
    return res.status(502).json({ error:'Fetch failed' });
  }
});

module.exports = router;
