// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

/* --------------------------------------------------------------------------
 * Card shape for UI lists
 * --------------------------------------------------------------------------*/
function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title, creator, cover, source, readerUrl, archiveId };
}

/* --------------------------------------------------------------------------
 * Open Library search (kept simple)
 * --------------------------------------------------------------------------*/
async function searchOpenLibrary(q, limit = 60) {
  const url = `https://openlibrary.org/search.json?mode=everything&limit=${limit}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  const data = await r.json();
  const docs = Array.isArray(data.docs) ? data.docs : [];
  return docs.map(d => {
    const id = d.key || d.work_key || (Array.isArray(d.edition_key) ? d.edition_key[0] : d.edition_key) || '';
    const author = Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || '');
    let cover = '';
    if (d.cover_i) {
      cover = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
    } else if (d.edition_key && d.edition_key[0]) {
      cover = `https://covers.openlibrary.org/b/olid/${d.edition_key[0]}-M.jpg`;
    }
    // For OL we link to a search within our site (safer, no unexpected external nav)
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

/* --------------------------------------------------------------------------
 * Gutenberg search (via Gutendex) — we prefer EPUB reader link
 * --------------------------------------------------------------------------*/
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
    // INTERNAL reader (EPUB mode) — stays on our site
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

/* --------------------------------------------------------------------------
 * Internet Archive search
 * --------------------------------------------------------------------------*/
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

/* --------------------------------------------------------------------------
 * Auth helper (gates reading for guests)
 * --------------------------------------------------------------------------*/
function requireUser(req, res, next){
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

/* --------------------------------------------------------------------------
 * /read — federated search results
 * --------------------------------------------------------------------------*/
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
    const [ol, gb, ia] = await Promise.all([
      searchOpenLibrary(query).catch(() => []),
      searchGutenberg(query).catch(() => []),
      searchArchive(query).catch(() => [])
    ]);
    // Order: Gutenberg (internal EPUB) → IA → OL
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
      pageDescription: 'Browse and read books from multiple free sources using BookLantern’s modern reader.',
      books: [],
      query: req.query.query || '',
      error: 'Something went wrong. Please try again.'
    });
  }
});

/* --------------------------------------------------------------------------
 * Internet Archive internal view
 * --------------------------------------------------------------------------*/
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

/* --------------------------------------------------------------------------
 * Gutenberg: ePub proxy (avoids CORS/redirect issues)
 * --------------------------------------------------------------------------*/
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
    let resp;
    for (const u of urls) {
      resp = await fetch(u, { redirect: 'follow' });
      if (resp.ok) {
        res.set('Content-Type', 'application/epub+zip');
        if (resp.headers.get('content-length')) {
          res.set('Content-Length', resp.headers.get('content-length'));
        }
        return resp.body.pipe(res);
      }
    }
    return res.status(404).send('ePub not found');
  } catch (e) {
    console.error('proxy gutenberg epub err', e);
    res.status(500).send('Proxy error');
  }
});

/* --------------------------------------------------------------------------
 * Gutenberg: internal reader (EPUB mode with ePub.js)
 * --------------------------------------------------------------------------*/
router.get('/read/gutenberg/:gid/reader', requireUser, (req, res) => {
  const gid = String(req.params.gid).replace(/[^0-9]/g,'');
  // Pass title/author if provided (used in top bar)
  const title  = typeof req.query.title === 'string' ? req.query.title : '';
  const author = typeof req.query.author === 'string' ? req.query.author : '';
  return res.render('unified-reader', {
    gid, // triggers EPUB mode in the view
    book: { title, creator: author },
    pageTitle: title ? `Read • ${title}` : `Read • #${gid}`,
    pageDescription: 'Distraction-free reading'
  });
});

/* ==========================================================================
 * WIKISOURCE (HTML mode)
 *  - /read/wikisource/:lang/:title/reader  -> renders unified-reader (HTML mode)
 *  - /read/wikisource/:lang/:title/text    -> returns sanitized HTML
 * =========================================================================*/

/** Basic sanitize: strip <script>/<style>/<iframe>, event handlers, and most inline styles.
 *  Keep a safe set of tags. This is conservative but enough for prose pages. */
