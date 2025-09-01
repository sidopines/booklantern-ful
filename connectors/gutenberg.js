// connectors/gutenberg.js
const fetch = require('node-fetch');
const { gutenbergCache } = require('../utils/lru');
const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';

// Import the resolver function (we'll need to extract it from bookRoutes)
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
          'User-Agent': UA,
          'Accept': 'application/epub+zip,application/octet-stream;q=0.9,*/*;q=0.5',
          'Referer': 'https://www.gutenberg.org/'
        }
      });

      if (resp.ok) {
        const contentType = (resp.headers.get('content-type') || '').toLowerCase();
        if (contentType.startsWith('application/epub+zip') || contentType.startsWith('application/octet-stream')) {
          return resp.url || url;
        }
      }
    } catch (e) {
      // Continue to next candidate
    }
  }

  // Fallback: use Gutendex formats to find an application/epub+zip link
  try {
    const r = await fetch(`https://gutendex.com/books/${id}`, { 
      headers: { 
        'User-Agent': UA
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
          return fmt[epubKey];
        }
      }
    }
  } catch (e) {
    // Fallback failed
  }
  
  return null;
}

async function validateGutenbergEpub(gid) {
  const cacheKey = `gutenberg:${gid}`;
  
  // Check cache first
  const cached = gutenbergCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  
  try {
    // Try to resolve with 6-8 second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const url = await resolveGutenbergEpubUrl(gid, { preferImages: true });
    
    clearTimeout(timeoutId);
    
    if (url) {
      const result = { ok: true, url, checkedAt: new Date() };
      gutenbergCache.set(cacheKey, result, 24 * 60 * 60 * 1000); // 24h TTL
      return result;
    } else {
      // Try no-images variant
      const noImagesUrl = await resolveGutenbergEpubUrl(gid, { preferImages: false });
      if (noImagesUrl) {
        const result = { ok: true, url: noImagesUrl, checkedAt: new Date() };
        gutenbergCache.set(cacheKey, result, 24 * 60 * 60 * 1000); // 24h TTL
        return result;
      }
    }
    
    // Failed to resolve
    const result = { ok: false, checkedAt: new Date() };
    gutenbergCache.set(cacheKey, result, 2 * 60 * 60 * 1000); // 2h TTL
    return result;
    
  } catch (error) {
    const result = { ok: false, error: error.message, checkedAt: new Date() };
    gutenbergCache.set(cacheKey, result, 2 * 60 * 60 * 1000); // 2h TTL
    return result;
  }
}

function makeCard({ id, title, authors = [], formats = {} }) {
  const author =
    Array.isArray(authors) && authors.length
      ? (authors[0].name || '').trim()
      : '';
  const cover =
    formats['image/jpeg'] ||
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;

  return {
    source: 'gutenberg',
    title: title || '(Untitled)',
    author: author,
    cover: cover,
    gutenId: id,
    href: `/read/gutenberg/${id}/reader`,
    readable: true,
    openInline: true,
    identifier: `gutenberg:${id}`,
    creator: author,
    readerUrl: `/read/gutenberg/${id}/reader`,
    meta: {
      gid: id
    }
  };
}

async function searchGutenberg(q, limit = 40) {
  try {
    const url = `https://gutendex.com/books/?search=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    const data = await r.json();
    const items = Array.isArray(data.results) ? data.results : [];
    
    // Validate EPUB availability for each item
    const validatedItems = [];
    const concurrencyLimit = 8;
    const chunks = [];
    
    // Split into chunks for concurrency control
    for (let i = 0; i < items.length; i += concurrencyLimit) {
      chunks.push(items.slice(i, i + concurrencyLimit));
    }
    
    for (const chunk of chunks) {
      const promises = chunk.map(async (item) => {
        const validation = await validateGutenbergEpub(item.id);
        if (validation.ok) {
          return item;
        }
        return null;
      });
      
      const results = await Promise.all(promises);
      validatedItems.push(...results.filter(Boolean));
      
      // Stop if we have enough valid items
      if (validatedItems.length >= limit) break;
    }
    
    const cards = validatedItems.slice(0, limit).map(makeCard);
    console.log(`[GUTENBERG] results ${cards.length} (validated epub only)`);
    return cards;
  } catch (e) {
    console.error('[gutenberg] search error:', e);
    return [];
  }
}

async function fetchGutenbergMeta(gid) {
  try {
    const r = await fetch(`https://gutendex.com/books/${gid}`, {
      headers: { 'User-Agent': UA }
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.error('[gutenberg] meta error:', e);
    return null;
  }
}

module.exports = { searchGutenberg, fetchGutenbergMeta, resolveGutenbergEpubUrl };
