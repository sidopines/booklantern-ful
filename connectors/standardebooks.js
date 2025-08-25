// connectors/standardebooks.js
// Minimal, deploy-safe stub so Render stops failing with "module not found".
// We’ll upgrade this to real OPDS search next, but for now it simply returns
// an empty array and logs once so your app continues to work.

let warned = false;

/**
 * search(q, opts) -> Promise<[]>
 * q: string  - user query
 * opts: { limit?: number }
 */
async function search(q, opts = {}) {
  if (!warned) {
    console.warn('[standardebooks] connector stub loaded (returns 0 results for now).');
    warned = true;
  }
  // Return an empty list so the aggregator in bookRoutes can continue
  // combining results from other connectors without throwing.
  return [];
}

module.exports = { search };
