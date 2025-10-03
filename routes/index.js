// routes/index.js
const express = require('express');
const router = express.Router();

/**
 * Unified book shape we render in EJS:
 * { id, title, author, href, cover, provider, subjects[] }
 *
 * Node 18+ has global fetch, so we use it directly.
 */

const SHELF_SIZE = 12;        // items per row
const HERO_COLLAGE_SIZE = 8;  // covers in collage
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

const cache = new Map();
function setCache(key, value) { cache.set(key, { value, t: Date.now() }); }
function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value;
}

// ---------- Provider fetchers ----------

async function fetchOpenLibrary(query, subject = null, limit = 30) {
  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('q', query || '');
  url.searchParams.set('limit', String(limit));
  if (subject) url.searchParams.set('subject', subject);

  const res = await fetch(url, { headers: { 'User-Agent': 'BookLantern/1.0' }});
  if (!res.ok) return [];
  const data = await res.json();

  return (data.docs || []).map(d => {
    const title  = d.title || '';
    const author = (d.author_name && d.author_name[0]) || '';
    const olid   = (d.cover_edition_key || d.edition_key?.[0] || d.key || '').toString();
    const cover  = d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`
                 : (olid ? `https://covers.openlibrary.org/b/olid/${olid}-L.jpg` : null);
    const key    = d.key || ''; // e.g., "/works/OL82563W"
    const href   = key ? `https://openlibrary.org${key}` : '#';
    const subjects = d.subject ? d.subject.slice(0,6) : [];
    return { id: `ol:${olid || key}`, title, author, href, cover, provider: 'openlibrary', subjects };
  });
}

async function fetchGutenberg(query, topic = null, limit = 30) {
  // Gutendex (Project Gutenberg) public API
  const url = new URL('https://gutendex.com/books/');
  if (query) url.searchParams.set('search', query);
  if (topic) url.searchParams.set('topic', topic);
  url.searchParams.set('page_size', String(Math.min(limit, 32)));

  const res = await fetch(url, { headers: { 'User-Agent': 'BookLantern/1.0' }});
  if (!res.ok) return [];
  const data = await res.json();

  return (data.results || []).map(b => {
    const title = b.title || '';
    const author = (b.authors && b.authors[0] && b.authors[0].name) || '';
    const cover = (b.formats && (b.formats['image/jpeg'] || b.formats['image/png'])) || null;
    const href  = b.formats && (b.formats['text/html; charset=utf-8'] || b.formats['text/html'] || b.formats['application/epub+zip'] || b.formats['text/plain; charset=utf-8'] || b.formats['text/plain']) || '#';
    const subjects = b.subjects || [];
    return { id: `pg:${b.id}`, title, author, href, cover, provider: 'gutenberg', subjects };
  });
}

async function fetchArchiveOrg(query, subject = null, limit = 30) {
  // Internet Archive advanced search (public domain books)
  const params = new URLSearchParams({
    q: `${query || ''} AND mediatype:texts`,
    fl: 'identifier,title,creator,subject',
    rows: String(limit),
    output: 'json',
    sort: 'downloads desc'
  });
  const url = `https://archive.org/advancedsearch.php?${params.toString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BookLantern/1.0' }});
  if (!res.ok) return [];
  const data = await res.json();
  const docs = (data && data.response && data.response.docs) || [];

  return docs.map(d => {
    const id = d.identifier;
    const title = d.title || '';
    const author = Array.isArray(d.creator) ? d.creator[0] : (d.creator || '');
    const cover = `https://archive.org/services/img/${id}`;
    const href  = `https://archive.org/details/${id}`;
    const subjects = Array.isArray(d.subject) ? d.subject : (d.subject ? [d.subject] : []);
    return { id: `ia:${id}`, title, author, href, cover, provider: 'archive', subjects };
  });
}

