// routes/bookRoutes.js
const express = require('express');
const { Readable } = require('node:stream'); // for piping web streams to Express
const router = express.Router();

/* -----------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------------*/
function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title, creator, cover, source, readerUrl, archiveId };
}

function ensureUser(req, res, next) {
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

/* -----------------------------------------------------------------------------
 * Open Library search (now asks for IA ids so we can open our reader)
 * ---------------------------------------------------------------------------*/
async function searchOpenLibrary(q, limit = 60) {
  const url = `https://openlibrary.org/search.json?mode=everything&q=${encodeURIComponent(q)}&limit=${limit}` +
              `&fields=key,work_key,edition_key,title,author_name,cover_i,ia,has_fulltext`;
  const r = await fetch(url);
  const data = await r.json();
  const docs = Array.isArray(data.docs) ? data.docs : [];

  return docs.map(d => {
    const author = Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || '');
    // Cover (OL first; otherwise we’ll try IA thumb later when we have an ocaid)
    let cover = '';
    if (d.cover_i) cover = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
    else if (d.edition_key && d.edition_key[0]) cover = `https://covers.openlibrary.org/b/olid/${d.edition_key[0]}-M.jpg`;

    // If OL already tells us an IA identifier, we can open our internal IA reader directly.
    const ia = Array.isArray(d.ia) && d.ia.length ? String(d.ia[0]) : '';

    // Decide the click target:
    //  - If IA id exists -> open our internal IA viewer
    //  - Else if we have a specific edition -> attempt an OL edition resolver
    //  - Else if we have a work key -> attempt a work resolver
    //  - Else -> fallback to a search within /read
    let readerUrl = '';
    if (ia) {
      readerUrl = `/read/book/${encodeURIComponent(ia)}`;
      // Prefer IA thumbnail if OL cover was missing
      if (!cover) cover = `https://archive.org/services/img/${encodeURIComponent(ia)}`;
    } else if (Array.isArray(d.edition_key) && d.edition_key[0]) {
      readerUrl = `/openlibrary/edition/${encodeURIComponent(d.edition_key[0])}`;
    } else if (Array.isArray(d.work_key) && d.work_key[0]) {
      const wk = String(d.work_key[0]).replace(/^\/works\//, '');
      readerUrl = `/openlibrary/work/${encodeURIComponent(wk)}`;
    } else if (typeof d.key === 'string' && d.key.startsWith('/works/')) {
      const wk = d.key.replace(/^\/works\//, '');
      readerUrl = `/openlibrary/work/${encodeURIComponent(wk)}`;
    } else {
      readerUrl = `/read?query=${encodeURIComponent(`${d.title || ''} ${author || ''}`)}`;
    }

    return card({
      identifier: `openlibrary:${d.key || d.work_key || (d.edition_key && d.edition_key[0]) || ''}`,
      title: d.title || '(Untitled)',
      creator: author || '',
      cover,
      source: 'openlibrary',
      readerUrl
    });
  });
}

/* -----------------------------------------------------------------------------
 * Gutenberg search (opens internal reader)
 * ---------------------------------------------------------------------------*/
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
    // Our internal Gutenberg reader (ePub.js)
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

/* -----------------------------------------------------------------------------
 * Internet Archive search (opens our internal BookReader wrapper)
 * ---------------------------------------------------------------------------*/
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

/* -----------------------------------------------------------------------------
 * /read  (search hub)
 * ---------------------------------------------------------------------------*/
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

    const [ol, gb, ia] = await Promise.all([
      searchOpenLibrary(query).catch(() => []),
      searchGutenberg(query).catch(() => []),
      searchArchive(query).catch(() => [])
    ]);

    // Mix so users see “instantly readable” items first:
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

/* -----------------------------------------------------------------------------
 * Internet Archive internal viewer
 * ---------------------------------------------------------------------------*/
router.get('/read/book/:identifier', ensureUser, async (req, res) => {
  const id = String(req.params.identifier || '').trim();
  if (!id) return res.redirect('/read');

  let title = id;
  try {
    const metaR = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`);
    if (metaR.ok) {
      const meta = await metaR.json();
      if (meta?.metadata?.title) title = meta.metadata.title;
    }
  } catch (_) { /* ignore */ }

  return res.render('book-viewer', {
    iaId: id,
    title,
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`
  });
});

/* -----------------------------------------------------------------------------
 * Gutenberg: ePub proxy (avoids CORS)  → /proxy/gutenberg-epub/:gid
 * ---------------------------------------------------------------------------*/
router.get('/proxy/gutenberg-epub/:gid', ensureUser, async (req, res) => {
  try {
    const gid = String(req.params.gid).replace(/[^0-9]/g, '');
    if (!gid) return res.status(400).send('Bad id');

    // Try a few common ePub URLs
    const urls = [
      `https://www.gutenberg.org/ebooks/${gid}.epub.images?download`,
      `https://www.gutenberg.org/ebooks/${gid}.epub.noimages?download`,
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}-images.epub`,
      `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.epub`
    ];

    let resp = null;
    for (const u of urls) {
      const tryResp = await fetch(u, { redirect: 'follow' });
      if (tryResp.ok && tryResp.body) { resp = tryResp; break; }
    }
    if (!resp) return res.status(404).send('ePub not found');

    res.setHeader('Content-Type', 'application/epub+zip');
    // Convert WHATWG stream -> Node stream
    return Readable.fromWeb(resp.body).pipe(res);
  } catch (e) {
    console.error('proxy gutenberg epub err', e);
    res.status(500).send('Proxy error');
  }
});

/* -----------------------------------------------------------------------------
 * Gutenberg: internal reader (ePub.js shell)  → /read/gutenberg/:gid/reader
 * - The actual paging happens in views/unified-reader.ejs
 * - That page pulls the ePub via /proxy/gutenberg-epub/:gid
 * ---------------------------------------------------------------------------*/
router.get('/read/gutenberg/:gid/reader', ensureUser, (req, res) => {
  const gid = String(req.params.gid).replace(/[^0-9]/g, '');
  res.render('unified-reader', {
    gid,
    pageTitle: `Read • #${gid}`,
    pageDescription: 'Distraction-free reading'
  });
});

