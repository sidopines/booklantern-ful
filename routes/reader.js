// routes/reader.js — Federated public-domain EPUB reader with proxy
const express = require('express');
const { URL } = require('url');
const { ensureSubscriber, ensureSubscriberApi } = require('../utils/gate');
const { verifyReaderToken } = require('../utils/buildReaderToken');
const supabaseAdmin = require('../supabaseAdmin');

const router = express.Router();

// Allowed domains for EPUB proxying (security whitelist)
const ALLOWED_PROXY_DOMAINS = [
  'www.gutenberg.org',
  'gutenberg.org',
  'archive.org',
  'openlibrary.org',
  'covers.openlibrary.org',
  'loc.gov',
  'tile.loc.gov',
  'download.loc.gov',
  // OAPEN / DOAB (open access books)
  'library.oapen.org',
  'oapen.org',
  // OpenStax (open textbooks)
  'openstax.org',
  'assets.openstax.org',
  'd3bxy9euw4e147.cloudfront.net', // OpenStax CDN
];

// Check if URL domain is allowed for proxying
function isAllowedProxyDomain(urlString) {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();
    
    return ALLOWED_PROXY_DOMAINS.some(domain => {
      if (hostname === domain) return true;
      // Allow subdomains of certain domains
      if (hostname.endsWith('.archive.org')) return true;
      if (hostname.endsWith('.loc.gov')) return true;
      if (hostname.endsWith('.gutenberg.org')) return true;
      if (hostname.endsWith('.oapen.org')) return true;
      if (hostname.endsWith('.openstax.org')) return true;
      if (hostname.endsWith('.cloudfront.net')) return true; // OpenStax CDN
      return false;
    });
  } catch {
    return false;
  }
}

const PROXY_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36 BookLantern/1.0';
const PROXY_ACCEPT = 'application/epub+zip,application/octet-stream;q=0.9,application/xhtml+xml;q=0.8,*/*;q=0.8';
const FETCH_TIMEOUT_MS = 45000;

