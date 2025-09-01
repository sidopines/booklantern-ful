// routes/bookRoutes.js
const express = require('express');
const router = express.Router();
const config = require('../config');
const fs = require('fs').promises;
const path = require('path');
const { createReadStream } = require('fs');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 BookLantern/1.0';

/* ---------------- Gutenberg Cache Management ---------------- */
const CACHE_DIR = './.cache/epub';
const MAX_CACHE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_CACHE_FILES = 200;
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// In-memory cache index
const cacheIndex = new Map();

// Ensure cache directory exists
async function ensureCacheDir() {
  try {
    await fs.access(CACHE_DIR);
  } catch {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  }
}

// Get cache file path
function getCachePath(gid, variant) {
  const filename = `gutenberg-${gid}-${variant}.epub`;
  return path.join(CACHE_DIR, filename);
}

// Get file stats
async function getFileStats(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats;
  } catch {
    return null;
  }
}

// Check if file is expired
function isExpired(stats) {
  return Date.now() - stats.mtime.getTime() > CACHE_TTL;
}

// Generate ETag
function generateETag(stats) {
  return `${stats.size}-${stats.mtime.getTime()}`;
}

// Clean up expired files
async function cleanupExpired() {
  try {
    const files = await fs.readdir(CACHE_DIR);
    let totalSize = 0;
    const fileStats = [];

    for (const file of files) {
      if (!file.endsWith('.epub')) continue;
      const filePath = path.join(CACHE_DIR, file);
      const stats = await getFileStats(filePath);
      if (!stats) continue;

      if (isExpired(stats)) {
        await fs.unlink(filePath);
        cacheIndex.delete(file);
      } else {
        totalSize += stats.size;
        fileStats.push({ file, stats, path: filePath });
      }
    }

    // LRU cleanup if needed
    if (fileStats.length > MAX_CACHE_FILES || totalSize > MAX_CACHE_SIZE) {
      fileStats.sort((a, b) => a.stats.mtime.getTime() - b.stats.mtime.getTime());
      const toDelete = fileStats.slice(0, Math.ceil(fileStats.length * 0.2)); // Delete 20% oldest
      
      for (const { path: filePath, file } of toDelete) {
        await fs.unlink(filePath);
        cacheIndex.delete(file);
      }
    }
  } catch (error) {
    console.error('[GUTENBERG] Cache cleanup error:', error.message);
  }
}

// Download and cache file
async function downloadAndCache(gid, variant, upstreamUrl) {
  const cachePath = getCachePath(gid, variant);
  const tempPath = `${cachePath}.tmp`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/epub+zip,application/octet-stream,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.gutenberg.org/'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/epub+zip') && !contentType.includes('application/octet-stream')) {
      throw new Error('Invalid content type');
    }

    // Stream to temp file
    const { Readable } = require('stream');
    const { pipeline } = require('stream/promises');
    const writeStream = require('fs').createWriteStream(tempPath);
    
    await pipeline(response.body, writeStream);
    
    // Atomic rename
    await fs.rename(tempPath, cachePath);
    
    // Update cache index
    const stats = await fs.stat(cachePath);
    cacheIndex.set(path.basename(cachePath), { size: stats.size, mtime: stats.mtime });
    
    return stats;
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath);
    } catch {}
    throw error;
  }
}