/* -----------------------------------------------------------------------------
 * Gutenberg: server-side plain text / html (fallback for rare ePub gaps)
 * Client can call this if ePub fails to load and we’ll paginate on the fly.
 * ---------------------------------------------------------------------------*/
router.get('/read/gutenberg/:gid/text', ensureUser, async (req, res) => {
  try {
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
      pick('text/plain; charset=utf-8', 'text/plain; charset=us-ascii', 'text/plain') ||
      pick('text/html; charset=utf-8', 'text/html', 'application/xhtml+xml');

    if (!url) return res.status(404).json({ error: 'No readable format found' });

    const bookR = await fetch(url, { redirect: 'follow' });
    const ctype = (bookR.headers.get('content-type') || '').toLowerCase();
    const raw = await bookR.text();

    res.setHeader('Cache-Control', 'public, max-age=600');
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

/* -----------------------------------------------------------------------------
 * Open Library resolvers
 *  - edition → try to extract IA ocaid, else fall back to a search
 *  - work    → scan editions for an IA ocaid, else fall back to a search
 * These keep users inside BookLantern whenever an IA scan exists.
 * ---------------------------------------------------------------------------*/
router.get('/openlibrary/edition/:olid', ensureUser, async (req, res) => {
  try {
    const olid = String(req.params.olid).trim();
    const edR = await fetch(`https://openlibrary.org/books/${encodeURIComponent(olid)}.json`);
    if (!edR.ok) return res.redirect('/read');
    const ed = await edR.json();

    const ocaid = ed?.ocaid || (Array.isArray(ed?.ia) && ed.ia[0]);
    if (ocaid) return res.redirect(`/read/book/${encodeURIComponent(ocaid)}`);

    // No IA scan—fallback to search by title + author
    const title = ed?.title || '';
    let author = '';
    if (Array.isArray(ed?.authors) && ed.authors[0]?.key) {
      const aR = await fetch(`https://openlibrary.org${ed.authors[0].key}.json`);
      if (aR.ok) {
        const a = await aR.json();
        author = a?.name || '';
      }
    }
    return res.redirect(`/read?query=${encodeURIComponent(`${title} ${author}`.trim())}`);
  } catch (_) {
    return res.redirect('/read');
  }
});

router.get('/openlibrary/work/:workId', ensureUser, async (req, res) => {
  try {
    const wk = String(req.params.workId).trim();
    const wR = await fetch(`https://openlibrary.org/works/${encodeURIComponent(wk)}.json`);
    if (!wR.ok) return res.redirect('/read');
    const w = await wR.json();
    const title = w?.title || '';

    // Try editions (look for 'ocaid')
    const eR = await fetch(`https://openlibrary.org/works/${encodeURIComponent(wk)}/editions.json?limit=50`);
    if (eR.ok) {
      const eData = await eR.json();
      const entries = Array.isArray(eData?.entries) ? eData.entries : [];
      const withIa = entries.find(e => e.ocaid || (Array.isArray(e.ia) && e.ia[0]));
      const ocaid = withIa?.ocaid || (Array.isArray(withIa?.ia) && withIa.ia[0]);
      if (ocaid) return res.redirect(`/read/book/${encodeURIComponent(ocaid)}`);
    }

    // Fallback: search by title + (first) author
    let author = '';
    if (Array.isArray(w?.authors) && w.authors[0]?.author?.key) {
      const aR = await fetch(`https://openlibrary.org${w.authors[0].author.key}.json`);
      if (aR.ok) {
        const a = await aR.json();
        author = a?.name || '';
      }
    }
    return res.redirect(`/read?query=${encodeURIComponent(`${title} ${author}`.trim())}`);
  } catch (_) {
    return res.redirect('/read');
  }
});

module.exports = router;
