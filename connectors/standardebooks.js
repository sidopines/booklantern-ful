// connectors/standardebooks.js
// Safe stub connector so your server never crashes if this source is missing
// or temporarily disabled. We’ll upgrade this to real OPDS search later.

let warned = false;

/**
 * searchStandardEbooks(query, opts?)
 * Returns [] for now (no-op), but matches the function signature your routes call.
 */
async function searchStandardEbooks(_q, _opts = {}) {
  if (!warned) {
    console.warn('[standardebooks] stub loaded (returns 0 results for now).');
    warned = true;
  }
  return [];
}

// Export as a callable function (what routes expect)
module.exports = searchStandardEbooks;
// Also expose `.search` for object-style imports
module.exports.search = searchStandardEbooks;
