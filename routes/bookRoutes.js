// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

/* Connectors (all return [] on failure) */
const { searchGutenberg, fetchGutenbergMeta } = require('../connectors/gutenberg');
const { searchWikisource } = require('../connectors/wikisource');
const { searchOpenLibrary } = require('../connectors/openlibrary');
const { searchStandardEbooks } = require('../connectors/standardebooks');

/* ---------------- utils ---------------- */
function requireUser(req, res, next) {
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}
function deDupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const id = it.identifier || `${it.source}:${it.title}:${it.creator}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(it);
  }
  return out;
}

/* --------------- Archive.org (public-domain only) --------------- */
async function searchArchive(q, rows = 30) {
  try {
    // Older than 1929 ≈ US public domain. Also force mediatype:texts and exclude lending/preview collections.
    const query = [
      q,
      'mediatype:texts',
      '(year:[* TO 1929] OR date:[* TO 1929])',
      'access-restricted-item:false',
      '-collection:(inlibrary)',
      '-collection:(lendinglibrary)',
      '-collection:(printdisabled)',
      '-restricted:true'
    ].join(' AND ');
    const api = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=${rows}&page=1&output=json`;
    const r = await fetch(api);
    if (!r.ok) return [];
    const data = await r.json();
    const docs = data?.response?.docs || [];
    return docs.map(d => ({
      identifier: `archive:${d.identifier}`,
      title: d.title || '(Untitled)',
      creator: d.creator || '',
      cover: `https://archive.org/services/img/${d.identifier}`,
      source: 'archive',
      readerUrl: `/read/book/${encodeURIComponent(d.identifier)}`,
      archiveId: d.identifier
    }));
  } catch (e) {
    console.error('[archive] search error:', e);
    return [];
  }
}

/* ------------------------- /read ------------------------- */
router.get('/read', async (req, res) => {
  try {
    const query = (req.query.query || '').trim();
    if (!query) {
      return res.render('read', {
        pageTitle: 'Explore Free Books',
        pageDescription: 'Search and read free, public-domain books.',
        books: [],
        query
      });
    }

    const [gb, se, ws, ia, ol] = await Promise.all([
      searchGutenberg(query, 32).catch(() => []),
      searchStandardEbooks(query, 16).catch(() => []),
      searchWikisource(query, 16, 'en').catch(() => []),
      searchArchive(query, 24).catch(() => []),
      searchOpenLibrary(query, 40).catch(() => []),
    ]);

    const merged = deDupe([...se, ...gb, ...ws, ...ia, ...ol]); // show curated Standard Ebooks first
    console.log(`READ SEARCH "${query}" — se:${se.length} gutenberg:${gb.length} wikisource:${ws.length} archive:${ia.length} openlibrary:${ol.length} merged:${merged.length}`);

    res.render('read', {
      pageTitle: `Search • ${query}`,
      pageDescription: `Results for “${query}”`,
      books: merged,
      query
    });
  } catch (err) {
    console.error('Read search error:', err);
    res.status(500).render('read', {
      pageTitle: 'Explore Free Books',
      pageDescription: 'Search and read free, public-domain books.',
      books: [],
      query: req.query.query || '',
      error: 'Something went wrong. Please try again.'
    });
  }
});

/* --------- Archive internal (kept) --------- */
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

/* ---------------- Gutenberg: EPUB proxy with ZIP sniff + HTML fallback ---------------- */
router.get('/proxy/gutenberg-epub/:gid', async (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g, '');
  if (!gid) return res.status(400).send('Bad id');

  const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';
  const hint = req.query.hint ? String(req.query.hint) : '';

  const candidates = [
    hint || null,
    `https://www.gutenberg.org/ebooks/${gid}.epub.images?download`,
    `https://www.gutenberg.org/ebooks/${gid}.epub.noimages?download`,
    `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}-images.epub`,
    `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.epub`,
  ].filter(Boolean);

  async function tryOne(u) {
    try {
      const r = await fetch(u, {
        redirect: 'follow',
        headers: {
          'User-Agent': UA,
          'Accept': 'application/epub+zip,application/octet-stream;q=0.9,*/*;q=0.1'
        }
      });
      if (!r.ok) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 4) return null;
      if (buf[0] !== 0x50 || buf[1] !== 0x4B) return null; // not a ZIP
      return buf;
    } catch (_) { return null; }
  }

  for (const u of candidates) {
    const buf = await tryOne(u);
    if (buf) {
      res.setHeader('Content-Type', 'application/epub+zip');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Length', String(buf.length));
      return res.end(buf);
    }
  }
  res.status(404).send('EPUB not found');
});

