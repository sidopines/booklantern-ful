// routes/search.js
const express = require('express');
const { LRUCache } = require('lru-cache');
const { ensureSubscriberApi } = require('../utils/gate');
const { buildReaderToken } = require('../utils/buildReaderToken');
const { filterRestrictedArchiveItems } = require('../lib/checkArchiveAccess');
const gutenberg = require('../lib/sources/gutenberg');
const openlibrary = require('../lib/sources/openlibrary');
const archive = require('../lib/sources/archive');
const loc = require('../lib/sources/loc');

const router = express.Router();

// Cache: small TTL to reduce upstream load without serving stale/blocked items for long
const cache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 5, // 5 minutes
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
 * Provider priority for deduplication (lower = preferred)
 */
const PROVIDER_PRIORITY = {
  gutenberg: 1,
  openlibrary: 2,
  loc: 3,
  archive: 4,
  unknown: 99,
};

/**
 * Deduplicate books by title + author
 * Prefer: EPUB > PDF, and by provider priority: gutenberg > openlibrary > loc > archive
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
      // Priority: EPUB over PDF, then by provider priority
      const existingIsEpub = existing.format === 'epub';
      const bookIsEpub = book.format === 'epub';
      const existingPriority = PROVIDER_PRIORITY[existing.provider] || 99;
      const bookPriority = PROVIDER_PRIORITY[book.provider] || 99;
      
      // Prefer EPUB format first
      if (bookIsEpub && !existingIsEpub) {
        seen.set(key, book);
      } else if (existingIsEpub && !bookIsEpub) {
        // Keep existing
      } else if (bookPriority < existingPriority) {
        // Same format, prefer by provider priority
        seen.set(key, book);
      }
    }
  }
  
  return Array.from(seen.values());
}

/**
 * Build source URL for a book (for "Open Source Link" fallback)
 */
function buildSourceUrl(book) {
  if (book.source_url) return book.source_url;
  
  // Build source URL based on provider
  switch (book.provider) {
    case 'gutenberg':
      return `https://www.gutenberg.org/ebooks/${book.provider_id}`;
    case 'openlibrary':
      if (book.archive_id) {
        return `https://archive.org/details/${book.archive_id}`;
      }
      return `https://openlibrary.org/works/${book.provider_id}`;
    case 'archive':
      return `https://archive.org/details/${book.archive_id || book.provider_id}`;
    case 'loc':
      return `https://www.loc.gov/item/${book.provider_id}/`;
    default:
      return book.direct_url || '';
  }
}

/**
 * Normalize a book object to consistent schema
 * @returns {Object} Normalized book with external_only flag and reason
 * 
 * Task 6: Make OpenLibrary + LoC results appear with proper readable flags:
 * - OpenLibrary: readable=true only when ocaid/ia identifier exists
 * - LoC: readable=true when direct PDF download exists
 */
function normalizeBook(book) {
  const format = book.format || 'unknown';
  const directUrl = book.direct_url || null;
  const access = book.access || 'open';
  const isRestricted = book.is_restricted === true || book.is_restricted === 'true';
  const provider = book.provider || 'unknown';
  const archiveId = book.archive_id || null;
  
  // Determine if this item can only be viewed externally
  let externalOnly = false;
  let reason = null;
  
  if (isRestricted || access === 'restricted' || access === 'borrow') {
    externalOnly = true;
    reason = 'borrow_required';
  } else if (!directUrl) {
    externalOnly = true;
    reason = 'no_direct_url';
  } else if (provider === 'openlibrary') {
    // OpenLibrary: readable only when archive_id (ia/ocaid) exists
    if (!archiveId) {
      externalOnly = true;
      reason = 'no_archive_id';
    }
    // With archive_id, we can use archive proxy - mark as EPUB
  } else if (provider === 'loc') {
    // LoC: readable when we have a direct URL (PDF or EPUB)
    if (format === 'pdf') {
      // PDF is readable via our proxy
      externalOnly = false;
    } else if (format !== 'epub') {
      externalOnly = true;
      reason = 'no_epub';
    }
  } else if (format !== 'epub' && format !== 'pdf') {
    externalOnly = true;
    reason = 'no_epub';
  }
  
  return {
    provider: provider,
    provider_id: book.provider_id || '',
    title: asText(book.title),
    author: asText(book.author),
    cover_url: book.cover_url || null,
    format: format,
    source_url: buildSourceUrl(book),
    direct_url: directUrl,
    archive_id: archiveId,
    year: book.year || null,
    language: book.language || 'en',
    book_id: book.book_id || `${provider}:${book.provider_id}`,
    access: access,
    is_restricted: isRestricted,
    external_only: externalOnly,
    reason: reason,
  };
}

