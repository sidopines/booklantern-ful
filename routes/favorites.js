// routes/favorites.js
// Routes for favorites page and token-safe book opener
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const { ensureSubscriber } = require('../utils/gate');
const { buildReaderToken } = require('../utils/buildReaderToken');
const supabase = require('../lib/supabaseServer');

// Import archive resolution helpers from reader.js (lazy loaded to avoid circular deps)
let fetchArchiveMetadataFn = null;
let pickBestArchiveFileFn = null;

async function resolveArchiveFile(identifier) {
  // Lazy load from reader.js
  if (!fetchArchiveMetadataFn) {
    const fetch = require('node-fetch');
    const PROXY_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36 BookLantern/1.0';
    
    fetchArchiveMetadataFn = async (id) => {
      const metaUrl = `https://archive.org/metadata/${encodeURIComponent(id)}`;
      const res = await fetch(metaUrl, {
        headers: { 'User-Agent': PROXY_UA, 'Accept': 'application/json' },
        timeout: 20000
      });
      if (!res.ok) return null;
      try { return await res.json(); } catch { return null; }
    };
    
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
    const meta = await fetchArchiveMetadataFn(identifier);
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

  console.log(`[open] Opening book: provider=${provider}, id=${provider_id}, title=${title}`);

  try {
    // Extract real archive ID from bookKey (strips bl-book- prefix if present)
    // This handles bookKeys like "bl-book-archiveIdentifier" or double-prefixed ones
    const realArchiveId = extractArchiveIdFromKey(provider_id);
    
    // Determine if this is an archive book
    const isArchiveBook = provider === 'archive' || 
                          provider === 'unknown' ||  // Most favorites saved as 'unknown' are archive
                          provider_id.includes('archive.org') ||
                          (realArchiveId && realArchiveId !== provider_id); // Had bl-book- prefix
    
    if (isArchiveBook) {
      // Extract archive identifier from URL if it's a full URL
      let archiveId = realArchiveId;
      if (provider_id.includes('archive.org')) {
        const match = provider_id.match(/archive\.org\/details\/([^/?#]+)/);
        if (match) archiveId = match[1];
      }
      
      if (!archiveId) {
        console.error(`[open] Could not extract archive ID from: ${provider_id}`);
        return res.status(400).render('error', {
          pageTitle: 'Invalid Book ID',
          statusCode: 400,
          message: 'Could not identify the book. Please try searching for it again.'
        });
      }

      console.log(`[open] Resolving archive book: ${archiveId}`);
      
      // Resolve the archive file to get the actual EPUB/PDF URL
      const resolved = await resolveArchiveFile(archiveId);
      
      if (!resolved.ok) {
        console.error(`[open] Archive resolution failed for: ${archiveId}`);
        return res.status(404).render('error', {
          pageTitle: 'Book Not Found',
          statusCode: 404,
          message: 'This book could not be found or is not available for reading. Please try searching for another edition.'
        });
      }

      // Generate token with full URLs - CRITICAL FIX
      const token = buildReaderToken({
        provider: 'archive',
        provider_id: archiveId,
        archive_id: archiveId,
        format: resolved.format, // 'epub' or 'pdf'
        direct_url: resolved.direct_url, // THE ACTUAL FILE URL
        source_url: resolved.source_url,
        title: title,
        author: author,
        cover_url: cover || `https://archive.org/services/img/${archiveId}`,
        best_pdf: resolved.best_pdf || null
      });

      const redirectUrl = `/unified-reader?token=${encodeURIComponent(token)}&ref=${encodeURIComponent(ref)}`;
      console.log(`[open] Archive redirect: ${archiveId} -> ${resolved.format}`);
      return res.redirect(redirectUrl);
    }

    // Check if this is an external/DOAB/OAPEN book (URL-based)
    if (provider === 'external' || provider === 'doab' || provider === 'oapen' ||
        provider_id.startsWith('http://') || provider_id.startsWith('https://')) {
      
      // For external books, redirect to /read with search to resolve
      // This triggers the normal external token resolution flow
      const searchQuery = `${title} ${author}`.trim();
      console.log(`[open] External book, redirecting to search: ${searchQuery}`);
      return res.redirect(`/read?q=${encodeURIComponent(searchQuery)}`);
    }

    // For other providers (gutenberg, openlibrary, etc.)
    // Generate a fresh token - note: these may still need direct_url resolution
    // For now, let unified-reader handle these via its existing proxy logic
    const token = buildReaderToken({
      provider: provider,
      provider_id: provider_id,
      title: title,
      author: author,
      cover_url: cover,
      format: 'epub'
    });

    const redirectUrl = `/unified-reader?token=${encodeURIComponent(token)}&ref=${encodeURIComponent(ref)}`;
    console.log(`[open] Standard redirect for ${provider}: ${provider_id}`);
    return res.redirect(redirectUrl);

  } catch (err) {
    console.error('[open] error:', err);
    return res.status(500).render('error', {
      pageTitle: 'Error Opening Book',
      statusCode: 500,
      message: 'Failed to open book. Please try searching for it again.'
    });
  }
});

module.exports = router;
