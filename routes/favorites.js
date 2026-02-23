// routes/favorites.js
// Routes for favorites page and token-safe book opener
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const { ensureSubscriber } = require('../utils/gate');
const { buildReaderToken } = require('../utils/buildReaderToken');
const supabase = require('../lib/supabaseServer');
const { extractArchiveId, buildOpenUrl, normalizeMeta, isNumericOnly, stripPrefixes, isBorrowRequiredArchive, isEncryptedFile, repairFavoriteMeta, ensureRawProviderId, stripBlPrefix } = require('../utils/bookHelpers');

// Safe fetch: use globalThis.fetch (Node 18+) or dynamic import node-fetch
const fetchFn = globalThis.fetch
  ? globalThis.fetch.bind(globalThis)
  : (...args) => import('node-fetch').then(m => m.default(...args));

const PROXY_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36 BookLantern/1.0';

// Import archive resolution helpers from reader.js (lazy loaded to avoid circular deps)
let pickBestArchiveFileFn = null;

async function resolveArchiveFile(identifier) {
  if (!pickBestArchiveFileFn) {
    
    // Same logic as routes/reader.js pickBestArchiveFile
    pickBestArchiveFileFn = (files) => {
      if (!files || !Array.isArray(files)) return null;
      const MAX_EPUB_MB = parseInt(process.env.MAX_EPUB_MB) || 50;
      const MAX_PDF_MB = parseInt(process.env.MAX_PDF_MB) || 200;
      
      const epubs = [];
      const pdfs = [];
      
      for (const f of files) {
        if (!f.name) continue;
        const name = f.name.toLowerCase();
        const format = (f.format || '').toLowerCase();
        
        // Skip protected/DRM/encrypted files
        if (isEncryptedFile(f)) continue;
        
        const sizeMB = parseInt(f.size || 0) / 1e6;
        
        if ((name.endsWith('.epub') || format.includes('epub')) && sizeMB <= MAX_EPUB_MB) {
          epubs.push({ name: f.name, size: parseInt(f.size || 0), format: 'epub' });
        } else if ((name.endsWith('.pdf') || format.includes('pdf')) && sizeMB <= MAX_PDF_MB) {
          pdfs.push({ name: f.name, size: parseInt(f.size || 0), format: 'pdf' });
        }
      }
      
      // Prefer smallest EPUB, then smallest PDF
      epubs.sort((a, b) => a.size - b.size);
      pdfs.sort((a, b) => a.size - b.size);
      
      if (epubs.length > 0) return epubs[0];
      if (pdfs.length > 0) return pdfs[0];
      return null;
    };
  }
  
  const sourceUrl = `https://archive.org/details/${identifier}`;
  try {
    const metaUrl = `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
    const metaRes = await fetchFn(metaUrl, {
      headers: { 'User-Agent': PROXY_UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined
    });
    const meta = metaRes.ok ? await metaRes.json().catch(() => null) : null;
    if (!meta || !meta.files) {
      console.log(`[favorites/resolveArchive] id=${identifier} found=none (no metadata)`);
      return { ok: false, source_url: sourceUrl };
    }

    // Check borrow-required / encrypted-only
    const borrowCheck = isBorrowRequiredArchive(meta.metadata, meta.files, meta);
    if (borrowCheck.borrowRequired || borrowCheck.encryptedOnly) {
      console.log(`[favorites/resolveArchive] id=${identifier} ${borrowCheck.reason}`);
      return { ok: false, source_url: sourceUrl, borrow_required: borrowCheck.borrowRequired, encrypted_only: borrowCheck.encryptedOnly, reason: borrowCheck.reason };
    }
    
    const bestFile = pickBestArchiveFileFn(meta.files);
    if (!bestFile) {
      console.log(`[favorites/resolveArchive] id=${identifier} found=none (no suitable file)`);
      return { ok: false, source_url: sourceUrl };
    }
    
    const directUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(bestFile.name)}`;
    console.log(`[favorites/resolveArchive] id=${identifier} found=${bestFile.name} format=${bestFile.format}`);
    
    return {
      ok: true,
      format: bestFile.format,
      direct_url: directUrl,
      source_url: sourceUrl,
      best_pdf: bestFile.format === 'pdf' ? bestFile.name : null
    };
  } catch (err) {
    console.error(`[favorites/resolveArchive] error for ${identifier}:`, err.message);
    return { ok: false, source_url: sourceUrl };
  }
}

