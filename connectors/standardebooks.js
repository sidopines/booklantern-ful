// connectors/standardebooks.js
// Simple OPDS reader for Standard Ebooks that returns single-page HTML items
// OPDS: https://standardebooks.org/opds/all

const CATALOG_URL = 'https://standardebooks.org/opds/all';

/** Fetch OPDS XML as text */
async function fetchXml(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`SE OPDS ${r.status}`);
  return await r.text();
}

/** super-light XML parsing for <entry> blocks */
function parseEntries(xmlText) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = entryRe.exec(xmlText))) {
    const block = m[1];

    const title = (block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
    const author = (block.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i)?.[1] || '').trim();

    // Find "alternate" link (work page)
    const altHref = (block.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i)?.[1]) ||
                    (block.match(/<link[^>]+href="([^"]+)"[^>]+rel="alternate"/i)?.[1]) || '';

    // Cover
    const cover = (block.match(/<link[^>]+rel="http:\/\/opds-spec\.org\/image"[^>]+href="([^"]+)"/i)?.[1]) || '';

    if (!title || !altHref) continue;

    // Build single page HTML URL: …/text/single-page
    const htmlUrl = altHref.replace(/\/+$/,'') + '/text/single-page';
    // Slug-ish id from path (…/ebooks/{slug})
    const slug = (altHref.match(/\/ebooks\/([^/]+\/[^/]+)/)?.[1] || altHref).replace(/^\/+|\/+$/g,'');

    entries.push({ title, author, htmlUrl, cover, slug });
  }
  return entries;
}

/** case-insensitive contains */
function ciContains(hay = '', needle = '') {
  return String(hay).toLowerCase().includes(String(needle).toLowerCase());
}

/**
 * Search Standard Ebooks by filtering the OPDS catalog client-side.
 * Returns BookLantern "card" objects.
 */
async function searchStandardEbooks(q, { limit = 24 } = {}) {
  try {
    const xml = await fetchXml(CATALOG_URL);
    const entries = parseEntries(xml);
    const filtered = entries.filter(e =>
      ciContains(e.title, q) || ciContains(e.author, q)
    ).slice(0, limit);

    return filtered.map(e => ({
      identifier: `se:${e.slug}`,
      title: e.title,
      creator: e.author,
      cover: e.cover,
      source: 'standardebooks',
      // We’ll read the HTML through our html-proxy in unified reader
      readerUrl: `/read/se/${encodeURIComponent(e.slug)}/reader?u=${encodeURIComponent(e.htmlUrl)}`
    }));
  } catch (err) {
    console.warn('[standardebooks] search failed:', err?.message || err);
    return [];
  }
}

module.exports = searchStandardEbooks;
module.exports.search = searchStandardEbooks;
