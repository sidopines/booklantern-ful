// connectors/gutenberg.js
// Project Gutenberg connector that ONLY returns items we can render inline
// in our /read/gutenberg/:gid/reader using ePub.js + our /proxy/gutenberg-epub/:gid.
//
// It talks to Gutendex (the Project Gutenberg JSON API).
// Docs: https://gutendex.com/
// Example: https://gutendex.com/books?search=plato
//
// Output shape for each book:
// {
//   identifier: 'gutenberg:1342',
//   title: 'Pride and Prejudice',
//   creator: 'Jane Austen',
//   cover: 'https://...jpg',
//   source: 'gutenberg',
//   readerUrl: '/read/gutenberg/1342/reader?title=Pride%20and%20Prejudice&author=Jane%20Austen',
//   epubProxy: '/proxy/gutenberg-epub/1342'
// }

const API = 'https://gutendex.com/books';

function toId(val) {
  return String(val || '').replace(/[^0-9]/g, '');
}

function hasEpub(formats) {
  if (!formats || typeof formats !== 'object') return false;
  // Gutendex usually has keys like 'application/epub+zip'
  // Filter out .zip links and prefer direct .epub
  const keys = Object.keys(formats);
  return keys.some(k => /^application\/epub\+zip/i.test(k) && formats[k] && !/\.zip($|\?)/i.test(formats[k]));
}

function getCover(id, formats) {
  // Prefer Gutendex-provided image if present
  if (formats && formats['image/jpeg']) return formats['image/jpeg'];
  // Fallback to PG's predictable cover path
  return `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;
}

function normalizeAuthors(authorsArr) {
  if (!Array.isArray(authorsArr) || !authorsArr.length) return '';
  return authorsArr.map(a => a && a.name ? a.name : '').filter(Boolean).join(', ');
}

function toCard(b) {
  const gid    = toId(b.id);
  const title  = b.title || '(Untitled)';
  const author = normalizeAuthors(b.authors);
  const cover  = getCover(gid, b.formats || {});
  const readerUrl = `/read/gutenberg/${gid}/reader?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`;

  return {
    identifier: `gutenberg:${gid}`,
    title,
    creator: author,
    cover,
    source: 'gutenberg',
    readerUrl,
    epubProxy: `/proxy/gutenberg-epub/${gid}`
  };
}

/**
 * Fetch one page from Gutendex.
 */
async function fetchPage(url) {
  const r = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      // polite UA
      'User-Agent': 'BookLantern/1.0 (+booklantern.org)'
    }
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Gutendex ${r.status} ${r.statusText} ${text.slice(0,200)}`);
  }
  return r.json();
}

/**
 * Search Gutenberg via Gutendex and return ONLY inline-readable (EPUB) items,
 * normalized for our site.
 *
 * @param {string} q - user query
 * @param {number} limit - max number of cards to return
 * @returns {Promise<Array>} cards
 */
async function searchGutenberg(q, limit = 60) {
  const cleanQ = String(q || '').trim();
  if (!cleanQ) return [];

  let url = `${API}?search=${encodeURIComponent(cleanQ)}&page=1&page_size=50`;
  const out = [];

  // Keep pulling pages until we have "limit" or no next page
  // (Most searches fit in 1–2 pages.)
  for (let safeguard = 0; safeguard < 5 && out.length < limit && url; safeguard++) {
    const data = await fetchPage(url);
    const results = Array.isArray(data.results) ? data.results : [];

    for (const b of results) {
      // Only keep items with an EPUB we can proxy (no .zip)
      if (hasEpub(b.formats)) {
        out.push(toCard(b));
        if (out.length >= limit) break;
      }
    }

    url = data.next || null;
  }

  return out.slice(0, limit);
}

module.exports = {
  searchGutenberg
};