/**
 * Extract the real archive ID from a bookKey
 * bookKey format is "bl-book-{archiveId}" or sometimes just the archive ID
 * Also handles double-prefixed keys like "bl-book-bl-book-{archiveId}"
 */
function extractArchiveIdFromKey(bookKey) {
  if (!bookKey) return null;
  let id = bookKey;
  // Strip bl-book- prefix(es) if present
  while (id.startsWith('bl-book-')) {
    id = id.slice(8); // 'bl-book-'.length = 8
  }
  // Strip archive- prefix if present (older format)
  if (id.startsWith('archive-')) {
    id = id.slice(8);
  }
  return id || null;
}

/**
 * Detect whether a favorite is truly an Archive.org book.
 * Only returns true for strong archive signals — avoids false positives
 * for OpenLibrary / Gutenberg books saved as provider=unknown.
 */
function isArchiveLike({ provider, providerId, sourceUrl, cover }) {
  if (provider === 'archive') return true;
  if ((providerId || '').startsWith('archive-')) return true;
  if ((providerId || '').startsWith('bl-book-')) return true;
  if ((sourceUrl || '').includes('archive.org/details/')) return true;
  return false;
}

// Helper to get user ID from session
function getUserId(req) {
  return req.session?.user?.id || null;
}

// ============================================================================
// GET /favorites - Favorites page
// ============================================================================
router.get('/favorites', ensureSubscriber, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.redirect('/login?next=/favorites');
    }

    // Fetch favorites from Supabase
    const { data: items, error } = await supabase
      .from('reading_favorites')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[favorites] supabase error:', error);
      return res.status(500).render('error', {
        pageTitle: 'Error',
        statusCode: 500,
        message: 'Failed to load favorites'
      });
    }

    // Map to template format — include openUrl built with shared helper
    const favorites = (items || []).map(item => {
      // Repair favorites with unknown source on-the-fly
      const repaired = repairFavoriteMeta(item);
      // P0: Always use raw provider_id (never bookKey) for open links
      let provId = repaired._provider_id || item.book_key;
      provId = ensureRawProviderId(provId, 'favorites/list');
      const meta = {
        provider: repaired.source || item.source,
        provider_id: provId,
        title: item.title,
        author: item.author,
        cover: item.cover,
        source_url: item.reader_url,
        direct_url: repaired._direct_url || ''
      };
      const openUrl = buildOpenUrl(meta);
      const bareKey = stripPrefixes(item.book_key) || item.book_key || '';
      const unavailable = !openUrl || isNumericOnly(bareKey);
      if (unavailable) {
        console.log(`[favorites] unavailable: bookKey=${item.book_key} title="${item.title}" (still shown)`);
      }
      return {
        bookKey: item.book_key,
        source: repaired.source || item.source,
        title: item.title,
        author: item.author,
        cover: item.cover,
        readerUrl: item.reader_url,
        openUrl: openUrl,
        availability: unavailable ? 'unavailable' : 'ok',
        category: item.category,
        createdAt: item.created_at
      };
    }); // Bug B: do NOT filter — return all favorites, even unavailable

    return res.render('favorites', {
      pageTitle: 'My Favorites',
      favorites
    });
  } catch (err) {
    console.error('[favorites] error:', err);
    return res.status(500).render('error', {
      pageTitle: 'Error',
      statusCode: 500,
      message: 'Something went wrong'
    });
  }
});

