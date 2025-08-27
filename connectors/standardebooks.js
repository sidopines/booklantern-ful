// connectors/standardebooks.js
// Reliable Standard Ebooks search via OPDS (no HTML scraping, suited for servers)

const { get, toCard } = require('./utils');

// We try multiple OPDS endpoints (the first succeeds today)
const OPDS_URLS = [
  'https://standardebooks.org/opds/all',
  'https://standardebooks.org/ebooks.opds'
];

/** Very small OPDS parser for what we need (no external deps). */
function parseOpds(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const out = [];
  const entries = xml.split('<entry').slice(1);
  for (const raw of entries) {
    const block = '<entry' + raw;
    const title  = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [,''])[1].trim();
    const author = (block.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/) || [,''])[1].trim();
    const epub   = (block.match(/<link[^>]+type="application\/epub\+zip"[^>]+href="([^"]+)"/) || [,''])[1];
    const cover  = (block.match(/<link[^>]+rel="(?:http:\/\/opds-spec\.org\/image|http:\/\/opds-spec\.org\/image\/thumbnail)"[^>]+href="([^"]+)"/) || [,''])[1];
    const id     = (block.match(/<id>([\s\S]*?)<\/id>/) || [,''])[1].trim();
    if (title && epub) {
      out.push({ id, title, author, epub, cover });
    }
  }
  return out;
}

async function fetchOpds() {
  for (const url of OPDS_URLS) {
    try {
      const xml = await get(url, { accept: 'application/atom+xml' });
      if (xml) return xml;
    } catch (_) { /* try next */ }
  }
  return '';
}

/**
 * Search Standard Ebooks by fetching the OPDS catalog and filtering locally.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array>} unified "card" objects
 */
async function searchStandardEbooks(query, limit = 30) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  const xml = await fetchOpds();
  if (!xml) return [];

  const entries = parseOpds(xml);
  const filtered = entries
    .filter(e =>
      e.title.toLowerCase().includes(q) ||
      (e.author || '').toLowerCase().includes(q)
    )
    .slice(0, limit);

  return filtered.map(e =>
    toCard({
      identifier: `se:${e.id || e.epub}`,
      title: e.title,
      creator: e.author || '',
      cover: e.cover || '',
      source: 'standardebooks',
      // Our reader route for arbitrary EPUB URLs:
      readerUrl: `/read/epub?u=${encodeURIComponent(e.epub)}&title=${encodeURIComponent(e.title)}&author=${encodeURIComponent(e.author || '')}`
    })
  );
}

module.exports = { searchStandardEbooks };
