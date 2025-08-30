// connectors/openlibrary.js
const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';

function cardFromDoc(d) {
  const id = d.key || d.work_key || d.edition_key?.[0] || '';
  const author = Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || '');
  let cover = '';
  if (d.cover_i) cover = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
  else if (d.edition_key && d.edition_key[0]) cover = `https://covers.openlibrary.org/b/olid/${d.edition_key[0]}-M.jpg`;

  return {
    identifier: `openlibrary:${id}`,
    title: d.title || '(Untitled)',
    creator: author || '',
    cover,
    source: 'openlibrary',
    // We still route to /read so the user stays on site (they can pick Gutenberg/IA copies too)
    readerUrl: `/read?query=${encodeURIComponent(`${d.title || ''} ${author || ''}`)}`
  };
}

async function searchOpenLibrary(q, limit = 40) {
  try {
    const fields = [
      'key','title','author_name','cover_i','edition_key',
      'has_fulltext','public_scan_b','ebook_access'
    ].join(',');
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&mode=everything&limit=${limit}&fields=${fields}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    const data = await r.json();
    const docs = Array.isArray(data.docs) ? data.docs : [];
    const readable = docs.filter(d => {
      if (!d.has_fulltext) return false;
      if (d.public_scan_b === true) return true;                    // IA public scan
      if (String(d.ebook_access || '').toLowerCase() === 'public') return true;
      return false;
    });
    return readable.map(cardFromDoc);
  } catch (e) {
    console.error('[openlibrary] search error:', e);
    return [];
  }
}

module.exports = { searchOpenLibrary };
