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
    list.push(`${dl}.epub.images?download=1`);
    list.push(`${cache}/pg${id}-images.epub`);
    list.push(`${cache}/${id}-0.epub`);
    list.push(`${dl}.epub.noimages?download=1`);
    list.push(`${cache}/pg${id}.epub`);
  } else {
    list.push(`${dl}.epub.noimages?download=1`);
    list.push(`${cache}/pg${id}.epub`);
    list.push(`${dl}.epub.images?download=1`);
    list.push(`${cache}/pg${id}-images.epub`);
    list.push(`${cache}/${id}-0.epub`);
  }
  return list;
}

// Removed duplicate resolveGutenbergEpubUrl function - using the better implementation below

/* --------------- Archive.org (public-domain only) --------------- */
async function searchArchive(q, rows = 30) {
  try {
    // Use AdvancedSearch with safe filters for public, readable content
    const query = `("${q}") AND mediatype:texts`;
    const api = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=downloads&fl[]=language&sort[]=downloads desc&rows=${rows}&output=json`;
    const r = await fetch(api);
    if (!r.ok) return [];
    const data = await r.json();
    const docs = data?.response?.docs || [];
    
    // Keep items whose identifier has a corresponding embed page
    const filtered = docs.filter(d => d.identifier);
    
    const cards = filtered.map(d => ({
      identifier: `archive:${d.identifier}`,
      title: d.title || '(Untitled)',
      creator: d.creator || '',
      cover: `https://archive.org/services/img/${d.identifier}`,
      source: 'archive',
      openInline: true,
      kind: 'ia',
      iaId: d.identifier,
      href: `/read/ia/${d.identifier}`,
      readerUrl: `/read/ia/${d.identifier}` // for backward compatibility
    }));
    
    console.log(`[ARCHIVE] results ${cards.length} (public only)`);
    return cards;
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
    
    // Final gate: keep only items with openInline === true (i.e., they have href to our routes)
    const filtered = merged.filter(item => item.openInline === true);
    
    // Log search results with the requested format
    console.log('SEARCH "%s" — counts: gutenberg=%d, archive=%d, openlibrary=%d, standardebooks=%d, feedbooks=%d, hathitrust=%d, loc=%d, merged=%d, filtered=%d',
      query, gb.length, ia.length, ol.length, se.length, fb.length, ht.length, loc.length, merged.length, filtered.length);

    res.render('read', {
      pageTitle: `Search • ${query}`,
      pageDescription: `Results for “${query}”`,
      books: filtered,
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

/* --------- IA inline reader --------- */
router.get('/read/ia/:iaId', requireUser, async (req, res) => {
  const iaId = String(req.params.iaId || '').trim();
  if (!iaId) return res.redirect('/read');

  let title = iaId;
  try {
    const metaR = await fetch(`https://archive.org/metadata/${encodeURIComponent(iaId)}`);
    if (metaR.ok) {
      const meta = await metaR.json();
      if (meta?.metadata?.title) title = meta.metadata.title;
    }
  } catch (_) {}
  
  return res.render('unified-reader', {
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`,
    mode: 'ia',
    iaId,
    title
  });
});

/* ---------------- Gutenberg: Rock-solid EPUB proxy ---------------- */

// Helper function to resolve working EPUB URL
async function resolveGutenbergEpubUrl(gid, { preferImages = true, noImagesHint = false } = {}) {
  const id = String(gid).replace(/[^0-9]/g, '');
  const base = `https://www.gutenberg.org`;
  const cache = `${base}/cache/epub/${id}`;
  const dl = `${base}/ebooks/${id}`;
  
  // Build candidate list in exact order specified
  const candidates = [];
  if (!noImagesHint && preferImages) {
    candidates.push(`${dl}.epub.images?download=1`);
    candidates.push(`${cache}/pg${id}-images.epub`);
    candidates.push(`${cache}/${id}-0.epub`);
    candidates.push(`${dl}.epub.noimages?download=1`);
    candidates.push(`${cache}/pg${id}.epub`);
  } else {
    candidates.push(`${dl}.epub.noimages?download=1`);
    candidates.push(`${cache}/pg${id}.epub`);
    candidates.push(`${dl}.epub.images?download=1`);
    candidates.push(`${cache}/pg${id}-images.epub`);
    candidates.push(`${cache}/${id}-0.epub`);
  }

  for (const url of candidates) {
    try {
      const resp = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 BookLantern/1.0',
          'Accept': 'application/epub+zip,application/octet-stream;q=0.9,*/*;q=0.5',
          'Referer': 'https://www.gutenberg.org/'
        }
      });

      if (resp.ok) {
        const contentType = (resp.headers.get('content-type') || '').toLowerCase();
        if (contentType.startsWith('application/epub+zip') || contentType.startsWith('application/octet-stream')) {
          console.log('[GUTENBERG] resolved', id, resp.url || url);
          return resp.url || url;
        }
      }
      
      console.error('[GUTENBERG] upstream not ok', { gid: id, status: resp.status, url });
    } catch (e) {
      console.error('[GUTENBERG] upstream not ok', { gid: id, status: 'error', url, error: e.message });
    }
  }

  // Fallback: use Gutendex formats to find an application/epub+zip link
  try {
    const r = await fetch(`https://gutendex.com/books/${id}`, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 BookLantern/1.0' 
      } 
    });
    if (r.ok) {
      const j = await r.json();
      const fmt = j?.formats || {};
      // Prefer explicit epub links
      const keys = Object.keys(fmt);
      const epubKey = keys.find(k => k.startsWith('application/epub+zip'));
      if (epubKey && fmt[epubKey]) {
        // quick header check
        const p2 = await fetch(fmt[epubKey], { method: 'HEAD', redirect: 'follow' });
        if (p2?.ok) {
          console.log('[GUTENBERG] resolved via gutendex', id, fmt[epubKey]);
          return fmt[epubKey];
        }
      }
    }
  } catch (e) {
    console.error('[GUTENDEX] fallback error', e);
  }
  
  return null;
}