async function fetchLOC(query, subject = null, limit = 30) {
  // Library of Congress digital collections (books)
  const url = new URL('https://www.loc.gov/books/');
  if (query) url.searchParams.set('q', query);
  url.searchParams.set('fo', 'json');
  url.searchParams.set('c', String(limit));

  const res = await fetch(url, { headers: { 'User-Agent': 'BookLantern/1.0' }});
  if (!res.ok) return [];
  const data = await res.json();

  return (data.results || []).map(r => {
    const title = r.title || '';
    const author = (r.creator && (Array.isArray(r.creator) ? r.creator[0] : r.creator)) || '';
    // Prefer provided image; LOC results often include an 'image' or 'image_url'
    const cover = r.image || (Array.isArray(r.image_url) ? r.image_url[0] : (r.image_url || null));
    const href  = r.url || '#';
    const subjects = r.subject || [];
    const id = r.id || href;
    return { id: `loc:${id}`, title, author, href, cover, provider: 'loc', subjects };
  });
}

// ---------- Utilities ----------

function pickUniqueByTitle(items, max) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = (it.title || '').trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    // prefer ones with real cover
    if (!it.cover || /placeholder|default|blank/i.test(it.cover)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

function filterBySubjects(items, keywords) {
  const want = keywords.map(s => s.toLowerCase());
  return items.filter(it => {
    const subs = (it.subjects || []).map(s => (s || '').toLowerCase());
    return subs.some(s => want.some(w => s.includes(w)));
  });
}

// ---------- Home shelves composer ----------

async function buildHomeShelves() {
  const cached = getCache('homeShelves');
  if (cached) return cached;

  // Pull from all providers in parallel (generous limits; we’ll trim later)
  const [olAll, pgAll, iaAll, locAll] = await Promise.all([
    fetchOpenLibrary('classic OR popular OR science OR biography', null, 80),
    fetchGutenberg('science OR biography OR philosophy OR history', null, 80),
    fetchArchiveOrg('science OR biography OR philosophy OR history', null, 80),
    fetchLOC('science OR biography OR philosophy OR history', null, 80)
  ]);

  const all = [...olAll, ...pgAll, ...iaAll, ...locAll];

  // Shelves
  const trending = pickUniqueByTitle(
    [
      ...filterBySubjects(all, ['science', 'physics', 'astronomy']),
      ...filterBySubjects(all, ['biography', 'memoir']),
      ...all
    ],
    SHELF_SIZE
  );

  const philosophy = pickUniqueByTitle(
    [
      ...filterBySubjects(all, ['philosophy', 'ethics', 'logic']),
      ...filterBySubjects(all, ['stoicism', 'existentialism'])
    ],
    SHELF_SIZE
  );

  const history = pickUniqueByTitle(
    [
      ...filterBySubjects(all, ['history', 'war', 'civilization', 'biography'])
    ],
    SHELF_SIZE
  );

  const science = pickUniqueByTitle(
    [
      ...filterBySubjects(all, ['science', 'physics', 'astronomy', 'biology', 'chemistry', 'mathematics', 'geology'])
    ],
    SHELF_SIZE
  );

  // Hero collage: pick striking covers from trending+science
  const collageCandidates = [...trending, ...science, ...philosophy, ...history];
  const collageBooks = pickUniqueByTitle(collageCandidates, HERO_COLLAGE_SIZE);

  const payload = { trending, philosophy, history, science, collageBooks };
  setCache('homeShelves', payload);
  return payload;
}

// ---------- Routes ----------

router.get('/', async (req, res) => {
  try {
    const { trending, philosophy, history, science, collageBooks } = await buildHomeShelves();
    res.render('index', {
      trending,
      philosophy,
      history,
      science,
      collageBooks,
      buildId: Date.now()
    });
  } catch (err) {
    console.error('home shelves error', err);
    res.status(500).render('error', {
      code: 500,
      message: 'Something went wrong'
    });
  }
});

// keep your existing minor pages (about/contact/etc.) if they were here before.
// Example:
router.get('/about', (req, res) => res.render('about', { buildId: Date.now() }));
router.get('/contact', (req, res) => res.render('contact', { buildId: Date.now() }));

module.exports = router;