function sanitizeWikisourceHtml(html) {
  if (!html || typeof html !== 'string') return '';
  // remove scripts/styles/iframes
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '')
             .replace(/<style[\s\S]*?<\/style>/gi, '')
             .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  // strip on* handlers and javascript: URLs
  html = html.replace(/\son\w+="[^"]*"/gi, '')
             .replace(/\son\w+='[^']*'/gi, '')
             .replace(/\shref="javascript:[^"]*"/gi, ' href="#" ')
             .replace(/\ssrc="javascript:[^"]*"/gi, '');

  // allow a basic set of elements, drop others by whitelisting (lightweight)
  const allowed = /^(p|br|hr|h1|h2|h3|h4|h5|h6|ul|ol|li|strong|em|b|i|u|blockquote|pre|code|figure|figcaption|img|a|span|div|table|thead|tbody|tr|th|td|sup|sub)$/i;

  // naive filter: remove start tags that are not allowed
  html = html.replace(/<\s*([a-z0-9-]+)([^>]*)>/gi, (m, tag, attrs) => {
    if (!allowed.test(tag)) return ''; // drop disallowed tag
    // keep only href/src/alt/title for allowed tags
    let safeAttrs = '';
    if (/^a$/i.test(tag)) {
      const hrefMatch = attrs.match(/\shref\s*=\s*("[^"]*"|'[^']*')/i);
      if (hrefMatch) safeAttrs += ' href=' + hrefMatch[1];
      const titleMatch = attrs.match(/\stitle\s*=\s*("[^"]*"|'[^']*')/i);
      if (titleMatch) safeAttrs += ' title=' + titleMatch[1];
      return `<a${safeAttrs}>`;
    }
    if (/^img$/i.test(tag)) {
      const srcMatch = attrs.match(/\ssrc\s*=\s*("[^"]*"|'[^']*')/i);
      if (srcMatch) safeAttrs += ' src=' + srcMatch[1];
      const altMatch = attrs.match(/\salt\s*=\s*("[^"]*"|'[^']*')/i);
      if (altMatch) safeAttrs += ' alt=' + altMatch[1];
      const tMatch = attrs.match(/\stitle\s*=\s*("[^"]*"|'[^']*')/i);
      if (tMatch) safeAttrs += ' title=' + tMatch[1];
      return `<img${safeAttrs}>`;
    }
    // minimal attrs for others
    const titleMatch = attrs.match(/\stitle\s*=\s*("[^"]*"|'[^']*')/i);
    if (titleMatch) safeAttrs += ' title=' + titleMatch[1];
    return `<${tag}${safeAttrs}>`;
  });

  // remove any closing tags for disallowed elements (rough)
  html = html.replace(/<\/\s*([a-z0-9-]+)\s*>/gi, (m, tag) => allowed.test(tag) ? m : '');

  return html;
}

/** Convert relative and protocol-relative URLs to absolute for a given Wikisource lang. */
function absolutizeWikisourceUrls(lang, html) {
  if (!html || typeof html !== 'string') return '';
  const origin = `https://${lang}.wikisource.org`;

  // protocol-relative //upload.wikimedia.org → https://upload.wikimedia.org
  html = html.replace(/src="\/\/([^"]+)"/gi, 'src="https://$1"')
             .replace(/href="\/\/([^"]+)"/gi, 'href="https://$1"');

  // root-relative /wiki/Foo → https://LANG.wikisource.org/wiki/Foo
  html = html.replace(/(src|href)="\/([^"]*)"/gi, (_m, attr, path) => `${attr}="${origin}/${path}"`);

  return html;
}

/** Fetch & sanitize Wikisource page (MediaWiki API parse). */
async function fetchWikisourceSanitizedHtml(lang, title) {
  const api = `https://${lang}.wikisource.org/w/api.php?action=parse&format=json&prop=text&disablelimitreport=1&formatversion=2&page=${encodeURIComponent(title)}`;
  const r = await fetch(api, { headers: { 'User-Agent': 'BookLantern/1.0 (+https://booklantern.org)' }});
  if (!r.ok) throw new Error(`Wikisource API bad status: ${r.status}`);
  const data = await r.json();
  let html = data?.parse?.text || '';
  if (!html) throw new Error('No parse.text');
  html = sanitizeWikisourceHtml(html);
  html = absolutizeWikisourceUrls(lang, html);

  // Optional: strip site-specific boilerplate containers if present
  // (Keep it simple; many pages are already mostly content.)
  return html;
}

/* Reader shell (HTML mode) */
router.get('/read/wikisource/:lang/:title/reader', requireUser, async (req, res) => {
  const lang  = String(req.params.lang || 'en').toLowerCase();
  const title = String(req.params.title || '').trim();
  if (!title) return res.redirect('/read');

  // We keep the heavy HTML out of the initial render — the view will fetch it from /text endpoint:
  return res.render('unified-reader', {
    htmlTitle: title.replace(/_/g,' '),
    htmlAuthor: '', // unknown by default (Wikisource parse can extract later if needed)
    htmlFetchUrl: `/read/wikisource/${encodeURIComponent(lang)}/${encodeURIComponent(title)}/text`,
    pageTitle: `Read • ${title.replace(/_/g,' ')}`
  });
});

/* Text endpoint (returns sanitized HTML string for the reader to inject) */
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
