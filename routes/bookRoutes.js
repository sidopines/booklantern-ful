// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

/* -----------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------*/
function requireUser(req, res, next) {
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title, creator, cover, source, readerUrl, archiveId };
}

/* -----------------------------------------------------------
 * Open Library — prefer items with a public IA scan
 *  - We only include items that have IA IDs AND are public scans,
 *    so they open directly in our IA reader (no borrow wall).
 * ---------------------------------------------------------*/
async function searchOpenLibrary(q, limit = 40) {
  const url = `https://openlibrary.org/search.json?mode=everything&limit=${limit}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json();
  const docs = Array.isArray(data.docs) ? data.docs : [];

  const readable = [];
  for (const d of docs) {
    // Open Library flags
    const isPublic = d.public_scan_b === true || d.ebook_access === 'public';
    const iaList = Array.isArray(d.ia) ? d.ia : [];

    if (isPublic && iaList.length) {
      const iaId = iaList[0];
      const title = d.title || '(Untitled)';
      const author = Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || '');
      // covers
      let cover = '';
      if (d.cover_i) {
        cover = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
      } else if (d.edition_key && d.edition_key[0]) {
        cover = `https://covers.openlibrary.org/b/olid/${d.edition_key[0]}-M.jpg`;
      } else if (iaId) {
        cover = `https://archive.org/services/img/${iaId}`;
      }

      readable.push(card({
        identifier: `openlibrary:${d.key || iaId}`,
        title,
        creator: author,
        cover,
        source: 'openlibrary',
        readerUrl: `/read/book/${encodeURIComponent(iaId)}`,
        archiveId: iaId
      }));
    }
  }
  return readable;
}

/* -----------------------------------------------------------
 * Gutenberg — prefer EPUB inside our site
 *  - Reader route: /read/gutenberg/:gid/reader (ePub.js)
 *  - Fallback text route: /read/gutenberg/:gid/text (fixes “blank”)
 * ---------------------------------------------------------*/
async function searchGutenberg(q, limit = 48) {
  const url = `https://gutendex.com/books?search=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json();
  const results = Array.isArray(data.results) ? data.results.slice(0, limit) : [];

  return results.map(b => {
    const gid = b.id;
    const title = b.title || '(Untitled)';
    const author = Array.isArray(b.authors) && b.authors[0] ? b.authors[0].name : '';
    const cover = `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.cover.medium.jpg`;
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

/* -----------------------------------------------------------
 * Internet Archive — filter out access-restricted items
 * ---------------------------------------------------------*/
async function searchArchive(q, rows = 28) {
  const query = `${q} AND mediatype:texts AND access-restricted-item:false`;
  const api = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=${rows}&page=1&output=json`;
  const r = await fetch(api);
  if (!r.ok) return [];
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

/* -----------------------------------------------------------
 * Wikisource — inject a few inline-readable matches
 * ---------------------------------------------------------*/
async function searchWikisource(q, lang = 'en', limit = 6) {
  const api = `https://${lang}.wikisource.org/w/api.php?action=query&list=search&format=json&srsearch=${encodeURIComponent(q)}&srlimit=${limit}`;
  const r = await fetch(api, { headers: { 'User-Agent': 'BookLantern/1.0 (+https://booklantern.org)' }});
  if (!r.ok) return [];
  const data = await r.json();
  const hits = data?.query?.search || [];
  return hits.map(h => {
    const title = h?.title || '';
    return card({
      identifier: `wikisource:${lang}:${title}`,
      title,
      creator: '',
      cover: '', // Wikisource pages often don’t have a dedicated cover; fine to omit.
      source: 'wikisource',
      readerUrl: `/read/wikisource/${encodeURIComponent(lang)}/${encodeURIComponent(title)}/reader`
    });
  });
}

/* -----------------------------------------------------------
 * /read — federated search (PG + IA + OL + WS)
 *  - OL now returns only *readable* (public-scan) links
 *  - IA excludes restricted items
 *  - PG opens inside our reader; has text fallback route
 *  - WS (Wikisource) gives HTML inline-read
 * ---------------------------------------------------------*/
router.get('/read', async (req, res) => {
  try {
    const query = (req.query.query || '').trim();
    if (!query) {
      return res.render('read', {
        pageTitle: 'Read Books Online',
        pageDescription: 'Browse and read books from free sources using BookLantern’s modern reader.',
        books: [],
        query
      });
    }
    const [gb, ia, ol, ws] = await Promise.all([
      searchGutenberg(query).catch(() => []),
      searchArchive(query).catch(() => []),
      searchOpenLibrary(query).catch(() => []),
      searchWikisource(query).catch(() => []),
    ]);

    // Show internal readers first (Gutenberg EPUB + IA), then OL (internal IA link), then Wikisource.
    const books = [...gb, ...ia, ...ol, ...ws];
    console.log(`READ "${query}" — PG:${gb.length} IA:${ia.length} OL:${ol.length} WS:${ws.length}`);
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
      pageDescription: 'Browse and read books from multiple free sources using BookLantern’s modern reader.',
      books: [],
      query: req.query.query || '',
      error: 'Something went wrong. Please try again.'
    });
  }
});

