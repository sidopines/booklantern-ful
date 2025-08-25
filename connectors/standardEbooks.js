// connectors/standardEbooks.js
// Lightweight OPDS (Atom) fetcher for Standard Ebooks.
// We fetch the master feed and filter titles/authors locally (no API key needed).

const FEED_URL = 'https://standardebooks.org/opds/all';

// tiny helpers to pull fields out of Atom XML without extra deps
function getFirst(text, tag) {
  const m = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}
function getLinks(entry) {
  const links = [];
  const re = /<link\s+([^>]+)>/gi;
  let m;
  while ((m = re.exec(entry))) links.push(m[1]);
  return links;
}
function attr(str, name) {
  const m = str.match(new RegExp(`${name}="([^"]+)"`, 'i'));
  return m ? m[1] : '';
}

async function fetchFeed() {
  const r = await fetch(FEED_URL, { redirect: 'follow' });
  if (!r.ok) throw new Error('StandardEbooks feed error');
  return await r.text();
}

// normalize to your card shape
function cardFromEntry(entry) {
  const title = getFirst(entry, 'title');
  const author = getFirst(entry, 'name') || getFirst(entry, 'author');
  const links = getLinks(entry);

  // EPUB link
  const epub = links
    .map(l => ({ type: attr(l, 'type'), href: attr(l, 'href') }))
    .find(l => /application\/epub\+zip/i.test(l.type))?.href;

  // cover image (optional)
  const cover = links
    .map(l => ({ rel: attr(l, 'rel'), href: attr(l, 'href'), type: attr(l,'type') }))
    .find(l => /image/.test(l.type) && /cover/i.test(l.rel))?.href || '';

  if (!epub) return null;

  return {
    identifier: `se:${title}`,
    title: title || '(Untitled)',
    creator: author || '',
    cover,
    source: 'standardebooks',
    // Internal reader (stays on-site)
    readerUrl: `/read/epub?u=${encodeURIComponent(epub)}&title=${encodeURIComponent(title||'')}&author=${encodeURIComponent(author||'')}`
  };
}

async function searchStandardEbooks(q, limit = 40) {
  const feed = await fetchFeed();
  // split entries
  const entries = feed.split(/<\/entry>/i).map(x => x + '</entry>').filter(x => /<entry/i.test(x));
  const qx = String(q || '').toLowerCase();

  const out = [];
  for (const e of entries) {
    const title = getFirst(e, 'title').toLowerCase();
    const author = getFirst(e, 'name').toLowerCase() || getFirst(e, 'author').toLowerCase();
    if (!qx || title.includes(qx) || author.includes(qx)) {
      const c = cardFromEntry(e);
      if (c) out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}

module.exports = { searchStandardEbooks };