function parseArchiveIdentifier(urlString) {
  try {
    const u = new URL(urlString);
    if (!u.hostname.toLowerCase().includes('archive.org')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const downloadIdx = parts.indexOf('download');
    if (downloadIdx === -1 || downloadIdx + 1 >= parts.length) return null;
    return parts[downloadIdx + 1];
  } catch (_) {
    return null;
  }
}

function isProtectedArchiveFile(f) {
  const name = (f?.name || '').toLowerCase();
  const format = (f?.format || '').toLowerCase();

  const nameMatches =
    name.includes('lcp') ||
    name.endsWith('_lcp.epub') ||
    name.includes('drm') ||
    name.includes('protected') ||
    name.endsWith('.acsm');

  const formatMatches =
    format.includes('lcp') ||
    format.includes('protected') ||
    format.includes('drm') ||
    format.includes('adobe') ||
    format.includes('acsm');

  return nameMatches || formatMatches;
}

// Configurable size limits for EPUB and PDF (in MB)
const MAX_EPUB_MB = parseInt(process.env.MAX_EPUB_MB) || 50;
const MAX_PDF_MB = parseInt(process.env.MAX_PDF_MB) || 200;

// Extensions and formats to NEVER consider as EPUB (avoid "repub" matching)
const EPUB_EXCLUDE_EXTS = /\.(log|txt|xml|json|md|opf|ncx|html|htm|xhtml|css|js|jpg|jpeg|png|gif|svg|mp3|m4a|wav|ogg)$/i;

/**
 * Check if a file is a valid EPUB candidate by strict format/extension matching.
 * NEVER matches filenames containing "repub" as epub.
 */
function isValidEpubFile(f) {
  if (!f?.name) return false;
  const name = f.name;
  const format = (f.format || '').toLowerCase().trim();
  
  // Explicitly exclude files that end with non-epub extensions
  if (EPUB_EXCLUDE_EXTS.test(name)) return false;
  
  // Check format metadata first (Archive.org provides "EPUB", "EPUB 3", etc.)
  // Must be exact match or start with "epub" (e.g., "epub", "epub 3")
  // Do NOT match "repub" or other substrings
  const formatIsEpub = format === 'epub' || format.startsWith('epub ') || format === 'epub3';
  if (formatIsEpub) return true;
  
  // Fallback: check if filename ends with .epub or .epub3 (case-insensitive)
  return /\.epub3?$/i.test(name);
}

/**
 * Check if a file is a valid PDF candidate by strict format/extension matching.
 */
function isValidPdfFile(f) {
  if (!f?.name) return false;
  const name = f.name;
  const format = (f.format || '').toLowerCase().trim();
  
  // Check format metadata ("Text PDF", "PDF", etc.)
  const formatIsPdf = format === 'pdf' || format.includes('text pdf') || format === 'image container pdf';
  if (formatIsPdf) return true;
  
  // Fallback: check if filename ends with .pdf (case-insensitive)
  return /\.pdf$/i.test(name);
}

/**
 * Pick the best readable file from Archive.org metadata files array.
 * Priority: 
 *   a) EPUB <= MAX_EPUB_MB (default 50MB)
 *   b) PDF <= MAX_PDF_MB (default 200MB)
 *   c) Smallest EPUB (marked as too_large)
 * Returns: { name, format, size, too_large } or null if no suitable file
 */
function pickBestArchiveFile(files) {
  if (!Array.isArray(files)) return null;
  
  // Build candidate lists with STRICT matching
  const epubCandidates = [];
  const pdfCandidates = [];
  
  for (const f of files) {
    if (!f?.name) continue;
    if (isProtectedArchiveFile(f)) continue;
    
    const name = f.name;
    const size = Number(f.size) || 0;
    
    // EPUB candidates: strict format/extension check (never matches "repub")
    if (isValidEpubFile(f)) {
      epubCandidates.push({ name, format: 'epub', size });
    }
    // PDF candidates: strict format/extension check
    else if (isValidPdfFile(f)) {
      pdfCandidates.push({ name, format: 'pdf', size });
    }
  }
  
  // Sort by size ascending
  epubCandidates.sort((a, b) => a.size - b.size);
  pdfCandidates.sort((a, b) => a.size - b.size);
  
  const maxEpubBytes = MAX_EPUB_MB * 1024 * 1024;
  const maxPdfBytes = MAX_PDF_MB * 1024 * 1024;
  
  // Priority a) EPUB <= MAX_EPUB_MB
  const goodEpub = epubCandidates.find(c => c.size <= maxEpubBytes);
  if (goodEpub) {
    console.log(`[archive] Selected EPUB: ${goodEpub.name} (${Math.round(goodEpub.size/1e6)}MB)`);
    return { ...goodEpub, too_large: false };
  }
  
  // Priority b) PDF <= MAX_PDF_MB
  const goodPdf = pdfCandidates.find(c => c.size <= maxPdfBytes);
  if (goodPdf) {
    console.log(`[archive] No suitable EPUB, selected PDF: ${goodPdf.name} (${Math.round(goodPdf.size/1e6)}MB)`);
    return { ...goodPdf, too_large: false };
  }
  
  // Priority c) Smallest EPUB even if too large (for edition picker)
  if (epubCandidates.length > 0) {
    const smallest = epubCandidates[0];
    console.log(`[archive] Only large EPUB available: ${smallest.name} (${Math.round(smallest.size/1e6)}MB) - marked too_large`);
    return { ...smallest, too_large: true, all_files: { epubs: epubCandidates, pdfs: pdfCandidates } };
  }
  
  // No suitable files found
  console.log('[archive] No suitable EPUB or PDF files found');
  return null;
}

// Legacy function for backward compatibility - returns EPUB name or null
// For structured error info, use pickBestArchiveFile directly
function pickBestArchiveEpub(files) {
  const result = pickBestArchiveFile(files);
  if (!result) return null;
  // Only return EPUB files for legacy callers
  if (result.format !== 'epub') return null;
  return result.name;
}

function isRetryableNetworkError(err) {
  return err?.name === 'AbortError' || (err instanceof TypeError && /fetch failed/i.test(err.message));
}

async function fetchWithTimeout(url, timeoutMs, headers = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: headers || {
        'User-Agent': PROXY_UA,
        'Accept': PROXY_ACCEPT,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function fetchEpubWithRetry(url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetchWithTimeout(url, FETCH_TIMEOUT_MS, {
        'User-Agent': PROXY_UA,
        'Accept': PROXY_ACCEPT,
      });
    } catch (err) {
      lastErr = err;
      if (attempt === 0 && isRetryableNetworkError(err)) {
        console.warn('[proxy] retrying after network error for', url);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function fetchArchiveMetadata(identifier) {
  const metaUrl = `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
  const res = await fetchWithTimeout(metaUrl, 20000, {
    'User-Agent': PROXY_UA,
    'Accept': 'application/json',
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

// GET /unified-reader?token=...&ref=...
router.get('/unified-reader', ensureSubscriber, async (req, res) => {
  console.log('[reader] GET /unified-reader', req.query);
  try {
    const token = req.query.token;
    
    // Problem B: Return proper status codes for missing/invalid tokens
    if (!token) {
      console.warn('[reader] Missing token in unified-reader request');
      return res.status(400).render('error', { 
        statusCode: 400,
        message: 'Missing token. Please select a book from the search results.',
        pageTitle: 'Missing Token'
      });
    }
    
    const data = verifyReaderToken(token);
    if (!data) {
      console.warn('[reader] Invalid or expired token');
      return res.status(401).render('error', { 
        statusCode: 401,
        message: 'Invalid or expired token. Please try selecting the book again.',
        pageTitle: 'Invalid Token'
      });
    }

    // Normalize data from token
    const format = data.format || data.mode || 'iframe';
    const directUrl = data.direct_url || data.directUrl || data.url || '';
    const archiveId = data.archive_id || data.archiveId || null;
    const sourceUrl = data.source_url || data.sourceUrl || '';
    const ref = req.query.ref || data.ref || null;
    const fileSize = data.file_size || 0;
    const tooLarge = data.too_large === true;
    const availableFiles = data.available_files || null;
    const bestPdf = data.best_pdf || null; // PDF fallback filename for archive items
    
    // Determine if this is an EPUB file (needs ePub.js rendering, not iframe)
    // PDF files use iframe with our PDF proxy
    const isEpub = (format && format.toLowerCase() === 'epub') ||
                   (directUrl && directUrl.toLowerCase().includes('.epub'));
    const isPdf = format && format.toLowerCase() === 'pdf';
    
    return res.render('unified-reader', {
      title: data.title || 'Book',
      author: data.author || '',
      source: data.source || data.provider || '',
      provider: data.provider || '',
      provider_id: data.provider_id || '',
      cover_url: data.cover_url || '',
      format,
      mode: format, // for compatibility
      directUrl,
      sourceUrl, // For "Open Source Link" on error
      archiveId,
      isEpub, // Flag to use ePub.js renderer instead of iframe
      isPdf,  // Flag to use PDF iframe viewer
      fileSize,
      tooLarge,
      availableFiles,
      bestPdf, // PDF fallback filename for archive items
      backHref: ref || '/read',
      ref,
      user: req.user || null,
      buildId: Date.now()
    });
  } catch (e) {
    console.error('[unified-reader] error', e);
    return res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// POST /api/library/save
router.post('/api/library/save', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id, title, author, cover_url, provider, provider_id, format, direct_url } = req.body;
    if (!book_id || !title) return res.status(400).json({ error: 'Missing required fields' });
    
    const { error } = await supabaseAdmin.from('saved_books').upsert({
      user_id: userId, book_id, title, author: author || 'Unknown', cover_url,
      provider, provider_id, format: format || 'epub', direct_url,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,book_id' });
    
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error('[library/save] error:', error);
    return res.status(500).json({ error: 'Failed to save book' });
  }
});

// POST /api/library/remove
router.post('/api/library/remove', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id } = req.body;
    if (!book_id) return res.status(400).json({ error: 'Missing book_id' });
    
    const { error } = await supabaseAdmin.from('saved_books').delete()
      .eq('user_id', userId).eq('book_id', book_id);
    
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error('[library/remove] error:', error);
    return res.status(500).json({ error: 'Failed to remove book' });
  }
});

// POST /api/reader/progress
router.post('/api/reader/progress', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id, cfi, progress_percent } = req.body;
    if (!book_id || !cfi) return res.status(400).json({ error: 'Missing required fields' });
    
    const { error } = await supabaseAdmin.from('reading_progress').upsert({
      user_id: userId, book_id, cfi, progress_percent: progress_percent || 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,book_id' });
    
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error('[reader/progress] error:', error);
    return res.status(500).json({ error: 'Failed to save progress' });
  }
});

// GET /api/reader/progress/:book_id
router.get('/api/reader/progress/:book_id', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id } = req.params;
    const { data, error } = await supabaseAdmin.from('reading_progress').select('*')
      .eq('user_id', userId).eq('book_id', book_id).maybeSingle();
    if (error) throw error;
    return res.json(data || {});
  } catch (error) {
    console.error('[reader/progress] error:', error);
    return res.status(500).json({ error: 'Failed to get progress' });
  }
});

// POST /api/reader/bookmark
router.post('/api/reader/bookmark', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id, cfi, label } = req.body;
    if (!book_id || !cfi) return res.status(400).json({ error: 'Missing required fields' });
    
    const { data, error } = await supabaseAdmin.from('bookmarks').insert({
      user_id: userId, book_id, cfi, label: label || 'Bookmark',
      created_at: new Date().toISOString(),
    }).select().single();
    
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    console.error('[reader/bookmark] error:', error);
    return res.status(500).json({ error: 'Failed to add bookmark' });
  }
});

// GET /api/reader/bookmarks/:book_id
router.get('/api/reader/bookmarks/:book_id', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id } = req.params;
    const { data, error } = await supabaseAdmin.from('bookmarks').select('*')
      .eq('user_id', userId).eq('book_id', book_id).order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error('[reader/bookmarks] error:', error);
    return res.status(500).json({ error: 'Failed to get bookmarks' });
  }
});

// POST /api/reader/highlight
router.post('/api/reader/highlight', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id, cfi, text, color } = req.body;
    if (!book_id || !cfi || !text) return res.status(400).json({ error: 'Missing required fields' });
    
    const { data, error } = await supabaseAdmin.from('highlights').insert({
      user_id: userId, book_id, cfi, text, color: color || 'yellow',
      created_at: new Date().toISOString(),
    }).select().single();
    
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    console.error('[reader/highlight] error:', error);
    return res.status(500).json({ error: 'Failed to add highlight' });
  }
});

// GET /api/reader/highlights/:book_id
router.get('/api/reader/highlights/:book_id', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id } = req.params;
    const { data, error } = await supabaseAdmin.from('highlights').select('*')
      .eq('user_id', userId).eq('book_id', book_id).order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error('[reader/highlights] error:', error);
    return res.status(500).json({ error: 'Failed to get highlights' });
  }
});

// POST /api/reader/settings
router.post('/api/reader/settings', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { font_size, theme, font_family, line_height } = req.body;
    const { error } = await supabaseAdmin.from('reader_settings').upsert({
      user_id: userId, font_size, theme, font_family, line_height,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error('[reader/settings] error:', error);
    return res.status(500).json({ error: 'Failed to save settings' });
  }
});

// GET /api/reader/settings
router.get('/api/reader/settings', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { data, error } = await supabaseAdmin.from('reader_settings').select('*')
      .eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return res.json(data || {});
  } catch (error) {
    console.error('[reader/settings] error:', error);
    return res.status(500).json({ error: 'Failed to get settings' });
  }
});

// GET /library
router.get('/library', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) {
    return res.render('library', { pageTitle: 'My Library', books: [], error: 'Database not available' });
  }
  try {
    const userId = req.session.user.id;
    const { data: books, error } = await supabaseAdmin.from('saved_books').select('*')
      .eq('user_id', userId).order('updated_at', { ascending: false });
    if (error) throw error;
    
    const booksWithTokens = (books || []).map(book => {
      const token = sign({
        book_id: book.book_id, provider: book.provider, provider_id: book.provider_id,
        format: book.format, direct_url: book.direct_url, title: book.title,
        author: book.author, cover_url: book.cover_url,
      }, 3600);
      return { ...book, token };
    });
    
    return res.render('library', { pageTitle: 'My Library', books: booksWithTokens, error: null });
  } catch (error) {
    console.error('[library] error:', error);
    return res.render('library', { pageTitle: 'My Library', books: [], error: 'Failed to load library' });
  }
});

/**
 * GET /api/proxy/epub?url=<encoded-url> OR ?archive=<identifier>
 * Proxies EPUB files to avoid CORS issues with ePub.js
 * - Follows redirects server-side (no 302 to client)
 * - Streams response to client
 * - Validates ZIP header (PK signature)
 */
router.get('/api/proxy/epub', ensureSubscriberApi, async (req, res) => {
  const targetUrl = req.query.url;
  const archiveParam = req.query.archive;
  
  // Support both ?url= and ?archive= parameters
  let archiveId = archiveParam;
  let finalTargetUrl = targetUrl;
  
  if (archiveParam) {
    // Direct archive identifier mode - use metadata to find best EPUB
    archiveId = archiveParam;
    console.log('[proxy] Archive mode for identifier:', archiveId);
    
    try {
      const meta = await fetchArchiveMetadata(archiveId);
      if (!meta || !meta.files) {
        return res.status(404).json({ error: 'Archive metadata not found' });
      }
      
      const bestName = pickBestArchiveEpub(meta.files);
      if (!bestName) {
        // Check if there's a PDF fallback available
        const bestFile = pickBestArchiveFile(meta.files);
        const hasPdfFallback = bestFile && bestFile.format === 'pdf';
        return res.status(422).json({ 
          error: 'no_epub_available',
          detail: 'No valid EPUB file found in this archive item',
          has_pdf_fallback: hasPdfFallback,
          best_pdf: hasPdfFallback ? bestFile.name : undefined
        });
      }
      
      finalTargetUrl = `https://archive.org/download/${encodeURIComponent(archiveId)}/${encodeURIComponent(bestName)}`;
      console.log('[proxy] Resolved archive EPUB:', finalTargetUrl);
    } catch (err) {
      console.error('[proxy] Archive metadata error:', err);
      return res.status(502).json({ error: 'Failed to fetch archive metadata' });
    }
  } else if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url or archive parameter' });
  } else {
    // URL mode - validate domain
    if (!isAllowedProxyDomain(targetUrl)) {
      console.warn('[proxy] Blocked non-whitelisted domain:', targetUrl);
      return res.status(403).json({ error: 'Domain not allowed' });
    }
    archiveId = parseArchiveIdentifier(targetUrl);
  }
  
  console.log('[proxy] Fetching EPUB:', finalTargetUrl, archiveId ? `(archive: ${archiveId})` : '');

  async function tryArchiveFallback(reasonLabel) {
    if (!archiveId) return null;
    console.warn(`[proxy] attempting archive metadata fallback for ${archiveId} (${reasonLabel})`);
    const meta = await fetchArchiveMetadata(archiveId);
    if (!meta || !meta.files) throw new Error('Archive metadata unavailable');
    const bestName = pickBestArchiveEpub(meta.files);
    if (!bestName) {
      return { protected: true };
    }
    const fallbackUrl = `https://archive.org/download/${encodeURIComponent(archiveId)}/${encodeURIComponent(bestName)}`;
    console.log('[proxy] archive fallback candidate:', fallbackUrl);
    return await fetchEpubWithRetry(fallbackUrl);
  }

  let upstream;
  let finalUrl = finalTargetUrl;
  let lastErr;

  try {
    upstream = await fetchEpubWithRetry(finalTargetUrl);

    if (upstream && !upstream.ok && archiveId && (upstream.status === 404 || upstream.status === 403)) {
      upstream.body?.cancel?.();
      const fallbackRes = await tryArchiveFallback(`upstream ${upstream.status}`);
      if (fallbackRes?.protected) {
        return res.status(422).json({
          error: 'borrow_required',
          detail: 'This book is DRM-protected and requires borrowing from the source library',
          source_url: `https://archive.org/details/${archiveId}`
        });
      }
      upstream = fallbackRes;
      finalUrl = upstream?.url || finalUrl;
    }
  } catch (err) {
    lastErr = err;
    if (archiveId && isRetryableNetworkError(err)) {
      try {
        const fallbackRes = await tryArchiveFallback(err.message || err.name);
        if (fallbackRes?.protected) {
          return res.status(422).json({
            error: 'borrow_required',
            detail: 'This book is DRM-protected and requires borrowing from the source library',
            source_url: `https://archive.org/details/${archiveId}`
          });
        }
        upstream = fallbackRes;
        finalUrl = upstream?.url || finalUrl;
      } catch (fallbackErr) {
        lastErr = fallbackErr;
      }
    }
  }

  if (!upstream) {
    const detail = lastErr?.message || 'No upstream response';
    console.error('[proxy] Failed to fetch EPUB:', detail);
    const status = lastErr?.name === 'AbortError' ? 504 : 502;
    return res.status(status).json({ error: 'Failed to fetch EPUB', detail });
  }

  if (!upstream.ok) {
    console.error('[proxy] Upstream error after attempts:', upstream.status, upstream.url);
    // Build source URL for error response
    const sourceUrl = archiveId 
      ? `https://archive.org/details/${archiveId}`
      : (finalUrl.includes('archive.org') ? finalUrl.replace('/download/', '/details/').replace(/\/[^/]+\.epub.*$/, '') : finalUrl);
    
    if (upstream.status === 401 || upstream.status === 403) {
      return res.status(422).json({ 
        error: 'borrow_required',
        detail: 'This book requires borrowing from the source library',
        source_url: sourceUrl
      });
    }
    return res.status(upstream.status === 404 ? 404 : 502).json({ 
      error: 'Upstream returned ' + upstream.status,
      source_url: sourceUrl
    });
  }

  console.log('[proxy] Upstream OK, final URL:', upstream.url || finalUrl, 'Content-Length:', upstream.headers.get('content-length'));

  try {
    const reader = upstream.body.getReader();
    const firstChunk = await reader.read();

    if (firstChunk.done || !firstChunk.value || firstChunk.value.length < 2) {
      console.error('[proxy] Empty or too small response');
      return res.status(502).json({ error: 'Empty response from upstream' });
    }

    // Check for HTML response (likely a login/error page)
    const firstBytes = firstChunk.value.slice(0, 100);
    const text = Buffer.from(firstBytes).toString('utf-8', 0, Math.min(100, firstBytes.length)).toLowerCase();
    if (text.includes('<!doctype') || text.includes('<html') || text.includes('<head')) {
      console.error('[proxy] Got HTML instead of EPUB (likely protected/login required)');
      const sourceUrl = archiveId 
        ? `https://archive.org/details/${archiveId}`
        : (finalUrl.includes('archive.org') ? finalUrl.replace('/download/', '/details/').replace(/\/[^/]+\.epub.*$/, '') : finalUrl);
      return res.status(422).json({ 
        error: 'borrow_required',
        detail: 'This book requires borrowing or login at the source',
        source_url: sourceUrl
      });
    }

    // Validate ZIP/EPUB header (PK = 0x50 0x4B)
    if (firstChunk.value[0] !== 0x50 || firstChunk.value[1] !== 0x4B) {
      console.error('[proxy] Invalid EPUB: not a ZIP file (first bytes:', 
        firstChunk.value[0].toString(16), firstChunk.value[1].toString(16), ')');
      return res.status(422).json({ 
        error: 'Invalid EPUB (not a ZIP archive)',
        detail: 'This file is not a valid EPUB format'
      });
    }

    const ct = upstream.headers.get('content-type') || 'application/epub+zip';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline; filename="book.epub"');

    const contentLength = upstream.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
      // Also set X-Book-Bytes for client-side size-aware timeout
      res.setHeader('X-Book-Bytes', contentLength);
    }

    res.write(Buffer.from(firstChunk.value));

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }

    res.end();
    console.log('[proxy] EPUB streamed successfully');
  } catch (err) {
    console.error('[proxy] Error while streaming:', err.name, err.message);
    if (!res.headersSent) {
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: 'Request timeout (45s)' });
      }
      return res.status(502).json({ error: 'Failed to fetch EPUB: ' + err.message });
    }
  }
});

