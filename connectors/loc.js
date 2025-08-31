// connectors/loc.js
// Library of Congress Books API -> on-site PDF reader
// Docs: https://www.loc.gov/apis/json-and-yaml/

const fetch = require('node-fetch');
async function searchLOC(q, limit = 24) {
  try {
    // Use the correct endpoint
    const url = `https://www.loc.gov/books/?q=${encodeURIComponent(q)}&fo=json&at=results`;
    const r = await fetch(url, { 
      headers: { 
        'User-Agent': 'BookLanternBot/1.0 (+https://booklantern.org)',
        'Accept': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });
    
    if (!r.ok) {
      console.error('[LOC] API error:', r.status);
      return [];
    }
    
    const data = await r.json();
    const items = data?.results || [];
    
    const cards = [];
    for (const item of items.slice(0, limit * 2)) { // Get more items to filter
      try {
        // Find PDF URL
        let pdfUrl = null;
        
        // First check if item already has resources with PDF
        if (item.resources && Array.isArray(item.resources)) {
          for (const resource of item.resources) {
            // Check files array in resource
            if (resource.files && Array.isArray(resource.files)) {
              for (const file of resource.files) {
                if (file.url && (file.url.toLowerCase().endsWith('.pdf') || 
                    (file.content_type && file.content_type.toLowerCase().includes('pdf')))) {
                  pdfUrl = file.url;
                  break;
                }
              }
            }
            // Check direct resource URL
            if (!pdfUrl && resource.url && resource.url.toLowerCase().endsWith('.pdf')) {
              pdfUrl = resource.url;
            }
            if (pdfUrl) break;
          }
        }
        
        // If no PDF found in resources, follow the item URL to get details
        if (!pdfUrl && item.url) {
          try {
            const detailUrl = `${item.url}?fo=json`;
            const detailR = await fetch(detailUrl, {
              headers: { 
                'User-Agent': 'BookLanternBot/1.0 (+https://booklantern.org)',
                'Accept': 'application/json'
              },
              timeout: 5000
            });
            
            if (detailR.ok) {
              const detailData = await detailR.json();
              const detailItem = detailData?.results?.[0];
              
              if (detailItem && detailItem.resources) {
                for (const resource of detailItem.resources) {
                  if (resource.files && Array.isArray(resource.files)) {
                    for (const file of resource.files) {
                      if (file.url && (file.url.toLowerCase().endsWith('.pdf') || 
                          (file.content_type && file.content_type.toLowerCase().includes('pdf')))) {
                        pdfUrl = file.url;
                        break;
                      }
                    }
                  }
                  if (pdfUrl) break;
                }
              }
            }
          } catch (detailError) {
            // Silently continue if detail fetch fails
            console.error('[LOC] detail fetch error:', detailError.message);
          }
        }
        
        if (pdfUrl) {
          const author = (item.contributor && item.contributor[0]) || '';
          const cover = item.image_url || null;
          
          cards.push({
            source: 'loc',
            title: item.title || '(Untitled)',
            author: author,
            cover: cover,
            href: `/read/pdf?src=${encodeURIComponent(pdfUrl)}&title=${encodeURIComponent(item.title || '')}`,
            readable: true,
            openInline: true,
            identifier: `loc:${item.id || item.url}`,
            creator: author
          });
          
          // Stop if we have enough results
          if (cards.length >= limit) break;
        }
      } catch (itemError) {
        // Skip this item if there's an error
        console.error('[LOC] item processing error:', itemError.message);
        continue;
      }
    }
    
    console.log(`[LOC] results ${cards.length} (pdf only)`);
    return cards;
  } catch (e) {
    console.error('[LOC] search error:', e);
    return [];
  }
}

module.exports = { searchLOC };
