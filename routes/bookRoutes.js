// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 BookLantern/1.0';

/* Connectors (all return [] on failure) */
const { searchGutenberg, fetchGutenbergMeta } = require('../connectors/gutenberg');
const { searchWikisource } = require('../connectors/wikisource');
const { searchOpenLibrary } = require('../connectors/openlibrary');
const { searchStandardEbooks } = require('../connectors/standardebooks');
const { searchFeedbooksPD } = require('../connectors/feedbooks');
const { searchHathiFullView } = require('../connectors/hathitrust');
const { searchLOC } = require('../connectors/loc');

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

/* ---------------- Gutenberg helpers ---------------- */
async function headOrGetJson(url) {
  // Some mirrors reject HEAD; try HEAD then GET (no body read) to obtain headers/status.
  let resp;
  try {
    resp = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA, 'Accept': 'application/epub+zip,application/octet-stream,*/*' } });
    if (resp.ok) return { ok: true, status: resp.status, headers: resp.headers, url: resp.url };
  } catch (e) {}
  try {
    resp = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA, 'Accept': 'application/epub+zip,application/octet-stream,*/*' } });
    return { ok: resp.ok, status: resp.status, headers: resp.headers, url: resp.url };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function isEpubLike(headers) {
  const ct = (headers?.get('content-type') || '').toLowerCase();
  return ct.includes('application/epub+zip') || ct.includes('application/octet-stream');
}

// Cover both old/new Gutenberg naming (-images.epub, .epub, and -0.epub)
function candidateGutenbergUrls(gid, preferImages=true, noImagesHint=false) {
  const id = String(gid).replace(/[^0-9]/g,'');
  const base = `https://www.gutenberg.org`;
  const cache = `${base}/cache/epub/${id}`;
  const dl = `${base}/ebooks/${id}`;
  const list = [];
  if (!noImagesHint && preferImages) {
    list.push(`${dl}.epub.images?download`);
    list.push(`${cache}/pg${id}-images.epub`);
  }
  // generic
  list.push(`${dl}.epub.noimages?download`);
  list.push(`${cache}/pg${id}.epub`);
  // new naming sometimes uses -0.epub (UTF-8)
  list.push(`${cache}/${id}-0.epub`);
  return list;
}

