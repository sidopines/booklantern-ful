// routes/index.js
const express = require('express');
const router = express.Router();

// ---- config
const ROW = 12;                 // items per shelf
const CACHE_TTL = 1000 * 60 * 30; // 30 min cache

// simple in-memory cache
const cache = new Map();
const setCache = (k,v)=>cache.set(k,{v,ts:Date.now()});
const getCache = (k)=>{ const e=cache.get(k); if(!e) return null; if(Date.now()-e.ts>CACHE_TTL){cache.delete(k);return null;} return e.v; };

// ---- providers
async function fetchOpenLibrary(q, subject=null, limit=60){
  const url = new URL('https://openlibrary.org/search.json');
  if (q) url.searchParams.set('q', q);
  if (subject) url.searchParams.set('subject', subject);
  url.searchParams.set('limit', String(limit));
  const r = await fetch(url, { headers:{'User-Agent':'BookLantern/1.0'} });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.docs||[]).map(d=>{
    const title  = d.title || '';
    const author = (d.author_name && d.author_name[0]) || '';
    const olid   = (d.cover_edition_key || d.edition_key?.[0] || d.key || '').toString();
    const cover  = d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`
                 : (olid ? `https://covers.openlibrary.org/b/olid/${olid}-L.jpg` : null);
    const key    = d.key || '';
    const href   = key ? `https://openlibrary.org${key}` : '#';
    const subjects = d.subject ? d.subject.slice(0,10) : [];
    return { id:`ol:${olid||key}`, title, author, href, cover, provider:'openlibrary', subjects };
  });
}
async function fetchGutenberg(q, topic=null, limit=60){
  const url = new URL('https://gutendex.com/books/');
  if (q) url.searchParams.set('search', q);
  if (topic) url.searchParams.set('topic', topic);
  url.searchParams.set('page_size', String(Math.min(limit,32)));
  const r = await fetch(url, { headers:{'User-Agent':'BookLantern/1.0'} });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results||[]).map(b=>{
    const title = b.title || '';
    const author = (b.authors && b.authors[0] && b.authors[0].name) || '';
    const cover = (b.formats && (b.formats['image/jpeg'] || b.formats['image/png'])) || null;
    const href  = b.formats && (b.formats['text/html; charset=utf-8'] || b.formats['text/html'] || b.formats['application/epub+zip'] || b.formats['text/plain; charset=utf-8'] || b.formats['text/plain']) || '#';
    const subjects = b.subjects || [];
    return { id:`pg:${b.id}`, title, author, href, cover, provider:'gutenberg', subjects };
  });
}
async function fetchArchiveOrg(q, limit=60){
  const params = new URLSearchParams({
    q: `${q||''} AND mediatype:texts`,
    fl: 'identifier,title,creator,subject',
    rows: String(limit),
    output: 'json',
    sort: 'downloads desc'
  });
  const r = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`, { headers:{'User-Agent':'BookLantern/1.0'} });
  if (!r.ok) return [];
  const j = await r.json();
  const docs = (j && j.response && j.response.docs) || [];
  return docs.map(d=>{
    const id = d.identifier;
    const title = d.title || '';
    const author = Array.isArray(d.creator) ? d.creator[0] : (d.creator || '');
    const cover = `https://archive.org/services/img/${id}`;
    const href  = `https://archive.org/details/${id}`;
    const subjects = Array.isArray(d.subject) ? d.subject : (d.subject ? [d.subject] : []);
    return { id:`ia:${id}`, title, author, href, cover, provider:'archive', subjects };
  });
}
async function fetchLOC(q, limit=60){
  const url = new URL('https://www.loc.gov/books/');
  if (q) url.searchParams.set('q', q);
  url.searchParams.set('fo','json');
  url.searchParams.set('c', String(limit));
  const r = await fetch(url, { headers:{'User-Agent':'BookLantern/1.0'} });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results||[]).map(r=>{
    const title = r.title || '';
    const author = (r.creator && (Array.isArray(r.creator)?r.creator[0]:r.creator)) || '';
    const cover = r.image || (Array.isArray(r.image_url)?r.image_url[0]:r.image_url || null);
    const href  = r.url || '#';
    const subjects = r.subject || [];
    const id = r.id || href;
    return { id:`loc:${id}`, title, author, href, cover, provider:'loc', subjects };
  });
}

// ---- utilities
const norm = s => (s||'').trim().toLowerCase();
function uniquePool(items){
  const byTitle = new Map();
  for (const it of items){
    const k = norm(it.title);
    if (!k) continue;
    if (!it.cover) continue;
    if (!byTitle.has(k)) byTitle.set(k, it);
  }
  return Array.from(byTitle.values());
}
function subjectMatch(item, needles){
  const subs = (item.subjects||[]).map(norm);
  return subs.some(s => needles.some(n => s.includes(n)));
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]];} return a; }

/** take() pulls up to max items that match predicate, while removing them from pool to avoid duplication across shelves */
function take(pool, predicate, max){
  const out = [];
  for (let i=pool.length-1; i>=0 && out.length<max; i--){
    const it = pool[i];
    if (predicate(it)) {
      out.push(it);
      pool.splice(i,1); // remove so other shelves don't reuse it
    }
  }
  return out.reverse(); // keep earlier order
}

// ---- composer
async function buildHomeShelves(){
  const cached = getCache('homeShelves-v2');
  if (cached) return cached;

  const [ol,pg,ia,loc] = await Promise.all([
    fetchOpenLibrary('classic OR popular OR science OR biography'),
    fetchGutenberg('science OR biography OR philosophy OR history'),
    fetchArchiveOrg('science OR biography OR philosophy OR history'),
    fetchLOC('science OR biography OR philosophy OR history')
  ]);

  // unified, unique, shuffled
  let pool = uniquePool(shuffle([...ol, ...pg, ...ia, ...loc]));

  // shelves (mutually exclusive)
  const science = take(pool, it => subjectMatch(it, ['science','physics','astronomy','biology','chemistry','mathematics','geology']), ROW);
  const trending = take(pool, it => subjectMatch(it, ['biography','memoir','science','technology']) || norm(it.author), ROW);
  const philosophy = take(pool, it => subjectMatch(it, ['philosophy','ethics','logic','stoicism','existential']), ROW);
  const history = take(pool, it => subjectMatch(it, ['history','war','civilization','empire']), ROW);

  // If any shelf is thin, top-up with remaining unique items
  function topUp(shelf){
    while (shelf.length < ROW && pool.length){
      shelf.push(pool.shift());
    }
  }
  topUp(science); topUp(trending); topUp(philosophy); topUp(history);

  const payload = { trending, philosophy, history, science };
  setCache('homeShelves-v2', payload);
  return payload;
}

// ---- routes
router.get('/', async (req,res)=>{
  try{
    const { trending, philosophy, history, science } = await buildHomeShelves();
    res.render('index', { trending, philosophy, history, science, buildId: Date.now() });
  }catch(err){
    console.error('home shelves error', err);
    res.status(500).render('error', { code:500, message:'Something went wrong' });
  }
});

router.get('/about', (req,res)=>res.render('about',{ buildId:Date.now() }));
router.get('/contact', (req,res)=>res.render('contact',{ buildId:Date.now() }));

module.exports = router;
