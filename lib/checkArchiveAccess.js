// lib/checkArchiveAccess.js
// Shared helper to validate Archive.org URLs are freely downloadable (not borrow-only)
// Uses HEAD request with 4s timeout, follows redirects, caches results for 30 min

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
    // On error, assume restricted (fail-closed)
    console.error('[checkArchiveAccess] error:', url, err.message);
    return false;
  }
}

/**
 * Perform HEAD request to check if URL is accessible
 * Rules:
 *   - 401/403 => restricted
 *   - 200/206 => keep
 *   - redirect to /borrow, /loan, lending => restricted
 *   - otherwise => exclude (fail-closed)
 */
function doHeadCheck(url, timeout, redirectCount = 0) {
  return new Promise((resolve) => {
    // Limit redirect hops
    if (redirectCount > 5) {
      resolve(false);
      return;
    }
    
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
        // Follow redirects manually
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const location = res.headers.location;
          // If redirect goes to borrow/loan flow, it's restricted
          if (location.includes('/borrow') || location.includes('/loan') || location.includes('lending')) {
            resolve(false);
            return;
          }
          // Resolve relative URLs
          let nextUrl = location;
          if (!location.startsWith('http')) {
            nextUrl = new URL(location, url).href;
          }
          // Follow the redirect
          doHeadCheck(nextUrl, timeout, redirectCount + 1).then(resolve);
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
        
        // Other status codes - fail closed (exclude)
        resolve(false);
      });
      
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      
      req.end();
    } catch {
      resolve(false);
    }
  });
}

/**
 * Batch check first N archive URLs via HEAD
 * Only checks first maxChecks items, rest are left unchecked
 * 
 * @param {Array} items - Array of book objects with direct_url or archive_id
 * @param {number} maxChecks - Maximum HEAD checks to perform (default 15)
 * @returns {Promise<Array>} Filtered array
 */
async function filterRestrictedArchiveItems(items, maxChecks = 15) {
  const archiveItems = [];
  const otherItems = [];
  
  for (const item of items) {
    const url = item.direct_url || '';
    // IA-like items: have archive.org URL or archive_id
    if (url.includes('archive.org') || item.archive_id) {
      archiveItems.push(item);
    } else {
      otherItems.push(item);
    }
  }
  
  // Check only first N archive items via HEAD
  const toCheck = archiveItems.slice(0, maxChecks);
  const unchecked = archiveItems.slice(maxChecks);
  
  const checkResults = await Promise.all(
    toCheck.map(async (item) => {
      const accessible = await checkArchiveAccess(item.direct_url);
      return { item, accessible };
    })
  );
  
  const kept = checkResults.filter(r => r.accessible).map(r => r.item);
  const restrictedCount = checkResults.filter(r => !r.accessible).length;
  
  console.log(`[search] ia access check restricted=${restrictedCount} kept=${kept.length} unchecked=${unchecked.length}`);
  
  // Return: other items + checked-and-accessible + unchecked (left as-is)
  return [...otherItems, ...kept, ...unchecked];
}

module.exports = { checkArchiveAccess, filterRestrictedArchiveItems };
