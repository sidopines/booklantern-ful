// connectors/gutenberg.js
// Robust Gutenberg search via Gutendex with explicit EPUB URL for inline reader.

const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';

function makeCard({ id, title, authors = [], formats = {} }) {
  // Try to find a direct EPUB link from Gutendex formats
  const epubUrl =
    formats['application/epub+zip'] ||
    formats['application/x-epub+zip'] ||
    null;

  const author =
    Array.isArray(authors) && authors.length
      ? (authors[0].name || '').trim()
      : '';

  // Prefer cover from Gutendex; fall back to cache path
  const cover =
    formats['image/jpeg'] ||
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;

  return {
    identifier: `gutenberg:${id}`,
    title: title || '(Untitled)',
    creator: author,
    cover,
    source: 'gutenberg',
    // We pass the gid; the route will build a proxied EPUB stream
    readerUrl: `/read/gutenberg/${id}/reader`,
    meta: {
      epubUrl, // used as a hint; route will still probe fallbacks if needed
      gid: id
    }
  };
}

async function searchGutenberg(q, limit = 40) {
  try {
    const url = `https://gutendex.com/books?search=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    const data = await r.json();
    const items = Array.isArray(data.results) ? data.results : [];
    return items.slice(0, limit).map(makeCard);
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

module.exports = {
  searchGutenberg,
  fetchGutenbergMeta,
};
