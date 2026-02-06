// routes/favorites.js
// Routes for favorites page and token-safe book opener
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const { ensureSubscriber } = require('../utils/gate');
const { buildReaderToken } = require('../utils/buildReaderToken');
const supabase = require('../lib/supabaseServer');

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
        
        // Skip protected/DRM files
        if (name.includes('lcp') || name.includes('drm') || name.includes('protected') ||
            name.endsWith('.acsm') || format.includes('lcp') || format.includes('drm')) continue;
        
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

    // Map to template format
    const favorites = (items || []).map(item => ({
      bookKey: item.book_key,
      source: item.source,
      title: item.title,
      author: item.author,
      cover: item.cover,
      readerUrl: item.reader_url,
      category: item.category,
      createdAt: item.created_at
    }));

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
  const {
    provider = 'unknown',
    provider_id,
    title = 'Untitled',
    author = '',
    cover = ''
  } = req.query;

  const ref = req.query.ref || '/read';

  // Validate required params
  if (!provider_id) {
    return res.status(400).render('error', {
      pageTitle: 'Missing Book ID',
      statusCode: 400,
      message: 'No book identifier provided. Please go back and try again.'
    });
  }

  const source_url = req.query.source_url || '';
  const archive_id = req.query.archive_id || '';
  const direct_url = req.query.direct_url || '';
  const format = req.query.format || '';

  console.log(`[open] Opening book: provider=${provider}, id=${provider_id}, title=${title}`);

  try {
    // Extract real archive ID from bookKey (strips bl-book- prefix if present)
    const realArchiveId = extractArchiveIdFromKey(provider_id);

    // Determine if this is truly an Archive.org book using strong signals only
    const archiveLike = isArchiveLike({
      provider,
      providerId: provider_id,
      sourceUrl: source_url,
      cover
    });

    // ----- Branch 1: confirmed archive book -----
    if (archiveLike) {
      let archiveId = null;

      // Derive archiveId from source_url first (most reliable)
      if (source_url.includes('archive.org/details/')) {
        const match = source_url.match(/archive\.org\/details\/([^/?#]+)/);
        if (match) archiveId = match[1];
      }
      // Then try provider_id if it's a URL
      if (!archiveId && provider_id.includes('archive.org')) {
        const match = provider_id.match(/archive\.org\/details\/([^/?#]+)/);
        if (match) archiveId = match[1];
      }
      // Then try archive_id query param
      if (!archiveId && archive_id) archiveId = archive_id;
      // Then try stripping bl-book- prefix
      if (!archiveId && realArchiveId) archiveId = realArchiveId;

      if (!archiveId) {
        console.error(`[open] Could not extract archive ID from: ${provider_id}`);
        return res.redirect(`/read?q=${encodeURIComponent(title)}&notice=resolve_failed`);
      }

      console.log(`[open] Resolving archive book: ${archiveId}`);
      const resolved = await resolveArchiveFile(archiveId);

      if (!resolved.ok) {
        console.warn(`[open] Archive resolution failed for: ${archiveId}, falling back to search`);
        return res.redirect(`/read?q=${encodeURIComponent(title)}&notice=resolve_failed`);
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

    // ----- Branch 2: unknown provider but has archive_id param -----
    if (archive_id && provider === 'unknown') {
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
      // fall through to other strategies
    }

    // ----- Branch 3: has a direct_url we can use -----
    if (direct_url) {
      console.log(`[open] Using direct_url for ${provider}: ${provider_id}`);
      const fmt = format || (direct_url.toLowerCase().endsWith('.pdf') ? 'pdf' : 'epub');
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
      console.log(`[open] External book, redirecting to search: ${searchQuery}`);
      return res.redirect(`/read?q=${encodeURIComponent(searchQuery)}`);
    }

    // ----- Branch 5: known providers (gutenberg, openlibrary, etc.) -----
    if (provider !== 'unknown') {
      console.log(`[open] Standard redirect for ${provider}: ${provider_id}`);
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

    // ----- Branch 6: truly unknown — graceful fallback to search -----
    console.warn(`[open] Cannot resolve unknown favorite: ${provider_id} "${title}", falling back to search`);
    return res.redirect(`/read?q=${encodeURIComponent(title)}&notice=resolve_failed`);

  } catch (err) {
    console.error('[open] error:', err);
    // Never 500 — redirect to search so user isn't stuck
    return res.redirect(`/read?q=${encodeURIComponent(title)}&notice=error`);
  }
});

module.exports = router;
