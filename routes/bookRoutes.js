// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

/* ─────────────────────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────────────────────*/
function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title, creator, cover, source, readerUrl, archiveId };
}

function uniqCards(cards) {
  const seen = new Set();
  const out = [];
  for (const c of cards) {
    const key = [
      (c.source || '').toLowerCase(),
      (c.identifier || '').toLowerCase(),
      (c.title || '').toLowerCase(),
      (c.creator || '').toLowerCase()
    ].join('|');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Wikisource connector (we added this in /connectors/wikisource.js)
   ───────────────────────────────────────────────────────────────────────────*/
let wikisource = null;
try {
  wikisource = require('../connectors/wikisource');
} catch (_) {
  // If the file is missing, we gracefully skip Wikisource
  wikisource = null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Inline-first: Gutenberg (EPUB) + Wikisource (HTML)
   ───────────────────────────────────────────────────────────────────────────*/

/** Gutenberg: search via Gutendex; return cards wired to our internal EPUB reader. */
async function searchGutenbergInline(q, limit = 48) {
  const url = `https://gutendex.com/books?search=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json();
  const results = Array.isArray(data.results) ? data.results.slice(0, limit) : [];
  return results.map(b => {
    const gid = b.id;
    const title = b.title || '(Untitled)';
    const author = Array.isArray(b.authors) && b.authors[0] ? b.authors[0].name : '';
    // use Gutenberg’s predictable cover
    const cover = `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.cover.medium.jpg`;
    return card({
      identifier: `gutenberg:${gid}`,
      title,
      creator: author,
      cover,
      source: 'gutenberg',
      readerUrl: `/read/gutenberg/${gid}/reader?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`
    });
  });
}

/** Wikisource: search (HTML readable inline). */
async function searchWikisourceInline(q, { limit = 24, lang = 'en' } = {}) {
  if (!wikisource) return [];
  try {
    const cards = await wikisource.searchWikisource(q, { limit, lang });
    // already returns cards in our shape
    return cards;
  } catch (e) {
    console.error('Wikisource search error:', e.message);
    return [];
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Open Library search — public-scan (no account wall) only
   ───────────────────────────────────────────────────────────────────────────*/
async function searchOpenLibraryPublic(q, limit = 40) {
  const url = `https://openlibrary.org/search.json?has_fulltext=true&limit=${limit}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json();
  const docs = Array.isArray(data.docs) ? data.docs : [];

  // Prefer items that are publicly readable (avoid "borrow"/account wall)
  const filtered = docs.filter(d => {
    // Many OL records expose "public_scan_b: true" for scans available without borrowing
    if (typeof d.public_scan_b === 'boolean') return d.public_scan_b === true;
    // Fallback heuristics: at least has_fulltext + no "inlibrary" collection marker
    return d.has_fulltext === true;
  });

  return filtered.map(d => {
    const id = d.key || d.work_key || d.edition_key?.[0] || '';
    const author = Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || '');
    let cover = '';
    if (d.cover_i) cover = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
    else if (d.edition_key && d.edition_key[0]) cover = `https://covers.openlibrary.org/b/olid/${d.edition_key[0]}-M.jpg`;

    // Keep this as a search link (opens /read pre-filled) — OL direct embeds vary a lot.
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

/* ─────────────────────────────────────────────────────────────────────────────
   Internet Archive search — exclude borrow-only collections
   ───────────────────────────────────────────────────────────────────────────*/
async function searchArchivePublic(q, rows = 36) {
  // Exclude known borrow/limited collections
  const query = `${q} AND mediatype:(texts) AND -collection:(printdisabled) AND -collection:(lendinglibrary) AND -collection:(inlibrary)`;
  const api = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=rights&fl[]=licenseurl&rows=${rows}&page=1&output=json`;
  const r = await fetch(api);
  if (!r.ok) return [];
  const data = await r.json();
  const docs = data?.response?.docs || [];

  const filtered = docs.filter(d => {
    const rights = (d.rights || '').toString().toLowerCase();
    // Heuristic: if it claims pd/creative commons, it's often openly readable
    if (rights.includes('pd') || rights.includes('public') || rights.includes('creative')) return true;
    // Otherwise allow; we already excluded in-library/printdisabled above.
    return true;
  });

  return filtered.map(d => {
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

/* ─────────────────────────────────────────────────────────────────────────────
   READ search page
   ───────────────────────────────────────────────────────────────────────────*/
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

    // Prefer inline sources first
    const [gb, ws, ia, ol] = await Promise.all([
      searchGutenbergInline(query).catch(() => []),
      searchWikisourceInline(query, { lang: 'en', limit: 24 }).catch(() => []),
      searchArchivePublic(query).catch(() => []),
      searchOpenLibraryPublic(query).catch(() => [])
    ]);

    let books = uniqCards([...gb, ...ws, ...ia, ...ol]);

    console.log(`READ SEARCH "${query}" — gutenberg:${gb.length} wikisource:${ws.length} archive:${ia.length} openlibrary:${ol.length}`);

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

/* ─────────────────────────────────────────────────────────────────────────────
   IA internal reader (stays on-site); gated for logged-in users
   ───────────────────────────────────────────────────────────────────────────*/
function requireUser(req, res, next) {
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

/* ─────────────────────────────────────────────────────────────────────────────
   Gutenberg EPUB proxy  (avoids CORS; used by ePub.js in unified-reader)
   ───────────────────────────────────────────────────────────────────────────*/
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
    let resp;
    for (const u of urls) {
      resp = await fetch(u, { redirect: 'follow' });
      if (resp.ok) {
        res.set('Content-Type', 'application/epub+zip');
        // Stream the file through
        return resp.body.pipe(res);
      }
    }
    return res.status(404).send('ePub not found');
  } catch (e) {
    console.error('proxy gutenberg epub err', e);
    res.status(500).send('Proxy error');
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   Gutenberg reader page (EPUB-internal via unified-reader)
   ───────────────────────────────────────────────────────────────────────────*/
router.get('/read/gutenberg/:gid/reader', requireUser, (req, res) => {
  const gid = String(req.params.gid).replace(/[^0-9]/g,'');
  const title = String(req.query.title || '').trim();
  const creator = String(req.query.author || '').trim();

  // unified-reader.ejs will detect EPUB mode (no bookHtml provided) and load via /proxy/gutenberg-epub/:gid
  return res.render('unified-reader', {
    gid,
    bookTitle: title || `Project Gutenberg #${gid}`,
    bookAuthor: creator || '',
    pageTitle: `Read • ${title || `#${gid}`}`,
    pageDescription: 'Distraction-free reading mode'
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   Wikisource reader (HTML mode) + JSON API
   ───────────────────────────────────────────────────────────────────────────*/
router.get('/read/wikisource/:lang/:title/reader', requireUser, async (req, res) => {
  if (!wikisource) return res.status(404).send('Wikisource not installed');
  try {
    const lang = String(req.params.lang || 'en');
    const title = String(req.params.title || '');
    const { html, title: niceTitle } = await wikisource.getWikisourceHtml(lang, title);
    return res.render('unified-reader', {
      bookHtml: html,                // triggers HTML mode in the template
      bookTitle: niceTitle || title,
      bookAuthor: '',
      pageTitle: `Read • ${niceTitle || title}`,
      pageDescription: 'Distraction-free reading mode'
    });
  } catch (e) {
    console.error('Wikisource reader error:', e);
    return res.status(500).send('Wikisource fetch failed');
  }
});

// Optional JSON endpoint (AJAX use)
router.get('/api/wikisource/:lang/:title', requireUser, async (req, res) => {
  if (!wikisource) return res.status(404).json({ error: 'Wikisource not installed' });
  try {
    const lang = String(req.params.lang || 'en');
    const title = String(req.params.title || '');
    const out = await wikisource.getWikisourceHtml(lang, title);
    res.set('Cache-Control','public, max-age=600');
    return res.json(out);
  } catch (e) {
    console.error('Wikisource api error:', e);
    return res.status(500).json({ error: 'Fetch failed' });
  }
});

module.exports = router;
