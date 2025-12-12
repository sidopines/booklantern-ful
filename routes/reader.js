// routes/reader.js — Federated public-domain EPUB reader with proxy
const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { ensureSubscriber } = require('../utils/gate');
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

// GET /unified-reader?token=...&ref=...
router.get('/unified-reader', ensureSubscriber, async (req, res) => {
  console.log('[reader] GET /unified-reader', req.query);
  try {
    const token = req.query.token;
    const data = verifyReaderToken(token);
    if (!data) return res.status(400).render('error', { message: 'Invalid or expired token.' });

    // Normalize data from token
    const format = data.format || data.mode || 'iframe';
    const directUrl = data.direct_url || data.directUrl || data.url || '';
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
 * GET /api/proxy/epub?url=<encoded-url>
 * Proxies EPUB files to avoid CORS issues with ePub.js
 */
router.get('/api/proxy/epub', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  // Security: only allow whitelisted domains
  if (!isAllowedProxyDomain(targetUrl)) {
    console.warn('[proxy] Blocked non-whitelisted domain:', targetUrl);
    return res.status(403).json({ error: 'Domain not allowed' });
  }
  
  try {
    const parsed = new URL(targetUrl);
    const protocol = parsed.protocol === 'https:' ? https : http;
    
    const proxyReq = protocol.get(targetUrl, {
      headers: {
        'User-Agent': 'BookLantern/1.0 (+https://booklantern.org)',
        'Accept': 'application/epub+zip, application/octet-stream, */*',
        'Accept-Encoding': 'identity',
      },
      timeout: 30000,
    }, (proxyRes) => {
      // Handle redirects
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        const redirectUrl = proxyRes.headers.location;
        
        // Handle relative redirects
        let absoluteRedirect = redirectUrl;
        if (!redirectUrl.startsWith('http')) {
          absoluteRedirect = new URL(redirectUrl, targetUrl).href;
        }
        
        // Validate redirect URL
        if (!isAllowedProxyDomain(absoluteRedirect)) {
          console.warn('[proxy] Redirect to non-whitelisted domain blocked:', absoluteRedirect);
          return res.status(403).json({ error: 'Redirect domain not allowed' });
        }
        
        // Follow redirect
        return res.redirect(`/api/proxy/epub?url=${encodeURIComponent(absoluteRedirect)}`);
      }
      
      if (proxyRes.statusCode !== 200) {
        console.error('[proxy] Upstream error:', proxyRes.statusCode, targetUrl);
        return res.status(proxyRes.statusCode).json({ error: 'Upstream error' });
      }
      
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/epub+zip');
      
      // Forward content-length if available
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      
      // Stream the response
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
      console.error('[proxy] Request error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to fetch EPUB' });
      }
    });
    
    proxyReq.on('timeout', () => {
      console.error('[proxy] Request timeout:', targetUrl);
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timeout' });
      }
    });
    
  } catch (err) {
    console.error('[proxy] Error:', err.message);
    return res.status(500).json({ error: 'Proxy error' });
  }
});

module.exports = router;
