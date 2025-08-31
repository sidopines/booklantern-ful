// connectors/gutenberg.js
const fetch = require('node-fetch');
const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';

function makeCard({ id, title, authors = [], formats = {} }) {
  const author =
    Array.isArray(authors) && authors.length
      ? (authors[0].name || '').trim()
      : '';
  const cover =
    formats['image/jpeg'] ||
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;

  // Check if EPUB is available
  const hasEpub = formats['application/epub+zip'] || 
                  Object.keys(formats).some(key => key.includes('.epub'));

  return {
    source: 'gutenberg',
    title: title || '(Untitled)',
    author: author,
    cover: cover,
    gutenId: id,
    href: `/read/gutenberg/${id}/reader`,
    readable: Boolean(hasEpub),
    openInline: Boolean(hasEpub),
    identifier: `gutenberg:${id}`,
    creator: author,
    readerUrl: `/read/gutenberg/${id}/reader`,
    meta: {
      gid: id,
      epubUrl: formats['application/epub+zip'] || ''
    }
  };
}

async function searchGutenberg(q, limit = 40) {
  try {
    const url = `https://gutendex.com/books/?search=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    const data = await r.json();
    const items = Array.isArray(data.results) ? data.results : [];
    
    // Filter for items with EPUB availability
    const epubItems = items.filter(item => {
      const formats = item.formats || {};
      return formats['application/epub+zip'] || 
             Object.keys(formats).some(key => key.includes('.epub'));
    });
    
    const cards = epubItems.slice(0, limit).map(makeCard);
    console.log(`[GUTENBERG] results ${cards.length} (epub only)`);
    return cards;
  } catch (e) {
    console.error('[gutenberg] search error:', e);
    return [];
  }
}

async function fetchGutenbergMeta(gid) {
  try {
    const r = await fetch(`https://gutendex.com/books/${gid}`, {
      headers: { 'User-Agent': UA }
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.error('[gutenberg] meta error:', e);
    return null;
  }
}

module.exports = { searchGutenberg, fetchGutenbergMeta };
