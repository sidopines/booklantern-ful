// lib/sources/openstax.js
// OpenStax integration - free, peer-reviewed textbooks
// All books are open access with direct PDF downloads

const axios = require('axios');

const OPENSTAX_API = 'https://openstax.org/api/v2/pages';
const USER_AGENT = 'BookLantern/1.0 (+https://booklantern.org)';

// OpenStax book catalog (they don't have a search API, so we use their content API)
// These are manually curated high-quality textbooks
const OPENSTAX_SUBJECTS = [
  'math',
  'science',
  'social-sciences',
  'humanities',
  'business',
  'essentials',
  'college-success',
  'high-school',
];

/**
 * Search OpenStax for open textbooks
 * Note: OpenStax doesn't have a traditional search API, so we fetch their book list
 * and filter locally by query match
 * @param {string} q - Search query
 * @param {number} page - Page number (1-indexed) - not really used since we filter locally
 * @returns {Promise<Array>} Normalized book objects
 */
async function search(q, page = 1) {
  try {
    // Fetch OpenStax book listings
    const response = await axios.get('https://openstax.org/api/v2/pages/', {
      params: {
        type: 'books.Book',
        fields: 'title,slug,cover_url,amazon_link,book_subjects,high_resolution_pdf_url,low_resolution_pdf_url,webview_rex_link,publish_date,authors',
        limit: 100, // They have ~50 books total
      },
      timeout: 8000,
      headers: { 'User-Agent': USER_AGENT },
    });
    
    const items = response.data?.items || [];
    if (!Array.isArray(items) || items.length === 0) {
      console.log('[openstax] No books in response');
      return [];
    }
    
    // Filter books matching the query
    const qLower = q.toLowerCase();
    const queryTerms = qLower.split(/\s+/).filter(t => t.length > 2);
    
    const matchingBooks = items.filter(book => {
      const title = (book.title || '').toLowerCase();
      const subjects = (book.book_subjects || []).map(s => (s.name || '').toLowerCase()).join(' ');
      const searchText = `${title} ${subjects}`;
      
      // Match if any query term appears in title or subjects
      return queryTerms.some(term => searchText.includes(term));
    });
    
    // Limit results per page
    const limit = 10;
    const offset = (page - 1) * limit;
    const pageBooks = matchingBooks.slice(offset, offset + limit);
    
    const books = [];
    
    for (const book of pageBooks) {
      try {
        const title = book.title || 'Untitled';
        
        // Extract authors
        const authors = book.authors || [];
        const author = authors
          .map(a => a.name || `${a.first_name || ''} ${a.last_name || ''}`.trim())
          .filter(Boolean)
          .join(', ');
        
        // Get PDF URL (prefer high resolution, fall back to low)
        const pdfUrl = book.high_resolution_pdf_url || book.low_resolution_pdf_url;
        if (!pdfUrl) {
          continue; // Skip books without PDF
        }
        
        // Cover URL
        const coverUrl = book.cover_url || null;
        
        // Extract year from publish_date
        const year = book.publish_date 
          ? parseInt(book.publish_date.substring(0, 4))
          : null;
        
        const slug = book.slug || book.id;
        const providerId = `openstax-${slug}`;
        const bookId = `openstax:${slug}`;
        
        books.push({
          book_id: bookId,
          title,
          author,
          cover_url: coverUrl,
          year,
          language: 'en',
          provider: 'openstax',
          provider_id: providerId,
          format: 'pdf',
          direct_url: pdfUrl,
          source_url: book.webview_rex_link || `https://openstax.org/details/books/${slug}`,
          access: 'open',
          is_restricted: false,
          // All OpenStax items are freely downloadable
          readable: 'true',
        });
      } catch (itemErr) {
        console.warn('[openstax] Error processing book:', itemErr.message);
      }
    }
    
    console.log(`[openstax] search for "${q}" returned ${books.length} items (from ${matchingBooks.length} matches)`);
    return books;
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.log('[openstax] search timeout');
    } else {
      console.error('[openstax] search error:', error.message);
    }
    return [];
  }
}

module.exports = { search };
