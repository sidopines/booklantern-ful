// lib/archiveMetadata.js
// Archive.org metadata helper with caching and readability probing
// Used to determine if items can be opened on-site (not borrow-only)

const https = require('https');
const http = require('http');
const { URL } = require('url');

// In-memory LRU-like cache (TTL-based)
const metadataCache = new Map();
const probeCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// Size limits from env
const MAX_EPUB_MB = parseInt(process.env.MAX_EPUB_MB) || 50;
const MAX_PDF_MB = parseInt(process.env.MAX_PDF_MB) || 200;

const PROXY_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36 BookLantern/1.0';

/**
 * Clean up old cache entries
 */
function cleanupCache(cache, maxSize = 1000) {
  if (cache.size > maxSize) {
    const now = Date.now();
    for (const [key, val] of cache) {
      if (now - val.timestamp > CACHE_TTL) {
        cache.delete(key);
      }
    }
  }
}

/**
 * Fetch Archive.org metadata with caching
 * @param {string} identifier - Archive.org item identifier
 * @param {number} timeout - Request timeout in ms
 * @returns {Promise<Object|null>} Metadata object or null
 */
async function getArchiveMetadataCached(identifier, timeout = 10000) {
  if (!identifier) return null;
  
  // Check cache first
  const cached = metadataCache.get(identifier);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const metaUrl = `https://archive.org/metadata/${encodeURIComponent(identifier)}`;
    const res = await fetch(metaUrl, {
      headers: { 'User-Agent': PROXY_UA, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      metadataCache.set(identifier, { data: null, timestamp: Date.now() });
      return null;
    }
    
    const data = await res.json();
    metadataCache.set(identifier, { data, timestamp: Date.now() });
    cleanupCache(metadataCache);
    return data;
  } catch (err) {
    console.error('[archiveMetadata] fetch error for', identifier, ':', err.message);
    return null;
  }
}

/**
 * Check if a file is DRM-protected
 */
function isProtectedFile(f) {
  const name = (f?.name || '').toLowerCase();
  const format = (f?.format || '').toLowerCase();
  
  return (
    name.includes('lcp') ||
    name.endsWith('_lcp.epub') ||
    name.includes('drm') ||
    name.includes('protected') ||
    name.endsWith('.acsm') ||
    format.includes('lcp') ||
    format.includes('protected') ||
    format.includes('drm') ||
    format.includes('adobe') ||
    format.includes('acsm')
  );
}

/**
 * Analyze archive metadata to find best open-download file
 * @param {Object} metadata - Archive.org metadata response
 * @returns {Object} Analysis result with best file info and readability status
 */
function analyzeArchiveFiles(metadata) {
  if (!metadata || !metadata.files) {
    return { readable: 'maybe', reason: 'no_metadata', bestFile: null };
  }
  
  const files = metadata.files;
  const epubCandidates = [];
  const pdfCandidates = [];
  
  for (const f of files) {
    if (!f?.name) continue;
    if (isProtectedFile(f)) continue;
    
    const name = f.name;
    const size = Number(f.size) || 0;
    const format = (f.format || '').toLowerCase();
    
    // EPUB candidates
    if (format.includes('epub') || /\.epub$/i.test(name)) {
      epubCandidates.push({ name, format: 'epub', size });
    }
    // PDF candidates (prefer "Text PDF" over scanned)
    else if (format.includes('text pdf') || format === 'pdf' || /\.pdf$/i.test(name)) {
      const isTextPdf = format.includes('text pdf');
      pdfCandidates.push({ name, format: 'pdf', size, isTextPdf });
    }
  }
  
  // Sort by size ascending
  epubCandidates.sort((a, b) => a.size - b.size);
  // Sort PDFs: Text PDF first, then by size
  pdfCandidates.sort((a, b) => {
    if (a.isTextPdf && !b.isTextPdf) return -1;
    if (!a.isTextPdf && b.isTextPdf) return 1;
    return a.size - b.size;
  });
  
  const maxEpubBytes = MAX_EPUB_MB * 1024 * 1024;
  const maxPdfBytes = MAX_PDF_MB * 1024 * 1024;
  
  // Priority: Good EPUB -> Good PDF -> Large EPUB (marked too_large)
  const goodEpub = epubCandidates.find(c => c.size <= maxEpubBytes);
  if (goodEpub) {
    return {
      readable: 'maybe', // Will verify with probe
      bestFile: goodEpub,
      bestPdf: pdfCandidates.find(c => c.size <= maxPdfBytes) || null,
      allFiles: { epubs: epubCandidates, pdfs: pdfCandidates },
    };
  }
  
  const goodPdf = pdfCandidates.find(c => c.size <= maxPdfBytes);
  if (goodPdf) {
    return {
      readable: 'maybe',
      bestFile: goodPdf,
      bestPdf: goodPdf,
      preferPdf: true,
      allFiles: { epubs: epubCandidates, pdfs: pdfCandidates },
    };
  }
  
  // Only large files available
  if (epubCandidates.length > 0) {
    return {
      readable: 'maybe',
      bestFile: { ...epubCandidates[0], too_large: true },
      bestPdf: pdfCandidates[0] || null,
      allFiles: { epubs: epubCandidates, pdfs: pdfCandidates },
    };
  }
  
  return { readable: false, reason: 'no_usable_files', bestFile: null };
}

/**
 * Probe an Archive.org download URL to verify it's openly accessible
 * Uses HEAD request with small timeout
 * @param {string} identifier - Archive.org identifier
 * @param {string} filename - File name within the archive item
 * @param {number} timeout - Request timeout in ms
 * @returns {Promise<'true'|'false'|'maybe'>} Readability status
 */
async function probeArchiveFile(identifier, filename, timeout = 4000) {
  const cacheKey = `${identifier}/${filename}`;
  
  // Check probe cache
  const cached = probeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }
  
  const downloadUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(filename)}`;
  
  try {
    const result = await doProbe(downloadUrl, timeout);
    probeCache.set(cacheKey, { result, timestamp: Date.now() });
    cleanupCache(probeCache);
    return result;
  } catch (err) {
    console.error('[archiveMetadata] probe error:', cacheKey, err.message);
    return 'maybe';
  }
}

/**
 * Perform HEAD/Range probe to check URL accessibility
 */
function doProbe(url, timeout, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 5) {
      resolve('maybe');
      return;
    }
    
    try {
      const parsed = new URL(url);
      const protocol = parsed.protocol === 'https:' ? https : http;
      
      const req = protocol.request(url, {
        method: 'HEAD',
        timeout,
        headers: {
          'User-Agent': PROXY_UA,
          'Accept': '*/*',
          'Range': 'bytes=0-0', // Request just first byte
        },
      }, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const location = res.headers.location;
          // Borrow/loan redirects mean restricted
          if (location.includes('/borrow') || location.includes('/loan') || location.includes('lending')) {
            resolve('false');
            return;
          }
          let nextUrl = location;
          if (!location.startsWith('http')) {
            nextUrl = new URL(location, url).href;
          }
          doProbe(nextUrl, timeout, redirectCount + 1).then(resolve);
          return;
        }
        
        // 401/403 = restricted
        if (res.statusCode === 401 || res.statusCode === 403) {
          resolve('false');
          return;
        }
        
        // 200/206 with correct content type = accessible
        if (res.statusCode === 200 || res.statusCode === 206) {
          const contentType = res.headers['content-type'] || '';
          // Check for EPUB or PDF content type, or octet-stream (generic binary)
          if (contentType.includes('epub') || 
              contentType.includes('pdf') || 
              contentType.includes('octet-stream') ||
              contentType.includes('zip')) {
            resolve('true');
            return;
          }
          // HTML response might be a login page
          if (contentType.includes('text/html')) {
            resolve('false');
            return;
          }
          // Unknown content type, assume OK
          resolve('true');
          return;
        }
        
        // 404 = not found
        if (res.statusCode === 404) {
          resolve('false');
          return;
        }
        
        // Other status = uncertain
        resolve('maybe');
      });
      
      req.on('error', () => resolve('maybe'));
      req.on('timeout', () => {
        req.destroy();
        resolve('maybe');
      });
      
      req.end();
    } catch {
      resolve('maybe');
    }
  });
}

/**
 * Full readability check for an Archive.org item
 * Fetches metadata, analyzes files, and probes best candidate
 * @param {string} identifier - Archive.org identifier
 * @param {boolean} skipProbe - Skip the probe step (faster but less accurate)
 * @returns {Promise<Object>} Readability result
 */
async function checkArchiveReadability(identifier, skipProbe = false) {
  if (!identifier) {
    return { readable: 'false', reason: 'no_identifier' };
  }
  
  // Fetch metadata
  const metadata = await getArchiveMetadataCached(identifier);
  if (!metadata) {
    return { readable: 'maybe', reason: 'metadata_unavailable' };
  }
  
  // Analyze files
  const analysis = analyzeArchiveFiles(metadata);
  if (analysis.readable === false) {
    return analysis;
  }
  
  if (!analysis.bestFile) {
    return { readable: 'false', reason: 'no_suitable_file' };
  }
  
  // Build direct URL
  const directUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(analysis.bestFile.name)}`;
  
  if (skipProbe) {
    return {
      readable: 'maybe',
      bestFile: analysis.bestFile,
      bestPdf: analysis.bestPdf,
      directUrl,
      preferPdf: analysis.preferPdf,
      allFiles: analysis.allFiles,
    };
  }
  
  // Probe the file
  const probeResult = await probeArchiveFile(identifier, analysis.bestFile.name);
  
  return {
    readable: probeResult,
    bestFile: analysis.bestFile,
    bestPdf: analysis.bestPdf,
    directUrl,
    preferPdf: analysis.preferPdf,
    allFiles: analysis.allFiles,
  };
}

