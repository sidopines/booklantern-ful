// lib/sources/loc.js
const axios = require('axios');
const crypto = require('crypto');

/**
 * Search Library of Congress
 * @param {string} q - Search query
 * @param {number} page - Page number (1-indexed)
 * @returns {Promise<Array>} Normalized book objects
 */
async function search(q, page = 1) {
  try {
    const url = `https://www.loc.gov/books/`;
    const params = {
      q,
      fo: 'json',
      c: 40,
      sp: page,
    };

    const response = await axios.get(url, {
      params,
      timeout: 10000,
      headers: { 'User-Agent': 'BookLantern/1.0' },
    });

    const results = response.data.results || [];
    const books = [];

    for (const item of results) {
      // Check if public domain and downloadable
      // access_restricted === false means it's NOT restricted (open access)
      // We want items where: NOT restricted AND digitized
      const isOpen = item.access_restricted === false;
      const digitized = item.digitized === true;
      
      // Skip restricted or non-digitized items
      if (!isOpen || !digitized) continue;

      // Look for download resources
      const resources = Array.isArray(item.resources) ? item.resources : [];
      let epubUrl = null;
      let pdfUrl = null;
      let format = null;

      for (const res of resources) {
        if (!res || typeof res !== 'object') continue;
        const url = res.url || '';
        const files = Array.isArray(res.files) ? res.files : [];
        
        for (const file of files) {
          if (!Array.isArray(file)) continue;
          const fileUrl = file[0] || '';
          const mimeType = file[1] || '';
          
          if (mimeType.includes('epub') || fileUrl.endsWith('.epub')) {
            epubUrl = fileUrl;
            format = 'epub';
            break;
          } else if (mimeType.includes('pdf') || fileUrl.endsWith('.pdf')) {
            pdfUrl = fileUrl;
          }
        }
        
        if (epubUrl) break;
      }

      // Prefer EPUB, fall back to PDF
      const directUrl = epubUrl || pdfUrl;
      if (!directUrl) continue;
      
      if (!format) format = pdfUrl ? 'pdf' : 'epub';

      const title = item.title || 'Untitled';
      const author = Array.isArray(item.contributor_names)
        ? item.contributor_names.join(', ')
        : (item.contributor_names || item.creator || '');
      const year = item.date ? parseInt(item.date) : null;
      const language = 'en'; // LoC primarily English
      
      const imageUrl = item.image_url?.[0] || null;
      const coverUrl = imageUrl ? `https://www.loc.gov${imageUrl}` : null;

      const providerId = item.id || crypto.createHash('md5').update(title + author).digest('hex');
      const bookId = `loc:${providerId}`;

      books.push({
        book_id: bookId,
        title,
        author,
        cover_url: coverUrl,
        year,
        language,
        provider: 'loc',
        provider_id: providerId,
        format,
        direct_url: directUrl,
      });
    }

    console.log(`[loc] search complete: found ${books.length} items from ${results.length} results`);
    return books;
  } catch (error) {
    // Enhanced error logging for LOC failures
    const status = error.response?.status || 'N/A';
    const statusText = error.response?.statusText || '';
    console.error(`[loc] search error: status=${status} ${statusText} message="${error.message}"`);
    if (error.response?.data) {
      console.error('[loc] response body:', typeof error.response.data === 'string' 
        ? error.response.data.slice(0, 200) 
        : JSON.stringify(error.response.data).slice(0, 200));
    }
    if (error.code) {
      console.error('[loc] error code:', error.code);
    }
    // Return empty array to not break aggregator
    return [];
  }
}

module.exports = { search };
