// routes/proxy.js - CORS proxy for EPUB and PDF files
const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const router = express.Router();

// Allowed domains for EPUB/PDF proxying (security whitelist)
const ALLOWED_DOMAINS = [
  'www.gutenberg.org',
  'gutenberg.org',
  'archive.org',
  'ia600000.us.archive.org', // IA CDN domains follow this pattern
  'openlibrary.org',
  'covers.openlibrary.org',
  'loc.gov',
  'tile.loc.gov',
  'download.loc.gov',
  'www.loc.gov',
  // OAPEN / DOAB (open access books)
  'library.oapen.org',
  'oapen.org',
  'doabooks.org',
  'directory.doabooks.org',
  'www.doabooks.org',
  // OpenStax (open textbooks)
  'openstax.org',
  'assets.openstax.org',
  'd3bxy9euw4e147.cloudfront.net', // OpenStax CDN
];

// PDF-specific allowed domains for LoC and other sources
const PDF_ALLOWED_DOMAINS = [
  ...ALLOWED_DOMAINS,
  'tile.loc.gov',
  'download.loc.gov',
  'www.loc.gov',
  'cdn.loc.gov',
  // OAPEN PDFs
  'library.oapen.org',
  'oapen.org',
  'directory.doabooks.org',
  // OpenStax PDFs
  'openstax.org',
  'assets.openstax.org',
  'd3bxy9euw4e147.cloudfront.net',
];

// Check if URL domain is allowed
function isAllowedDomain(urlString, allowedList = ALLOWED_DOMAINS) {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();
    
    // Check exact match or if it's a known CDN subdomain
    return allowedList.some(domain => {
      if (hostname === domain) return true;
      if (hostname.endsWith('.archive.org')) return true;
      if (hostname.endsWith('.loc.gov')) return true;
      if (hostname.endsWith('.gutenberg.org')) return true;
      if (hostname.endsWith('.oapen.org')) return true;
      if (hostname.endsWith('.doabooks.org')) return true;
      if (hostname.endsWith('.openstax.org')) return true;
      if (hostname.endsWith('.cloudfront.net')) return true; // OpenStax CDN
      return false;
    });
  } catch {
    return false;
  }
}

const PROXY_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36 BookLantern/1.0';
const FETCH_TIMEOUT_MS = 60000; // 60s for larger PDFs

/**
 * Fetch archive metadata to find best PDF file
 */