/* -----------------------------------------------------------
 * IA internal reader
 * ---------------------------------------------------------*/
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

/* -----------------------------------------------------------
 * Gutenberg EPUB proxy (CORS-safe) + reader route
 * ---------------------------------------------------------*/
router.get('/proxy/gutenberg-epub/:gid', async (req, res) => {
  try {
    const gid = String(req.params.gid).replace(/[^0-9]/g, '');
    if (!gid) return res.status(400).send('Bad id');
    const urls = [
      `https://www.gutenberg.org/ebooks/${gid}.epub.images?download`,
      `https://www.gutenberg.org/ebooks/${gid}.epub.noimages?download`,
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}-images.epub`,
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.epub`,
    ];
    let resp;
    for (const u of urls) {
      resp = await fetch(u, { redirect: 'follow' });
      if (resp.ok) {
        res.set('Content-Type', 'application/epub+zip');
        const len = resp.headers.get('content-length');
        if (len) res.set('Content-Length', len);
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
  const gid    = String(req.params.gid).replace(/[^0-9]/g, '');
  const title  = typeof req.query.title === 'string' ? req.query.title : '';
  const author = typeof req.query.author === 'string' ? req.query.author : '';
  return res.render('unified-reader', {
    gid, // triggers EPUB mode in the view
    book: { title, creator: author },
    pageTitle: title ? `Read • ${title}` : `Read • #${gid}`,
    pageDescription: 'Distraction-free reading'
  });
});

/* -----------------------------------------------------------
 * Gutenberg text/HTML fallback (used by the reader if EPUB fails)
 *  - This endpoint fixes the “Internal Server Error”/blank page issue.
 * ---------------------------------------------------------*/
router.get('/read/gutenberg/:gid/text', requireUser, async (req, res) => {
  try {
    const gid = String(req.params.gid).replace(/[^0-9]/g, '');
    if (!gid) return res.status(400).json({ error: 'Bad id' });

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

    if (!url) return res.status(404).json({ error: 'No readable format found' });

    const bookR = await fetch(url, { redirect: 'follow' });
    const ctype = (bookR.headers.get('content-type') || '').toLowerCase();
    const raw = await bookR.text();

    res.set('Cache-Control', 'public, max-age=600');

    if (ctype.includes('html') || /<\/?[a-z][\s\S]*>/i.test(raw)) {
      return res.json({ type: 'html', content: raw, title });
    } else {
      return res.json({ type: 'text', content: raw, title });
    }
  } catch (err) {
    console.error('gutenberg text error:', err);
    return res.status(502).json({ error: 'Fetch failed' });
  }
});

/* -----------------------------------------------------------
 * Wikisource reader (HTML mode) + sanitized HTML endpoint
 * ---------------------------------------------------------*/
function sanitizeWikisourceHtml(html) {
  if (!html || typeof html !== 'string') return '';
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '')
             .replace(/<style[\s\S]*?<\/style>/gi, '')
             .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
             .replace(/\son\w+="[^"]*"/gi, '')
             .replace(/\son\w+='[^']*'/gi, '')
             .replace(/\shref="javascript:[^"]*"/gi, ' href="#" ')
             .replace(/\ssrc="javascript:[^"]*"/gi, '');
  const allowed = /^(p|br|hr|h1|h2|h3|h4|h5|h6|ul|ol|li|strong|em|b|i|u|blockquote|pre|code|figure|figcaption|img|a|span|div|table|thead|tbody|tr|th|td|sup|sub)$/i;
  html = html.replace(/<\s*([a-z0-9-]+)([^>]*)>/gi, (m, tag, attrs) => {
    if (!allowed.test(tag)) return '';
    let safe = '';
    if (/^a$/i.test(tag)) {
      const href = attrs.match(/\shref\s*=\s*("[^"]*"|'[^']*')/i);
      if (href) safe += ' href=' + href[1];
      const ttl = attrs.match(/\stitle\s*=\s*("[^"]*"|'[^']*')/i);
      if (ttl) safe += ' title=' + ttl[1];
      return `<a${safe}>`;
    }
    if (/^img$/i.test(tag)) {
      const src = attrs.match(/\ssrc\s*=\s*("[^"]*"|'[^']*')/i);
      if (src) safe += ' src=' + src[1];
      const alt = attrs.match(/\salt\s*=\s*("[^"]*"|'[^']*')/i);
      if (alt) safe += ' alt=' + alt[1];
      const ttl = attrs.match(/\stitle\s*=\s*("[^"]*"|'[^']*')/i);
      if (ttl) safe += ' title=' + ttl[1];
      return `<img${safe}>`;
    }
    const ttl = attrs.match(/\stitle\s*=\s*("[^"]*"|'[^']*')/i);
    if (ttl) safe += ' title=' + ttl[1];
    return `<${tag}${safe}>`;
  });
  html = html.replace(/<\/\s*([a-z0-9-]+)\s*>/gi, (m, tag) => allowed.test(tag) ? m : '');
  return html;
}
function absolutizeWikisourceUrls(lang, html) {
  if (!html || typeof html !== 'string') return '';
  const origin = `https://${lang}.wikisource.org`;
  html = html.replace(/src="\/\/([^"]+)"/gi, 'src="https://$1"')
             .replace(/href="\/\/([^"]+)"/gi, 'href="https://$1"')
             .replace(/(src|href)="\/([^"]*)"/gi, (_m, attr, path) => `${attr}="${origin}/${path}"`);
  return html;
}
async function fetchWikisourceSanitizedHtml(lang, title) {
  const api = `https://${lang}.wikisource.org/w/api.php?action=parse&format=json&prop=text&disablelimitreport=1&formatversion=2&page=${encodeURIComponent(title)}`;
  const r = await fetch(api, { headers: { 'User-Agent': 'BookLantern/1.0 (+https://booklantern.org)' }});
  if (!r.ok) throw new Error(`Wikisource API bad status: ${r.status}`);
  const data = await r.json();
  let html = data?.parse?.text || '';
  if (!html) throw new Error('No parse.text');
  html = sanitizeWikisourceHtml(html);
  html = absolutizeWikisourceUrls(lang, html);
  return html;
}
router.get('/read/wikisource/:lang/:title/reader', requireUser, (req, res) => {
  const lang  = String(req.params.lang || 'en').toLowerCase();
  const title = String(req.params.title || '').trim();
  if (!title) return res.redirect('/read');
  return res.render('unified-reader', {
    htmlTitle: title.replace(/_/g,' '),
    htmlAuthor: '',
    htmlFetchUrl: `/read/wikisource/${encodeURIComponent(lang)}/${encodeURIComponent(title)}/text`,
    pageTitle: `Read • ${title.replace(/_/g,' ')}`
  });
});
router.get('/read/wikisource/:lang/:title/text', requireUser, async (req, res) => {
  try {
    const lang  = String(req.params.lang || 'en').toLowerCase();
    const title = String(req.params.title || '').trim();
    if (!title) return res.status(400).send('Missing title');
    const html = await fetchWikisourceSanitizedHtml(lang, title);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=600');
    return res.send(html);
  } catch (err) {
    console.error('Wikisource text error:', err);
    return res.status(502).send('<div class="hint">Could not load this text.</div>');
  }
});

module.exports = router;
