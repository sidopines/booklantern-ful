// routes/search.js
const express = require('express');
const { LRUCache } = require('lru-cache');
const { ensureSubscriberApi } = require('../utils/gate');
const { buildReaderToken } = require('../utils/buildReaderToken');
const { batchCheckReadability } = require('../lib/archiveMetadata');
const gutenberg = require('../lib/sources/gutenberg');
const openlibrary = require('../lib/sources/openlibrary');
const archive = require('../lib/sources/archive');
const loc = require('../lib/sources/loc');
const oapen = require('../lib/sources/oapen');
const openstax = require('../lib/sources/openstax');

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
 * Gutenberg is most reliable, then OAPEN/OpenStax (always open), then OL/LoC, archive last
 */
const PROVIDER_PRIORITY = {
  gutenberg: 1,
  oapen: 2,
  openstax: 2,
  openlibrary: 3,
  loc: 4,
  archive: 5,
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
  
  // Global deadline: 8 seconds max for entire search request
  const GLOBAL_DEADLINE_MS = 8000;
  const searchStartTime = Date.now();
  
  try {
    const q = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    console.log('[search] hit /api/search', { q, page });
    
    if (!q.trim()) {
      return res.json({ items: [] });
    }
    
    console.log('[search] query="' + q + '" page=' + page);
    
    // Parallel search across all sources (including new OAPEN and OpenStax)
    // Wrap each source with its own timeout to prevent any single source from blocking
    const connectorNames = ['gutenberg', 'openlibrary', 'archive', 'loc', 'oapen', 'openstax'];
    
    // Create individual search promises with per-source handling
    const searches = [
      gutenberg.search(q, page),
      openlibrary.search(q, page),
      archive.search(q, page),
      loc.search(q, page),
      oapen.search(q, page),
      openstax.search(q, page),
    ];
    
    // Use Promise.race with global deadline timeout
    const globalDeadline = new Promise((resolve) => {
      setTimeout(() => {
        resolve({ isDeadline: true });
      }, GLOBAL_DEADLINE_MS);
    });
    
    // Race between allSettled and global deadline
    const searchPromise = Promise.allSettled(searches);
    const raceResult = await Promise.race([searchPromise, globalDeadline]);
    
    let results;
    let hitDeadline = false;
    
    if (raceResult && raceResult.isDeadline) {
      // Global deadline hit - collect whatever partial results are available
      hitDeadline = true;
      console.log('[search] global deadline hit after', GLOBAL_DEADLINE_MS, 'ms, returning partial results');
      
      // Use Promise.allSettled with a very short additional wait to grab any in-flight results
      const quickWait = new Promise(resolve => setTimeout(resolve, 100));
      await quickWait;
      
      // Get current state of all promises (some may have settled, some pending)
      results = await Promise.allSettled(searches.map(p => 
        Promise.race([p, new Promise(resolve => setTimeout(() => resolve([]), 50))])
      ));
    } else {
      results = raceResult;
    }
    
    // Collect successful results with logging
    let allBooks = [];
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
    
    const elapsedMs = Date.now() - searchStartTime;
    console.log(`[search] results: gutenberg=${counts.gutenberg || 0} openlibrary=${counts.openlibrary || 0} archive=${counts.archive || 0} loc=${counts.loc || 0} oapen=${counts.oapen || 0} openstax=${counts.openstax || 0} total_before_dedup=${allBooks.length} elapsed=${elapsedMs}ms${hitDeadline ? ' (deadline)' : ''}`);
    
    // Normalize all books to consistent schema (includes external_only + reason flags)
    const normalizedBooks = allBooks.map(normalizeBook);
    
    // NOTE: We no longer filter out restricted items here - instead we mark them as external_only
    // and show them in results with "Unavailable" label (no "Borrow" action)
    // This ensures OL/LOC results always appear even if they require borrowing
    
    // Deduplicate (preserves provider priority: gutenberg > oapen/openstax > openlibrary > loc > archive)
    const uniqueBooks = deduplicate(normalizedBooks);
    
    console.log(`[search] after dedup: ${uniqueBooks.length} unique books`);
    
    // Check readability for Archive.org items using metadata + probing
    // This determines readable=true/false/maybe for each IA item
    const withReadability = await batchCheckReadability(uniqueBooks, 20);
    
    console.log(`[search] after readability check: ${withReadability.length} items`);
    
    // Sort by readability: true > maybe > false
    // This ensures "working" items appear first
    withReadability.sort((a, b) => {
      const order = { 'true': 0, 'maybe': 1, 'false': 2 };
      const aOrder = order[a.readable] ?? 1;
      const bOrder = order[b.readable] ?? 1;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Within same readability, preserve provider priority
      const aPriority = PROVIDER_PRIORITY[a.provider] || 99;
      const bPriority = PROVIDER_PRIORITY[b.provider] || 99;
      return aPriority - bPriority;
    });
    
    // Count readability stats for logging
    const readableTrue = withReadability.filter(b => b.readable === 'true').length;
    const readableMaybe = withReadability.filter(b => b.readable === 'maybe').length;
    const readableFalse = withReadability.filter(b => b.readable === 'false').length;
    console.log(`[search] readability sort: readable_true=${readableTrue} readable_maybe=${readableMaybe} readable_false=${readableFalse}`);
    
    // Create signed tokens and public response
    const items = withReadability.map(book => {
      const hasDirectUrl = Boolean(book.direct_url || book.directUrl);
      const actualDirectUrl = book.directUrl || book.direct_url;
      const isEpub = book.format === 'epub';
      const isPdf = book.format === 'pdf';
      const hasArchiveId = Boolean(book.archive_id);
      
      // Determine final readability from probing results
      // readable='true' means we verified open download
      // readable='false' means borrow-only or no usable file
      // readable='maybe' means unverified
      const isReadableTrue = book.readable === 'true';
      const isReadableFalse = book.readable === 'false';
      const isReadableMaybe = book.readable === 'maybe';
      
      // For non-IA items (gutenberg, oapen, openstax), assume readable if they have direct URL
      const nonIaReadable = !hasArchiveId && hasDirectUrl && (isEpub || isPdf) && !book.external_only;
      
      // Final readable flag: true if verified OR non-IA with direct URL
      const isReadable = isReadableTrue || nonIaReadable;
      
      // External-only (no on-site reading): false readability OR no direct URL
      const externalOnly = isReadableFalse || (!isReadable && !isReadableMaybe);

      let token = null;
      let href = null;

      // Only create reader token if we can actually render it
      if (isReadable && !externalOnly) {
        // Use archive_id when provided to ensure metadata-based fetch path
        const useArchive = Boolean(book.archive_id);
        
        // Determine format - prefer PDF for items marked preferPdf
        const tokenFormat = book.preferPdf ? 'pdf' : (book.format || 'epub');
        
        token = buildReaderToken({
          provider: book.provider,
          provider_id: book.provider_id,
          format: tokenFormat,
          direct_url: actualDirectUrl,
          archive_id: useArchive ? book.archive_id : undefined,
          title: asText(book.title),
          author: asText(book.author),
          cover_url: book.cover_url,
          source_url: book.source_url,
          // Include PDF fallback info for archive items
          best_pdf: book.bestPdf ? book.bestPdf.name : undefined,
          exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
        });
        href = `/unified-reader?token=${encodeURIComponent(token)}`;
      }
      
      // Determine reason for non-readable items
      let reason = null;
      if (externalOnly || !isReadable) {
        if (isReadableFalse) {
          reason = book.reason || 'borrow_required';
        } else if (!hasDirectUrl) {
          reason = 'no_direct_url';
        } else {
          reason = 'no_epub';
        }
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
        direct_url: actualDirectUrl,
        token,
        href,
        readable: isReadable, // Boolean for UI
        // External-only flag and reason for UI display
        external_only: externalOnly,
        reason: reason,
        // Pass readable status for sorting/debugging
        readable_status: book.readable,
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
