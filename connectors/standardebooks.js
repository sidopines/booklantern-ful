// connectors/standardebooks.js
// Search Standard Ebooks via OPDS (reliable for server-side use)
// No external deps; light XML parsing.

const { get, toCard } = require('./utils');

// Known OPDS endpoints (we'll try them in order)
const OPDS_URLS = [
  'https://standardebooks.org/opds/all',
  'https://standardebooks.org/ebooks.opds'
];

function parseOpds(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const out = [];
  const chunks = xml.split('<entry').slice(1);
  for (const chunk of chunks) {
    const block = '<entry' + chunk;
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [,''])[1].trim();
    const author = (block.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/) || [,''])[1].trim();
    const epub = (block.match(/<link[^>]+type="application\/epub\+zip"[^>]+href="([^"]+)"/) || [,''])[1];
    const image = (block.match(/<link[^>]+rel="(?:http:\/\/opds-spec\.org\/image|http:\/\/opds-spec\.org\/image\/thumbnail)"[^>]+href="([^"]+)"/) || [,''])[1];
    const id    = (block.match(/<id>([\s\S]*?)<\/id>/) || [,''])[1].trim();
    if (title && epub) {
      out.push({ id, title, author, epub, cover: image });
    }
  }
  return out;
}

async function searchStandardEbooks(query, limit = 30) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  let xml = '';
  for (const url of OPDS_URLS) {
    try {
      xml = await get(url, { accept: 'application/atom+xml' });
      if (xml) break;
    } catch (_) { /* try next */ }
  }
  if (!xml) return [];

  const entries = parseOpds(xml);
  const filtered = entries.filter(e =>
    e.title.toLowerCase().includes(q) || (e.author || '').toLowerCase().includes(q)
  ).slice(0, limit);

  // Map to your unified "card" shape
  return filtered.map(e =>
    toCard({
      identifier: `se:${e.id || e.epub}`,
      title: e.title,
      creator: e.author || '',
      cover: e.cover || '',
      source: 'standardebooks',
      // readerUrl assumes your unified reader supports ?epub=<url>
      readerUrl: `/read/epub?u=${encodeURIComponent(e.epub)}`
    })
  );
}

module.exports = { searchStandardEbooks };
