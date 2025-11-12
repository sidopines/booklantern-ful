// lib/sources/archive.js
const axios = require('axios');
const crypto = require('crypto');

/**
 * Search Internet Archive
 * @param {string} q - Search query
 * @param {number} page - Page number (1-indexed)
 * @returns {Promise<Array>} Normalized book objects
 */
async function search(q, page = 1) {
  try {
    const rows = 20;
    const start = (page - 1) * rows;
    
    // Build query: public domain texts with EPUB format
    const query = `(${q}) AND mediatype:texts AND format:EPUB AND (licenseurl:* OR publicdate:[* TO *])`;
    
    const url = `https://archive.org/advancedsearch.php`;
    const params = {
      q: query,
      fl: 'identifier,title,creator,year,language,format',
      rows,
      page: page,
      output: 'json',
    };

    const response = await axios.get(url, {
      params,
      timeout: 3500,
      headers: { 'User-Agent': 'BookLantern/1.0' },
    });

    const docs = response.data.response?.docs || [];
    const books = [];

    for (const doc of docs) {
      const identifier = doc.identifier;
      if (!identifier) continue;

      // Verify EPUB format exists
      const formats = doc.format || [];
      const hasEpub = formats.some(f => 
        f.toLowerCase().includes('epub')
      );
      
      if (!hasEpub) continue;

      // Construct EPUB URL
      const epubUrl = `https://archive.org/download/${identifier}/${identifier}.epub`;

      const title = doc.title || 'Untitled';
      const author = doc.creator || 'Unknown';
      const year = doc.year || null;
      const language = doc.language || 'en';
      
      // Thumbnail
      const coverUrl = `https://archive.org/services/img/${identifier}`;

      const bookId = `archive:${identifier}`;

      books.push({
        book_id: bookId,
        title,
        author,
        cover_url: coverUrl,
        year,
        language,
        provider: 'archive',
        provider_id: identifier,
        format: 'epub',
        direct_url: epubUrl,
      });
    }

    return books;
  } catch (error) {
    console.error('[archive] search error:', error.message);
    return [];
  }
}

module.exports = { search };
