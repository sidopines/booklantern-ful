// connectors/standardebooks.js
// Standard Ebooks OPDS catalog search
// Returns EPUB-ready cards pointing to our on-site reader via proxy.
const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';
const BASE = 'https://standardebooks.org';

function toCard(hit) {
  return {
    identifier: `standardebooks:${hit.slug}`,
    title: hit.title,
    creator: hit.author,
    cover: hit.cover || '',
    source: 'standardebooks',
    openInline: true,
    kind: 'epub',
    gid: null,
    epubUrl: hit.epub,
    href: `/read/epub?src=${encodeURIComponent(hit.epub)}&title=${encodeURIComponent(hit.title)}&author=${encodeURIComponent(hit.author)}`,
    readerUrl: `/read/standardebooks/${hit.slug}/reader` // for backward compatibility
  };
}

async function fetchHtml(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return '';
  return await r.text();
}

function parseHits(html) {
  // Updated parser for the new HTML structure
  const re = /<li typeof="schema:Book" about="\/ebooks\/([^"]+)">[\s\S]*?<a href="\/ebooks\/[^"]+"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1];
    const title = m[2].trim();
    const author = m[3].trim();
    out.push({
      slug,
      title,
      author,
      gid: '',
      epub: `${BASE}/ebooks/${slug}.epub`,
      cover: `${BASE}/ebooks/${slug}/cover-thumb.jpg`
    });
  }
  return out;
}

async function searchStandardEbooks(q, limit = 20) {
  try {
    const url = `${BASE}/ebooks?query=${encodeURIComponent(q)}`;
    const html = await fetchHtml(url);
    if (!html) return [];
    const hits = parseHits(html).slice(0, limit);
    const results = hits.map(toCard);
    console.log(`[SE] results ${results.length}`);
    return results;
  } catch (e) {
    console.error('[standardebooks] search error:', e);
    return [];
  }
}

module.exports = { searchStandardEbooks };
