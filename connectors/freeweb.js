// connectors/freeweb.js
// Generic "Free Web" discoverer (whitelisted, direct files only)
// Searches curated hosts known to allow direct, free downloads without login

const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';

// Whitelist of hosts that allow direct, free downloads without login
const ALLOWED_HOSTS = [
  'gutenberg.org',
  'loc.gov', 
  'archive.org',
  'feedbooks.com',
  'gallica.bnf.fr',
  'digital.library.upenn.edu',
  'sacred-texts.com'
];

// Host-specific search configurations
const HOST_CONFIGS = {
  'gallica.bnf.fr': {
    searchUrl: 'https://gallica.bnf.fr/SRU?operation=searchRetrieve&version=1.2&query=',
    searchParams: '&maximumRecords=20&recordSchema=dc',
    parseResults: parseGallicaResults
  },
  'digital.library.upenn.edu': {
    searchUrl: 'https://digital.library.upenn.edu/books/search?q=',
    searchParams: '&format=json&limit=20',
    parseResults: parsePennResults
  },
  'sacred-texts.com': {
    searchUrl: 'https://www.sacred-texts.com/search.htm?q=',
    searchParams: '',
    parseResults: parseSacredTextsResults
  }
};

// Helper function to check if a file is valid (EPUB or PDF)
async function isValidFile(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) return false;
    
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const contentLength = parseInt(response.headers.get('content-length') || '0');
    
    // Must be EPUB or PDF and > 64KB
    return (contentType.includes('application/epub+zip') || 
            contentType.includes('application/pdf')) && 
           contentLength > 65536;
  } catch (e) {
    return false;
  }
}

// Parse Gallica (French National Library) results
async function parseGallicaResults(xml, query) {
  const results = [];
  
  // Simple XML parsing for DC records
  const records = xml.match(/<dc:record>[\s\S]*?<\/dc:record>/gi) || [];
  
  for (const record of records.slice(0, 10)) {
    try {
      const titleMatch = record.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
      const creatorMatch = record.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
      const identifierMatch = record.match(/<dc:identifier[^>]*>([^<]+)<\/dc:identifier>/i);
      
      if (!titleMatch || !identifierMatch) continue;
      
      const title = titleMatch[1].trim();
      const creator = creatorMatch ? creatorMatch[1].trim() : '';
      const identifier = identifierMatch[1].trim();
      
      // Construct PDF URL
      const pdfUrl = `https://gallica.bnf.fr/ark:/12148/${identifier}/f1.pdf`;
      
      // Validate the PDF exists and is accessible
      if (await isValidFile(pdfUrl)) {
        results.push({
          title,
          creator,
          url: pdfUrl,
          source: 'gallica',
          type: 'pdf'
        });
      }
    } catch (e) {
      // Skip invalid records
    }
  }
  
  return results;
}

// Parse Penn Digital Library results
async function parsePennResults(json, query) {
  const results = [];
  
  try {
    const data = JSON.parse(json);
    const items = data.results || [];
    
    for (const item of items.slice(0, 10)) {
      try {
        const title = item.title || '';
        const creator = item.creator || item.author || '';
        const pdfUrl = item.pdf_url || item.download_url || '';
        
        if (title && pdfUrl && await isValidFile(pdfUrl)) {
          results.push({
            title,
            creator,
            url: pdfUrl,
            source: 'penn',
            type: 'pdf'
          });
        }
      } catch (e) {
        // Skip invalid items
      }
    }
  } catch (e) {
    console.error('[FREEWEB] Penn JSON parse error:', e.message);
  }
  
  return results;
}

// Parse Sacred Texts results
async function parseSacredTextsResults(html, query) {
  const results = [];
  
  // Look for PDF links in the search results
  const pdfLinks = html.match(/<a[^>]*href="([^"]*\.pdf)"[^>]*>([^<]+)<\/a>/gi) || [];
  
  for (const link of pdfLinks.slice(0, 10)) {
    try {
      const urlMatch = link.match(/href="([^"]+)"/);
      const titleMatch = link.match(/>([^<]+)</);
      
      if (!urlMatch || !titleMatch) continue;
      
      const url = urlMatch[1];
      const title = titleMatch[1].trim();
      
      // Make URL absolute if needed
      const absoluteUrl = url.startsWith('http') ? url : `https://www.sacred-texts.com${url}`;
      
      if (await isValidFile(absoluteUrl)) {
        results.push({
          title,
          creator: '',
          url: absoluteUrl,
          source: 'sacred-texts',
          type: 'pdf'
        });
      }
    } catch (e) {
      // Skip invalid links
    }
  }
  
  return results;
}

// Convert result to card format
function toCard(result) {
  const isEpub = result.type === 'epub';
  const readerUrl = isEpub ? 
    `/read/epub?src=${encodeURIComponent(result.url)}&title=${encodeURIComponent(result.title)}&author=${encodeURIComponent(result.creator)}` :
    `/read/pdf?src=${encodeURIComponent(result.url)}&title=${encodeURIComponent(result.title)}`;
  
  return {
    identifier: `freeweb:${result.source}:${result.title}`,
    title: result.title || '(Untitled)',
    creator: result.creator || '',
    cover: '', // No cover for free web sources
    source: result.source,
    openInline: true,
    readable: true,
    href: readerUrl,
    readerUrl: readerUrl
  };
}

// Main search function
async function searchFreeWeb(q, limit = 20) {
  try {
    const allResults = [];
    
    // Search each configured host
    for (const [host, config] of Object.entries(HOST_CONFIGS)) {
      try {
        const searchUrl = `${config.searchUrl}${encodeURIComponent(q)}${config.searchParams}`;
        console.log(`[FREEWEB] Searching ${host}: ${searchUrl}`);
        
        const response = await fetch(searchUrl, {
          headers: { 'User-Agent': UA },
          timeout: 15000
        });
        
        if (!response.ok) {
          console.warn(`[FREEWEB] ${host} search failed: ${response.status}`);
          continue;
        }
        
        const content = await response.text();
        const results = await config.parseResults(content, q);
        
        allResults.push(...results);
        
        console.log(`[FREEWEB] ${host} found ${results.length} results`);
        
      } catch (e) {
        console.error(`[FREEWEB] ${host} search error:`, e.message);
      }
    }
    
    // Convert to cards and limit results
    const cards = allResults.slice(0, limit).map(toCard);
    
    console.log(`[FREEWEB] Total results: ${cards.length}`);
    return cards;
    
  } catch (e) {
    console.error('[FREEWEB] Search error:', e.message);
    return [];
  }
}

module.exports = { searchFreeWeb };