async function resolveGutenbergEpubUrl(gid, { preferImages=true, noImagesHint=false } = {}) {
  const urls = candidateGutenbergUrls(gid, preferImages, noImagesHint);
  for (const u of urls) {
    const p = await headOrGetJson(u);
    if (p?.ok && isEpubLike(p.headers)) return p.url || u;
    // Accept octet-stream with unknown content-length as well
    if (p?.ok && (p.headers?.get('content-type') || '').toLowerCase().includes('octet-stream')) return p.url || u;
  }
  // Fallback: use Gutendex formats to find an application/epub+zip link
  try {
    const r = await fetch(`https://gutendex.com/books/${String(gid).replace(/[^0-9]/g,'')}`, { headers: { 'User-Agent': UA } });
    if (r.ok) {
      const j = await r.json();
      const fmt = j?.formats || {};
      // Prefer explicit epub links
      const keys = Object.keys(fmt);
      const epubKey = keys.find(k => k.startsWith('application/epub+zip'));
      if (epubKey && fmt[epubKey]) {
        // quick header check
        const p2 = await headOrGetJson(fmt[epubKey]);
        if (p2?.ok) return p2.url || fmt[epubKey];
      }
    }
  } catch (e) {
    console.error('[GUTENDEX] fallback error', e);
  }
  return null;
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

    // Search all sources with individual error handling
    let gb = [], se = [], ws = [], ia = [], ol = [], fb = [], ht = [], loc = [];
    
    try {
      gb = await searchGutenberg(query, 32);
    } catch (e) {
      console.error('Gutenberg search failed:', e.message);
    }
    
    try {
      se = await searchStandardEbooks(query, 16);
    } catch (e) {
      console.error('Standard Ebooks search failed:', e.message);
    }
    
    try {
      ws = await searchWikisource(query, 16, 'en');
    } catch (e) {
      console.error('Wikisource search failed:', e.message);
    }
    
    try {
      ia = await searchArchive(query, 24);
    } catch (e) {
      console.error('Archive.org search failed:', e.message);
    }
    
    try {
      ol = await searchOpenLibrary(query, 40);
    } catch (e) {
      console.error('Open Library search failed:', e.message);
    }
    
    try {
      fb = await searchFeedbooksPD(query, 20);
    } catch (e) {
      console.error('Feedbooks search failed:', e.message);
    }
    
    try {
      ht = await searchHathiFullView(query, 20);
    } catch (e) {
      console.error('HathiTrust search failed:', e.message);
    }
    
    try {
      loc = await searchLOC(query, 20);
    } catch (e) {
      console.error('Library of Congress search failed:', e.message);
    }

    // Only include Wikisource results if they exist (filtered for book-like content)
    const sources = [se, gb, ol, ia, fb, ht, loc]; // Standard Ebooks, Gutenberg, Open Library, Archive, Feedbooks, HathiTrust, LOC
    if (ws.length > 0) {
      sources.push(ws);
    }
    
    const merged = deDupe(sources.flat()); // show curated Standard Ebooks first
    
    // Log search results with the requested format
    console.log('SEARCH "%s" — counts: gutenberg=%d, archive=%d, openlibrary=%d, standardebooks=%d, feedbooks=%d, hathitrust=%d, loc=%d, merged=%d',
      query, gb.length, ia.length, ol.length, se.length, fb.length, ht.length, loc.length, merged.length);

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

/* ---------------- Gutenberg: Rock-solid EPUB proxy ---------------- */

// Helper function to resolve working EPUB URL
async function resolveGutenbergEpubUrl(gid, preferImages = true) {
  const UA = 'Mozilla/5.0 BookLantern';
  const candidates = preferImages ? [
    `https://www.gutenberg.org/ebooks/${gid}.epub.images?download`,
    `https://www.gutenberg.org/ebooks/${gid}.epub.noimages?download`,
    `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}-images.epub`,
    `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.epub`,
  ] : [
    `https://www.gutenberg.org/ebooks/${gid}.epub.noimages?download`,
    `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.epub`,
    `https://www.gutenberg.org/ebooks/${gid}.epub.images?download`,
    `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}-images.epub`,
  ];

  for (const url of candidates) {
    try {
      // Try HEAD first
      const headResp = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        headers: {
          'User-Agent': UA,
          'Accept': 'application/epub+zip,application/octet-stream,*/*'
        }
      });

      if (headResp.ok) {
        const contentType = headResp.headers.get('content-type') || '';
        if (contentType.includes('application/epub+zip') || contentType.includes('application/octet-stream')) {
          console.log(`[GUTENBERG] Found working URL: ${url} (content-type: ${contentType})`);
          return url;
        }
      }

      // If HEAD fails or wrong content-type, try GET
      const getResp = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': UA,
          'Accept': 'application/epub+zip,application/octet-stream,*/*'
        }
      });

      if (getResp.ok) {
        const contentType = getResp.headers.get('content-type') || '';
        if (contentType.includes('application/epub+zip') || contentType.includes('application/octet-stream')) {
          console.log(`[GUTENBERG] Found working URL via GET: ${url} (content-type: ${contentType})`);
          return url;
        }
      }

      console.log(`[GUTENBERG] URL failed: ${url} (status: ${headResp.status}/${getResp.status})`);
    } catch (e) {
      console.log(`[GUTENBERG] URL error: ${url} - ${e.message}`);
    }
  }

  return null;
}

router.get('/proxy/gutenberg-epub/:gid', async (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
  const debug = req.query.debug === '1';
  const noImagesHint = req.query.alt === 'noimages';  // from UI retry button

  if (!gid) return res.status(400).send('bad id');

  try {
    // Try up to 2 passes: preferImages pass, then non-prefer if first fails.
    let resolved = await resolveGutenbergEpubUrl(gid, { preferImages: !noImagesHint, noImagesHint });
    if (!resolved) {
      resolved = await resolveGutenbergEpubUrl(gid, { preferImages: false, noImagesHint: true });
    }
    if (!resolved) {
      console.error('[GUTENBERG] No working EPUB', { gid });
      if (debug) return res.status(404).json({ error: 'No working EPUB', gid });
      return res.status(404).send('EPUB not found');
    }

    if (debug) {
      return res.json({ gid, resolved });
    }

    // Stream with realistic headers
    const upstream = await fetch(resolved, {
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'application/epub+zip,application/octet-stream,*/*',
        'Referer': 'https://www.gutenberg.org/',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!upstream.ok) {
      console.error('[GUTENBERG] upstream not ok', { gid, status: upstream.status, url: resolved });
      return res.status(502).send('Bad gateway (upstream not ok)');
    }

    // Set passthrough-ish headers
    res.setHeader('Content-Type','application/epub+zip');
    res.setHeader('Content-Disposition', `inline; filename="gutenberg-${gid}.epub"`);
    res.setHeader('Cache-Control','public, max-age=3600');

    const al = upstream.headers.get('accept-ranges');
    if (al) res.setHeader('Accept-Ranges', al);
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);

    // Pipe
    upstream.body.on('error', (e) => {
      console.error('[GUTENBERG] stream error', { gid, url: resolved, err: e?.message });
      try { res.destroy(e); } catch {}
    });
    upstream.body.pipe(res);

  } catch (e) {
    console.error('[GUTENBERG] proxy error', { gid, err: e?.message });
    return res.status(502).send('Bad gateway (exception)');
  }
});