/* Gutenberg reader shell */
router.get('/read/gutenberg/:gid/reader', requireUser, async (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g, '');
  if (!gid) return res.redirect('/read');

  let title = `Project Gutenberg #${gid}`;
  let author = '';
  let hint = '';
  try {
    const meta = await fetchGutenbergMeta(gid);
    if (meta) {
      title = meta.title || title;
      author = Array.isArray(meta.authors) && meta.authors[0] ? (meta.authors[0].name || '') : '';
      const fmts = meta.formats || {};
      hint = fmts['application/epub+zip'] || fmts['application/x-epub+zip'] || '';
    }
  } catch (_) {}

  const epubUrl = `/proxy/gutenberg-epub/${gid}${hint ? `?hint=${encodeURIComponent(hint)}` : ''}`;

  res.render('unified-reader', {
    pageTitle: title ? `Read • ${title}` : 'Read • Book',
    pageDescription: title ? `Read ${title} on BookLantern` : 'Read on BookLantern',
    mode: 'epub',
    epubUrl,
    gid,
    title,
    author
  });
});

/* Gutenberg HTML fallback (used when EPUB fails in the browser) */
router.get('/read/gutenberg/:gid/html', requireUser, async (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g, '');
  if (!gid) return res.status(400).type('text/plain').send('Bad id');
  try {
    // Prefer HTML, then XHTML, then plain text.
    const meta = await fetchGutenbergMeta(gid);
    const fmts = meta?.formats || {};
    const url =
      fmts['text/html; charset=utf-8'] || fmts['text/html'] ||
      fmts['application/xhtml+xml'] ||
      fmts['text/plain; charset=utf-8'] || fmts['text/plain'] || '';
    if (!url) return res.status(404).type('text/plain').send('No HTML');
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return res.status(502).type('text/plain').send('Fetch failed');
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    let raw = await r.text();
    // If plain text, wrap lightly.
    if (!/html/.test(ctype)) {
      raw = `<pre style="white-space:pre-wrap">${raw.replace(/[&<>]/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[s]))}</pre>`;
    }
    // Strip scripts/styles for safety
    raw = raw.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    res.type('text/html').send(raw);
  } catch (e) {
    console.error('[gutenberg] html fallback error:', e);
    res.status(502).type('text/plain').send('Fetch error');
  }
});

/* ---------------- Wikisource HTML reader ---------------- */
router.get('/read/wikisource/:lang/:title/reader', requireUser, (req, res) => {
  const lang = String(req.params.lang || 'en');
  const title = String(req.params.title || '').trim();
  if (!title) return res.redirect('/read');
  const htmlUrl = `/read/wikisource/${encodeURIComponent(lang)}/${encodeURIComponent(title)}/text`;
  res.render('unified-reader', {
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`,
    mode: 'html',
    htmlUrl,
    title
  });
});

// Serve sanitized fragment (BODY inner), not a full HTML document
router.get('/read/wikisource/:lang/:title/text', requireUser, async (req, res) => {
  const lang = String(req.params.lang || 'en');
  const title = String(req.params.title || '').trim();
  if (!title) return res.status(400).type('text/plain').send('Bad title');

  try {
    const api = `https://${lang}.wikisource.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&formatversion=2&origin=*`;
    const r = await fetch(api);
    if (!r.ok) return res.status(502).type('text/plain').send('Fetch failed');
    const data = await r.json();
    let inner = data?.parse?.text || '';
    if (!inner) return res.status(404).type('text/plain').send('Not found');
    inner = String(inner)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/\sonclick="[^"]*"/gi, '');
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.type('text/html').send(inner);
  } catch (e) {
    console.error('[wikisource] html error:', e);
    res.status(502).type('text/plain').send('Fetch error');
  }
});

module.exports = router;
