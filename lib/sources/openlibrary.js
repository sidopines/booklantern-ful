// lib/sources/openlibrary.js
const axios = require('axios');
const crypto = require('crypto');

/**
 * Search Open Library
 * @param {string} q - Search query
 * @param {number} page - Page number (1-indexed)
 * @returns {Promise<Array>} Normalized book objects
 */
async function search(q, page = 1) {
  try {
    const offset = (page - 1) * 20;
    const url = `https://openlibrary.org/search.json`;
    const params = {
      q,
      has_fulltext: true,
      limit: 20,
      offset,
    };

    const response = await axios.get(url, {
      params,
      timeout: 5000,
      headers: { 'User-Agent': 'BookLantern/1.0' },
    });

    const docs = response.data.docs || [];
    const books = [];

    for (const doc of docs) {
      // Try to resolve Internet Archive EPUB
      const iaKeys = doc.ia || [];
      if (!iaKeys.length) continue;

      // Use first IA identifier
      const iaId = iaKeys[0];
      
      // Check if public domain via lending/availability
      const availability = doc.availability || {};
      const isPublicDomain =
        availability.status === 'open' ||
        doc.public_scan_b === true ||
        doc.has_fulltext === true;

      if (!isPublicDomain) continue;

      // Construct IA EPUB URL
      const epubUrl = `https://archive.org/download/${iaId}/${iaId}.epub`;

      // Extract metadata
      const title = doc.title || 'Untitled';
      const author = Array.isArray(doc.author_name) 
        ? doc.author_name.join(', ') 
        : (doc.author_name || '');
      const coverId = doc.cover_i;
      const coverUrl = coverId
        ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
        : null;
      const year = doc.first_publish_year || null;
      const language = (doc.language || ['en'])[0];

      const providerId = doc.key ? doc.key.replace('/works/', '') : iaId;
      const bookId = `openlibrary:${providerId}`;

      books.push({
        book_id: bookId,
        title,
        author,
        cover_url: coverUrl,
        year,
        language,
        provider: 'openlibrary',
        provider_id: providerId,
        format: 'epub',
        direct_url: epubUrl,
      });
    }

    return books;
  } catch (error) {
    console.error('[openlibrary] search error:', error.message);
    return [];
  }
}

module.exports = { search };
