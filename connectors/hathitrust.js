// connectors/hathitrust.js
// NOTE: HathiTrust search requires SRU / bibliographic keys; there isn't a simple free-text JSON endpoint.
// This scaffold logs cleanly and returns [] so your deploy never breaks while we wire SRU next.

async function searchHathiFullView(q, limit = 24) {
  try {
    // Placeholder: We will switch to SRU (Z39.50-style) to query only "Full view" items
    // and map them to IIIF/PDF/Thumbs. For now, keep it no-op & logged.
    console.warn('[HathiTrust] connector scaffold active — SRU search to be wired next. Query:', q);
    return [];
  } catch (err) {
    console.error('[HathiTrust] search error:', err?.message || err);
    return [];
  }
}

module.exports = { searchHathiFullView };