/**
 * Batch check readability for multiple items
 * @param {Array} items - Array of items with archive_id field
 * @param {number} maxProbes - Max number of items to probe
 * @returns {Promise<Array>} Items with readable flag added
 */
async function batchCheckReadability(items, maxProbes = 20) {
  const archiveItems = [];
  const otherItems = [];
  
  // Separate IA items from others
  for (const item of items) {
    if (item.archive_id || (item.direct_url && item.direct_url.includes('archive.org'))) {
      archiveItems.push(item);
    } else {
      // Non-IA items keep their existing readable status
      otherItems.push({
        ...item,
        readable: item.readable !== false ? 'true' : 'false',
      });
    }
  }
  
  // Check first N archive items with probing
  const toProbe = archiveItems.slice(0, maxProbes);
  const skipProbe = archiveItems.slice(maxProbes);
  
  let probedCount = 0;
  let readableTrue = 0;
  let readableFalse = 0;
  let readableMaybe = 0;
  
  const probedResults = await Promise.all(
    toProbe.map(async (item) => {
      const identifier = item.archive_id || extractArchiveId(item.direct_url);
      if (!identifier) {
        return { ...item, readable: 'maybe', reason: 'no_identifier' };
      }
      
      const result = await checkArchiveReadability(identifier, false);
      probedCount++;
      
      if (result.readable === 'true') readableTrue++;
      else if (result.readable === 'false') readableFalse++;
      else readableMaybe++;
      
      return {
        ...item,
        readable: result.readable,
        reason: result.reason,
        bestFile: result.bestFile,
        bestPdf: result.bestPdf,
        directUrl: result.directUrl || item.direct_url,
        preferPdf: result.preferPdf,
        allFiles: result.allFiles,
      };
    })
  );
  
  // Mark unchecked items as 'maybe'
  const uncheckedResults = skipProbe.map(item => ({
    ...item,
    readable: 'maybe',
    reason: 'not_probed',
  }));
  
  console.log(`[archiveMetadata] batch check: probed=${probedCount} readable_true=${readableTrue} readable_false=${readableFalse} readable_maybe=${readableMaybe} unchecked=${uncheckedResults.length}`);
  
  return [...otherItems, ...probedResults, ...uncheckedResults];
}

/**
 * Extract Archive.org identifier from URL
 */
function extractArchiveId(url) {
  if (!url) return null;
  try {
    const match = url.match(/archive\.org\/(?:download|details)\/([^\/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

module.exports = {
  getArchiveMetadataCached,
  analyzeArchiveFiles,
  probeArchiveFile,
  checkArchiveReadability,
  batchCheckReadability,
  extractArchiveId,
};
