// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

/* ───────────────────────── Helpers ───────────────────────── */
function str(v) {
  if (Array.isArray(v)) return v.filter(Boolean).join(', ');
  return v ? String(v) : '';
}
function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title: str(title), creator: str(creator), cover, source, readerUrl, archiveId };
}
const safe = (fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { console.error('[connector failed]', fn.name || 'fn', e.message); return []; }
};

/* ───────────────────── Connectors (named exports) ───────────────────── */
const { searchGutenberg }       = require('../connectors/gutenberg');
const { searchWikisource }      = require('../connectors/wikisource');
const { searchStandardEbooks }  = require('../connectors/standardebooks');
const { searchOpenLibrary }     = require('../connectors/openlibrary');
const { searchHathiTrust }      = require('../connectors/hathitrust');
const { searchLOC }             = require('../connectors/loc');
const { searchFeedbooks }       = require('../connectors/feedbooks');

/* ───────────────── Internet Archive (inline connector) ─────────────────
   Return only “free to read” collections; avoid borrow-only where possible. */
async function searchArchive(q, rows = 36) {
  const clause = `${q} AND mediatype:(texts) AND -collection:(inlibrary printdisabled)`;
  const api = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(clause)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=collection&rows=${rows}&page=1&output=json`;
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

/* ───────────────────────────── /read search ───────────────────────────── */
router.get('/read', async (req, res) => {
  try {
    const query = (req.query.query || '').trim();

    if (!query) {
      return res.render('read', {
        pageTitle: 'Explore Free Books',
        pageDescription: 'Browse and read books from multiple free sources.',
        books: [],
        query
      });
    }

    // Run connectors in parallel (guarded with safe())
    const [
      gb, se, ws, ia, ol, ht, lc, fb
    ] = await Promise.all([
      safe(searchGutenberg)(query, 40),
      safe(searchStandardEbooks)(query, 24),
      safe(searchWikisource)(query, 24),
      safe(searchArchive)(query, 36),
      safe(searchOpenLibrary)(query, 48),
      safe(searchHathiTrust)(query, 24),
      safe(searchLOC)(query, 24),
      safe(searchFeedbooks)(query, 24),
    ]);

    // Normalize to our card shape + point readers to our on-site views
    const mapGutenberg = gb.map(b => {
      const gid = String(b.id || b.gid || (b.identifier || '').replace(/^gutenberg:/,'')).replace(/[^0-9]/g,'');
      const cover = b.cover || (gid ? `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.cover.medium.jpg` : '');
      return card({
        identifier: `gutenberg:${gid}`,
        title: b.title,
        creator: b.creator || (b.authors && b.authors[0]?.name) || '',
        cover,
        source: 'gutenberg',
        readerUrl: `/read/gutenberg/${gid}/reader`
      });
    });

    const mapSE = se.map(b => {
      // Standard Ebooks returns a direct EPUB URL; open in our reader via src
      const epubUrl = b.epub || b.href || b.url || '';
      return card({
        identifier: `standardebooks:${b.id || b.slug || epubUrl}`,
        title: b.title,
        creator: b.creator || b.author || '',
        cover: b.cover || '',
        source: 'standardebooks',
        readerUrl: `/read/epub?src=${encodeURIComponent(epubUrl)}&title=${encodeURIComponent(str(b.title))}&author=${encodeURIComponent(str(b.creator || b.author || ''))}`
      });
    });

    const mapWS = ws.map(b => {
      const lang = b.lang || 'en';
      const title = b.title || b.page || '';
      return card({
        identifier: `wikisource:${lang}:${title}`,
        title,
        creator: b.creator || b.author || '',
        cover: b.cover || '',
        source: 'wikisource',
        readerUrl: `/read/wikisource/${encodeURIComponent(lang)}/${encodeURIComponent(title)}/reader`
      });
    });

    const mapIA = ia.map(x => x); // already card()-shaped in searchArchive

    const mapOL = ol.map(b => {
      // Only include items that are marked readable by the connector
      return card({
        identifier: b.identifier || b.id || '',
        title: b.title,
        creator: b.creator || b.author || '',
        cover: b.cover || '',
        source: 'openlibrary',
        readerUrl: b.readerUrl || '' // connector should set this
      });
    }).filter(x => x.readerUrl);

    const mapHathi = ht.map(b => {
      // Hathi full-view → our PDF viewer
      return card({
        identifier: `hathi:${b.id || b.url}`,
        title: b.title,
        creator: b.creator || b.author || '',
        cover: b.cover || '',
        source: 'hathitrust',
        readerUrl: `/read/pdf?src=${encodeURIComponent(b.pdf || b.url)}&title=${encodeURIComponent(str(b.title))}`
      });
    });

    const mapLOC = lc.map(b => {
      return card({
        identifier: `loc:${b.id || b.url}`,
        title: b.title,
        creator: b.creator || b.author || '',
        cover: b.cover || '',
        source: 'loc',
        readerUrl: `/read/pdf?src=${encodeURIComponent(b.pdf || b.url)}&title=${encodeURIComponent(str(b.title))}`
      });
    });

    const mapFB = fb.map(b => {
      // Many Feedbooks items are public-domain EPUBs
      const epub = b.epub || b.url || '';
      return card({
        identifier: `feedbooks:${b.id || epub}`,
        title: b.title,
        creator: b.creator || b.author || '',
        cover: b.cover || '',
        source: 'feedbooks',
        readerUrl: `/read/epub?src=${encodeURIComponent(epub)}&title=${encodeURIComponent(str(b.title))}&author=${encodeURIComponent(str(b.creator || b.author || ''))}`
      });
    });

    const books = [
      ...mapSE,
      ...mapGutenberg,
      ...mapWS,
      ...mapIA,
      ...mapHathi,
      ...mapLOC,
      ...mapFB,
      ...mapOL,
    ];

    console.log(`READ SEARCH "${query}" — gb:${mapGutenberg.length} se:${mapSE.length} ws:${mapWS.length} ia:${mapIA.length} ol:${mapOL.length} ht:${mapHathi.length} loc:${mapLOC.length} fb:${mapFB.length} merged:${books.length}`);

    return res.render('read', {
      pageTitle: `Search • ${query}`,
      pageDescription: `Results for “${query}”`,
      books,
      query
    });

  } catch (err) {
    console.error('Read search error:', err);
    return res.status(500).render('read', {
      pageTitle: 'Explore Free Books',
      pageDescription: 'Browse and read books from multiple free sources.',
      books: [],
      query: req.query.query || '',
      error: 'Something went wrong. Please try again.'
    });
  }
});

/* ─────────────── Internet Archive internal viewer (on-site) ─────────────── */
function requireUser(req, res, next){
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

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

/* ─────────────── Project Gutenberg (EPUB proxy + reader) ─────────────── */
router.get('/proxy/gutenberg-epub/:gid', requireUser, async (req, res) => {
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
      if (resp.ok) {
        res.setHeader('Content-Type', 'application/epub+zip');
        return resp.body.pipe(res);
      }
    }
    return res.status(404).send('ePub not found');
  } catch (e) {
    console.error('proxy gutenberg epub err', e);
    res.status(500).send('Proxy error');
  }
});

router.get('/read/gutenberg/:gid/reader', requireUser, (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
  const epubUrl = `/proxy/gutenberg-epub/${gid}`;
  return res.render('unified-reader', {
    mode: 'epub',
    gid,
    epubUrl,
    pageTitle: `Read • #${gid}`,
    pageDescription: 'Distraction-free reading'
  });
});