/**
 * GET /api/search?q=&page=1
 * Federated search across all sources
 */
async function handleSearch(req, res) {
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
    console.log('[search] hit /api/search', { q, page });
    
    if (!q.trim()) {
      return res.json({ items: [] });
    }
    
    console.log('[search] query="' + q + '" page=' + page);
    
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
    
    // Normalize all books to consistent schema (includes external_only + reason flags)
    const normalizedBooks = allBooks.map(normalizeBook);
    
    // NOTE: We no longer filter out restricted items here - instead we mark them as external_only
    // and show them in results with "Open Source Link" option
    // This ensures OL/LOC results always appear even if they require borrowing
    
    // Deduplicate (preserves provider priority: gutenberg > openlibrary > loc > archive)
    const uniqueBooks = deduplicate(normalizedBooks);
    
    console.log(`[search] after dedup: ${uniqueBooks.length} unique books`);
    
    // HEAD-check first 15 archive.org URLs to verify accessibility
    // This marks items as external_only if they return 401/403
    const verified = await filterRestrictedArchiveItems(uniqueBooks, 15);
    
    console.log(`[search] after HEAD check: ${verified.length} items (some may be external-only)`);
    
    // Create signed tokens and public response
    const items = verified.map(book => {
      const hasDirectUrl = Boolean(book.direct_url);
      const isEpub = book.format === 'epub';
      const isPdf = book.format === 'pdf';
      const hasArchiveId = Boolean(book.archive_id);
      
      // Determine readability:
      // - EPUB with direct URL and not external-only
      // - PDF with direct URL (LoC or archive) and not external-only
      // - OpenLibrary items with archive_id (can proxy via archive)
      const isReadable = !book.external_only && hasDirectUrl && (isEpub || isPdf || (book.provider === 'openlibrary' && hasArchiveId));
      
      // Use the pre-computed external_only flag from normalizeBook
      // Also mark as external if HEAD check failed
      const externalOnly = book.external_only || book.head_check_failed || !hasDirectUrl || (!isEpub && !isPdf && !(book.provider === 'openlibrary' && hasArchiveId));

      let token = null;
      let href = null;

      // Only create reader token if we can actually render it
      if (isReadable && !externalOnly) {
        // Use archive_id when provided to ensure metadata-based fetch path
        const useArchive = Boolean(book.archive_id);
        
        token = buildReaderToken({
          provider: book.provider,
          provider_id: book.provider_id,
          format: book.format || (useArchive ? 'epub' : 'epub'), // Default to epub for archive items
          direct_url: book.direct_url,
          archive_id: useArchive ? book.archive_id : undefined,
          title: asText(book.title),
          author: asText(book.author),
          cover_url: book.cover_url,
          source_url: book.source_url,
          exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
        });
        href = `/unified-reader?token=${encodeURIComponent(token)}`;
      }
      
      return {
        provider: book.provider,
        title: asText(book.title),
        author: asText(book.author),
        cover_url: book.cover_url,
        year: book.year,
        language: book.language,
        book_id: book.book_id,
        has_audio: true, // TTS available for all
        format: book.format,
        access: book.access,
        source_url: book.source_url,
        direct_url: book.direct_url,
        token,
        href,
        readable: isReadable && !externalOnly, // New flag for UI clarity
        // External-only flag and reason for UI display
        external_only: externalOnly,
        reason: externalOnly ? (book.reason || (book.head_check_failed ? 'borrow_required' : 'no_epub')) : null,
      };
    });
    
    const response = { items };
    return res.json(response);
  } catch (error) {
    console.error('[search] error:', error);
    // Always return JSON on error
    return res.status(500).json({ items: [], error: 'search_failed' });
  }
}

// Gate each route explicitly to guarantee auth check
router.get('/', ensureSubscriberApi, handleSearch);
router.get('/search', ensureSubscriberApi, handleSearch);

module.exports = router;
