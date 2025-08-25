// connectors/standardebooks.js
// Deploy-safe connector so the app never crashes if Standard Ebooks is offline
// or their OPDS changes. We'll upgrade this to real OPDS search next.
// It returns [] for now, but has the SAME shape your routes expect.

let warned = false;

/**
 * searchStandardEbooks(q, opts?)
 * Returns Promise<Array> of cards, but currently [] until we wire OPDS.
 */
async function searchStandardEbooks(q, opts = {}) {
  if (!warned) {
    console.warn('[standardebooks] stub loaded (returns 0 results for now).');
    warned = true;
  }
  return [];
}

// Export **as a function** (what your routes call)
module.exports = searchStandardEbooks;

// Also expose .search for code paths that import as an object
module.exports.search = searchStandardEbooks;
