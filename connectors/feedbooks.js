// connectors/feedbooks.js
// Feedbooks Public Domain OPDS search (no key). Results are public-domain EPUBs.

const SEARCH_URL = 'https://www.feedbooks.com/publicdomain/search.atom?query=';

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

async function fetchSearch(q) {
  const r = await fetch(SEARCH_URL + encodeURIComponent(q || ''), { redirect: 'follow' });
  if (!r.ok) throw new Error('Feedbooks search error');
  return await r.text();
}

function cardFromEntry(entry) {
  const title = getFirst(entry, 'title');
  const author = getFirst(entry, 'name') || getFirst(entry, 'author');
  const links = getLinks(entry);

  const epub = links
    .map(l => ({ type: attr(l,'type'), href: attr(l,'href') }))
    .find(l => /application\/epub\+zip/i.test(l.type))?.href;

  const cover = links
    .map(l => ({ rel: attr(l,'rel'), href: attr(l,'href'), type: attr(l,'type') }))
    .find(l => /image/.test(l.type) && /cover/i.test(l.rel))?.href || '';

  if (!epub) return null;

  return {
    identifier: `feedbooks:${title}`,
    title: title || '(Untitled)',
    creator: author || '',
    cover,
    source: 'feedbooks',
    readerUrl: `/read/epub?u=${encodeURIComponent(epub)}&title=${encodeURIComponent(title||'')}&author=${encodeURIComponent(author||'')}`
  };
}

async function searchFeedbooksPD(q, limit = 40) {
  const xml = await fetchSearch(q);
  const entries = xml.split(/<\/entry>/i).map(x => x + '</entry>').filter(x => /<entry/i.test(x));
  const out = [];
  for (const e of entries) {
    const c = cardFromEntry(e);
    if (c) out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { searchFeedbooksPD };
