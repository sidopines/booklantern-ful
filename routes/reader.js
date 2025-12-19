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

function pickBestArchiveEpub(files) {
  if (!Array.isArray(files)) return null;
  const candidates = files.filter(f => f?.name && /\.epub$/i.test(f.name));
  if (!candidates.length) return null;

  const sortedBySize = (arr) => arr
    .map(f => ({ name: f.name, size: Number(f.size) || 0 }))
    .sort((a, b) => b.size - a.size);

  const nonProtected = sortedBySize(candidates.filter(f => !isProtectedArchiveFile(f)));
  if (nonProtected.length) return nonProtected[0].name;

  // If only protected EPUBs exist, do not fall back to them
  return null;
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
    
    // Determine if this is an EPUB file (needs ePub.js rendering, not iframe)
    const isEpub = (format && format.toLowerCase() === 'epub') ||
                   (directUrl && directUrl.toLowerCase().includes('.epub'));
    
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
        return res.status(422).json({ 
          error: 'EPUB is protected',
          detail: 'No suitable EPUB file found in archive (all protected or restricted)'
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

module.exports = router;
