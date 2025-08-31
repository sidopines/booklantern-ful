// connectors/openlibrary.js
const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';

function cardFromDoc(d) {
  const id = d.key || d.work_key || d.edition_key?.[0] || '';
  const author = Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || '');
  let cover = '';
  if (d.cover_i) cover = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
  else if (d.edition_key && d.edition_key[0]) cover = `https://covers.openlibrary.org/b/olid/${d.edition_key[0]}-M.jpg`;

  // Only return cards for items that are readable on-site (no account, no borrow)
  if (d.ebook_access === 'public' && Array.isArray(d.ia) && d.ia.length > 0) {
    const iaId = d.ia[0];
    return {
      identifier: `openlibrary:${id}`,
      title: d.title || '(Untitled)',
      creator: author || '',
      cover,
      source: 'openlibrary',
      openInline: true,
      kind: 'ia',
      iaId,
      href: `/read/ia/${iaId}`,
      readerUrl: `/read/ia/${iaId}` // for backward compatibility
    };
  }
  
  // Return null for items that don't meet the criteria
  return null;
}

async function searchOpenLibrary(q, limit = 40) {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&mode=ebooks&has_fulltext=true&fields=key,title,author_name,first_publish_year,edition_key,ebook_access,ia&limit=${limit}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    const data = await r.json();
    const docs = Array.isArray(data.docs) ? data.docs : [];
    
    // Filter strictly: only keep docs where ebook_access === 'public' AND Array.isArray(ia) AND ia.length > 0
    const filtered = docs.filter(d => d.ebook_access === 'public' && Array.isArray(d.ia) && d.ia.length > 0);
    const cards = filtered.map(cardFromDoc).filter(Boolean); // Remove null values
    
    console.log(`[OL] kept ${cards.length} / dropped ${docs.length - filtered.length} (borrow/restricted)`);
    return cards;
  } catch (e) {
    console.error('[openlibrary] search error:', e);
    return [];
  }
}

module.exports = { searchOpenLibrary };
