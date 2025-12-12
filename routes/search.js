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
  try {
    const q = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    
    if (!q.trim()) {
      return res.json({ items: [] });
    }
    
    // Check cache
    const cacheKey = `${q}:${page}`;
    const cached = cache.get(cacheKey);
    if (cached) {
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
    
    // Collect successful results
    let allBooks = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        allBooks = allBooks.concat(result.value);
      }
    }
    
    // Deduplicate
    const uniqueBooks = deduplicate(allBooks);
    
    // Create signed tokens and public response
    const items = uniqueBooks.map(book => {
      const access = book.access || 'public';
      const isPublic = access === 'public';

      let token = null;
      let href = null;

      if (isPublic) {
        token = buildReaderToken({
          provider: book.provider,
          provider_id: book.provider_id,
          format: book.format || 'epub',
          direct_url: book.direct_url,
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
