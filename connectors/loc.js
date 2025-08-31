// connectors/loc.js
// Library of Congress Search API -> on-site PDF reader
// Returns only items with validated PDFs that open in our reader

const fetch = require('node-fetch');

// Simple in-memory cache for detail JSON lookups (6-24h TTL)
const detailCache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// Helper function to fetch JSON with timeout
async function fetchJSON(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 10000);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BookLanternBot/1.0 (+https://booklantern.org)',
        'Accept': 'application/json'
      },
      signal: controller.signal,
      ...options
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Helper function to validate PDF with HEAD request
async function headOkPdf(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'BookLanternBot/1.0 (+https://booklantern.org)'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!response.ok && response.status !== 206) {
      return false;
    }
    
    const contentType = response.headers.get('content-type') || '';
    return contentType.toLowerCase().includes('application/pdf') || url.toLowerCase().endsWith('.pdf');
  } catch (error) {
    clearTimeout(timeoutId);
    return false;
  }
}

// Helper function to find PDF URL in detail JSON
function findPdfInDetail(detailJson) {
  const item = detailJson?.item || detailJson?.results?.[0];
  if (!item) return null;
  
  // Check resources array for pdf field
  if (item.resources && Array.isArray(item.resources)) {
    for (const resource of item.resources) {
      // Check direct pdf field in resource
      if (resource.pdf) {
        return resource.pdf;
      }
      
      // Check files array in resource
      if (resource.files && Array.isArray(resource.files)) {
        for (const file of resource.files) {
          if (file.url && (file.url.toLowerCase().endsWith('.pdf') || 
              (file.content_type && file.content_type.toLowerCase().includes('pdf')))) {
            return file.url;
          }
        }
      }
      // Check direct resource URL
      if (resource.url && resource.url.toLowerCase().endsWith('.pdf')) {
        return resource.url;
      }
    }
  }
  
  // Check any object/download blocks
  if (item.objects && Array.isArray(item.objects)) {
    for (const obj of item.objects) {
      if (obj.download && obj.download.toLowerCase().endsWith('.pdf')) {
        return obj.download;
      }
    }
  }
  
  // Check any pdf fields
  if (item.pdf) return item.pdf;
  if (item.download && item.download.toLowerCase().endsWith('.pdf')) {
    return item.download;
  }
  
  return null;
}

async function searchLOC(q, limit = 25, page = 1) {
  try {
    console.log(`[LOC] searching "${q}" (limit: ${limit}, page: ${page})`);
    
    // Try with PDF filter first
    let url = `https://www.loc.gov/search/?q=${encodeURIComponent(q)}&fo=json&c=${limit}&sp=${page}&fa=online-format:pdf`;
    let data = await fetchJSON(url, { timeout: 10000 });
    let items = data?.results || [];
    
    // If no results, fallback to broader search
    if (items.length === 0) {
      console.log('[LOC] no PDF-filtered results, trying broader search');
      url = `https://www.loc.gov/search/?q=${encodeURIComponent(q)}&fo=json&c=${limit * 2}&sp=${page}`;
      data = await fetchJSON(url, { timeout: 10000 });
      items = data?.results || [];
    }
    
    console.log(`[LOC] found ${items.length} items, processing for PDFs`);
    
    const cards = [];
    for (const item of items) {
      try {
        let pdfUrl = null;
        
        // Check cache first
        const cacheKey = item.id || item.url;
        if (cacheKey && detailCache.has(cacheKey)) {
          const cached = detailCache.get(cacheKey);
          if (Date.now() - cached.timestamp < CACHE_TTL) {
            pdfUrl = cached.pdfUrl;
            console.log('[LOC] cache hit for', cacheKey);
          } else {
            detailCache.delete(cacheKey);
          }
        }
        
                 // If not in cache, fetch detail JSON
         if (!pdfUrl && item.id) {
           try {
             // Extract the actual ID from the full URL
             const urlParts = item.id.split('/');
             const itemId = urlParts[urlParts.length - 2] || urlParts[urlParts.length - 1];
             const detailUrl = `https://www.loc.gov/item/${itemId}/?fo=json`;
             const detailData = await fetchJSON(detailUrl, { timeout: 10000 });
             pdfUrl = findPdfInDetail(detailData);
            
            // Cache the result
            if (cacheKey) {
              detailCache.set(cacheKey, {
                pdfUrl,
                timestamp: Date.now()
              });
            }
            
            console.log('[LOC] detail ok for', item.id, pdfUrl ? 'pdf found' : 'no pdf');
          } catch (detailError) {
            console.log('[LOC] skip reason=detail_fetch_error', item.id, detailError.message);
            continue;
          }
        }
        
        // Validate PDF URL
        if (pdfUrl) {
          const isValid = await headOkPdf(pdfUrl);
          if (isValid) {
            console.log('[LOC] pdf ok', pdfUrl);
            
            const author = (item.creator || item.contributor || [])[0] || '';
            const cover = (item.image_url && item.image_url[0]) || null;
            
            cards.push({
              source: 'loc',
              title: item.title || '',
              author: author,
              cover: cover,
              href: `/read/pdf?src=${encodeURIComponent(pdfUrl)}&title=${encodeURIComponent(item.title || '')}`,
              readable: true,
              openInline: true,
              identifier: `loc:${item.id || item.url}`,
              creator: author
            });
            
            if (cards.length >= limit) break;
          } else {
            console.log('[LOC] skip reason=pdf_validation_failed', pdfUrl);
          }
        } else {
          console.log('[LOC] skip reason=no_pdf_found', item.id);
        }
      } catch (itemError) {
        console.log('[LOC] skip reason=item_processing_error', item.id, itemError.message);
        continue;
      }
    }
    
    console.log(`[LOC] results ${cards.length} (validated PDFs)`);
    return cards;
  } catch (e) {
    console.error('[LOC] search error:', e.message);
    return [];
  }
}

module.exports = { searchLOC };
