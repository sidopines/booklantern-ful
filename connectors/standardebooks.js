// connectors/standardebooks.js
// Lightweight HTML scrape of Standard Ebooks search results.
// Returns EPUB-ready cards pointing to our reader via gutenberg-like proxy.
const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';
const BASE = 'https://standardebooks.org';

function toCard(hit) {
  return {
    identifier: `standardebooks:${hit.slug}`,
    title: hit.title,
    creator: hit.author,
    cover: hit.cover || '',
    source: 'standardebooks',
    // They publish clean EPUBs; link the canonical EPUB for our reader to pull.
    readerUrl: `/read/gutenberg/${hit.gid || ''}/reader`, // if mapped to a Gutenberg ID
    // If no Gutenberg id, we’ll open their EPUB directly through the reader via proxy below:
    meta: { directEpub: hit.epub }
  };
}

async function fetchHtml(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return '';
  return await r.text();
}

function parseHits(html) {
  // Very small parser: look for ebook cards.
  const re = /<li class="ebook">[\s\S]*?<a href="\/ebooks\/([^"]+)">[\s\S]*?<span class="title">([^<]+)<\/span>[\s\S]*?<span class="author">([^<]+)<\/span>[\s\S]*?(?:data-gutenberg-id="(\d+)")?/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1];
    const title = m[2].trim();
    const author = m[3].trim();
    const gid = m[4] ? m[4].trim() : '';
    out.push({
      slug,
      title,
      author,
      gid,
      epub: `${BASE}/ebooks/${slug}.epub`,
      cover: `${BASE}/ebooks/${slug}/cover-thumb.jpg`
    });
  }
  return out;
}

async function searchStandardEbooks(q, limit = 20) {
  try {
    const url = `${BASE}/ebooks/?query=${encodeURIComponent(q)}`;
    const html = await fetchHtml(url);
    if (!html) return [];
    const hits = parseHits(html).slice(0, limit);
    return hits.map(toCard);
  } catch (e) {
    console.error('[standardebooks] search error:', e);
    return [];
  }
}

module.exports = { searchStandardEbooks };
