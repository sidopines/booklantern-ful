// connectors/loc.js
// Library of Congress Books API -> on-site PDF reader
// Docs: https://www.loc.gov/apis/json-and-yaml/
async function searchLOC(q, limit = 24) {
  const url = `https://www.loc.gov/books/?q=${encodeURIComponent(q)}&fo=json&c=${limit}`;
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`LOC status ${r.status}`);
    const data = await r.json();
    const results = Array.isArray(data?.results) ? data.results : [];

    const cards = [];
    for (const item of results) {
      // Find a PDF resource
      const resources = Array.isArray(item?.resources) ? item.resources : [];
      const pdfRes = resources.find(
        (res) =>
          /pdf/i.test(res?.format || '') ||
          /application\/pdf/i.test(res?.mime || '') ||
          /\.pdf($|\?)/i.test(res?.url || '')
      );
      const pdfUrl = pdfRes?.url;

      if (!pdfUrl) continue; // Skip items without a direct PDF

      const cover =
        (Array.isArray(item?.image_url) && item.image_url[0]) ||
        item?.image ||
        '';

      cards.push({
        identifier: `loc:${item?.id || item?.url || pdfUrl}`,
        title: item?.title || '(Untitled)',
        creator: item?.creator || '',
        cover,
        source: 'loc',
        // Open inside our on-site PDF reader (with proxy)
        readerUrl: `/read/pdf?u=${encodeURIComponent(pdfUrl)}`,
      });
    }

    return cards;
  } catch (err) {
    console.error('[LOC] search error:', err?.message || err);
    return [];
  }
}

module.exports = { searchLOC };
