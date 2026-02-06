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
  'directory.doabooks.org',
  'doabooks.org',
  // OpenStax (open textbooks)
  'openstax.org',
  'assets.openstax.org',
  'cnx.org',
  'd3bxy9euw4e147.cloudfront.net', // OpenStax CDN
  // HathiTrust
  'babel.hathitrust.org',
  'hathitrust.org',
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
      if (hostname.endsWith('.doabooks.org')) return true;
      if (hostname.endsWith('.openstax.org')) return true;
      if (hostname.endsWith('.cnx.org')) return true;
      if (hostname.endsWith('.hathitrust.org')) return true;
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

async function fetchWithTimeout(url, timeoutMs, headers = null, method = 'GET') {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
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

// ============================================================================
// EXTERNAL RESOLVER: Resolve landing pages to direct PDF URLs
// ============================================================================

// In-memory cache for external metadata (cover URLs) with 24h TTL
const externalMetaCache = new Map();
const EXTERNAL_META_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachedExternalMeta(url) {
  const cached = externalMetaCache.get(url);
  if (cached && Date.now() < cached.expires) {
    return cached.data;
  }
  externalMetaCache.delete(url);
  return null;
}

function setCachedExternalMeta(url, data) {
  externalMetaCache.set(url, {
    data,
    expires: Date.now() + EXTERNAL_META_CACHE_TTL_MS
  });
}

// Allowlist for external resolution (OAPEN/DOAB/CATALOG)
const EXTERNAL_RESOLVE_ALLOWLIST = [
  'library.oapen.org',
  'oapen.org',
  'directory.doabooks.org',
  'doabooks.org',
  'www.doabooks.org',
];

function isAllowedExternalDomain(urlString) {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();
    return EXTERNAL_RESOLVE_ALLOWLIST.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * Resolve a landing page URL to a direct PDF link
 * @param {string} landingUrl - The landing page URL to resolve
 * @returns {Promise<{ok: boolean, direct_url?: string, format?: string}>}
 */
async function resolveExternalPdf(landingUrl) {
  try {
    // Fetch the landing page HTML
    const response = await fetchWithTimeout(landingUrl, 15000, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    });

    if (!response.ok) {
      console.log(`[externalResolve] landing=${landingUrl} status=${response.status}`);
      return { ok: false };
    }

    const html = await response.text();
    
    // Extract PDF link: look for href containing /bitstream/handle/ and .pdf
    // Pattern: href="..." or href='...'
    const hrefPattern = /href=["']([^"']*\/bitstream\/handle\/[^"']*\.pdf[^"']*)["']/gi;
    let match;
    let directUrl = null;

    while ((match = hrefPattern.exec(html)) !== null) {
      let href = match[1];
      // Convert relative URL to absolute
      if (!href.startsWith('http://') && !href.startsWith('https://')) {
        href = new URL(href, landingUrl).toString();
      }
      directUrl = href;
      break; // Use the first match
    }

    console.log(`[externalResolve] landing=${landingUrl} foundPdf=${directUrl || 'null'}`);
    
    if (directUrl) {
      return { ok: true, format: 'pdf', direct_url: directUrl };
    }
    return { ok: false };
  } catch (err) {
    console.error(`[externalResolve] error for ${landingUrl}:`, err.message);
    return { ok: false };
  }
}

// GET /api/external/resolve?url=<landing_url>
router.get('/api/external/resolve', async (req, res) => {
  const url = req.query.url;
  
  if (!url) {
    return res.status(400).json({ ok: false, error: 'Missing url parameter' });
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid URL format' });
  }

  // Check allowlist
  if (!isAllowedExternalDomain(url)) {
    console.log(`[externalResolve] blocked non-allowlisted domain: ${url}`);
    return res.json({ ok: false, source_url: url });
  }

  const result = await resolveExternalPdf(url);
  
  if (result.ok) {
    return res.json({
      ok: true,
      format: result.format,
      direct_url: result.direct_url,
      source_url: url
    });
  }
  
  return res.json({ ok: false, source_url: url });
});

// GET /api/external/meta?url=<landing_url>
// Returns cover image URL and downloadable files extracted from landing page HTML
router.get('/api/external/meta', async (req, res) => {
  const url = req.query.url;
  
  if (!url) {
    return res.status(400).json({ ok: false, error: 'Missing url parameter' });
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid URL format' });
  }

  // Check allowlist
  if (!isAllowedExternalDomain(url)) {
    return res.json({ ok: false });
  }

  // Check cache first
  const cached = getCachedExternalMeta(url);
  if (cached !== null) {
    console.log(`[externalMeta] cache hit landing=${url} cover=${cached.cover_url || 'null'} files=${cached.files?.length || 0}`);
    return res.json(cached);
  }

  try {
    // Fetch the landing page HTML
    const response = await fetchWithTimeout(url, 15000, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    });

    if (!response.ok) {
      console.log(`[externalMeta] landing=${url} status=${response.status}`);
      const result = { ok: false };
      setCachedExternalMeta(url, result);
      return res.json(result);
    }

    const html = await response.text();
    let coverUrl = null;
    const files = [];
    const seenUrls = new Set();

    // Helper: normalize relative URL to absolute
    function toAbsolute(href) {
      if (!href) return null;
      href = href.trim();
      if (!href) return null;
      if (href.startsWith('http://') || href.startsWith('https://')) return href;
      try {
        return new URL(href, url).toString();
      } catch {
        return null;
      }
    }

    // Helper: check if URL is a thumbnail/preview image (not actual PDF)
    function isThumbnail(href) {
      if (!href) return true;
      const lower = href.toLowerCase();
      return lower.includes('.pdf.jpg') || lower.includes('.pdf.png') || 
             lower.includes('_thumb') || lower.includes('thumbnail') ||
             lower.includes('/cover/') || lower.includes('preview');
    }

    // Helper: strip query/hash from URL for extension checking
    function getCleanPath(href) {
      if (!href) return '';
      return href.split('?')[0].split('#')[0].toLowerCase();
    }

    // ============ Extract downloadable files ============
    
    // 1. Try citation_pdf_url meta tag (most reliable for academic sites)
    const citationPdfMatch = html.match(/<meta\s+(?:name|property)=["']citation_pdf_url["']\s+content=["']([^"']+)["']/i)
                          || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:name|property)=["']citation_pdf_url["']/i);
    if (citationPdfMatch && citationPdfMatch[1]) {
      const pdfUrl = toAbsolute(citationPdfMatch[1]);
      if (pdfUrl && !isThumbnail(pdfUrl) && !seenUrls.has(pdfUrl)) {
        seenUrls.add(pdfUrl);
        files.push({ format: 'pdf', url: pdfUrl, label: 'PDF (citation)' });
        console.log(`[externalMeta] found citation_pdf_url: ${pdfUrl}`);
      }
    }

    // 2. Try citation_epub_url meta tag
    const citationEpubMatch = html.match(/<meta\s+(?:name|property)=["']citation_epub_url["']\s+content=["']([^"']+)["']/i)
                           || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:name|property)=["']citation_epub_url["']/i);
    if (citationEpubMatch && citationEpubMatch[1]) {
      const epubUrl = toAbsolute(citationEpubMatch[1]);
      if (epubUrl && !seenUrls.has(epubUrl)) {
        seenUrls.add(epubUrl);
        files.push({ format: 'epub', url: epubUrl, label: 'EPUB (citation)' });
        console.log(`[externalMeta] found citation_epub_url: ${epubUrl}`);
      }
    }

    // 3. Look for <a href> links containing /bitstream/ ending with .pdf or .epub (handles querystrings)
    const hrefPattern = /href=["']([^"']*\/bitstream\/[^"']*)["']/gi;
    let hrefMatch;
    while ((hrefMatch = hrefPattern.exec(html)) !== null) {
      let href = hrefMatch[1];
      
      // Skip thumbnail images disguised as PDFs
      if (isThumbnail(href)) continue;
      
      const absUrl = toAbsolute(href);
      if (!absUrl || seenUrls.has(absUrl)) continue;
      
      // Strip query/hash for extension check
      const cleanPath = getCleanPath(href);
      
      if (cleanPath.endsWith('.pdf')) {
        seenUrls.add(absUrl);
        files.push({ format: 'pdf', url: absUrl, label: 'PDF (bitstream)' });
        console.log(`[externalMeta] found bitstream PDF: ${absUrl}`);
      } else if (cleanPath.endsWith('.epub')) {
        seenUrls.add(absUrl);
        files.push({ format: 'epub', url: absUrl, label: 'EPUB (bitstream)' });
        console.log(`[externalMeta] found bitstream EPUB: ${absUrl}`);
      }
    }

    // 4. Look for any href ending with .pdf or .epub (broader search, handles querystrings)
    const anyPdfPattern = /href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi;
    while ((hrefMatch = anyPdfPattern.exec(html)) !== null) {
      const href = hrefMatch[1];
      if (isThumbnail(href)) continue;
      const absUrl = toAbsolute(href);
      if (absUrl && !seenUrls.has(absUrl)) {
        seenUrls.add(absUrl);
        files.push({ format: 'pdf', url: absUrl, label: 'PDF' });
        console.log(`[externalMeta] found generic PDF link: ${absUrl}`);
      }
    }

    const anyEpubPattern = /href=["']([^"']+\.epub(?:\?[^"']*)?)["']/gi;
    while ((hrefMatch = anyEpubPattern.exec(html)) !== null) {
      const absUrl = toAbsolute(hrefMatch[1]);
      if (absUrl && !seenUrls.has(absUrl)) {
        seenUrls.add(absUrl);
        files.push({ format: 'epub', url: absUrl, label: 'EPUB' });
        console.log(`[externalMeta] found generic EPUB link: ${absUrl}`);
      }
    }

    // ============ Extract cover image ============
    
    // 1. Try og:image meta tag
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
                      || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
    if (ogImageMatch && ogImageMatch[1]) {
      let ogUrl = ogImageMatch[1].trim();
      if (ogUrl && !ogUrl.toLowerCase().endsWith('.pdf')) {
        coverUrl = toAbsolute(ogUrl);
      }
    }

    // 2. Try img src with /bitstream/handle/ and image extension
    if (!coverUrl) {
      const imgPattern = /<img[^>]+src=["']([^"']*\/bitstream\/handle\/[^"']*)["'][^>]*>/gi;
      let imgMatch;
      while ((imgMatch = imgPattern.exec(html)) !== null) {
        let src = imgMatch[1];
        // Check if it's an image (jpg, jpeg, png, webp)
        if (/\.(jpg|jpeg|png|webp)/i.test(src)) {
          coverUrl = toAbsolute(src);
          break;
        }
      }
    }

    // 3. Try twitter:image
    if (!coverUrl) {
      const twitterImageMatch = html.match(/<meta\s+(?:name|property)=["']twitter:image["']\s+content=["']([^"']+)["']/i)
                             || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:name|property)=["']twitter:image["']/i);
      if (twitterImageMatch && twitterImageMatch[1]) {
        let twUrl = twitterImageMatch[1].trim();
        if (twUrl && !twUrl.toLowerCase().endsWith('.pdf')) {
          coverUrl = toAbsolute(twUrl);
        }
      }
    }

    console.log(`[externalMeta] landing=${url} cover=${coverUrl || 'null'} files=${files.length}`);

    const result = { 
      ok: coverUrl || files.length > 0, 
      cover_url: coverUrl || undefined,
      files: files.length > 0 ? files : undefined
    };
    setCachedExternalMeta(url, result);
    return res.json(result);

  } catch (err) {
    console.error(`[externalMeta] error for ${url}:`, err.message);
    const result = { ok: false };
    setCachedExternalMeta(url, result);
    return res.json(result);
  }
});

// ============================================================================
// PROVIDER-SPECIFIC EXTRACTORS FOR /api/external/token
// ============================================================================

/**
 * Helper: Normalize relative URL to absolute
 */
function toAbsoluteUrl(href, baseUrl) {
  if (!href) return null;
  href = href.trim();
  if (!href) return null;
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Helper: Check if URL is a thumbnail/derivative (not actual content)
 */
function isThumbnailOrDerivative(href) {
  if (!href) return true;
  const lower = href.toLowerCase();
  // Thumbnail patterns: .pdf.jpg, .pdf.png, etc.
  if (/\.pdf\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(lower)) return true;
  // Image file extensions
  if (/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(lower)) return true;
  // Explicit thumbnail markers
  if (lower.includes('_thumb') || lower.includes('thumbnail')) return true;
  // Preview/cover paths (unless in bitstream)
  if ((lower.includes('/cover/') || lower.includes('preview')) && !lower.includes('/bitstream/')) return true;
  return false;
}

/**
 * Helper: Validate candidate URL via HEAD request
 * Returns { valid: true, contentType } or { valid: false }
 */
async function validateCandidateUrl(url) {
  try {
    const response = await fetchWithTimeout(url, 10000, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
    }, 'HEAD');
    
    if (!response.ok) {
      return { valid: false, reason: `HTTP ${response.status}` };
    }
    
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const isPdf = contentType.includes('application/pdf');
    const isEpub = contentType.includes('application/epub+zip') || contentType.includes('application/epub');
    const isOctet = contentType.includes('application/octet-stream');
    
    if (isPdf) return { valid: true, contentType: 'application/pdf', format: 'pdf' };
    if (isEpub) return { valid: true, contentType: 'application/epub+zip', format: 'epub' };
    // Accept octet-stream if URL has .pdf or .epub extension
    if (isOctet) {
      const urlLower = url.toLowerCase();
      if (urlLower.includes('.pdf')) return { valid: true, contentType, format: 'pdf' };
      if (urlLower.includes('.epub')) return { valid: true, contentType, format: 'epub' };
    }
    
    return { valid: false, reason: `Content-Type: ${contentType}` };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}

/**
 * OAPEN Extractor (library.oapen.org)
 * Extracts downloadable files from OAPEN landing pages
 */
async function extractOapenFiles(landingUrl, html) {
  const candidates = [];
  const seenUrls = new Set();
  
  // 1. citation_pdf_url meta tag (most reliable)
  const citationPdfMatch = html.match(/<meta\s+(?:name|property)=["']citation_pdf_url["']\s+content=["']([^"']+)["']/i)
                        || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:name|property)=["']citation_pdf_url["']/i);
  if (citationPdfMatch?.[1]) {
    const url = toAbsoluteUrl(citationPdfMatch[1], landingUrl);
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      candidates.push({ url, format: 'pdf', source: 'citation_pdf_url' });
    }
  }
  
  // 2. citation_epub_url meta tag
  const citationEpubMatch = html.match(/<meta\s+(?:name|property)=["']citation_epub_url["']\s+content=["']([^"']+)["']/i)
                         || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:name|property)=["']citation_epub_url["']/i);
  if (citationEpubMatch?.[1]) {
    const url = toAbsoluteUrl(citationEpubMatch[1], landingUrl);
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      candidates.push({ url, format: 'epub', source: 'citation_epub_url' });
    }
  }
  
  // 3. JSON-LD contentUrl / encoding.contentUrl
  const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const jsonData = JSON.parse(match[1]);
      const contentUrls = [];
      if (jsonData.contentUrl) contentUrls.push(jsonData.contentUrl);
      if (jsonData.encoding?.contentUrl) contentUrls.push(jsonData.encoding.contentUrl);
      if (Array.isArray(jsonData.encoding)) {
        jsonData.encoding.forEach(enc => enc.contentUrl && contentUrls.push(enc.contentUrl));
      }
      for (const rawUrl of contentUrls) {
        const url = toAbsoluteUrl(rawUrl, landingUrl);
        if (url && !seenUrls.has(url) && !isThumbnailOrDerivative(url)) {
          seenUrls.add(url);
          const lower = url.toLowerCase();
          if (lower.includes('.epub')) {
            candidates.push({ url, format: 'epub', source: 'json-ld' });
          } else if (lower.includes('.pdf')) {
            candidates.push({ url, format: 'pdf', source: 'json-ld' });
          }
        }
      }
    } catch { /* ignore parse errors */ }
  }
  
  // 4. <a href> containing "/bitstream/" and ending with .pdf or .epub
  const bitstreamPattern = /href=["']([^"']*\/bitstream\/[^"']*)["']/gi;
  let match;
  while ((match = bitstreamPattern.exec(html)) !== null) {
    const url = toAbsoluteUrl(match[1], landingUrl);
    if (!url || seenUrls.has(url) || isThumbnailOrDerivative(url)) continue;
    seenUrls.add(url);
    const lower = url.toLowerCase();
    const path = lower.split('?')[0].split('#')[0];
    if (path.endsWith('.epub')) {
      candidates.push({ url, format: 'epub', source: 'bitstream' });
    } else if (path.endsWith('.pdf')) {
      candidates.push({ url, format: 'pdf', source: 'bitstream' });
    }
  }
  
  // 5. Any href ending with .pdf or .epub (fallback)
  const hrefPattern = /href=["']([^"']+)["']/gi;
  while ((match = hrefPattern.exec(html)) !== null) {
    const url = toAbsoluteUrl(match[1], landingUrl);
    if (!url || seenUrls.has(url) || isThumbnailOrDerivative(url)) continue;
    const lower = url.toLowerCase();
    const path = lower.split('?')[0].split('#')[0];
    if (path.endsWith('.epub')) {
      seenUrls.add(url);
      candidates.push({ url, format: 'epub', source: 'href' });
    } else if (path.endsWith('.pdf')) {
      seenUrls.add(url);
      candidates.push({ url, format: 'pdf', source: 'href' });
    }
  }
  
  return candidates;
}

/**
 * DOAB/DSpace Extractor (directory.doabooks.org)
 * Extracts downloadable files from DOAB/DSpace landing pages
 */
async function extractDoabFiles(landingUrl, html) {
  const candidates = [];
  const seenUrls = new Set();
  
  // 1. citation_pdf_url meta tag
  const citationPdfMatch = html.match(/<meta\s+(?:name|property)=["']citation_pdf_url["']\s+content=["']([^"']+)["']/i)
                        || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:name|property)=["']citation_pdf_url["']/i);
  if (citationPdfMatch?.[1]) {
    const url = toAbsoluteUrl(citationPdfMatch[1], landingUrl);
    if (url && !seenUrls.has(url) && !isThumbnailOrDerivative(url)) {
      seenUrls.add(url);
      candidates.push({ url, format: 'pdf', source: 'citation_pdf_url' });
    }
  }
  
  // 2. citation_epub_url meta tag
  const citationEpubMatch = html.match(/<meta\s+(?:name|property)=["']citation_epub_url["']\s+content=["']([^"']+)["']/i)
                         || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:name|property)=["']citation_epub_url["']/i);
  if (citationEpubMatch?.[1]) {
    const url = toAbsoluteUrl(citationEpubMatch[1], landingUrl);
    if (url && !seenUrls.has(url) && !isThumbnailOrDerivative(url)) {
      seenUrls.add(url);
      candidates.push({ url, format: 'epub', source: 'citation_epub_url' });
    }
  }
  
  // 3. DSpace bitstream links - collect all hrefs/srcs containing "/bitstream/"
  // Accept candidates without extensions too (verify via HEAD later)
  const bitstreamPattern = /(?:href|src)=["']([^"']*\/bitstream\/[^"']*)["']/gi;
  let match;
  while ((match = bitstreamPattern.exec(html)) !== null) {
    const url = toAbsoluteUrl(match[1], landingUrl);
    if (!url || seenUrls.has(url) || isThumbnailOrDerivative(url)) continue;
    seenUrls.add(url);
    
    const lower = url.toLowerCase();
    const path = lower.split('?')[0].split('#')[0];
    
    if (path.endsWith('.epub')) {
      candidates.push({ url, format: 'epub', source: 'bitstream' });
    } else if (path.endsWith('.pdf')) {
      candidates.push({ url, format: 'pdf', source: 'bitstream' });
    } else if (!path.match(/\.(jpg|jpeg|png|gif|webp|svg|html|htm|xml|css|js)$/)) {
      // No extension or unknown - mark for HEAD validation
      candidates.push({ url, format: 'unknown', source: 'bitstream', needsValidation: true });
    }
  }
  
  // 4. Any href ending with .pdf or .epub (broader search)
  const hrefPattern = /href=["']([^"']+)["']/gi;
  while ((match = hrefPattern.exec(html)) !== null) {
    const url = toAbsoluteUrl(match[1], landingUrl);
    if (!url || seenUrls.has(url) || isThumbnailOrDerivative(url)) continue;
    const lower = url.toLowerCase();
    const path = lower.split('?')[0].split('#')[0];
    if (path.endsWith('.epub')) {
      seenUrls.add(url);
      candidates.push({ url, format: 'epub', source: 'href' });
    } else if (path.endsWith('.pdf')) {
      seenUrls.add(url);
      candidates.push({ url, format: 'pdf', source: 'href' });
    }
  }
  
  return candidates;
}

/**
 * Validate candidates via HEAD requests and return verified files
 */
async function validateCandidates(candidates, maxCandidates = 10) {
  const validatedFiles = [];
  const toValidate = candidates.slice(0, maxCandidates);
  
  for (const candidate of toValidate) {
    // Skip validation for known formats unless marked needsValidation
    if (!candidate.needsValidation && (candidate.format === 'pdf' || candidate.format === 'epub')) {
      // Still do a quick HEAD to confirm it's accessible
      const result = await validateCandidateUrl(candidate.url);
      if (result.valid) {
        validatedFiles.push({
          url: candidate.url,
          format: result.format || candidate.format,
          source: candidate.source,
          validated: true,
        });
      } else {
        console.log(`[externalToken] HEAD failed for ${candidate.url}: ${result.reason}`);
      }
    } else if (candidate.needsValidation) {
      // Unknown format - must validate via HEAD
      const result = await validateCandidateUrl(candidate.url);
      if (result.valid && result.format) {
        validatedFiles.push({
          url: candidate.url,
          format: result.format,
          source: candidate.source,
          validated: true,
        });
      } else {
        console.log(`[externalToken] HEAD validation failed for ${candidate.url}: ${result.reason}`);
      }
    }
  }
  
  return validatedFiles;
}

// POST /api/external/token
// Resolves landing page to downloadable files and mints a signed token
router.post('/api/external/token', async (req, res) => {
  const { provider, title, author, cover_url, landing_url } = req.body;
  
  // Standard response shape
  const makeResponse = (ok, error, extras = {}) => ({
    ok,
    error: error || null,
    token: extras.token || null,
    format: extras.format || null,
    direct_url: extras.direct_url || null,
    source_url: landing_url || null,
    open_url: landing_url || null,
    title: title || null,
    author: author || null,
    cover_url: extras.cover_url || cover_url || null,
  });
  
  // Validate landing_url
  if (!landing_url) {
    return res.status(400).json(makeResponse(false, 'missing_landing_url'));
  }

  // Check allowlist for landing URL
  if (!isAllowedExternalDomain(landing_url)) {
    console.log(`[externalToken] blocked non-allowlisted domain: ${landing_url}`);
    return res.json(makeResponse(false, 'domain_not_allowed'));
  }

  // Determine provider
  const isOapen = landing_url.includes('library.oapen.org');
  const isDoab = landing_url.includes('directory.doabooks.org');
  const providerName = isOapen ? 'OAPEN' : isDoab ? 'DOAB' : 'unknown';
  
  let candidates = [];
  let resolvedCoverUrl = cover_url || null;
  
  try {
    // Fetch the landing page HTML
    console.log(`[externalToken] Fetching landing page: ${landing_url}`);
    const response = await fetchWithTimeout(landing_url, 15000, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    });

    if (!response.ok) {
      console.error(`[externalToken] Failed to fetch landing page: HTTP ${response.status}`);
      return res.json(makeResponse(false, 'fetch_failed'));
    }

    const html = await response.text();
    
    // Use provider-specific extractor
    if (isOapen) {
      candidates = await extractOapenFiles(landing_url, html);
    } else if (isDoab) {
      candidates = await extractDoabFiles(landing_url, html);
    } else {
      // Generic fallback: try both extractors
      candidates = await extractOapenFiles(landing_url, html);
      if (candidates.length === 0) {
        candidates = await extractDoabFiles(landing_url, html);
      }
    }
    
    console.log(`[externalToken] ${providerName}: Found ${candidates.length} candidates from HTML`);
    candidates.slice(0, 10).forEach((c, i) => {
      console.log(`  ${i + 1}. [${c.format}] ${c.url} (via ${c.source})${c.needsValidation ? ' [needs validation]' : ''}`);
    });

    // Extract cover if not provided
    if (!resolvedCoverUrl) {
      const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
                        || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
      if (ogImageMatch?.[1]) {
        const ogUrl = ogImageMatch[1].trim();
        if (ogUrl && !ogUrl.toLowerCase().endsWith('.pdf')) {
          resolvedCoverUrl = toAbsoluteUrl(ogUrl, landing_url);
        }
      }
    }
  } catch (err) {
    console.error(`[externalToken] fetch error for ${landing_url}:`, err.message);
    return res.json(makeResponse(false, 'fetch_error'));
  }

  // Validate candidates via HEAD requests
  console.log(`[externalToken] Validating ${Math.min(candidates.length, 10)} candidates via HEAD...`);
  const validatedFiles = await validateCandidates(candidates, 10);
  
  console.log(`[externalToken] ${providerName}: ${validatedFiles.length} validated files`);
  validatedFiles.forEach(f => console.log(`  - [${f.format}] ${f.url} (via ${f.source})`));

  // Choose best file: prefer EPUB > PDF
  const epubFile = validatedFiles.find(f => f.format === 'epub');
  const pdfFile = validatedFiles.find(f => f.format === 'pdf');
  const bestFile = epubFile || pdfFile;

  if (!bestFile) {
    // Diagnostics: log what we considered
    console.log(`[externalToken] NO FILES FOUND for ${providerName}: ${landing_url}`);
    console.log(`[externalToken] Top 10 candidates considered (after filtering):`);
    candidates.slice(0, 10).forEach((c, i) => {
      console.log(`  ${i + 1}. [${c.format}] ${c.url} (via ${c.source})`);
    });
    if (candidates.length === 0) {
      console.log(`  (no candidates detected in HTML)`);
    }
    return res.json(makeResponse(false, 'no_files_found', { cover_url: resolvedCoverUrl }));
  }

  // Validate the chosen file URL is allowed by proxy
  if (!isAllowedProxyDomain(bestFile.url)) {
    console.log(`[externalToken] file URL not allowed by proxy: ${bestFile.url}`);
    return res.json(makeResponse(false, 'domain_not_allowed', {
      format: bestFile.format,
      direct_url: bestFile.url,
      cover_url: resolvedCoverUrl,
    }));
  }

  // Generate a signed reader token
  const { buildReaderToken } = require('../utils/buildReaderToken');
  
  const token = buildReaderToken({
    provider: 'external',
    provider_id: landing_url,
    format: bestFile.format,
    direct_url: bestFile.url,
    source_url: landing_url,
    title: title || 'Untitled',
    author: author || '',
    cover_url: resolvedCoverUrl || '',
  });
  
  console.log(`[externalToken] SUCCESS: ${title || 'Untitled'} (${bestFile.format})`);
  console.log(`[externalToken] direct_url: ${bestFile.url}`);
  
  return res.json(makeResponse(true, null, {
    token,
    format: bestFile.format,
    direct_url: bestFile.url,
    cover_url: resolvedCoverUrl,
  }));
});

// ============================================================================
// ARCHIVE.ORG RESOLVER: Resolve Archive items to readable files
// ============================================================================

/**
 * Extract Archive.org identifier from URL or return as-is if already an identifier
 * @param {string} input - URL like https://archive.org/details/xyz or identifier like xyz
 * @returns {string|null}
 */
function extractArchiveIdentifier(input) {
  if (!input) return null;
  
  // If it looks like a URL, parse it
  if (input.includes('archive.org')) {
    try {
      const url = new URL(input);
      const parts = url.pathname.split('/').filter(Boolean);
      // /details/identifier or /download/identifier
      const idx = parts.findIndex(p => p === 'details' || p === 'download');
      if (idx !== -1 && parts[idx + 1]) {
        return parts[idx + 1];
      }
    } catch {
      return null;
    }
  }
  
  // Otherwise treat as identifier directly (alphanumeric, dots, underscores, hyphens)
  if (/^[a-zA-Z0-9._-]+$/.test(input)) {
    return input;
  }
  
  return null;
}

/**
 * Resolve an Archive.org identifier to a readable file (PDF or EPUB)
 * @param {string} identifier
 * @returns {Promise<{ok: boolean, format?: string, direct_url?: string, source_url: string}>}
 */
async function resolveArchiveFile(identifier) {
  const sourceUrl = `https://archive.org/details/${identifier}`;
  
  try {
    const meta = await fetchArchiveMetadata(identifier);
    if (!meta || !meta.files) {
      console.log(`[archiveResolve] id=${identifier} found=none (no metadata)`);
      return { ok: false, source_url: sourceUrl };
    }
    
    // Use existing pickBestArchiveFile which prioritizes EPUB then PDF
    const bestFile = pickBestArchiveFile(meta.files);
    
    if (!bestFile || bestFile.too_large) {
      console.log(`[archiveResolve] id=${identifier} found=none (no suitable file)`);
      return { ok: false, source_url: sourceUrl };
    }
    
    const directUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(bestFile.name)}`;
    console.log(`[archiveResolve] id=${identifier} found=${bestFile.name} format=${bestFile.format}`);
    
    return {
      ok: true,
      format: bestFile.format, // 'epub' or 'pdf'
      direct_url: directUrl,
      source_url: sourceUrl
    };
  } catch (err) {
    console.error(`[archiveResolve] error for ${identifier}:`, err.message);
    return { ok: false, source_url: sourceUrl };
  }
}

// GET /api/archive/resolve?identifier=...
router.get('/api/archive/resolve', async (req, res) => {
  const input = req.query.identifier || req.query.id || req.query.url;
  
  if (!input) {
    return res.status(400).json({ ok: false, error: 'Missing identifier parameter' });
  }
  
  const identifier = extractArchiveIdentifier(input);
  if (!identifier) {
    return res.status(400).json({ ok: false, error: 'Invalid Archive.org identifier' });
  }
  
  const result = await resolveArchiveFile(identifier);
  return res.json(result);
});

// POST /api/archive/token
router.post('/api/archive/token', async (req, res) => {
  const { identifier, title, author, cover_url } = req.body;
  
  if (!identifier) {
    return res.status(400).json({ ok: false, error: 'Missing identifier' });
  }
  
  const id = extractArchiveIdentifier(identifier);
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Invalid Archive.org identifier' });
  }
  
  const sourceUrl = `https://archive.org/details/${id}`;
  const resolved = await resolveArchiveFile(id);
  
  if (resolved.ok && resolved.direct_url) {
    const { buildReaderToken } = require('../utils/buildReaderToken');
    
    const token = buildReaderToken({
      provider: 'archive',
      provider_id: id,
      format: resolved.format,
      direct_url: resolved.direct_url,
      source_url: sourceUrl,
      title: title || 'Untitled',
      author: author || '',
      cover_url: cover_url || `https://archive.org/services/img/${id}`,
    });
    
    console.log(`[archiveToken] generated token for: ${title} (${id})`);
    return res.json({ ok: true, token });
  }
  
  // Fallback: fetch metadata for available files to show on external page
  let availableFiles = null;
  try {
    const meta = await fetchArchiveMetadata(id);
    if (meta && meta.files) {
      const epubs = meta.files
        .filter(f => isValidEpubFile(f) && !isProtectedArchiveFile(f))
        .map(f => ({ name: f.name, size: Number(f.size) || 0 }))
        .sort((a, b) => a.size - b.size);
      const pdfs = meta.files
        .filter(f => isValidPdfFile(f) && !isProtectedArchiveFile(f))
        .map(f => ({ name: f.name, size: Number(f.size) || 0 }))
        .sort((a, b) => a.size - b.size);
      if (epubs.length || pdfs.length) {
        availableFiles = { epubs, pdfs };
      }
    }
  } catch (e) {
    console.error('[archiveToken] metadata fetch error:', e.message);
  }
  
  console.log(`[archiveToken] fallback for: ${id} files=${availableFiles ? 'yes' : 'no'}`);
  return res.json({ 
    ok: false, 
    open_url: sourceUrl,
    archive_id: id,
    available_files: availableFiles,
    title: title || '',
    author: author || '',
    cover_url: cover_url || `https://archive.org/services/img/${id}`
  });
});

// GET /external?url=...&ref=...&title=...&author=...&reason=...&archive_id=...&files=...
router.get('/external', async (req, res) => {
  const url = req.query.url || '';
  const ref = req.query.ref || '/read';
  const bookTitle = req.query.title || '';
  const author = req.query.author || '';
  const reason = req.query.reason || '';
  const archiveId = req.query.archive_id || '';
  const coverUrl = req.query.cover_url || (archiveId ? `https://archive.org/services/img/${archiveId}` : '');
  
  // Try to get available files from query or fetch from archive
  let files = null;
  if (req.query.files) {
    try {
      files = JSON.parse(req.query.files);
    } catch (e) {}
  }
  
  // If no files provided but we have an archive ID, try to fetch
  if (!files && archiveId) {
    try {
      const meta = await fetchArchiveMetadata(archiveId);
      if (meta && meta.files) {
        const epubs = meta.files
          .filter(f => isValidEpubFile(f) && !isProtectedArchiveFile(f))
          .map(f => ({ name: f.name, size: Number(f.size) || 0 }))
          .sort((a, b) => a.size - b.size);
        const pdfs = meta.files
          .filter(f => isValidPdfFile(f) && !isProtectedArchiveFile(f))
          .map(f => ({ name: f.name, size: Number(f.size) || 0 }))
          .sort((a, b) => a.size - b.size);
        if (epubs.length || pdfs.length) {
          files = { epubs, pdfs };
        }
      }
    } catch (e) {
      console.error('[external] metadata fetch error:', e.message);
    }
  }
  
  res.render('external', {
    pageTitle: bookTitle || 'External Content',
    externalUrl: url,
    backHref: ref,
    bookTitle: bookTitle,
    author: author,
    reason: reason,
    archiveId: archiveId,
    coverUrl: coverUrl,
    files: files,
  });
});

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
      console.warn('[reader] Token rejected for', req.path, { ref: req.query.ref });

      // Try to decode the token payload (before the dot) so we can build a /open retry link
      let retryUrl = '/read';
      try {
        const dotIdx = token.indexOf('.');
        if (dotIdx > 0) {
          const payloadB64 = token.slice(0, dotIdx);
          const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
          const params = new URLSearchParams();
          params.set('provider', payload.provider || 'unknown');
          params.set('provider_id', payload.provider_id || payload.archive_id || '');
          if (payload.title) params.set('title', payload.title);
          if (payload.author) params.set('author', payload.author);
          if (payload.cover_url) params.set('cover', payload.cover_url);
          if (payload.direct_url) params.set('direct_url', payload.direct_url);
          if (payload.format) params.set('format', payload.format);
          retryUrl = '/open?' + params.toString();
        }
      } catch (_) { /* keep default /read */ }

      return res.status(401).render('error', { 
        statusCode: 401,
        message: 'Your reading session has expired. Use the button below to re-open this book.',
        pageTitle: 'Session Expired',
        retryUrl: retryUrl
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
      return { ...book };
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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/pdf, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://openstax.org/',
    };
    if (rangeHeader) {
      headers['Range'] = rangeHeader;
    }
    
    const response = await fetchWithTimeout(targetUrl, 60000, headers);
    
    // Handle redirects (fetch follows them automatically)
    if (!response.ok && response.status !== 206) {
      console.error('[pdf-proxy] Upstream error:', response.status, targetUrl);
      
      // For 403 specifically: redirect client to original URL (let iframe/browser try direct load)
      if (response.status === 403) {
        const originalUrl = urlParam || (archiveId ? `https://archive.org/details/${archiveId}` : targetUrl);
        console.log('[pdf-proxy] 403 fallback - redirecting to:', originalUrl);
        return res.redirect(302, originalUrl);
      }
      
      if (response.status === 401) {
        return res.status(422).json({ 
          error: 'borrow_required',
          detail: 'This PDF requires borrowing from the source library',
          source_url: archiveId ? `https://archive.org/details/${archiveId}` : targetUrl
        });
      }
      return res.status(response.status).json({ error: 'Upstream error', status: response.status });
    }
    
    // Set response headers for embeddable inline viewing
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');
    
    // CRITICAL: Content-Disposition: inline allows embedding in iframe/object
    // Without this, Chrome may treat it as a download and block embedded viewing
    const safeFilename = (fileParam || 'document').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.pdf$/i, '') + '.pdf';
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    
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

/**
 * SSRF protection: Check if a hostname resolves to a private/internal IP
 * Blocks: localhost, 127.x.x.x, 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 169.254.x.x, ::1, fc00::/7
 */
function isPrivateOrInternalHost(hostname) {
  const lower = hostname.toLowerCase();
  // Block localhost and common internal names
  if (lower === 'localhost' || lower === 'localhost.localdomain' ||
      lower.endsWith('.localhost') || lower.endsWith('.local') ||
      lower.endsWith('.internal') || lower === 'metadata.google.internal') {
    return true;
  }
  // Block IP address patterns
  // IPv4 private/reserved
  if (/^127\.\d+\.\d+\.\d+$/.test(hostname)) return true;  // 127.0.0.0/8
  if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return true;   // 10.0.0.0/8
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname)) return true; // 172.16.0.0/12
  if (/^192\.168\.\d+\.\d+$/.test(hostname)) return true;  // 192.168.0.0/16
  if (/^169\.254\.\d+\.\d+$/.test(hostname)) return true;  // Link-local (cloud metadata)
  if (/^0\.\d+\.\d+\.\d+$/.test(hostname)) return true;    // 0.0.0.0/8
  // IPv6 loopback and private
  if (hostname === '::1' || hostname === '::' || hostname.startsWith('fe80:') ||
      hostname.startsWith('fc') || hostname.startsWith('fd')) {
    return true;
  }
  return false;
}

/**
 * GET /api/proxy/file?url=<encoded-url>
 * GET /api/proxy/file?token=<signed-token>  (or ?t=...)
 * Generic file proxy that streams any file type (PDF, EPUB, images)
 * - Validates URL against allowlist
 * - SSRF protection: blocks localhost, private IPs, cloud metadata endpoints
 * - Supports Range requests (Accept-Ranges / 206 Partial Content) for PDFs
 * - Preserves Content-Type and Content-Length
 * - Sets Content-Disposition: inline for embedding
 * - Retries with simpler headers on failure
 * - Returns 502 on failure (NEVER redirects to external URL for CSP safety)
 * 
 * Authentication modes:
 * 1. token/t param: Verifies signed token, extracts direct_url from payload (no session needed)
 * 2. url param: Requires logged-in subscriber session (existing behavior)
 * 
 * This is the primary endpoint for embedding blocked-iframe PDFs like OpenStax
 */
router.get('/api/proxy/file', async (req, res, next) => {
  // If token provided, validate it and extract direct_url
  const tokenParam = req.query.token || req.query.t;
  if (tokenParam) {
    const payload = verifyReaderToken(tokenParam);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (!payload.direct_url) {
      return res.status(400).json({ error: 'Token missing direct_url' });
    }
    // Attach extracted URL and proceed (skip ensureSubscriberApi)
    req._tokenDirectUrl = payload.direct_url;
    return handleFileProxy(req, res);
  }
  
  // No token: require subscriber auth via middleware
  ensureSubscriberApi(req, res, (err) => {
    if (err) return next(err);
    handleFileProxy(req, res);
  });
});

// Shared handler for file proxy logic
async function handleFileProxy(req, res) {
  // Use token-extracted URL if present, otherwise query param
  const targetUrl = req._tokenDirectUrl || req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  // Validate URL format
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  // SSRF protection: only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.warn('[file-proxy] Blocked non-http protocol:', targetUrl);
    return res.status(400).json({ error: 'Only http/https URLs allowed' });
  }
  
  // SSRF protection: block private/internal hosts
  if (isPrivateOrInternalHost(parsed.hostname)) {
    console.warn('[file-proxy] Blocked private/internal host:', parsed.hostname);
    return res.status(403).json({ error: 'Internal hosts not allowed' });
  }
  
  // Validate domain against allowlist
  if (!isAllowedProxyDomain(targetUrl)) {
    console.warn('[file-proxy] Blocked non-whitelisted domain:', targetUrl);
    return res.status(403).json({ error: 'Domain not allowed for proxying' });
  }
  
  console.log('[file-proxy] Proxying:', targetUrl);
  
  // Helper: build headers for upstream request
  function buildHeaders(simple = false) {
    const hostname = parsed.hostname.toLowerCase();
    const upstreamOrigin = `${parsed.protocol}//${parsed.host}`;
    
    const hdrs = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/pdf,*/*',
      'Accept-Encoding': 'identity', // Don't compress for proper Range support
    };
    
    if (!simple) {
      hdrs['Accept-Language'] = 'en-US,en;q=0.9';
      hdrs['Referer'] = upstreamOrigin + '/';
      hdrs['Origin'] = upstreamOrigin;
    }
    
    // Forward conditional/range headers from client
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      hdrs['Range'] = rangeHeader;
      console.log('[file-proxy] Range request:', rangeHeader);
    }
    if (req.headers['if-range']) hdrs['If-Range'] = req.headers['if-range'];
    if (req.headers['if-modified-since']) hdrs['If-Modified-Since'] = req.headers['if-modified-since'];
    if (req.headers['if-none-match']) hdrs['If-None-Match'] = req.headers['if-none-match'];
    
    return hdrs;
  }
  
  // Helper: check if error status should trigger retry with simpler headers
  function shouldRetry(status) {
    return status === 403 || status === 401 || status === 429;
  }
  
  // Helper: send plain text error (not JSON) unless client wants JSON
  function sendError(status, msg) {
    const acceptJson = (req.headers.accept || '').includes('application/json');
    if (acceptJson) {
      return res.status(status).json({ error: msg });
    }
    res.status(status).type('text/plain').send(msg);
  }
  
  try {
    // First attempt with full headers
    let response = await fetchWithTimeout(targetUrl, 60000, buildHeaders(false));
    
    // On failure, retry once with simpler headers
    if (!response.ok && response.status !== 206 && shouldRetry(response.status)) {
      console.log('[file-proxy] First attempt failed:', response.status, '- retrying with simple headers');
      response = await fetchWithTimeout(targetUrl, 60000, buildHeaders(true));
    }
    
    // If upstream fails, return 502 (NEVER redirect to external URL - would violate CSP)
    if (!response.ok && response.status !== 206) {
      console.error('[file-proxy] Upstream error:', response.status, targetUrl);
      return sendError(502, 'Upstream error: ' + response.status);
    }
    
    // Determine content type
    const upstreamContentType = response.headers.get('content-type') || 'application/octet-stream';
    let contentType = upstreamContentType;
    
    // Force correct content types for known extensions
    const urlLower = targetUrl.toLowerCase();
    if (urlLower.endsWith('.pdf')) {
      contentType = 'application/pdf';
    } else if (urlLower.endsWith('.epub')) {
      contentType = 'application/epub+zip';
    } else if (urlLower.match(/\.(jpg|jpeg)$/)) {
      contentType = 'image/jpeg';
    } else if (urlLower.endsWith('.png')) {
      contentType = 'image/png';
    } else if (urlLower.endsWith('.webp')) {
      contentType = 'image/webp';
    }
    
    // Set response headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');
    
    // Set Content-Disposition: inline for embedding (critical for PDFs)
    let filename = 'file';
    try {
      filename = decodeURIComponent(parsed.pathname.split('/').pop() || 'file');
    } catch {}
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    
    // Forward Content-Length if present
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    
    // Forward ETag and Last-Modified for caching
    const etag = response.headers.get('etag');
    if (etag) {
      res.setHeader('ETag', etag);
    }
    const lastModified = response.headers.get('last-modified');
    if (lastModified) {
      res.setHeader('Last-Modified', lastModified);
    }
    
    // Handle 206 Partial Content
    if (response.status === 206) {
      const contentRange = response.headers.get('content-range');
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
        console.log('[file-proxy] Content-Range:', contentRange);
      }
      res.status(206);
    } else {
      res.status(200);
    }
    
    // Stream the response
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
    console.log('[file-proxy] File streamed successfully:', contentType);
    
  } catch (err) {
    console.error('[file-proxy] Error:', err.message);
    if (!res.headersSent) {
      // Always return 502 - NEVER redirect to external URL (would violate CSP)
      const acceptJson = (req.headers.accept || '').includes('application/json');
      const errorMsg = err.name === 'AbortError' 
        ? 'Request timeout - file may be too large or upstream too slow'
        : 'Failed to fetch file: ' + err.message;
      if (acceptJson) {
        return res.status(502).json({ error: errorMsg });
      }
      res.status(502).type('text/plain').send(errorMsg);
    }
  }
}

/**
 * GET /api/proxy/image?url=<encoded-url>
 * Image proxy for external cover images (OAPEN, DOAB, OpenStax, etc.)
 * - Validates URL against allowlist
 * - Sets browser-like headers with Referer/Origin from upstream
 * - Streams response with proper Content-Type
 * - Validates response is actually an image (not 0-byte or HTML)
 * - On failure: attempts fallback sources (Archive.org thumbnail, OpenLibrary)
 * - On 403/401/429/5xx: returns 307 redirect to original URL (let browser try direct)
 */
router.get('/api/proxy/image', async (req, res) => {
  const targetUrl = req.query.url;
  const title = req.query.title || '';
  const author = req.query.author || '';
  
  if (!targetUrl) {
    return res.status(400).type('text/plain').send('Missing url parameter');
  }
  
  // Validate URL format
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(400).type('text/plain').send('Invalid URL format');
  }
  
  // Validate domain against allowlist
  if (!isAllowedProxyDomain(targetUrl)) {
    console.warn('[image-proxy] Blocked non-whitelisted domain:', targetUrl);
    // For non-allowed domains, redirect to original (browser can try)
    return res.redirect(307, targetUrl);
  }
  
  console.log('[image-proxy] Proxying:', targetUrl);
  
  // Helper to try fetching an image URL and validate it's actually an image
  async function tryFetchImage(url) {
    try {
      const urlParsed = new URL(url);
      const upstreamOrigin = `${urlParsed.protocol}//${urlParsed.host}`;
      
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': upstreamOrigin + '/',
        'Origin': upstreamOrigin,
      };
      
      const response = await fetchWithTimeout(url, 15000, headers);
      
      if (!response.ok) {
        console.log('[image-proxy] Upstream error:', response.status, 'for', url);
        return null;
      }
      
      // Get content length - reject 0-byte responses
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength === 0) {
        console.log('[image-proxy] 0-byte response for:', url);
        return null;
      }
      
      // Get content type - reject non-image responses
      let contentType = response.headers.get('content-type') || '';
      contentType = contentType.split(';')[0].trim().toLowerCase();
      
      // Check if it's actually an image (not HTML error page)
      if (contentType.includes('html') || contentType.includes('text/plain')) {
        console.log('[image-proxy] Non-image content-type:', contentType, 'for', url);
        return null;
      }
      
      // If content-type is not image/*, try to infer from URL
      if (!contentType.startsWith('image/')) {
        const urlLower = url.toLowerCase();
        if (urlLower.match(/\.(jpg|jpeg)(\?|$)/)) contentType = 'image/jpeg';
        else if (urlLower.match(/\.png(\?|$)/)) contentType = 'image/png';
        else if (urlLower.match(/\.gif(\?|$)/)) contentType = 'image/gif';
        else if (urlLower.match(/\.webp(\?|$)/)) contentType = 'image/webp';
        else if (urlLower.match(/\.svg(\?|$)/)) contentType = 'image/svg+xml';
        else contentType = 'image/jpeg'; // Default fallback
      }
      
      return { response, contentType, contentLength };
    } catch (err) {
      console.log('[image-proxy] Fetch error for', url, ':', err.message);
      return null;
    }
  }
  
  // Build list of fallback URLs to try
  const urlsToTry = [targetUrl];
  
  // If the URL is from Archive.org, also try the thumbnail service
  if (targetUrl.includes('archive.org') && targetUrl.includes('/items/')) {
    // Extract identifier from URL like archive.org/download/identifier/file.jpg
    const match = targetUrl.match(/archive\.org\/(?:download|details)\/([^\/]+)/);
    if (match) {
      const identifier = match[1];
      urlsToTry.push(`https://archive.org/services/img/${identifier}`);
    }
  }
  
  // If we have a title/author, try OpenLibrary covers as fallback
  if (title) {
    // Search OpenLibrary by title (limited, but worth a shot)
    const searchTitle = title.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase();
    // Can't easily get ISBN from title, but we can try the search API
    // For now, just note this as a future enhancement point
  }
  
  // Try each URL in order
  for (const url of urlsToTry) {
    const result = await tryFetchImage(url);
    if (result) {
      const { response, contentType, contentLength } = result;
      
      // Set response headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache images for 24 hours
      res.setHeader('X-Content-Type-Options', 'nosniff');
      
      if (contentLength > 0) {
        res.setHeader('Content-Length', contentLength);
      }
      
      // Stream the response
      try {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
        console.log('[image-proxy] Image streamed successfully:', contentType, 'from', url);
        return;
      } catch (streamErr) {
        console.error('[image-proxy] Stream error:', streamErr.message);
        if (!res.headersSent) {
          continue; // Try next URL
        }
        return;
      }
    }
  }
  
  // All URLs failed - redirect to original as last resort (let browser try)
  console.log('[image-proxy] All URLs failed, redirecting to original');
  if (!res.headersSent) {
    return res.redirect(307, targetUrl);
  }
});

module.exports = router;