/* Connectors (all return [] on failure) */
const { searchGutenberg, fetchGutenbergMeta } = require('../connectors/gutenberg');
const { searchWikisource } = require('../connectors/wikisource');
const { searchOpenLibrary } = require('../connectors/openlibrary');
const { searchFeedbooksPD } = require('../connectors/feedbooks');
const { searchHathiFullView } = require('../connectors/hathitrust');
const { searchLOC } = require('../connectors/loc');
const { searchFreeWeb } = require('../connectors/freeweb');

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
    let gb = [], ws = [], ia = [], ol = [], fb = [], ht = [], loc = [], fw = [];
    
    try {
      gb = await searchGutenberg(query, 32);
    } catch (e) {
      console.error('Gutenberg search failed:', e.message);
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
    
    // Feature-flagged connectors
    if (config.CONNECTOR_FEEDBOOKS) {
      try {
        fb = await searchFeedbooksPD(query, 20);
      } catch (e) {
        console.error('Feedbooks search failed:', e.message);
      }
    }
    
    if (config.CONNECTOR_HATHI) {
      try {
        ht = await searchHathiFullView(query, 20);
      } catch (e) {
        console.error('HathiTrust search failed:', e.message);
      }
    }
    
    try {
      loc = await searchLOC(query, 20);
    } catch (e) {
      console.error('Library of Congress search failed:', e.message);
    }
    
    if (config.CONNECTOR_FREEWEB) {
      try {
        fw = await searchFreeWeb(query, 20);
      } catch (e) {
        console.error('FreeWeb search failed:', e.message);
      }
    }

    // Only include Wikisource results if they exist (filtered for book-like content)
    const sources = [gb, ol, ia, loc]; // Always enabled: Gutenberg, Open Library, Archive, LOC
    if (config.CONNECTOR_FEEDBOOKS && fb.length > 0) sources.push(fb);
    if (config.CONNECTOR_HATHI && ht.length > 0) sources.push(ht);
    if (config.CONNECTOR_FREEWEB && fw.length > 0) sources.push(fw);
    if (ws.length > 0) {
      sources.push(ws);
    }
    
    const merged = deDupe(sources.flat()); // show curated Standard Ebooks first
    
    // Final gate: keep only items with openInline === true (i.e., they have href to our routes)
    const filtered = merged.filter(item => item.openInline === true);
    
    // Log search results with the requested format
    const feedbooksCount = config.CONNECTOR_FEEDBOOKS ? fb.length : 0;
    const hathiCount = config.CONNECTOR_HATHI ? ht.length : 0;
    const freewebCount = config.CONNECTOR_FREEWEB ? fw.length : 0;
    console.log('SEARCH "%s" — counts: gutenberg=%d, archive=%d, openlibrary=%d, feedbooks=%d, hathitrust=%d, loc=%d, freeweb=%d, merged=%d, filtered=%d',
      query, gb.length, ia.length, ol.length, feedbooksCount, hathiCount, loc.length, freewebCount, merged.length, filtered.length);

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
    await ensureCacheDir();
    await cleanupExpired();

    const preferImages = alt !== 'noimages';
    const variant = preferImages ? 'images' : 'noimages';
    const cachePath = getCachePath(gid, variant);
    const tried = [];
    let resolvedUrl = null;

    // Check if file exists in cache
    const stats = await getFileStats(cachePath);
    const isCached = stats && stats.size > 0 && !isExpired(stats);

    if (debug) {
      return res.json({
        ok: true,
        gid,
        variant,
        cached: isCached,
        size: stats?.size || 0,
        path: cachePath,
        resolvedUrl: resolvedUrl || 'not resolved yet'
      });
    }

    // Handle ETag
    if (isCached) {
      const etag = generateETag(stats);
      res.setHeader('ETag', etag);
      
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }
    }

    // If not cached, resolve URL and download
    if (!isCached) {
      // Build candidate URLs
      const candidates = preferImages ? [
        `https://www.gutenberg.org/ebooks/${gid}.epub.images?download=1`,
        `https://www.gutenberg.org/files/${gid}/${gid}-epub-images.epub`,
        `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}-images.epub`,
        `https://www.gutenberg.org/cache/epub/${gid}/${gid}-0.epub`
      ] : [
        `https://www.gutenberg.org/ebooks/${gid}.epub.noimages?download=1`,
        `https://www.gutenberg.org/files/${gid}/${gid}-epub.noimages.epub`,
        `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.epub`
      ];

      // Try to resolve URL
      for (const url of candidates) {
        tried.push(url);
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s for HEAD

          const response = await fetch(url, {
            method: 'HEAD',
            headers: {
              'User-Agent': UA,
              'Accept': 'application/epub+zip,application/octet-stream,*/*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': 'https://www.gutenberg.org/'
            },
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/epub+zip') || contentType.includes('application/octet-stream')) {
              resolvedUrl = response.url || url;
              break;
            }
          }
        } catch (e) {
          // Continue to next candidate
        }
      }

      // If images variant failed, try no-images
      if (!resolvedUrl && preferImages) {
        const noImagesCandidates = [
          `https://www.gutenberg.org/ebooks/${gid}.epub.noimages?download=1`,
          `https://www.gutenberg.org/files/${gid}/${gid}-epub.noimages.epub`,
          `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.epub`
        ];

        for (const url of noImagesCandidates) {
          tried.push(url);
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(url, {
              method: 'HEAD',
              headers: {
                'User-Agent': UA,
                'Accept': 'application/epub+zip,application/octet-stream,*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.gutenberg.org/'
              },
              signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
              const contentType = response.headers.get('content-type') || '';
              if (contentType.includes('application/epub+zip') || contentType.includes('application/octet-stream')) {
                resolvedUrl = response.url || url;
                break;
              }
            }
          } catch (e) {
            // Continue to next candidate
          }
        }
      }

      // Fallback: try Gutendex
      if (!resolvedUrl) {
        try {
          const gutendexResponse = await fetch(`https://gutendex.com/books/${gid}`, {
            headers: { 'User-Agent': UA }
          });
          
          if (gutendexResponse.ok) {
            const data = await gutendexResponse.json();
            const formats = data?.formats || {};
            const epubUrl = formats['application/epub+zip'];
            
            if (epubUrl) {
              resolvedUrl = epubUrl;
              tried.push(epubUrl);
            }
          }
        } catch (e) {
          console.error('[GUTENBERG] gutendex fallback error', { gid, error: e.message });
        }
      }

      // Download and cache if URL resolved
      if (resolvedUrl) {
        try {
          const downloadStats = await downloadAndCache(gid, variant, resolvedUrl);
          
          if (config.IS_PRODUCTION) {
            console.log(`[GUTENBERG] 200 gid=${gid} cache=miss size=${downloadStats.size}`);
          }
          
          // Update stats for serving
          Object.assign(stats, downloadStats);
        } catch (error) {
          console.error('[GUTENBERG] Download failed:', error.message);
          return res.status(502).send('Download failed');
        }
      } else {
        if (config.IS_PRODUCTION) {
          console.log(`[GUTENBERG] FAIL gid=${gid} reason=no_valid_url`);
        }
        return res.status(502).send('No valid EPUB URL found');
      }
    } else {
      if (config.IS_PRODUCTION) {
        console.log(`[GUTENBERG] 200 gid=${gid} cache=hit size=${stats.size}`);
      }
    }

    // Serve from cache
    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    // Handle Range requests
    const range = req.headers.range;
    if (range) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1]);
        const end = match[2] ? parseInt(match[2]) : stats.size - 1;
        
        if (start >= stats.size) {
          return res.status(416).end();
        }
        
        const contentLength = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
        res.setHeader('Content-Length', contentLength);
        
        if (config.IS_PRODUCTION) {
          console.log(`[GUTENBERG] 206 gid=${gid} range=${start}-${end}/${stats.size} cache=hit`);
        }
        
        const stream = createReadStream(cachePath, { start, end });
        stream.pipe(res);
        return;
      }
    }

    // Full file request
    const stream = createReadStream(cachePath);
    stream.pipe(res);

  } catch (e) {
    console.error('[GUTENBERG] proxy error', { gid, error: e.message });
    return res.status(502).send('Internal error');
  }
});