// ============================================================================
// GET /open - Token-safe book opener
// Regenerates a fresh token and redirects to unified-reader
// This ensures favorited books never expire
// ============================================================================
router.get('/open', ensureSubscriber, async (req, res) => {
  const ref = req.query.ref || '/read';

  try {
    // ── Priority redirect: source_url already points to unified-reader ──
    const rawSourceUrl = req.query.source_url || '';
    if (rawSourceUrl.startsWith('/unified-reader?token=')) {
      console.log('[open] Fast redirect via source_url token path');
      return res.redirect(302, rawSourceUrl);
    }

    // ── Bug E+A: If provider=unknown and source_url is a safe internal path, redirect ──
    if ((!req.query.provider || req.query.provider === 'unknown') && rawSourceUrl) {
      const safePrefixes = ['/open?', '/unified-reader?'];
      const isSafePath = safePrefixes.some(p => rawSourceUrl.startsWith(p));
      // Security: prevent open redirect — only relative paths, no protocol
      if (isSafePath && !rawSourceUrl.includes('://') && !rawSourceUrl.startsWith('//')) {
        console.log(`[open] Redirecting provider=unknown via safe source_url: ${rawSourceUrl.slice(0, 80)}`);
        return res.redirect(302, rawSourceUrl);
      }
    }

    // ── Self-heal metadata via normalizeMeta ──
    // P0: Strip bl:<provider>: prefix from provider_id and archive_id to fix polluted inputs
    let rawProviderId = req.query.provider_id || '';
    const pidStripped = stripBlPrefix(rawProviderId);
    if (pidStripped) {
      console.log(`[open] STRIPPED polluted provider_id: "${rawProviderId}" → "${pidStripped.rawId}"`);
      rawProviderId = pidStripped.rawId;
    }
    let rawArchiveId = req.query.archive_id || '';
    const aidStripped = stripBlPrefix(rawArchiveId);
    if (aidStripped) {
      console.log(`[open] STRIPPED polluted archive_id: "${rawArchiveId}" → "${aidStripped.rawId}"`);
      rawArchiveId = aidStripped.rawId;
    }
    const raw = {
      provider:    req.query.provider || 'unknown',
      provider_id: rawProviderId,
      archive_id:  rawArchiveId,
      source_url:  rawSourceUrl,
      direct_url:  req.query.direct_url || '',
      title:       req.query.title || 'Untitled',
      author:      req.query.author || '',
      cover:       req.query.cover || '',
      cover_url:   req.query.cover || '',
      format:      req.query.format || ''
    };
    const meta = normalizeMeta(raw);

    const provider    = meta.provider || 'unknown';
    const provider_id = meta.provider_id || '';
    const title       = meta.title || 'Untitled';
    const author      = meta.author || '';
    const cover       = meta.cover || meta.cover_url || '';
    const source_url  = meta.source_url || '';
    const archive_id  = meta.archive_id || '';
    const direct_url  = meta.direct_url || '';
    const format      = meta.format || '';

    // Validate required params
    if (!provider_id) {
      return res.status(404).render('error', {
        pageTitle: 'Book Not Found',
        statusCode: 404,
        message: 'No book identifier could be resolved. Please go back and try again.'
      });
    }

    // Log self-healing when normalizeMeta changed provider_id
    if (provider_id !== (req.query.provider_id || '')) {
      console.log(`[open] Self-healed: provider_id ${req.query.provider_id} → ${provider_id} (provider=${provider})`);
    }
    console.log(`[open] provider=${provider} provider_id=${provider_id} archive_id=${archive_id} title="${title}"`);
    // P0 log: numeric-only detection
    const strippedPid = stripPrefixes(provider_id) || provider_id;
    if (isNumericOnly(strippedPid)) {
      console.warn(`[open] NUMERIC-ONLY detected: provider_id=${provider_id} stripped=${strippedPid}`);
    }

    // Use shared helper to extract archive ID from all available metadata
    const derivedArchiveId = extractArchiveId({
      archive_id: archive_id,
      provider: provider,
      provider_id: provider_id,
      source_url: source_url,
      direct_url: direct_url,
      cover: cover
    });
    console.log(`[open] derivedArchiveId=${derivedArchiveId || 'null'} branch=pending`);

    // Detect if this is truly an Archive.org book using strong signals only
    const archiveLike = derivedArchiveId || isArchiveLike({
      provider,
      providerId: provider_id,
      sourceUrl: source_url,
      cover
    });

    // Guard: if provider=archive but provider_id is purely numeric (ISBN),
    // and we couldn't derive a real archive identifier, this is unresolvable
    if (provider === 'archive' && !derivedArchiveId && isNumericOnly(provider_id)) {
      console.warn(`[open] Numeric-only archive provider_id=${provider_id} with no resolvable identifier for "${title}"`);
      return res.status(404).render('error', {
        pageTitle: 'Book Not Found',
        statusCode: 404,
        message: `Could not open "${title}". The book identifier is not a valid Archive.org identifier.`
      });
    }

    // ----- Branch 1: confirmed archive book -----
    if (archiveLike && derivedArchiveId) {
      console.log(`[open] branch=1-archive archiveId=${derivedArchiveId}`);
      const archiveId = derivedArchiveId;

      // Guard: never call resolveArchiveFile with numeric-only identifier
      if (isNumericOnly(archiveId)) {
        console.warn(`[open] Blocked numeric-only derivedArchiveId=${archiveId} for "${title}"`);
        return res.status(404).render('error', {
          pageTitle: 'Book Not Found',
          statusCode: 404,
          message: `Could not open "${title}". The book identifier is not a valid Archive.org identifier.`
        });
      }

      console.log(`[open] Resolving archive book: ${archiveId}`);
      const resolved = await resolveArchiveFile(archiveId);

      if (!resolved.ok) {
        console.warn(`[open] Archive resolution failed for: ${archiveId} reason=${resolved.reason || 'unknown'}`);
        // If borrow-required or encrypted, redirect to /external with a clean message
        if (resolved.borrow_required || resolved.encrypted_only) {
          const extParams = new URLSearchParams({
            url: `https://archive.org/details/${archiveId}`,
            title: title,
            author: author,
            reason: resolved.borrow_required ? 'borrow_required' : 'encrypted_only',
            archive_id: archiveId,
            ref: ref,
          });
          if (cover) extParams.set('cover_url', cover);
          return res.redirect(`/external?${extParams.toString()}`);
        }
        return res.status(404).render('error', {
          pageTitle: 'Book Not Found',
          statusCode: 404,
          message: `Could not load "${title}" from Archive.org. The book may no longer be available.`
        });
      }

      const token = buildReaderToken({
        provider: 'archive',
        provider_id: archiveId,
        archive_id: archiveId,
        format: resolved.format,
        direct_url: resolved.direct_url,
        source_url: resolved.source_url,
        title,
        author,
        cover_url: cover || `https://archive.org/services/img/${archiveId}`,
        best_pdf: resolved.best_pdf || null
      });

      console.log(`[open] Archive redirect: ${archiveId} -> ${resolved.format}`);
      return res.redirect(`/unified-reader?token=${encodeURIComponent(token)}&ref=${encodeURIComponent(ref)}`);
    }

    // ----- Branch 1b: archiveLike but couldn't extract ID — try realArchiveId from prefix stripping -----
    if (archiveLike && !derivedArchiveId) {
      console.log(`[open] branch=1b-archiveLike-noId provider_id=${provider_id}`);
      const realArchiveId = extractArchiveIdFromKey(provider_id);
      if (realArchiveId && !isNumericOnly(realArchiveId)) {
        console.log(`[open] Trying prefix-stripped archive ID: ${realArchiveId}`);
        const resolved = await resolveArchiveFile(realArchiveId);
        if (resolved.ok) {
          const token = buildReaderToken({
            provider: 'archive',
            provider_id: realArchiveId,
            archive_id: realArchiveId,
            format: resolved.format,
            direct_url: resolved.direct_url,
            source_url: resolved.source_url,
            title,
            author,
            cover_url: cover || `https://archive.org/services/img/${realArchiveId}`,
            best_pdf: resolved.best_pdf || null
          });
          return res.redirect(`/unified-reader?token=${encodeURIComponent(token)}&ref=${encodeURIComponent(ref)}`);
        }
        // Borrow-required → redirect to /external
        if (resolved.borrow_required || resolved.encrypted_only) {
          const extParams = new URLSearchParams({
            url: `https://archive.org/details/${realArchiveId}`,
            title, author,
            reason: resolved.borrow_required ? 'borrow_required' : 'encrypted_only',
            archive_id: realArchiveId, ref,
          });
          if (cover) extParams.set('cover_url', cover);
          return res.redirect(`/external?${extParams.toString()}`);
        }
      }
      // Still no luck — show error
      return res.status(404).render('error', {
        pageTitle: 'Book Not Found',
        statusCode: 404,
        message: `Could not load "${title}". The book may no longer be available from its source.`
      });
    }

    // ----- Branch 2: unknown provider but has archive_id param -----
    if (archive_id && provider === 'unknown') {
      console.log(`[open] branch=2-unknown-with-archive_id archive_id=${archive_id}`);
      // Guard: never call resolveArchiveFile with numeric-only identifier
      if (isNumericOnly(archive_id)) {
        console.warn(`[open] Blocked numeric-only archive_id=${archive_id} in Branch 2 for "${title}"`);
        return res.status(404).render('error', {
          pageTitle: 'Book Not Found',
          statusCode: 404,
          message: `Could not open "${title}". The book identifier is not a valid Archive.org identifier.`
        });
      }
      console.log(`[open] Unknown provider with archive_id=${archive_id}, resolving as archive`);
      const resolved = await resolveArchiveFile(archive_id);
      if (resolved.ok) {
        const token = buildReaderToken({
          provider: 'archive',
          provider_id: archive_id,
          archive_id,
          format: resolved.format,
          direct_url: resolved.direct_url,
          source_url: resolved.source_url,
          title,
          author,
          cover_url: cover || `https://archive.org/services/img/${archive_id}`,
          best_pdf: resolved.best_pdf || null
        });
        return res.redirect(`/unified-reader?token=${encodeURIComponent(token)}&ref=${encodeURIComponent(ref)}`);
      }
      // Borrow-required → redirect to /external
      if (resolved.borrow_required || resolved.encrypted_only) {
        const extParams = new URLSearchParams({
          url: `https://archive.org/details/${archive_id}`,
          title, author,
          reason: resolved.borrow_required ? 'borrow_required' : 'encrypted_only',
          archive_id, ref,
        });
        if (cover) extParams.set('cover_url', cover);
        return res.redirect(`/external?${extParams.toString()}`);
      }
      // fall through to other strategies
    }

    // ----- Branch 3: has a direct_url we can use -----
    if (direct_url) {
      console.log(`[open] branch=3-direct_url provider=${provider} provider_id=${provider_id}`);
      const fmt = format || (direct_url.toLowerCase().endsWith('.pdf') ? 'pdf' : 'epub');
      const realArchiveId = extractArchiveIdFromKey(provider_id);
      const token = buildReaderToken({
        provider,
        provider_id: realArchiveId || provider_id,
        title,
        author,
        cover_url: cover,
        format: fmt,
        direct_url,
        source_url
      });
      return res.redirect(`/unified-reader?token=${encodeURIComponent(token)}&ref=${encodeURIComponent(ref)}`);
    }

    // ----- Branch 4: external / DOAB / OAPEN -----
    if (provider === 'external' || provider === 'doab' || provider === 'oapen' ||
        provider_id.startsWith('http://') || provider_id.startsWith('https://')) {
      const searchQuery = `${title} ${author}`.trim();
      console.log(`[open] branch=4-external provider=${provider} redirecting to search: ${searchQuery}`);
      return res.redirect(`/read?q=${encodeURIComponent(searchQuery)}`);
    }

    // ----- Branch 5: known providers (gutenberg, openlibrary, etc.) -----
    if (provider !== 'unknown') {
      console.log(`[open] branch=5-known-provider provider=${provider} provider_id=${provider_id}`);
      const token = buildReaderToken({
        provider,
        provider_id: provider_id,
        title,
        author,
        cover_url: cover,
        format: format || 'epub'
      });
      return res.redirect(`/unified-reader?token=${encodeURIComponent(token)}&ref=${encodeURIComponent(ref)}`);
    }

    // ----- Branch 6: truly unknown — try to resolve as archive one last time -----
    console.log(`[open] branch=6-last-resort provider_id=${provider_id}`);
    const lastResortId = extractArchiveIdFromKey(provider_id);
    if (lastResortId && !isNumericOnly(lastResortId)) {
      console.log(`[open] branch=6 trying as archive: ${lastResortId}`);
      const resolved = await resolveArchiveFile(lastResortId);
      if (resolved.ok) {
        const token = buildReaderToken({
          provider: 'archive',
          provider_id: lastResortId,
          archive_id: lastResortId,
          format: resolved.format,
          direct_url: resolved.direct_url,
          source_url: resolved.source_url,
          title,
          author,
          cover_url: cover || `https://archive.org/services/img/${lastResortId}`,
          best_pdf: resolved.best_pdf || null
        });
        return res.redirect(`/unified-reader?token=${encodeURIComponent(token)}&ref=${encodeURIComponent(ref)}`);
      }
    }

    // Show proper error page instead of redirecting to search
    console.warn(`[open] Cannot resolve unknown favorite: ${provider_id} "${title}"`);
    return res.status(404).render('error', {
      pageTitle: 'Book Not Found',
      statusCode: 404,
      message: `Could not open "${title}". The book may no longer be available from its source.`
    });

  } catch (err) {
    console.error('[open] error:', err);
    const safeTitle = req.query.title || 'this book';
    return res.status(500).render('error', {
      pageTitle: 'Error',
      statusCode: 500,
      message: `Something went wrong opening "${safeTitle}". Please try again.`
    });
  }
});

module.exports = router;
