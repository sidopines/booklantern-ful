// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

/* Helpers */
function card({ identifier, title, creator = '', cover = '', source, readerUrl = '', archiveId = '' }) {
  return { identifier, title, creator, cover, source, readerUrl, archiveId };
}

/* --------------------------- Open Library search --------------------------- */
async function searchOpenLibrary(q, limit = 60) {
  const url = `https://openlibrary.org/search.json?mode=everything&limit=${limit}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url);
  const data = await r.json();
  const docs = Array.isArray(data.docs) ? data.docs : [];
  return docs.map(d => {
    const id = d.key || d.work_key || d.edition_key?.[0] || '';
    const author = Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || '');
    let cover = '';
    if (d.cover_i) cover = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
    else if (d.edition_key && d.edition_key[0]) cover = `https://covers.openlibrary.org/b/olid/${d.edition_key[0]}-M.jpg`;
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
    const startUrl = `https://www.gutenberg.org/ebooks/${gid}`;
    const readerUrl = `/read/gutenberg/${gid}/reader?u=${encodeURIComponent(startUrl)}`;
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
    const [ol, gb, ia] = await Promise.all([
      searchOpenLibrary(query).catch(() => []),
      searchGutenberg(query).catch(() => []),
      searchArchive(query).catch(() => [])
    ]);
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

/* ----------------------------- Auth helper --------------------------------- */
function requireUser(req, res, next){
  if (!req.session?.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

/* -------------------------------------------------------------------------- */
/*                      GUTENBERG (ePub.js READER + PROXY)                    */
/* -------------------------------------------------------------------------- */

/** ePub proxy (avoids CORS). We try multiple canonical URLs:
 *  - /ebooks/{gid}.epub.images?download
 *  - /ebooks/{gid}.epub.noimages?download
 *  - /cache/epub/{gid}/pg{gid}-images.epub
 *  - /cache/epub/{gid}/pg{gid}.epub
 * Sends Content-Type: application/epub+zip and streams the body.
 */
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
        // Node 18+ global fetch returns a web stream; pipe via .body
        return resp.body.pipe(res);
      }
    }
    return res.status(404).send('ePub not found');
  } catch (e) {
    console.error('proxy gutenberg epub err', e);
    res.status(500).send('Proxy error');
  }
});

/** Reader page: renders views/unified-reader.ejs which loads the ePub
 *  from /proxy/gutenberg-epub/:gid and displays with ePub.js.
 *  Protected for logged-in users.
 */
router.get('/read/gutenberg/:gid/reader', requireUser, async (req, res) => {
  const gid = String(req.params.gid).replace(/[^0-9]/g,'');
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

/* -------------------------------------------------------------------------- */

module.exports = router;