router.get('/proxy/gutenberg-epub/:gid', async (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
  const debug = req.query.debug === '1';
  const alt = req.query.alt;

  if (!gid) return res.status(400).send('bad id');

  try {
    const preferImages = alt !== 'noimages';
    const resolved = await resolveGutenbergEpubUrl(gid, { preferImages, noImagesHint: alt === 'noimages' });
    
    if (!resolved) {
      console.error('[GUTENBERG] No working EPUB', { gid, tried: candidateGutenbergUrls(gid, preferImages, alt === 'noimages') });
      if (debug) {
        return res.status(502).json({ 
          gid, 
          tried: candidateGutenbergUrls(gid, preferImages, alt === 'noimages'),
          error: 'No working EPUB found' 
        });
      }
      return res.status(502).send('Bad gateway (no working EPUB)');
    }

    if (debug) {
      return res.json({ gid, resolvedUrl: resolved });
    }

    // Stream with realistic headers
    const upstream = await fetch(resolved, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 BookLantern/1.0',
        'Accept': 'application/epub+zip,application/octet-stream;q=0.9,*/*;q=0.5',
        'Referer': 'https://www.gutenberg.org/'
      }
    });

    if (!upstream.ok) {
      console.error('[GUTENBERG] upstream not ok', { gid, status: upstream.status, url: resolved });
      return res.status(502).send('Bad gateway (upstream not ok)');
    }

    // Copy relevant headers
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    
    const contentDisposition = upstream.headers.get('content-disposition');
    if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);
    else res.setHeader('Content-Disposition', `inline; filename="gutenberg-${gid}.epub"`);

    // Pipe the stream - handle both Node.js and browser fetch responses
    if (upstream.body && typeof upstream.body.on === 'function') {
      // Node.js response
      upstream.body.on('error', (e) => {
        console.error('[GUTENBERG] stream error', { gid, url: resolved, err: e?.message });
        try { res.destroy(e); } catch {}
      });
      upstream.body.pipe(res);
    } else {
      // Browser fetch response - convert to buffer and send
      const buffer = await upstream.arrayBuffer();
      res.end(Buffer.from(buffer));
    }

  } catch (e) {
    console.error('[GUTENBERG] proxy error', { gid, err: e?.message });
    return res.status(502).send('Bad gateway (exception)');
  }
});

// Health endpoint for testing Gutenberg resolution
router.get('/health/gutenberg/:gid', async (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
  const alt = req.query.alt;

  if (!gid) return res.status(400).json({ error: 'bad id' });

  try {
    const preferImages = alt !== 'noimages';
    const resolved = await resolveGutenbergEpubUrl(gid, { preferImages, noImagesHint: alt === 'noimages' });
    
    if (resolved) {
      return res.json({ ok: true, resolvedUrl: resolved });
    } else {
      return res.json({ ok: false, error: 'No working EPUB found' });
    }
  } catch (e) {
    console.error('[GUTENBERG] health check error', { gid, err: e?.message });
    return res.status(500).json({ ok: false, error: e?.message });
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

/* ---------------- PDF reader ---------------- */
router.get('/read/pdf', requireUser, async (req, res) => {
  const src = req.query.src;
  const title = req.query.title || 'Unknown';
  
  if (!src) return res.redirect('/read');

  res.render('unified-reader', {
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`,
    mode: 'pdf',
    pdfUrl: src,
    title
  });
});

/* ---------------- Generic EPUB reader and proxy ---------------- */
router.get('/read/epub', requireUser, async (req, res) => {
  const src = req.query.src;
  const title = req.query.title || 'Unknown';
  const author = req.query.author || '';
  
  if (!src) return res.redirect('/read');

  res.render('unified-reader', {
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} on BookLantern`,
    mode: 'epub',
    epubUrl: `/proxy/epub?src=${encodeURIComponent(src)}`,
    title,
    author
  });
});

router.get('/proxy/epub', async (req, res) => {
  const src = req.query.src;
  if (!src) return res.status(400).send('No URL provided');

  try {
    const r = await fetch(src, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 BookLantern/1.0',
        'Accept': 'application/epub+zip,application/octet-stream;q=0.9,*/*;q=0.5'
      }
    });
    
    if (!r.ok) {
      console.error(`[epub-proxy] HTTP ${r.status} for ${src}`);
      return res.status(502).send('Bad gateway (upstream not ok)');
    }
    
    const contentType = r.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/epub+zip') && !contentType.toLowerCase().includes('application/octet-stream')) {
      console.error(`[epub-proxy] Wrong content-type ${contentType} for ${src}`);
      return res.status(502).send('Bad gateway (wrong content-type)');
    }
    
    // Copy relevant headers
    if (contentType) res.setHeader('Content-Type', contentType);
    
    const contentLength = r.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    
    const contentDisposition = r.headers.get('content-disposition');
    if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);
    
    // Pipe the stream
    r.body.on('error', (e) => {
      console.error('[epub-proxy] stream error', { src, err: e?.message });
      try { res.destroy(e); } catch {}
    });
    r.body.pipe(res);
    
  } catch (e) {
    console.error(`[epub-proxy] Fetch error for ${src}:`, e.message);
    res.status(502).send('Bad gateway (exception)');
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
