// connectors/wikisource.js
const UA = 'BookLanternBot/1.0 (+https://booklantern.org)';

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

function isBookLike(page) {
  const title = (page.title || '').toLowerCase();
  const description = (page.description || '').toLowerCase();
  
  // Check for book indicators in title
  const bookIndicators = ['(novel)', '(book)', '(novella)', '(poetry)', '(collection)', '(anthology)', '(volume)', '(part)', '(chapter)'];
  const hasBookIndicator = bookIndicators.some(indicator => title.includes(indicator));
  
  if (hasBookIndicator) {
    return true;
  }
  
  // Check for book-related categories (if available)
  if (page.categories) {
    const bookCategories = ['books', 'novels', 'poetry', 'literature', 'fiction', 'non-fiction'];
    const hasBookCategory = page.categories.some(cat => 
      bookCategories.some(bookCat => cat.toLowerCase().includes(bookCat))
    );
    if (hasBookCategory) {
      return true;
    }
  }
  
  // Check page length (if available)
  if (page.length && page.length >= 50000) { // 50kb threshold
    return true;
  }
  
  // Check for book-like patterns in title (exclude articles, short works)
  const shortWorkPatterns = [
    /^letter\s+/i,
    /^speech\s+/i,
    /^article\s+/i,
    /^essay\s+/i,
    /^poem\s+/i,
    /^sonnet\s+/i,
    /^short\s+story/i,
    /^chapter\s+\d+$/i,
    /^section\s+/i,
    /^part\s+\d+$/i
  ];
  
  const isShortWork = shortWorkPatterns.some(pattern => pattern.test(title));
  if (isShortWork) {
    return false;
  }
  
  // If we can't confidently determine, default to false (exclude)
  return false;
}

async function searchWikisource(q, limit = 20, lang = 'en') {
  try {
    // Enhanced API call to get more metadata including categories and page length
    const api = `https://${lang}.wikisource.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=${limit}&prop=pageimages|description|categories|pageprops&piprop=thumbnail&pithumbsize=400&format=json&origin=*`;
    const r = await fetch(api, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    const data = await r.json();
    const pages = data?.query?.pages || {};
    const out = [];
    
    for (const k of Object.keys(pages)) {
      const p = pages[k];
      if (!p || !p.title) continue;
      if (/^(Index|Author|Category):/i.test(p.title)) continue;
      
      // Filter for book-like content
      if (isBookLike(p)) {
        out.push(cardFromTitle(lang, p.title, p.description || '', p.thumbnail?.source || ''));
      }
    }
    
    console.log(`[wikisource] Found ${Object.keys(pages).length} total results, filtered to ${out.length} book-like items`);
    return out;
  } catch (e) {
    console.error('[wikisource] search error:', e);
    return [];
  }
}

module.exports = { searchWikisource };
