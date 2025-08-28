// connectors/wikisource.js
// Finds Wikisource pages that are likely complete works and opens in HTML mode.

const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';

// Very small heuristic: prefer the title match on the language you pass in; default en
function cardFromTitle(lang, title, subtitle = '', thumb = '') {
  return {
    identifier: `wikisource:${lang}:${title}`,
    title: title || '(Untitled)',
    creator: subtitle || '',
    cover: thumb || '',
    source: 'wikisource',
    readerUrl: `/read/wikisource/${encodeURIComponent(lang)}/${encodeURIComponent(title)}/reader`
  };
}

async function searchWikisource(q, limit = 20, lang = 'en') {
  try {
    const api = `https://${lang}.wikisource.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=${limit}&prop=pageimages|description&piprop=thumbnail&pithumbsize=400&format=json&origin=*`;
    const r = await fetch(api, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    const data = await r.json();
    const pages = data?.query?.pages || {};
    const out = [];
    for (const k of Object.keys(pages)) {
      const p = pages[k];
      if (!p || !p.title) continue;
      // Skip obvious index/author/category pages
      if (/^(Index|Author|Category):/i.test(p.title)) continue;
      out.push(cardFromTitle(lang, p.title, p.description || '', p.thumbnail?.source || ''));
    }
    return out;
  } catch (e) {
    console.error('[wikisource] search error:', e);
    return [];
  }
}

module.exports = { searchWikisource };
