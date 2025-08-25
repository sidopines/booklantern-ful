// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

// Connectors
const { searchStandardEbooks } = require('../connectors/standardEbooks');
const { searchFeedbooksPD }   = require('../connectors/feedbooks');

// Helpers
function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title, creator, cover, source, readerUrl, archiveId };
}
function requireUser(req, res, next){
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

/* ------------------------------ Gutenberg (Gutendex) ----------------------- */
async function searchGutenberg(q, limit = 48) {
  const url = `https://gutendex.com/books?search=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  const data = await r.json();
  const results = Array.isArray(data.results) ? data.results.slice(0, limit) : [];
  return results.map(b => {
    const gid   = b.id;
    const title = b.title || '(Untitled)';
    const author = Array.isArray(b.authors) && b.authors[0] ? b.authors[0].name : '';
    const cover  = `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.cover.medium.jpg`;

    // Route stays on-site and loads EPUB through our proxy (fixes blank page)
    const readerUrl = `/read/gutenberg/${gid}/reader?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`;

    return card({
      identifier: `gutenberg:${gid}`,
      title, creator: author, cover, source: 'gutenberg',
      readerUrl
    });
  });
}

/* ----------------------------- Internet Archive ---------------------------- */
async function searchArchive(q, rows = 40) {
  const api = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
    `${q} AND mediatype:texts`
  )}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&fl[]=rights&rows=${rows}&page=1&output=json`;
  const r = await fetch(api);
  const data = await r.json();
  const docs = data?.response?.docs || [];

  // show only items we can open inline (avoid borrow/preview)
  return docs
    .filter(d => {
      const rights = String(d.rights || d.licenseurl || '').toLowerCase();
      return rights.includes('public') || rights.includes('cc0') || rights.includes('creative commons') || rights === '';
    })
    .map(d => {
      const id = d.identifier;
      const title = d.title || '(Untitled)';
      const author = d.creator || '';
      const cover = `https://archive.org/services/img/${id}`;
      const readerUrl = `/read/book/${encodeURIComponent(id)}`;
      return card({
        identifier: `archive:${id}`,
        title, creator: author, cover, source:'archive',
        readerUrl, archiveId: id
      });
    });
}

/* ------------------------------- READ (search) ----------------------------- */
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

    const [std, feed, gut, ia] = await Promise.all([
      searchStandardEbooks(query).catch(() => []),
      searchFeedbooksPD(query).catch(() => []),
      searchGutenberg(query).catch(() => []),
      searchArchive(query).catch(() => []),
    ]);

    // Merge with most “on-site readable” first
    const books = [...std, ...feed, ...gut, ...ia];

    console.log(`READ SEARCH "${query}" — se:${std.length} feedbooks:${feed.length} gutenberg:${gut.length} archive:${ia.length} merged:${books.length}`);

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

/* --------------------------- Gutenberg reader (EPUB) ----------------------- */
// We always feed the EPUB via our proxy to dodge CORS; unified template.
router.get('/read/gutenberg/:gid/reader', requireUser, (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
  const title  = String(req.query.title || `Gutenberg #${gid}`);
  const author = String(req.query.author || '');
  const epubUrl = `/proxy/gutenberg-epub/${gid}`;
  return res.render('unified-reader', {
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`,
    title, author, mode: 'epub', epubUrl
  });
});

/* ----------------------------- Generic EPUB reader ------------------------- */
router.get('/read/epub', requireUser, (req, res) => {
  const raw = String(req.query.u || '');
  if (!raw) return res.status(400).send('Missing EPUB URL');
  const prox = `/proxy/epub?u=${encodeURIComponent(raw)}`;
  const title  = String(req.query.title || 'Book');
  const author = String(req.query.author || '');
  return res.render('unified-reader', {
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`,
    title, author, mode: 'epub', epubUrl: prox
  });
});

/* --------------------------- Gutenberg: EPUB proxy ------------------------- */
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
    for (const u of urls) {
      const resp = await fetch(u, { redirect: 'follow' });
      if (resp.ok && (resp.headers.get('content-type')||'').includes('epub')) {
        res.set('Content-Type','application/epub+zip');
        return resp.body.pipe(res);
      }
    }
    return res.status(404).send('ePub not found');
  } catch (e) {
    console.error('proxy gutenberg epub err', e);
    res.status(500).send('Proxy error');
  }
});

/* ----------------------------- Generic EPUB proxy -------------------------- */
// Whitelist prevents open-proxy abuse.
const EPUB_WHITELIST = new Set([
  'www.gutenberg.org',
  'standardebooks.org',
  'ebooks.standardebooks.org',
  'www.feedbooks.com',
  'feedbooks.com'
]);
router.get('/proxy/epub', async (req, res) => {
  try {
    const raw = String(req.query.u || '');
    if (!raw) return res.status(400).send('Missing URL');
    let u;
    try { u = new URL(raw); } catch { return res.status(400).send('Bad URL'); }
    if (!EPUB_WHITELIST.has(u.hostname)) return res.status(403).send('Host not allowed');

    const resp = await fetch(u.toString(), { redirect: 'follow' });
    if (!resp.ok) return res.status(resp.status).send('Upstream error');
    res.set('Content-Type','application/epub+zip');
    return resp.body.pipe(res);
  } catch (e) {
    console.error('proxy epub err', e);
    res.status(500).send('Proxy error');
  }
});

/* -------------------------- Gutenberg text (preview) ----------------------- */
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
