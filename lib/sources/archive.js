// lib/sources/archive.js
const axios = require('axios');
const crypto = require('crypto');

/**
 * Check if an Archive.org item is freely downloadable (not borrow-only)
 * Uses metadata fields to detect controlled lending / DRM items
 */
function isFreelyDownloadable(doc) {
  // Explicit access-restricted flag
  const restricted = doc['access-restricted-item'];
  if (restricted === true || restricted === 'true' || restricted === 1) {
    return false;
  }

  // Collection-based filtering: these collections are borrow-only
  const collections = doc.collection || [];
  const collectionArr = Array.isArray(collections) ? collections : [collections];
  const borrowCollections = [
    'inlibrary',
    'printdisabled',
    'lending',
    'borrowable',
    'lendingebooks',
    'internetarchivebooks',
  ];
  // If item is ONLY in borrow-type collections, it's likely restricted
  const inBorrowCollection = collectionArr.some(c => 
    borrowCollections.includes(String(c).toLowerCase())
  );
  // Check for public domain / open collections
  const openCollections = ['opensource', 'gutenberg', 'millionbooks', 'americana', 'fedlink'];
  const inOpenCollection = collectionArr.some(c =>
    openCollections.includes(String(c).toLowerCase())
  );
  // If in borrow collection but not in any open collection, likely restricted
  if (inBorrowCollection && !inOpenCollection) {
    return false;
  }

  // Check lending-specific fields
  if (doc.lending___status) {
    const status = String(doc.lending___status).toLowerCase();
    if (status.includes('borrow') || status.includes('lending') || status.includes('waitlist')) {
      return false;
    }
  }

  // If item has borrow count but no loans_allowed, it's likely lending-only
  if (doc.loans__loaned__ > 0 && !doc.downloads) {
    return false;
  }

  return true;
}

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
    // Exclude items explicitly in lending collections
    const query = `(${q}) AND mediatype:texts AND format:EPUB AND -collection:inlibrary AND -collection:printdisabled`;
    
    const url = `https://archive.org/advancedsearch.php`;
    const params = {
      q: query,
      // Request additional fields to detect lending/borrow status
      fl: 'identifier,title,creator,year,language,format,access-restricted-item,collection,lending___status,loans__loaned__,downloads',
      rows,
      page: page,
      output: 'json',
    };

    // Increased timeout to 12s for better reliability
    const response = await axios.get(url, {
      params,
      timeout: 12000,
      headers: { 'User-Agent': 'BookLantern/1.0' },
    });

    const docs = response.data.response?.docs || [];
    const books = [];
    let restrictedCount = 0;

    for (const doc of docs) {
      const identifier = doc.identifier;
      if (!identifier) continue;

      // Verify EPUB format exists
      const formats = doc.format || [];
      const hasEpub = formats.some(f => 
        f.toLowerCase().includes('epub')
      );
      
      if (!hasEpub) continue;

      // Filter out borrow-only / restricted items
      if (!isFreelyDownloadable(doc)) {
        restrictedCount++;
        continue;
      }

      // Construct EPUB URL
      const epubUrl = `https://archive.org/download/${identifier}/${identifier}.epub`;

      const access = 'public';

      const title = doc.title || 'Untitled';
      // IA metadata sometimes provides creator as string or array
      const metaAuthor = doc.creator;
      const author = Array.isArray(metaAuthor) 
        ? metaAuthor.join(', ') 
        : (metaAuthor || '');
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
        archive_id: identifier,
        format: 'epub',
        direct_url: epubUrl,
        access,
      });
    }

    if (restrictedCount > 0) {
      console.log(`[search] archive filtered restricted=${restrictedCount} kept=${books.length}`);
    }

    return books;
  } catch (error) {
    // Retry once on timeout
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.log('[archive] search timeout, retrying once...');
      try {
        const retryResponse = await axios.get(url, {
          params,
          timeout: 12000,
          headers: { 'User-Agent': 'BookLantern/1.0' },
        });
        const retryDocs = retryResponse.data.response?.docs || [];
        const retryBooks = [];
        for (const doc of retryDocs) {
          const identifier = doc.identifier;
          if (!identifier) continue;
          const formats = doc.format || [];
          const hasEpub = formats.some(f => f.toLowerCase().includes('epub'));
          if (!hasEpub) continue;
          if (!isFreelyDownloadable(doc)) continue;
          
          const epubUrl = `https://archive.org/download/${identifier}/${identifier}.epub`;
          const title = doc.title || 'Untitled';
          const metaAuthor = doc.creator;
          const author = Array.isArray(metaAuthor) ? metaAuthor.join(', ') : (metaAuthor || '');
          const year = doc.year || null;
          const language = doc.language || 'en';
          const coverUrl = `https://archive.org/services/img/${identifier}`;
          const bookId = `archive:${identifier}`;
          
          retryBooks.push({
            book_id: bookId,
            title,
            author,
            cover_url: coverUrl,
            year,
            language,
            provider: 'archive',
            provider_id: identifier,
            archive_id: identifier,
            format: 'epub',
            direct_url: epubUrl,
            access: 'public',
          });
        }
        console.log(`[archive] retry succeeded: ${retryBooks.length} books`);
        return retryBooks;
      } catch (retryError) {
        console.error('[archive] retry also failed:', retryError.message);
        return [];
      }
    }
    console.error('[archive] search error:', error.message);
    return [];
  }
}

module.exports = { search };
