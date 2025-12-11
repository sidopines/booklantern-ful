// routes/proxy.js - CORS proxy for EPUB files
const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const router = express.Router();

// Allowed domains for EPUB proxying (security whitelist)
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
];

// Check if URL domain is allowed
function isAllowedDomain(urlString) {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();
    
    // Check exact match or if it's an archive.org CDN subdomain
    return ALLOWED_DOMAINS.some(domain => {
      if (hostname === domain) return true;
      if (hostname.endsWith('.archive.org')) return true;
      if (hostname.endsWith('.loc.gov')) return true;
      return false;
    });
  } catch {
    return false;
  }
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