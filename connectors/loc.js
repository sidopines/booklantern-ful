// connectors/loc.js
// Library of Congress Books API -> on-site PDF reader
// Docs: https://www.loc.gov/apis/json-and-yaml/
async function searchLOC(q, limit = 24) {
  // TODO: Fix LOC API integration - currently returns collections, not individual PDFs
  console.log(`[LOC] results 0 (pdf only) - API returns collections, not individual PDFs`);
  return [];
}

module.exports = { searchLOC };
