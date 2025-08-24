// connectors/wikisource.js
// Wikisource connector that returns HTML-readable works we can render inline
// at /read/wikisource/:lang/:title/reader (a template we'll wire in routes next).
//
// It uses the public MediaWiki API on <lang>.wikisource.org.
//
// Exposed functions:
//   - searchWikisource(q, { limit=40, lang='en' })  -> cards[]
//   - getWikisourceHtml(lang, title)                -> { title, html }
//
// Card shape:
// {
//   identifier: 'wikisource:en:Title_of_work',
//   title: 'Title of work',
//   creator: '',                 // unknown unless we fetch templates — keep empty
//   cover: 'https://...thumb.jpg'| '',
//   source: 'wikisource',
//   readerUrl: '/read/wikisource/en/Title_of_work/reader'
// }

const DEFAULT_LANG = 'en';

function safeLang(lang) {
  const L = String(lang || '').toLowerCase().trim();
  return /^[a-z-]{2,8}$/.test(L) ? L : DEFAULT_LANG;
}

function apiBase(lang) {
  return `https://${safeLang(lang)}.wikisource.org/w/api.php`;
}

function siteBase(lang) {
  return `https://${safeLang(lang)}.wikisource.org`;
}

function toTitle(s) {
  // MediaWiki canonicalizes spaces to underscores in URLs
  return String(s || '').trim().replace(/ /g, '_');
}

function fromTitle(s) {
  return String(s || '').replace(/_/g, ' ');
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function buildCard(lang, title, thumbUrl = '') {
  const t = toTitle(title);
  return {
    identifier: `wikisource:${safeLang(lang)}:${t}`,
    title: fromTitle(t),
    creator: '',
    cover: thumbUrl || '',
    source: 'wikisource',
    readerUrl: `/read/wikisource/${safeLang(lang)}/${encodeURIComponent(t)}/reader`
  };
}

/**
 * Search Wikisource for pages matching q.
 * We fetch titles via list=search, then batch-fetch thumbnails via prop=pageimages.
 */
async function searchWikisource(q, { limit = 40, lang = DEFAULT_LANG } = {}) {
  const cleanQ = String(q || '').trim();
  if (!cleanQ) return [];

  const srlimit = Math.min(Math.max(limit, 1), 100);
  const searchURL = `${apiBase(lang)}?action=query&list=search&srsearch=${encodeURIComponent(cleanQ)}&srlimit=${srlimit}&format=json&origin=*`;

  const r = await fetch(searchURL, {
    headers: { 'User-Agent': 'BookLantern/1.0 (+booklantern.org)' }
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Wikisource search ${r.status} ${r.statusText} ${txt.slice(0,150)}`);
  }
  const data = await r.json();
  const hits = Array.isArray(data?.query?.search) ? data.query.search : [];
  if (!hits.length) return [];

  const titles = hits.map(h => h.title).filter(Boolean);
  // Batch-fetch thumbnails
  const thumbs = await fetchThumbnails(lang, titles, 400);

  return titles.map(t => buildCard(lang, t, thumbs[toTitle(t)] || ''));
}

/**
 * Batch-fetch thumbnails for a list of page titles.
 * Returns a map: normalizedTitle -> thumb URL (if any)
 */
async function fetchThumbnails(lang, titles, size = 400) {
  const out = {};
  const groups = chunk(titles, 50); // MediaWiki title cap per query
  for (const group of groups) {
    const titlesParam = group.map(encodeURIComponent).join('|');
    const url = `${apiBase(lang)}?action=query&prop=pageimages&format=json&pithumbsize=${size}&titles=${titlesParam}&origin=*`;
    const r = await fetch(url, { headers: { 'User-Agent': 'BookLantern/1.0 (+booklantern.org)' } });
    if (!r.ok) continue;
    const data = await r.json();
    const pages = data?.query?.pages || {};
    for (const pid of Object.keys(pages)) {
      const p = pages[pid];
      if (!p || !p.title) continue;
      const key = toTitle(p.title);
      if (p.thumbnail && p.thumbnail.source) out[key] = p.thumbnail.source;
    }
  }
  return out;
}

/**
 * Get parsed HTML for a Wikisource page.
 * We use action=parse&prop=text which returns HTML for the page body.
 * We sanitize by removing <script> and <style> and fixing relative links.
 */
async function getWikisourceHtml(lang, title) {
  const L = safeLang(lang);
  const T = toTitle(title);
  const url = `${apiBase(L)}?action=parse&page=${encodeURIComponent(T)}&prop=text&format=json&origin=*`;
  const r = await fetch(url, { headers: { 'User-Agent': 'BookLantern/1.0 (+booklantern.org)' } });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Wikisource parse ${r.status} ${r.statusText} ${txt.slice(0,150)}`);
  }
  const data = await r.json();
  const rawHtml = data?.parse?.text?.['*'] || '';
  const cleaned = sanitizeHtml(rawHtml, L);
  return { title: fromTitle(T), html: cleaned };
}

function sanitizeHtml(html, lang) {
  // 1) strip <script> and <style>
  let s = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  // 2) make relative links absolute to Wikisource, keep anchors
  const base = siteBase(lang);
  // href="/wiki/..." -> absolute
  s = s.replace(/href="\/wiki\/([^"]+)"/g, (m, p1) => `href="${base}/wiki/${p1}" target="_blank" rel="noopener"`);
  // src="//upload.wikimedia.org/..." -> https:
  s = s.replace(/src="\/\/([^"]+)"/g, 'src="https://$1"');

  // 3) optional: confine tables/images max-width in our reader CSS — handled in the reader template
  return s;
}

module.exports = {
  searchWikisource,
  getWikisourceHtml
};