/**
 * GET /api/proxy/pdf?archive=<identifier>&file=<filename> OR ?url=<encoded-url>
 * Proxies PDF files for on-site viewing
 * - archive param: Archive.org identifier
 * - file param (optional): Specific PDF filename to use (must end with .pdf)
 * - url param: Direct URL proxy (allowlist validated)
 * Supports Range requests for better compatibility
 */
router.get('/api/proxy/pdf', ensureSubscriberApi, async (req, res) => {
  const archiveParam = req.query.archive;
  const fileParam = req.query.file;
  const urlParam = req.query.url;
  
  let targetUrl = null;
  let archiveId = archiveParam;
  
  if (archiveParam) {
    // Archive mode
    console.log('[pdf-proxy] Archive mode for:', archiveParam, 'file:', fileParam || '(auto-select)');
    
    // If file param provided, validate and use it directly
    if (fileParam) {
      // Validate the file ends with .pdf (case-insensitive)
      if (!/\.pdf$/i.test(fileParam)) {
        return res.status(400).json({ 
          error: 'Invalid file parameter',
          detail: 'File must end with .pdf'
        });
      }
      
      targetUrl = `https://archive.org/download/${encodeURIComponent(archiveParam)}/${encodeURIComponent(fileParam)}`;
      console.log('[pdf-proxy] Using specified PDF file:', targetUrl);
    } else {
      // Auto-select best PDF from metadata
      try {
        const meta = await fetchArchiveMetadata(archiveParam);
        if (!meta || !meta.files) {
          return res.status(404).json({ error: 'Archive metadata not found' });
        }
        
        // Find best PDF file using strict validation
        const pdfCandidates = meta.files
          .filter(f => isValidPdfFile(f))
          .map(f => ({ 
            name: f.name, 
            size: Number(f.size) || 0,
            isTextPdf: (f.format || '').toLowerCase().includes('text pdf')
          }))
          // Sort: Text PDF first, then by size
          .sort((a, b) => {
            if (a.isTextPdf && !b.isTextPdf) return -1;
            if (!a.isTextPdf && b.isTextPdf) return 1;
            return a.size - b.size;
          });
        
        if (!pdfCandidates.length) {
          return res.status(404).json({ error: 'No PDF file found in archive' });
        }
        
        const maxPdfBytes = MAX_PDF_MB * 1024 * 1024;
        const suitable = pdfCandidates.find(p => p.size <= maxPdfBytes);
        const bestPdf = suitable ? suitable.name : pdfCandidates[0].name;
        
        targetUrl = `https://archive.org/download/${encodeURIComponent(archiveParam)}/${encodeURIComponent(bestPdf)}`;
        console.log('[pdf-proxy] Auto-selected PDF:', targetUrl);
      } catch (err) {
        console.error('[pdf-proxy] Metadata error:', err);
        return res.status(502).json({ error: 'Failed to fetch archive metadata' });
      }
    }
  } else if (urlParam) {
    // URL mode: validate domain and proxy
    if (!isAllowedProxyDomain(urlParam)) {
      console.warn('[pdf-proxy] Blocked non-whitelisted domain:', urlParam);
      return res.status(403).json({ error: 'Domain not allowed' });
    }
    targetUrl = urlParam;
    console.log('[pdf-proxy] URL mode:', targetUrl);
  } else {
    return res.status(400).json({ error: 'Missing archive or url parameter' });
  }
  
  try {
    // Check for Range header for partial content requests
    const rangeHeader = req.headers.range;
    const headers = {
      'User-Agent': PROXY_UA,
      'Accept': 'application/pdf, */*',
    };
    if (rangeHeader) {
      headers['Range'] = rangeHeader;
    }
    
    const response = await fetchWithTimeout(targetUrl, 60000, headers);
    
    // Handle redirects (fetch follows them automatically)
    if (!response.ok && response.status !== 206) {
      console.error('[pdf-proxy] Upstream error:', response.status, targetUrl);
      
      if (response.status === 401 || response.status === 403) {
        return res.status(422).json({ 
          error: 'borrow_required',
          detail: 'This PDF requires borrowing from the source library',
          source_url: archiveId ? `https://archive.org/details/${archiveId}` : targetUrl
        });
      }
      return res.status(response.status).json({ error: 'Upstream error' });
    }
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');
    
    // Forward relevant headers
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
    }
    
    // Set status code (200 or 206)
    res.status(response.status);
    
    // Stream the response
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
    console.log('[pdf-proxy] PDF streamed successfully');
    
  } catch (err) {
    console.error('[pdf-proxy] Error:', err.message);
    if (!res.headersSent) {
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: 'Request timeout' });
      }
      return res.status(502).json({ error: 'Failed to fetch PDF: ' + err.message });
    }
  }
});

module.exports = router;