async function fetchArchiveMetadata(identifier, timeout = 20000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const metaUrl = `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
    const res = await fetch(metaUrl, {
      headers: { 'User-Agent': PROXY_UA, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Pick best PDF file from archive metadata
 */
function pickBestArchivePdf(files) {
  if (!Array.isArray(files)) return null;
  
  const pdfCandidates = files
    .filter(f => {
      if (!f?.name) return false;
      const name = f.name.toLowerCase();
      const format = (f.format || '').toLowerCase();
      return format.includes('text pdf') || format === 'pdf' || name.endsWith('.pdf');
    })
    .map(f => ({ name: f.name, size: Number(f.size) || 0 }))
    .sort((a, b) => a.size - b.size); // Prefer smaller PDFs
  
  if (!pdfCandidates.length) return null;
  
  // Return smallest PDF under 200MB, or just smallest
  const maxPdfBytes = (parseInt(process.env.MAX_PDF_MB) || 200) * 1024 * 1024;
  const suitable = pdfCandidates.find(p => p.size <= maxPdfBytes);
  return suitable ? suitable.name : pdfCandidates[0].name;
}

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
  if (!isAllowedDomain(targetUrl)) {
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
        'Accept-Encoding': 'identity', // Don't compress for streaming
      },
      timeout: 30000,
    }, (proxyRes) => {
      // Handle redirects
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        const redirectUrl = proxyRes.headers.location;
        
        // Validate redirect URL
        if (!isAllowedDomain(redirectUrl)) {
          console.warn('[proxy] Redirect to non-whitelisted domain blocked:', redirectUrl);
          return res.status(403).json({ error: 'Redirect domain not allowed' });
        }
        
        // Follow redirect
        return res.redirect(`/api/proxy/epub?url=${encodeURIComponent(redirectUrl)}`);
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

/**
 * GET /api/proxy/pdf?archive=<identifier> OR ?url=<encoded-url>
 * Proxies PDF files for on-site viewing
 * - archive param: resolves best PDF from archive.org metadata
 * - url param: direct URL proxy (allowlist validated)
 * Supports Range requests for better PDF viewer compatibility (Chrome requires this)
 */
router.get('/api/proxy/pdf', async (req, res) => {
  const archiveParam = req.query.archive;
  const urlParam = req.query.url;
  
  let targetUrl = null;
  let archiveId = archiveParam;
  
  if (archiveParam) {
    // Archive mode: resolve best PDF from metadata
    console.log('[pdf] Archive mode for:', archiveParam);
    
    try {
      const meta = await fetchArchiveMetadata(archiveParam);
      if (!meta || !meta.files) {
        return res.status(404).json({ error: 'Archive metadata not found' });
      }
      
      const bestPdf = pickBestArchivePdf(meta.files);
      if (!bestPdf) {
        return res.status(404).json({ error: 'No PDF file found in archive' });
      }
      
      targetUrl = `https://archive.org/download/${encodeURIComponent(archiveParam)}/${encodeURIComponent(bestPdf)}`;
      console.log('[pdf] Resolved PDF:', targetUrl);
    } catch (err) {
      console.error('[pdf] Metadata error:', err);
      return res.status(502).json({ error: 'Failed to fetch archive metadata' });
    }
  } else if (urlParam) {
    // URL mode: validate domain and proxy
    if (!isAllowedDomain(urlParam, PDF_ALLOWED_DOMAINS)) {
      console.warn('[pdf] Blocked non-whitelisted domain:', urlParam);
      return res.status(403).json({ error: 'Domain not allowed' });
    }
    targetUrl = urlParam;
    console.log('[pdf] URL mode:', targetUrl);
  } else {
    return res.status(400).json({ error: 'Missing archive or url parameter' });
  }
  
  try {
    const parsed = new URL(targetUrl);
    const protocol = parsed.protocol === 'https:' ? https : http;
    
    // Check for Range header for partial content requests
    const rangeHeader = req.headers.range;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/pdf, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://openstax.org/',
      'Accept-Encoding': 'identity', // Don't compress - needed for Range to work
    };
    
    if (rangeHeader) {
      headers['Range'] = rangeHeader;
      console.log('[pdf] Range request:', rangeHeader);
    }
    
    const proxyReq = protocol.get(targetUrl, {
      headers,
      timeout: FETCH_TIMEOUT_MS,
    }, (proxyRes) => {
      // Handle redirects
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        const redirectUrl = proxyRes.headers.location;
        
        if (!isAllowedDomain(redirectUrl, PDF_ALLOWED_DOMAINS)) {
          console.warn('[pdf] Redirect to blocked domain:', redirectUrl);
          return res.status(403).json({ error: 'Redirect domain not allowed' });
        }
        
        // Follow redirect - preserve range param if present
        const redirectProxy = `/api/proxy/pdf?url=${encodeURIComponent(redirectUrl)}`;
        console.log('[pdf] Following redirect to:', redirectUrl);
        return res.redirect(redirectProxy);
      }
      
      // Accept 200 OK or 206 Partial Content
      if (proxyRes.statusCode !== 200 && proxyRes.statusCode !== 206) {
        console.error('[pdf] Upstream error:', proxyRes.statusCode, targetUrl);
        
        // For 403 specifically: redirect client to original URL (let iframe/browser try direct load)
        if (proxyRes.statusCode === 403) {
          const originalUrl = urlParam || (archiveId ? `https://archive.org/details/${archiveId}` : targetUrl);
          console.log('[pdf] 403 fallback - redirecting to:', originalUrl);
          return res.redirect(302, originalUrl);
        }
        
        return res.status(proxyRes.statusCode).json({ error: 'Upstream error', status: proxyRes.statusCode });
      }
      
      const upstreamContentLength = proxyRes.headers['content-length'];
      console.log('[pdf] Upstream status:', proxyRes.statusCode, 'content-length:', upstreamContentLength || 'chunked');
      
      // Set response headers - force correct content type
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="document.pdf"');
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache PDFs for 1 hour
      res.setHeader('X-Content-Type-Options', 'nosniff');
      
      // Always advertise Range support
      res.setHeader('Accept-Ranges', 'bytes');
      
      // Forward relevant headers from upstream
      if (upstreamContentLength) {
        res.setHeader('Content-Length', upstreamContentLength);
      }
      
      // Handle 206 Partial Content responses
      if (proxyRes.statusCode === 206) {
        if (proxyRes.headers['content-range']) {
          res.setHeader('Content-Range', proxyRes.headers['content-range']);
          console.log('[pdf] Content-Range:', proxyRes.headers['content-range']);
        }
        res.status(206);
      } else {
        res.status(200);
      }
      
      // Stream the response
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
      console.error('[pdf] Request error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to fetch PDF' });
      }
    });
    
    proxyReq.on('timeout', () => {
      console.error('[pdf] Request timeout:', targetUrl);
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timeout' });
      }
    });
    
  } catch (err) {
    console.error('[pdf] Error:', err.message);
    return res.status(500).json({ error: 'Proxy error' });
  }
});