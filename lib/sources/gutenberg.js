// lib/sources/gutenberg.js
const axios = require('axios');
const crypto = require('crypto');

/**
 * Search Gutenberg via Gutendex API
 * @param {string} q - Search query
 * @param {number} page - Page number (1-indexed)
 * @returns {Promise<Array>} Normalized book objects
 */
async function search(q, page = 1) {
  const TIMEOUT_MS = 12000; // Bug C: increased from 5000ms
  const MAX_RETRIES = 1;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const url = `https://gutendex.com/books`;
      const params = {
        search: q,
        page: page,
      };

      const response = await axios.get(url, {
        params,
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': 'BookLantern/1.0' },
      });

      const results = response.data.results || [];
      const books = [];

      for (const item of results) {
        // Only include items with EPUB format
        const formats = item.formats || {};
        const epubUrl =
          formats['application/epub+zip'] ||
          formats['application/epub'] ||
          null;

        if (!epubUrl) continue;

        // Extract author
        const authors = item.authors || [];
        const author = authors.map(a => a && a.name).filter(Boolean).join(', ') || '';

        // Extract cover
        const coverUrl = formats['image/jpeg'] || null;

        // Determine language
        const languages = item.languages || [];
        const language = languages[0] || 'en';

        // Provider ID
        const providerId = String(item.id);

        // Create stable book_id
        const bookId = `gutenberg:${providerId}`;

        books.push({
          book_id: bookId,
          title: item.title || 'Untitled',
          author,
          cover_url: coverUrl,
          year: item.download_count ? null : null,
          language,
          provider: 'gutenberg',
          provider_id: providerId,
          format: 'epub',
          direct_url: epubUrl,
        });
      }

      return books;
    } catch (error) {
      const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
      if (isTimeout && attempt < MAX_RETRIES) {
        console.warn(`[gutenberg] timeout on attempt ${attempt + 1}, retrying...`);
        continue;
      }
      console.error('[gutenberg] search error:', error.message);
      return [];
    }
  }
  return [];
}

module.exports = { search };
