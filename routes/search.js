// routes/search.js
const express = require('express');
const { LRUCache } = require('lru-cache');
const { buildReaderToken } = require('../utils/buildReaderToken');
const gutenberg = require('../lib/sources/gutenberg');
const openlibrary = require('../lib/sources/openlibrary');
const archive = require('../lib/sources/archive');
const loc = require('../lib/sources/loc');

const router = express.Router();

// Cache results for 10 minutes
const cache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 10, // 10 minutes
});

/**
 * Normalize any incoming value to a plain string.
 * - Arrays → "a, b"
 * - Objects with "name" → that name
 * - null/undefined → ""
 */
function asText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.filter(Boolean).map(asText).join(', ');
  if (typeof v === 'object') {
    if (v.name && typeof v.name === 'string') return v.name;
    // Best-effort stringify for odd shapes
    try { return String(v); } catch { return ''; }
  }
  return String(v);
}

/**
 * Deduplicate books by title + author
 * Prefer EPUB over PDF
 */
function deduplicate(books) {
  const seen = new Map();
  
  for (const raw of books) {
    const book = {
      ...raw,
      title: asText(raw.title),
      author: asText(raw.author),
    };
    const key = `${book.title.toLowerCase().trim()}|${book.author.toLowerCase().trim()}`;
    const existing = seen.get(key);
    
    if (!existing) {
      seen.set(key, book);
    } else {
      // Prefer EPUB over PDF
      if (book.format === 'epub' && existing.format === 'pdf') {
        seen.set(key, book);
      }
    }
  }
  
  return Array.from(seen.values());
}

/**
 * GET /api/search?q=&page=1
 * Federated search across all sources
 */
router.get('/api/search', async (req, res) => {
  // Disable caching for search results
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  
  try {
    const q = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    
    if (!q.trim()) {
      return res.json({ items: [] });
    }
    
    console.log('[search] query="' + q + '" page=' + page);
    
    // Check cache (keep internal cache but disable HTTP caching)
    const cacheKey = `${q}:${page}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('[search] serving from cache');
      return res.json(cached);
    }
    
    // Parallel search across all sources
    const searches = [
      gutenberg.search(q, page),
      openlibrary.search(q, page),
      archive.search(q, page),
      loc.search(q, page),
    ];
    
    const results = await Promise.allSettled(searches);
    
    // Collect successful results with logging
    let allBooks = [];
    const connectorNames = ['gutenberg', 'openlibrary', 'archive', 'loc'];
    const counts = {};
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const connectorName = connectorNames[i];
      
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        counts[connectorName] = result.value.length;
        allBooks = allBooks.concat(result.value);
      } else if (result.status === 'rejected') {
        console.error(`[search] ${connectorName} error:`, result.reason?.message || result.reason);
        counts[connectorName] = 0;
      } else {
        counts[connectorName] = 0;
      }
    }
    
    console.log(`[search] results: gutenberg=${counts.gutenberg || 0} openlibrary=${counts.openlibrary || 0} archive=${counts.archive || 0} loc=${counts.loc || 0} total_before_dedup=${allBooks.length}`);
    
    // Deduplicate
    const uniqueBooks = deduplicate(allBooks);
    
    console.log(`[search] after dedup: ${uniqueBooks.length} unique books`);
    
    // Create signed tokens and public response
    const items = uniqueBooks.map(book => {
      const access = book.access || 'public';
      const isPublic = access === 'public';

      let token = null;
      let href = null;

      if (isPublic) {
        // Use archive_id for archive/openlibrary items to ensure proper metadata fallback
        const useArchive = book.archive_id && (book.provider === 'archive' || book.provider === 'openlibrary');
        
        token = buildReaderToken({
          provider: book.provider,
          provider_id: book.provider_id,
          format: book.format || 'epub',
          direct_url: book.direct_url,
          archive_id: useArchive ? book.archive_id : undefined,
          title: asText(book.title),
          author: asText(book.author),
          cover_url: book.cover_url,
          exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
        });
        href = `/unified-reader?token=${encodeURIComponent(token)}`;
      }
      
      return {
        title: asText(book.title),
        author: asText(book.author),
        cover_url: book.cover_url,
        year: book.year,
        language: book.language,
        book_id: book.book_id,
        has_audio: true, // TTS available for all
        format: book.format,
        access,
        token,
        href,
      };
    });
    
    const response = { items };
    
    // Cache the response
    cache.set(cacheKey, response);
    
    return res.json(response);
  } catch (error) {
    console.error('[search] error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
