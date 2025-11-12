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
      c: 20,
      sp: page,
    };

    const response = await axios.get(url, {
      params,
      timeout: 3500,
      headers: { 'User-Agent': 'BookLantern/1.0' },
    });

    const results = response.data.results || [];
    const books = [];

    for (const item of results) {
      // Check if public domain and downloadable
      const accessRestricted = item.access_restricted === false;
      const digitized = item.digitized === true;
      
      if (!accessRestricted || !digitized) continue;

      // Look for download resources
      const resources = item.resources || [];
      let epubUrl = null;
      let pdfUrl = null;
      let format = null;

      for (const res of resources) {
        const url = res.url || '';
        const files = res.files || [];
        
        for (const file of files) {
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
      const author = (item.contributor_names || []).join(', ') || 'Unknown';
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

    return books;
  } catch (error) {
    console.error('[loc] search error:', error.message);
    return [];
  }
}

module.exports = { search };