/* ─────────────── Generic EPUB reader (for Standard Ebooks, etc.) ─────────────── */
router.get('/read/epub', requireUser, (req, res) => {
  const src = String(req.query.src || '');
  if (!src) return res.redirect('/read');
  return res.render('unified-reader', {
    mode: 'epub',
    epubUrl: src,
    pageTitle: `Read • ${req.query.title || 'Book'}`,
    pageDescription: 'Distraction-free reading'
  });
});

/* ─────────────── Wikisource HTML reader + text feed ─────────────── */
router.get('/read/wikisource/:lang/:title/reader', requireUser, (req, res) => {
  const { lang, title } = req.params;
  return res.render('unified-reader', {
    mode: 'html',
    wsLang: lang,
    wsTitle: title,
    pageTitle: `Read • ${title}`,
    pageDescription: 'Distraction-free reading'
  });
});

router.get('/read/wikisource/:lang/:title/text', requireUser, async (req, res) => {
  try {
    const { lang, title } = req.params;
    // Pull rendered HTML from REST API
    const url = `https://${lang}.wikisource.org/api/rest_v1/page/html/${encodeURIComponent(title)}`;
    const r = await fetch(url, { headers: { 'Accept': 'text/html' } });
    if (!r.ok) return res.status(404).json({ error: 'not found' });
    const html = await r.text();
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.json({ type: 'html', content: html, title });
  } catch (e) {
    console.error('wikisource text error:', e);
    res.status(502).json({ error: 'Fetch failed' });
  }
});

/* ─────────────── Gutenberg “first page text” for Listen preview ─────────────── */
router.get('/read/gutenberg/:gid/text', requireUser, async (req, res) => {
  try{
    const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
    const metaR = await fetch(`https://gutendex.com/books/${gid}`);
    if (!metaR.ok) throw new Error('meta not ok');
    const meta = await metaR.json();
    const title = meta?.title || `Project Gutenberg #${gid}`;
    const formats = meta?.formats || {};
    const pick = (...keys) => { for (const k of keys) { const u = formats[k]; if (u && !/\.zip($|\?)/i.test(u)) return u; } return null; };
    const src = pick('text/plain; charset=utf-8','text/plain; charset=us-ascii','text/plain','text/html; charset=utf-8','text/html','application/xhtml+xml');
    if (!src) return res.status(404).json({ error:'No readable format found' });
    const bookR = await fetch(src, { redirect:'follow' });
    const ctype = (bookR.headers.get('content-type') || '').toLowerCase();
    const raw = await bookR.text();
    res.setHeader('Cache-Control','public, max-age=600');
    if (ctype.includes('html') || /<\/?[a-z][\s\S]*>/i.test(raw)) {
      return res.json({ type:'html', content: raw, title });
    }
    return res.json({ type:'text', content: raw, title });
  }catch(err){
    console.error('gutenberg text error:', err);
    return res.status(502).json({ error:'Fetch failed' });
  }
});

module.exports = router;
