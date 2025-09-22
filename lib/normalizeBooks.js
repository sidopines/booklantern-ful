function first(arr){ return Array.isArray(arr) && arr.length ? arr[0] : null; }

function coverFrom(record = {}) {
  // direct URLs first
  if (record.coverLarge) return record.coverLarge;
  if (record.cover_url) return record.cover_url;
  if (record.coverUrl) return record.coverUrl;
  if (record.imageLarge) return record.imageLarge;
  if (record.image) return record.image;
  if (record.cover) return record.cover;
  if (record.thumbnail) return record.thumbnail;
  if (record.thumb) return record.thumb;

  // Open Library "search" style
  if (record.cover_i) return `https://covers.openlibrary.org/b/id/${record.cover_i}-L.jpg`;
  const isbn = (record.isbn && (Array.isArray(record.isbn) ? record.isbn[0] : record.isbn)) || record.isbn13 || record.isbn10;
  if (isbn) return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg`;
  if (record.olid || record.openLibraryId) {
    const id = record.olid || record.openLibraryId;
    return `https://covers.openlibrary.org/b/olid/${encodeURIComponent(id)}-L.jpg`;
  }

  // Open Library "subjects" works style
  // e.g. /subjects/*.json returns works with cover_id / cover_edition_key / edition_key
  if (record.cover_id) return `https://covers.openlibrary.org/b/id/${record.cover_id}-L.jpg`;
  if (record.cover_edition_key) return `https://covers.openlibrary.org/b/olid/${encodeURIComponent(record.cover_edition_key)}-L.jpg`;
  const edKey = first(record.edition_key);
  if (edKey) return `https://covers.openlibrary.org/b/olid/${encodeURIComponent(edKey)}-L.jpg`;

  // formats map last
  if (record.formats){ 
    const f=record.formats, keys=['image/jpeg','image/jpg','image/png','image/*','thumbnail','cover'];
    for(const k of keys){ if(f[k]) return f[k]; }
  }
  return null;
}

function titleOf(rec) {
  return rec.title || rec.title_suggest || rec.name || 'Untitled';
}

function authorOf(rec) {
  if (rec.author) return rec.author;
  if (rec.author_name && rec.author_name.length) return rec.author_name[0];
  if (rec.authors && rec.authors.length) return rec.authors[0].name || rec.authors[0];
  return '';
}

function hrefOf(rec) {
  // Use OL work/edition link when available
  if (rec.key) return `https://openlibrary.org${rec.key}`;
  if (rec.ol_key) return `https://openlibrary.org${rec.ol_key}`;
  return '#';
}

module.exports = function normalizeBooks(records = []) {
  return records.map(rec => ({
    title: titleOf(rec),
    author: authorOf(rec),
    cover: coverFrom(rec),
    cover_i: rec.cover_i,
    isbn: rec.isbn,
    openLibraryId: rec.olid || rec.openLibraryId,
    href: hrefOf(rec),
    description: rec.first_sentence || rec.subtitle || rec.description || ''
  }));
};

module.exports.fromPlain = function fromPlain(arr = []) {
  return arr.map(x => ({
    title: x.title || 'Untitled',
    author: x.author || '',
    cover: x.cover || null,
    cover_i: x.cover_i,
    isbn: x.isbn,
    openLibraryId: x.openLibraryId || x.olid,
    href: x.href || '#',
    description: x.description || ''
  }));
};
