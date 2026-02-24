// routes/search.js
const express = require('express');
const { LRUCache } = require('lru-cache');
const { ensureSubscriberApi } = require('../utils/gate');
const { buildReaderToken } = require('../utils/buildReaderToken');
const { buildOpenUrl, normalizeMeta, scoreRelevance } = require('../utils/bookHelpers');
const { batchCheckReadability } = require('../lib/archiveMetadata');
const gutenberg = require('../lib/sources/gutenberg');
const openlibrary = require('../lib/sources/openlibrary');
const archive = require('../lib/sources/archive');
const loc = require('../lib/sources/loc');
const oapen = require('../lib/sources/oapen');
const openstax = require('../lib/sources/openstax');

// Local catalog search (Supabase)
let catalogSearch = null;
try {
  catalogSearch = require('./catalog').searchCatalog;
} catch (e) {
  console.warn('[search] catalog module not available:', e.message);
}

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
 * Catalog items are lowest priority (external links only)
 */
const PROVIDER_PRIORITY = {
  gutenberg: 1,
  oapen: 2,
  openstax: 2,
  openlibrary: 3,
  loc: 4,
  archive: 5,
  catalog: 6,  // Catalog is external-only, lowest priority
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
  
  // Global deadline: 18 seconds max for entire search request
  const GLOBAL_DEADLINE_MS = 18000;
  const searchStartTime = Date.now();
  
  try {
    const q = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    console.log('[search] hit /api/search', { q, page });
    
    if (!q.trim()) {
      return res.json({ items: [] });
    }
    
    console.log('[search] query="' + q + '" page=' + page);
    
    // Search local catalog FIRST (fast, Supabase)
    let catalogResults = [];
    let catalogElapsed = 0;
    if (catalogSearch) {
      try {
        const catalogStart = Date.now();
        const catalogData = await catalogSearch(q, 15);
        catalogResults = catalogData.items || [];
        catalogElapsed = Date.now() - catalogStart;
        console.log(`[catalog] hits=${catalogResults.length} elapsed=${catalogElapsed}ms`);
      } catch (e) {
        console.error('[catalog] search failed:', e.message);
      }
    }
    
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
    
    // Add catalog results FIRST (already searched above)
    if (catalogResults.length > 0) {
      counts.catalog = catalogResults.length;
      allBooks = allBooks.concat(catalogResults);
    } else {
      counts.catalog = 0;
    }
    
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
    console.log(`[search] results: catalog=${counts.catalog || 0} gutenberg=${counts.gutenberg || 0} openlibrary=${counts.openlibrary || 0} archive=${counts.archive || 0} loc=${counts.loc || 0} oapen=${counts.oapen || 0} openstax=${counts.openstax || 0} total_before_dedup=${allBooks.length} elapsed=${elapsedMs}ms${hitDeadline ? ' (deadline)' : ''}`);
    
    // Normalize all books to consistent schema (includes external_only + reason flags)
    // Skip catalog items as they're already normalized
    const normalizedBooks = allBooks.map(book => 
      book.provider === 'catalog' ? book : normalizeBook(book)
    );
    
    // NOTE: We no longer filter out restricted items here - instead we mark them as external_only
    // and show them in results with "Unavailable" label (no "Borrow" action)
    // This ensures OL/LOC results always appear even if they require borrowing
    
    // Deduplicate (preserves provider priority: gutenberg > oapen/openstax > openlibrary > loc > archive)
    const uniqueBooks = deduplicate(normalizedBooks);
    
    console.log(`[search] after dedup: ${uniqueBooks.length} unique books`);

    // --- Relevance scoring: drop garbage results ---
    // Adaptive threshold: lower for short/broad queries (Bug C)
    const queryTokens = q.trim().split(/\s+/).filter(t => t.length >= 1);
    const isShortQuery = q.trim().length <= 5 || queryTokens.length <= 1;
    const RELEVANCE_THRESHOLD = isShortQuery ? 3 : 10;
    const MIN_PER_PROVIDER = 10; // always keep at least N per provider
    const scored = uniqueBooks.map(book => ({
      ...book,
      _relevance: scoreRelevance(book, q),
    }));
    // Group by provider to enforce per-provider minimum
    const byProvider = {};
    for (const b of scored) {
      const p = b.provider || 'unknown';
      if (!byProvider[p]) byProvider[p] = [];
      byProvider[p].push(b);
    }
    // Sort each provider group by relevance descending
    for (const p of Object.keys(byProvider)) {
      byProvider[p].sort((a, b) => (b._relevance || 0) - (a._relevance || 0));
    }
    const relevant = scored.filter(b => {
      if (b._relevance >= RELEVANCE_THRESHOLD) return true;
      // Keep top MIN_PER_PROVIDER per provider even if below threshold
      const p = b.provider || 'unknown';
      const rank = byProvider[p].indexOf(b);
      return rank >= 0 && rank < MIN_PER_PROVIDER;
    });
    const droppedCount = scored.length - relevant.length;
    if (droppedCount > 0) {
      console.log(`[search] relevance filter: dropped ${droppedCount} items below adaptive threshold ${RELEVANCE_THRESHOLD} (shortQuery=${isShortQuery})`);
    }
    
    // Check readability for Archive.org items using metadata + probing
    // Bug C: Only check top K items, keep the rest as 'maybe' (lazy readability)
    const MAX_READABILITY_PROBES = 30;
    const withReadability = await batchCheckReadability(relevant, MAX_READABILITY_PROBES);
    
    console.log(`[search] after readability check: ${withReadability.length} items (all kept)`);
    
    // Sort by readability: true > maybe > false, then by relevance, then by provider priority
    // Bug C: Do NOT filter by readability — all items are returned, just sorted
    withReadability.sort((a, b) => {
      const order = { 'true': 0, 'maybe': 1, 'false': 2 };
      const aOrder = order[a.readable] ?? 1;
      const bOrder = order[b.readable] ?? 1;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Within same readability, sort by relevance descending
      const aRel = a._relevance || 0;
      const bRel = b._relevance || 0;
      if (aRel !== bRel) return bRel - aRel;
      // Then by provider priority
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

      // Only create reader link if we can actually render it
      // Build /open URL via shared helper for consistent URL construction
      if (isReadable && !externalOnly) {
        const tokenFormat = book.preferPdf ? 'pdf' : (book.format || 'epub');
        href = buildOpenUrl({
          provider: book.provider || 'unknown',
          provider_id: book.provider_id || '',
          title: asText(book.title),
          author: asText(book.author),
          cover: book.cover_url,
          source_url: book.source_url,
          direct_url: actualDirectUrl,
          archive_id: book.archive_id,
          format: tokenFormat
        });
        // If buildOpenUrl returned null, treat as external-only
        if (!href) {
          console.log(`[search] buildOpenUrl returned null for ${book.provider}:${book.provider_id} "${asText(book.title)}"`);
        }
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
      
      // For external-only items (like catalog/DOAB), provide external link if available
      const hasExternalLink = Boolean(book.has_external_link || book.source_url || book.open_access_url);
      const externalUrl = book.open_access_url || book.source_url || null;
      
      return {
        provider: book.provider,
        title: asText(book.title) || 'Untitled',
        author: asText(book.author) || 'Unknown author',
        cover_url: book.cover_url,
        year: book.year,
        language: book.language,
        book_id: book.book_id,
        has_audio: true, // TTS available for all
        format: book.format,
        access: book.access,
        source_url: book.source_url,
        open_access_url: externalUrl,
        direct_url: actualDirectUrl,
        token,
        href,
        readable: isReadable, // Boolean for UI
        // External-only flag and reason for UI display
        external_only: externalOnly,
        has_external_link: hasExternalLink, // Can click to open external source
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
