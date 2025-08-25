// connectors/openlibrary.js
// Use Open Library search but include ONLY public (readable) ebooks.
// Borrow-only items are excluded to avoid bounce-outs.
function asCard(doc) {
  const id = doc.key || doc.work_key || doc.edition_key?.[0] || '';
  const author = Array.isArray(doc.author_name) ? doc.author_name[0] : (doc.author_name || '');
  let cover = '';
  if (doc.cover_i) cover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
  else if (doc.edition_key && doc.edition_key[0]) cover = `https://covers.openlibrary.org/b/olid/${doc.edition_key[0]}-M.jpg`;

  // If IA id present, open with our internal Archive viewer
  const iaId = Array.isArray(doc.ia) && doc.ia[0] ? doc.ia[0] : '';

  return {
    identifier: `openlibrary:${id}`,
    title: doc.title || '(Untitled)',
    creator: author || '',
    cover,
    source: 'openlibrary',
    archiveId: iaId || '',
    readerUrl: iaId ? `/read/book/${encodeURIComponent(iaId)}` : ''
  };
}

async function searchOpenLibraryReadable(q, limit = 48) {
  // mode=ebooks & has_fulltext=true narrows to items that have some online access
  // fields=... to fetch ebook_access + IA identifiers for routing
  const url =
    `https://openlibrary.org/search.json` +
    `?q=${encodeURIComponent(q)}` +
    `&mode=ebooks&has_fulltext=true&limit=${limit}` +
    `&fields=key,title,author_name,cover_i,ebook_access,ia,edition_key`;

  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`OL status ${r.status}`);
    const data = await r.json();
    const docs = Array.isArray(data?.docs) ? data.docs : [];

    // Only keep ebooks that are PUBLIC (read online). We skip borrow-only to avoid off-site flows.
    const filtered = docs.filter((d) => String(d.ebook_access || '').toLowerCase() === 'public');

    return filtered.map(asCard);
  } catch (err) {
    console.error('[OpenLibrary] search error:', err?.message || err);
    return [];
  }
}

module.exports = { searchOpenLibraryReadable };
