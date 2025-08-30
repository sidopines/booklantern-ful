// connectors/gutenberg.js
const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';

function makeCard({ id, title, authors = [], formats = {} }) {
  const author =
    Array.isArray(authors) && authors.length
      ? (authors[0].name || '').trim()
      : '';
  const cover =
    formats['image/jpeg'] ||
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;

  return {
    identifier: `gutenberg:${id}`,
    title: title || '(Untitled)',
    creator: author,
    cover,
    source: 'gutenberg',
    readerUrl: `/read/gutenberg/${id}/reader`,
    meta: {
      gid: id,
      epubUrl:
        formats['application/epub+zip'] ||
        formats['application/x-epub+zip'] ||
        ''
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

module.exports = { searchGutenberg, fetchGutenbergMeta };
