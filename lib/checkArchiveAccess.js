// lib/checkArchiveAccess.js
// Shared helper to validate Archive.org URLs are freely downloadable (not borrow-only)

const https = require('https');
const http = require('http');
const { URL } = require('url');

// In-memory cache with TTL (30 minutes)
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Check if an Archive.org download URL is freely accessible (not borrow-only)
 * Uses HEAD request to validate without downloading the full file.
 * 
 * @param {string} url - The archive.org download URL to check
 * @param {number} timeout - Request timeout in ms (default 4000)
 * @returns {Promise<boolean>} true if freely accessible, false if restricted
 */
async function checkArchiveAccess(url, timeout = 4000) {
  if (!url || !url.includes('archive.org')) {
    return true; // Non-archive URLs are assumed OK
  }

  // Check cache first
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.accessible;
  }

  try {
    const accessible = await doHeadCheck(url, timeout);
    
    // Cache the result
    cache.set(url, { accessible, timestamp: Date.now() });
    
    // Cleanup old cache entries periodically
    if (cache.size > 1000) {
      const now = Date.now();
      for (const [key, val] of cache) {
        if (now - val.timestamp > CACHE_TTL) {
          cache.delete(key);
        }
      }
    }
    
    return accessible;
  } catch (err) {
    // On error, assume restricted (fail-safe)
    console.error('[checkArchiveAccess] error:', url, err.message);
    return false;
  }
}

/**
 * Perform HEAD request to check if URL is accessible
 */
function doHeadCheck(url, timeout) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const protocol = parsed.protocol === 'https:' ? https : http;
      
      const req = protocol.request(url, {
        method: 'HEAD',
        timeout,
        headers: {
          'User-Agent': 'BookLantern/1.0 (+https://booklantern.org)',
          'Accept': '*/*',
        },
      }, (res) => {
        // Follow redirects manually for one hop
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const location = res.headers.location;
          // If redirect goes to borrow/loan flow, it's restricted
          if (location.includes('/borrow') || location.includes('/loan') || 
              location.includes('lending') || location.includes('details')) {
            resolve(false);
            return;
          }
          // Otherwise follow the redirect
          doHeadCheck(location, timeout).then(resolve);
          return;
        }
        
        // 401/403 means restricted
        if (res.statusCode === 401 || res.statusCode === 403) {
          resolve(false);
          return;
        }
        
        // 200/206 means accessible
        if (res.statusCode === 200 || res.statusCode === 206) {
          resolve(true);
          return;
        }
        
        // Other status codes (404, 500, etc.) - assume restricted/unavailable
        resolve(false);
      });
      
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false); // Timeout = assume restricted
      });
      
      req.end();
    } catch {
      resolve(false);
    }
  });
}

/**
 * Batch check multiple URLs efficiently
 * Only checks first maxChecks items, rest are filtered by metadata
 * 
 * @param {Array} items - Array of book objects with direct_url
 * @param {number} maxChecks - Maximum HEAD checks to perform (default 10)
 * @returns {Promise<Array>} Filtered array with only accessible items
 */
async function filterRestrictedArchiveItems(items, maxChecks = 10) {
  const archiveItems = [];
  const otherItems = [];
  
  for (const item of items) {
    const url = item.direct_url || '';
    if (url.includes('archive.org/download/')) {
      archiveItems.push(item);
    } else {
      otherItems.push(item);
    }
  }
  
  // Check first N archive items via HEAD
  const toCheck = archiveItems.slice(0, maxChecks);
  const rest = archiveItems.slice(maxChecks);
  
  const checkResults = await Promise.all(
    toCheck.map(async (item) => {
      const accessible = await checkArchiveAccess(item.direct_url);
      return { item, accessible };
    })
  );
  
  const checkedAccessible = checkResults.filter(r => r.accessible).map(r => r.item);
  const checkedRestricted = checkResults.filter(r => !r.accessible).length;
  
  // For remaining items, rely on metadata filtering only
  // (they already passed isFreelyDownloadable or is_restricted checks)
  const result = [...otherItems, ...checkedAccessible, ...rest];
  
  if (checkedRestricted > 0 || rest.length > 0) {
    console.log(`[search] ia HEAD check: restricted=${checkedRestricted} kept=${checkedAccessible.length} unchecked=${rest.length}`);
  }
  
  return result;
}

module.exports = { checkArchiveAccess, filterRestrictedArchiveItems };