/* Gutenberg reader shell */
router.get('/read/gutenberg/:gid/reader', requireUser, async (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g, '');
  if (!gid) return res.redirect('/read');

  let title = `Project Gutenberg #${gid}`;
  let author = '';
  try {
    const meta = await fetchGutenbergMeta(gid);
    if (meta) {
      title = meta.title || title;
      author = Array.isArray(meta.authors) && meta.authors[0] ? (meta.authors[0].name || '') : '';
    }
  } catch (_) {}

  const epubUrl = `/proxy/gutenberg-epub/${gid}`;
  
  // Add concise server-side logging
  console.log('[READER] gutenberg gid=%s url=%s', gid, epubUrl);

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

/* ---------------- Standard Ebooks reader ---------------- */
router.get('/read/standardebooks/:slug/reader', requireUser, async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  if (!slug) return res.redirect('/read');

  let title = `Standard Ebooks: ${slug}`;
  let author = '';
  
  try {
    // Try to get metadata from the book page
    const bookUrl = `https://standardebooks.org/ebooks/${slug}`;
    const r = await fetch(bookUrl, { headers: { 'User-Agent': 'BookLanternBot/1.0' } });
    if (r.ok) {
      const html = await r.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) title = titleMatch[1].replace(' | Standard Ebooks', '').trim();
    }
  } catch (_) {}

  const epubUrl = `/proxy/standardebooks-epub/${encodeURIComponent(slug)}`;

  res.render('unified-reader', {
    pageTitle: title ? `Read • ${title}` : 'Read • Standard Ebooks',
    pageDescription: title ? `Read ${title} on BookLantern` : 'Read on BookLantern',
    mode: 'epub',
    epubUrl,
    title,
    author
  });
});

/* ---------------- Standard Ebooks EPUB proxy ---------------- */
router.get('/proxy/standardebooks-epub/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  if (!slug) return res.status(400).send('Bad slug');

  const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';
  const epubUrl = `https://standardebooks.org/ebooks/${slug}.epub`;

  try {
    const r = await fetch(epubUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'application/epub+zip,application/octet-stream;q=0.9,*/*;q=0.1'
      }
    });
    
    if (!r.ok) {
      console.error(`[standardebooks-epub] HTTP ${r.status} for ${epubUrl} (slug: ${slug})`);
      return res.status(404).send('EPUB not found');
    }
    
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 4) {
      console.error(`[standardebooks-epub] Empty response for ${epubUrl} (slug: ${slug})`);
      return res.status(404).send('EPUB not found');
    }
    
    if (buf[0] !== 0x50 || buf[1] !== 0x4B) {
      console.error(`[standardebooks-epub] Not a ZIP file for ${epubUrl} (slug: ${slug})`);
      return res.status(404).send('EPUB not found');
    }
    
    console.log(`[standardebooks-epub] Success for ${epubUrl} (slug: ${slug}, size: ${buf.length})`);
    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', String(buf.length));
    return res.end(buf);
  } catch (e) {
    console.error(`[standardebooks-epub] Fetch error for ${epubUrl} (slug: ${slug}):`, e.message);
    res.status(502).send('Fetch error');
  }
});

/* ---------------- Feedbooks reader ---------------- */
router.get('/read/feedbooks/:title/reader', requireUser, async (req, res) => {
  const title = String(req.params.title || '').trim();
  const epubUrl = req.query.epub;
  
  if (!title || !epubUrl) return res.redirect('/read');

  res.render('unified-reader', {
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`,
    mode: 'epub',
    epubUrl: `/proxy/feedbooks-epub?u=${encodeURIComponent(epubUrl)}`,
    title
  });
});

/* ---------------- Feedbooks EPUB proxy ---------------- */
router.get('/proxy/feedbooks-epub', async (req, res) => {
  const epubUrl = req.query.u;
  if (!epubUrl) return res.status(400).send('No URL provided');

  const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';

  try {
    const r = await fetch(epubUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'application/epub+zip,application/octet-stream;q=0.9,*/*;q=0.1'
      }
    });
    
    if (!r.ok) {
      console.error(`[feedbooks-epub] HTTP ${r.status} for ${epubUrl}`);
      return res.status(404).send('EPUB not found');
    }
    
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 4) {
      console.error(`[feedbooks-epub] Empty response for ${epubUrl}`);
      return res.status(404).send('EPUB not found');
    }
    
    if (buf[0] !== 0x50 || buf[1] !== 0x4B) {
      console.error(`[feedbooks-epub] Not a ZIP file for ${epubUrl}`);
      return res.status(404).send('EPUB not found');
    }
    
    console.log(`[feedbooks-epub] Success for ${epubUrl} (size: ${buf.length})`);
    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', String(buf.length));
    return res.end(buf);
  } catch (e) {
    console.error(`[feedbooks-epub] Fetch error for ${epubUrl}:`, e.message);
    res.status(502).send('Fetch error');
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
