// connectors/openlibrary.js
const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';

function cardFromDoc(d) {
  const id = d.key || d.work_key || d.edition_key?.[0] || '';
  const author = Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || '');
  let cover = '';
  if (d.cover_i) cover = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
  else if (d.edition_key && d.edition_key[0]) cover = `https://covers.openlibrary.org/b/olid/${d.edition_key[0]}-M.jpg`;

  // Build readerUrl based on availability
  let readerUrl = '';
  let accessBadge = '';
  
  if (d.ocaid) {
    // Internet Archive ID exists - use our on-site IA viewer
    readerUrl = `/read/book/${d.ocaid}`;
  } else if (d.ebook_access === 'public' && d.key) {
    // Public ebook - link to Open Library's reader
    readerUrl = `https://openlibrary.org${d.key}/read`;
  } else {
    // Not publicly readable
    accessBadge = 'Borrow/Login required';
  }

  return {
    identifier: `openlibrary:${id}`,
    title: d.title || '(Untitled)',
    creator: author || '',
    cover,
    source: 'openlibrary',
    readerUrl,
    accessBadge,
    ocaid: d.ocaid || null,
    ebookAccess: d.ebook_access || null,
    availability: d.availability || null,
    ia: d.ia || null
  };
}

async function searchOpenLibrary(q, limit = 40) {
  try {
    const fields = [
      'key','title','author_name','cover_i','edition_key',
      'has_fulltext','public_scan_b','ebook_access',
      'ocaid','availability','ia'
    ].join(',');
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&mode=everything&limit=${limit}&fields=${fields}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    const data = await r.json();
    const docs = Array.isArray(data.docs) ? data.docs : [];
    
    // Include all docs but mark them with appropriate access info
    return docs.map(cardFromDoc);
  } catch (e) {
    console.error('[openlibrary] search error:', e);
    return [];
  }
}

module.exports = { searchOpenLibrary };