// Health endpoint for testing Gutenberg cache status
router.get('/health/gutenberg/:gid', async (req, res) => {
  const gid = String(req.params.gid || '').replace(/[^0-9]/g,'');
  const alt = req.query.alt;

  if (!gid) return res.status(400).json({ error: 'bad id' });

  try {
    await ensureCacheDir();
    
    const preferImages = alt !== 'noimages';
    const variant = preferImages ? 'images' : 'noimages';
    const cachePath = getCachePath(gid, variant);
    const stats = await getFileStats(cachePath);
    
    const result = {
      ok: true,
      gid,
      cached: !!(stats && stats.size > 0 && !isExpired(stats)),
      size: stats?.size || 0,
      mtime: stats?.mtime?.toISOString() || null,
      variant,
      path: cachePath
    };
    
    return res.json(result);
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
  const debug = req.query.debug === '1';
  
  if (!src) {
    if (debug) return res.status(400).json({ ok: false, error: 'No URL provided' });
    return res.status(400).send('No URL provided');
  }

  try {
    // Decode src once and validate
    const upstreamUrl = decodeURIComponent(src);
    if (!upstreamUrl.startsWith('https://')) {
      if (debug) return res.status(400).json({ ok: false, error: 'Only HTTPS URLs allowed' });
      return res.status(400).send('Only HTTPS URLs allowed');
    }

    // Backward compatibility: if someone hits an old SE link, respond 410
    if (upstreamUrl.includes('standardebooks.org')) {
      console.log('[EPUB PROXY] Standard Ebooks legacy URL detected, returning 410');
      return res.status(410).json({ error: "Standard Ebooks removed" });
    }

    // Validate hostname is in our allowedHosts whitelist
    const allowedHosts = [
      'gutenberg.org',
      'feedbooks.com', 
      'gallica.bnf.fr',
      'digital.library.upenn.edu',
      'sacred-texts.com',
      'archive.org',
      'loc.gov'
    ];
    
    const urlObj = new URL(upstreamUrl);
    if (!allowedHosts.includes(urlObj.hostname)) {
      console.log('[EPUB PROXY] Host not allowed:', urlObj.hostname);
      if (debug) return res.status(403).json({ ok: false, error: 'Host not allowed' });
      return res.status(403).send('Host not allowed');
    }

    const tried = [];
    let finalUrl = upstreamUrl;
    let finalStatus = 0;
    let finalContentType = '';
    let responded = false;
    let redirectCount = 0;
    const maxRedirects = 3;

    // Helper function to check if response is EPUB
    function isEpub(headers, url) {
      const contentType = (headers.get('content-type') || '').toLowerCase();
      return contentType.includes('application/epub+zip') || 
             contentType.includes('application/octet-stream') ||
             url.toLowerCase().endsWith('.epub');
    }

    // Helper function to fetch with timeout and proper headers
    async function fetchWithTimeout(url, options = {}) {
      tried.push(url);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
      
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36 BookLantern/1.0',
        'Accept': 'application/epub+zip,application/octet-stream,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://standardebooks.org/'
      };
      
      // Forward Range header if present
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }
      
      try {
        const response = await fetch(url, {
          redirect: 'follow',
          headers,
          signal: controller.signal,
          ...options
        });
        clearTimeout(timeoutId);
        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    }

    // Helper function to stream response with proper headers
    async function streamResponse(response) {
      if (responded) return;
      responded = true;
      
      // Mirror useful headers
      const contentType = response.headers.get('content-type');
      const contentLength = response.headers.get('content-length');
      const acceptRanges = response.headers.get('accept-ranges');
      const contentRange = response.headers.get('content-range');
      
      // Set proper headers
      if (contentType) res.setHeader('Content-Type', contentType);
      if (contentLength) res.setHeader('Content-Length', contentLength);
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
      if (contentRange) res.setHeader('Content-Range', contentRange);
      
      // Set cache headers
      res.setHeader('Cache-Control', 'public, max-age=86400');
      
      // Forward status code (especially 206 for Range requests)
      if (response.status === 206) {
        res.status(206);
      }

      // Stream using Node 18+ helpers
      const { Readable } = require('stream');
      const { pipeline } = require('stream/promises');
      
      try {
        if (response.body && typeof response.body.on === 'function') {
          // Node.js response
          await pipeline(response.body, res);
        } else {
          // Browser fetch response - convert to readable stream
          const buffer = await response.arrayBuffer();
          
          // Size sanity check: if < 60KB or looks like HTML/XML, treat as failure
          // But be more lenient for Standard Ebooks which might have smaller initial responses
          const isStandardEbooks = finalUrl.includes('standardebooks.org');
          const minSize = isStandardEbooks ? 1000 : 60000; // 1KB for SE, 60KB for others
          
          if (buffer.byteLength < minSize || 
              (contentType && (contentType.includes('html') || contentType.includes('xml')))) {
            throw new Error('Response too small or wrong content type');
          }
          
          const readable = Readable.from(Buffer.from(buffer));
          await pipeline(readable, res);
        }
        console.log('[EPUB PROXY] ok', { url: finalUrl });
      } catch (streamError) {
        console.error('[EPUB PROXY] stream error', { error: streamError.message, url: finalUrl });
        try { res.destroy(streamError); } catch {}
      }
    }

    // Helper function to send debug response
    function sendDebugResponse() {
      if (responded) return;
      responded = true;
      
      return res.status(502).send('Bad gateway (no valid EPUB found)');
    }

    // First attempt - try the original URL
    let response = await fetchWithTimeout(upstreamUrl);
    finalStatus = response.status;
    finalContentType = response.headers.get('content-type') || '';

    // If it's an EPUB response, stream it
    if (response.ok && isEpub(response.headers, finalUrl)) {
      await streamResponse(response);
      return;
    }

    // If response is HTML, parse it and extract download links
    if (response.ok && (finalContentType.includes('html') || finalContentType.includes('text/html'))) {
      console.log('[EPUB PROXY] HTML detected, parsing for download links');
      
      // Check redirect limit
      if (redirectCount >= maxRedirects) {
        console.log('[EPUB PROXY] max redirects reached, stopping');
        if (debug) {
          if (responded) return;
          responded = true;
          return res.json({
            ok: false,
            tried: tried,
            chosen: finalUrl,
            status: finalStatus,
            headers: {
              'content-type': finalContentType
            },
            error: 'Max redirects reached'
          });
        }
        return res.status(502).send('Bad gateway (max redirects reached)');
      }
      
      try {
        const html = await response.text();
        console.log('[EPUB PROXY] HTML length:', html.length);
        
        // Look for EPUB download links
        let epubUrl = null;
        
        // For Standard Ebooks, try direct EPUB access first to avoid redirect loops
        if (finalUrl.includes('standardebooks.org')) {
          console.log('[EPUB PROXY] Standard Ebooks detected, trying direct EPUB access');
          const urlParts = finalUrl.split('/');
          if (urlParts.length >= 6 && urlParts[4] === 'downloads') {
            const author = urlParts[3];
            const title = urlParts[2];
            const directEpubUrl = `https://standardebooks.org/ebooks/${title}/${author}/downloads/${author}_${title}.epub?source=download`;
            console.log('[EPUB PROXY] trying constructed SE URL:', directEpubUrl);
            
            try {
              const directResponse = await fetchWithTimeout(directEpubUrl);
              if (directResponse.ok && isEpub(directResponse.headers, directEpubUrl)) {
                await streamResponse(directResponse);
                return;
              }
            } catch (e) {
              console.log('[EPUB PROXY] direct SE URL failed:', e.message);
            }
          }
        }
        
        // First try: meta refresh redirect
        const refreshMatch = html.match(/<meta[^>]*http-equiv="refresh"[^>]*content="[^"]*url=([^"]*)"[^>]*>/i);
        if (refreshMatch) {
          const relativeUrl = refreshMatch[1];
          const baseUrl = new URL(finalUrl);
          epubUrl = new URL(relativeUrl, baseUrl.origin).toString();
          console.log('[EPUB PROXY] found URL via meta refresh:', epubUrl);
          
          // Prevent infinite loops by checking if this is the same URL we're already processing
          // For Standard Ebooks, the redirect might add query parameters, so check the base path
          const currentPath = new URL(finalUrl).pathname;
          const redirectPath = new URL(epubUrl).pathname;
          if (redirectPath === currentPath) {
            console.log('[EPUB PROXY] meta refresh points to same path, skipping to prevent loop');
            epubUrl = null;
          }
        }
        
        // Second try: look for download-epub link
        if (!epubUrl) {
          const downloadMatch = html.match(/<a[^>]*id="download-epub"[^>]*href="([^"]*)"[^>]*>/i);
          if (downloadMatch) {
            const relativeUrl = downloadMatch[1];
            const baseUrl = new URL(finalUrl);
            epubUrl = new URL(relativeUrl, baseUrl.origin).toString();
            console.log('[EPUB PROXY] found URL via download-epub link:', epubUrl);
          }
        }
        
        // Third try: look for any .epub link in downloads section
        if (!epubUrl) {
          const epubMatch = html.match(/<a[^>]*href="([^"]*\.epub)"[^>]*>/i);
          if (epubMatch) {
            const relativeUrl = epubMatch[1];
            const baseUrl = new URL(finalUrl);
            epubUrl = new URL(relativeUrl, baseUrl.origin).toString();
            console.log('[EPUB PROXY] found URL via .epub link:', epubUrl);
          }
        }
        
        if (epubUrl) {
          // Resolve relative to absolute URL
          const absoluteUrl = new URL(epubUrl, finalUrl).toString();
          finalUrl = absoluteUrl;
          redirectCount++;
          
          // Try the EPUB URL
          response = await fetchWithTimeout(absoluteUrl);
          finalStatus = response.status;
          finalContentType = response.headers.get('content-type') || '';

          if (response.ok && isEpub(response.headers, finalUrl)) {
            await streamResponse(response);
            return;
          }
        }
      } catch (parseError) {
        console.error('[EPUB PROXY] HTML parse error', { error: parseError.message, url: finalUrl });
      }
    }

    // If we get here, we couldn't find a valid EPUB
    console.error('[EPUB PROXY] error', { status: finalStatus, contentType: finalContentType, url: finalUrl });
    
    if (debug) {
      if (responded) return;
      responded = true;
      return res.json({
        ok: false,
        tried: tried,
        chosen: finalUrl,
        status: finalStatus,
        headers: {
          'content-type': finalContentType
        },
        error: 'No valid EPUB found'
      });
    }
    
    sendDebugResponse();
    
  } catch (e) {
    console.error('[EPUB PROXY] error', { error: e.message, url: src });
    if (responded) return;
    responded = true;
    if (debug) return res.status(502).json({ ok: false, error: e.message });
    return res.status(502).send('Bad gateway (exception)');
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
      .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/\sonclick="[^"]*"/gi, '');
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.type('text/html').send(inner);
  } catch (e) {
    console.error('[wikisource] html error:', e);
    res.status(502).type('text/plain').send('Fetch error');
  }
});

module.exports = router;

