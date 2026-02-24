// lib/sources/oapen.js
// OAPEN / DOAB (Directory of Open Access Books) integration
// Provides direct PDF/EPUB downloads for open access scholarly books

const axios = require('axios');

const OAPEN_API = 'https://library.oapen.org/rest/search';
const USER_AGENT = 'BookLantern/1.0 (+https://booklantern.org)';

/**
 * Search OAPEN library for open access books
 * All OAPEN books are open access with direct download URLs
 * @param {string} q - Search query
 * @param {number} page - Page number (1-indexed)
 * @returns {Promise<Array>} Normalized book objects
 */
async function search(q, page = 1) {
  try {
    const limit = 30;
    const offset = (page - 1) * limit;
    
    // OAPEN REST API search
    // Documentation: https://library.oapen.org/
    // Increased timeout to 12s for better reliability
    const response = await axios.get(OAPEN_API, {
      params: {
        query: q,
        expand: 'metadata,bitstreams',
        limit,
        offset,
      },
      timeout: 12000,
      headers: { 'User-Agent': USER_AGENT },
    });
    
    const items = response.data || [];
    if (!Array.isArray(items)) {
      console.log('[oapen] No results array in response');
      return [];
    }
    
    const books = [];
    
    for (const item of items) {
      try {
        // Extract metadata
        const metadata = item.metadata || [];
        const getMetaValue = (key) => {
          const entry = metadata.find(m => m.key === key);
          return entry?.value || '';
        };
        
        const title = getMetaValue('dc.title') || item.name || 'Untitled';
        const author = getMetaValue('dc.contributor.author') || 
                       getMetaValue('dc.creator') || 
                       '';
        const year = getMetaValue('dc.date.issued')?.substring(0, 4) || null;
        const language = getMetaValue('dc.language.iso') || 'en';
        const description = getMetaValue('dc.description.abstract') || '';
        
        // Find PDF/EPUB bitstreams
        const bitstreams = item.bitstreams || [];
        let pdfUrl = null;
        let epubUrl = null;
        let pdfSize = 0;
        let epubSize = 0;
        
        for (const bs of bitstreams) {
          const mimeType = (bs.mimeType || '').toLowerCase();
          const name = (bs.name || '').toLowerCase();
          const retrieveLink = bs.retrieveLink || '';
          
          if (mimeType === 'application/pdf' || name.endsWith('.pdf')) {
            if (!pdfUrl) {
              pdfUrl = retrieveLink.startsWith('http') 
                ? retrieveLink 
                : `https://library.oapen.org${retrieveLink}`;
              pdfSize = bs.sizeBytes || 0;
            }
          } else if (mimeType === 'application/epub+zip' || name.endsWith('.epub')) {
            if (!epubUrl) {
              epubUrl = retrieveLink.startsWith('http') 
                ? retrieveLink 
                : `https://library.oapen.org${retrieveLink}`;
              epubSize = bs.sizeBytes || 0;
            }
          }
        }
        
        // Skip items without downloadable files
        if (!pdfUrl && !epubUrl) {
          continue;
        }
        
        // Prefer EPUB if available and reasonably sized, otherwise PDF
        const maxEpubBytes = (parseInt(process.env.MAX_EPUB_MB) || 50) * 1024 * 1024;
        const useEpub = epubUrl && (epubSize <= maxEpubBytes || !pdfUrl);
        
        const format = useEpub ? 'epub' : 'pdf';
        const directUrl = useEpub ? epubUrl : pdfUrl;
        
        // Generate cover URL from OAPEN handle
        const handle = item.handle || '';
        const coverUrl = handle 
          ? `https://library.oapen.org/bitstream/handle/${handle}/cover.jpg?sequence=1`
          : null;
        
        const providerId = item.uuid || item.id || handle.replace(/\//g, '-');
        const bookId = `oapen:${providerId}`;
        
        books.push({
          book_id: bookId,
          title,
          author,
          cover_url: coverUrl,
          year: year ? parseInt(year) : null,
          language,
          provider: 'oapen',
          provider_id: providerId,
          format,
          direct_url: directUrl,
          source_url: handle ? `https://library.oapen.org/handle/${handle}` : directUrl,
          access: 'open',
          is_restricted: false,
          // All OAPEN items are open access - mark as readable
          readable: 'true',
        });
      } catch (itemErr) {
        console.warn('[oapen] Error processing item:', itemErr.message);
      }
    }
    
    console.log(`[oapen] search returned ${books.length} items`);
    return books;
  } catch (error) {
    // Retry once on timeout
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.log('[oapen] search timeout, retrying once...');
      try {
        const limit = 30;
        const offset = (page - 1) * limit;
        const retryResponse = await axios.get(OAPEN_API, {
          params: {
            query: q,
            expand: 'metadata,bitstreams',
            limit,
            offset,
          },
          timeout: 15000,
          headers: { 'User-Agent': USER_AGENT },
        });
        
        const retryItems = retryResponse.data || [];
        if (!Array.isArray(retryItems)) {
          console.log('[oapen] retry: no results array');
          return [];
        }
        
        const retryBooks = [];
        for (const item of retryItems) {
          try {
            const metadata = item.metadata || [];
            const getMetaValue = (key) => {
              const entry = metadata.find(m => m.key === key);
              return entry?.value || '';
            };
            
            const title = getMetaValue('dc.title') || item.name || 'Untitled';
            const author = getMetaValue('dc.contributor.author') || getMetaValue('dc.creator') || '';
            const year = getMetaValue('dc.date.issued')?.substring(0, 4) || null;
            const language = getMetaValue('dc.language.iso') || 'en';
            
            const bitstreams = item.bitstreams || [];
            let pdfUrl = null;
            let epubUrl = null;
            
            for (const bs of bitstreams) {
              const mimeType = (bs.mimeType || '').toLowerCase();
              const name = (bs.name || '').toLowerCase();
              const retrieveLink = bs.retrieveLink || '';
              
              if ((mimeType === 'application/pdf' || name.endsWith('.pdf')) && !pdfUrl) {
                pdfUrl = retrieveLink.startsWith('http') ? retrieveLink : `https://library.oapen.org${retrieveLink}`;
              } else if ((mimeType === 'application/epub+zip' || name.endsWith('.epub')) && !epubUrl) {
                epubUrl = retrieveLink.startsWith('http') ? retrieveLink : `https://library.oapen.org${retrieveLink}`;
              }
            }
            
            if (!pdfUrl && !epubUrl) continue;
            
            const format = epubUrl ? 'epub' : 'pdf';
            const directUrl = epubUrl || pdfUrl;
            const handle = item.handle || '';
            const coverUrl = handle ? `https://library.oapen.org/bitstream/handle/${handle}/cover.jpg?sequence=1` : null;
            const providerId = item.uuid || item.id || handle.replace(/\//g, '-');
            
            retryBooks.push({
              book_id: `oapen:${providerId}`,
              title,
              author,
              cover_url: coverUrl,
              year: year ? parseInt(year) : null,
              language,
              provider: 'oapen',
              provider_id: providerId,
              format,
              direct_url: directUrl,
              source_url: handle ? `https://library.oapen.org/handle/${handle}` : directUrl,
              access: 'open',
              is_restricted: false,
              readable: 'true',
            });
          } catch (itemErr) {
            // Skip individual item errors
          }
        }
        
        console.log(`[oapen] retry succeeded: ${retryBooks.length} items`);
        return retryBooks;
      } catch (retryError) {
        console.error('[oapen] retry also failed:', retryError.message);
        return [];
      }
    }
    console.error('[oapen] search error:', error.message);
    return [];
  }
}

module.exports = { search };