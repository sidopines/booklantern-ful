// CSP-safe delegated image error handler (replaces inline onerror)
document.addEventListener('error', function(e) {
  var img = e.target;
  if (img && img.tagName === 'IMG') {
    var fb = img.getAttribute('data-fallback');
    if (fb && img.src !== fb && !img.src.endsWith(fb)) img.src = fb;
  }
}, true);

document.addEventListener('DOMContentLoaded', () => {
  const q = new URLSearchParams(location.search).get('q') || '';
  const box = document.querySelector('input[name="q"]');
  if (box) box.value = q;
  
  let mount = document.getElementById('results');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'results';
    mount.className = 'results-grid';
    (document.querySelector('.reader-intro') || document.querySelector('main') || document.body).appendChild(mount);
  }
  
  // Track favorited book keys
  const favoritedBooks = new Set();
  
  // Only show Continue Reading + Favorites shelves when there is NO search query
  if (!q) {
    // Load Continue Reading shelf
    loadContinueReading();
    
    // Load Favorites shelf
    loadFavorites();
  } else {
    // Hide shelves when showing search results
    const crShelf = document.getElementById('continue-reading-shelf');
    if (crShelf) crShelf.style.display = 'none';
    const favShelf = document.getElementById('favorites-shelf');
    if (favShelf) favShelf.style.display = 'none';
    // Still populate favoritedBooks set so heart buttons work on search results
    loadFavoritedSet();
  }
  
  // Helper to normalize URLs (handles missing scheme, //prefix, www prefix, etc)
  function normalizeUrl(u) {
    if (typeof u !== 'string') return null;
    let url = u.trim();
    if (!url) return null;
    
    // Accept http:// or https://
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    // //example.com → https://example.com
    if (url.startsWith('//')) {
      return 'https:' + url;
    }
    // www.example.com → https://www.example.com
    if (url.startsWith('www.')) {
      return 'https://' + url;
    }
    // directory.doabooks.org/... → https://directory.doabooks.org/...
    if (url.startsWith('directory.doabooks.org')) {
      return 'https://' + url;
    }
    // library.oapen.org/... → https://library.oapen.org/...
    if (url.startsWith('library.oapen.org')) {
      return 'https://' + url;
    }
    // oapen.org/... → https://oapen.org/...
    if (url.startsWith('oapen.org')) {
      return 'https://' + url;
    }
    return null;
  }
  
  /**
   * Load Continue Reading shelf
   */
  function loadContinueReading() {
    const shelf = document.getElementById('continue-reading-shelf');
    const container = document.getElementById('continue-reading-items');
    if (!shelf || !container) return;
    
    fetch('/api/reading/continue?limit=10', { credentials: 'include' })
      .then(r => {
        if (!r.ok) return { items: [] };
        return r.json();
      })
      .then(data => {
        if (!data.items || data.items.length === 0) {
          shelf.style.display = 'none';
          return;
        }
        
        shelf.style.display = 'block';
        // Dedupe by provider+bookKey first, then by normalized title
        var seenKeys = {};
        var seenTitles = {};
        var uniqueItems = data.items.filter(function(item) {
          // Primary dedup: provider + bookKey
          var pkey = ((item.source || 'unknown') + ':' + (item.bookKey || '')).toLowerCase();
          if (pkey && pkey !== 'unknown:' && seenKeys[pkey]) return false;
          if (pkey && pkey !== 'unknown:') seenKeys[pkey] = true;

          // Secondary dedup: normalized title
          var key = (item.title || '').trim().toLowerCase();
          if (key && seenTitles[key]) return false;
          if (key) seenTitles[key] = true;
          return true;
        });
        container.innerHTML = uniqueItems.map(item => {
          const cover = item.cover || '/public/img/cover-fallback.svg';
          const url = item.openUrl || item.readerUrl || '#';
          const progress = item.progress || 0;
          return `
            <a href="${url}" class="shelf-card">
              <div class="card-cover">
                <img src="${cover}" alt="" loading="lazy" data-fallback="/public/img/cover-fallback.svg">
              </div>
              <div class="card-title">${escapeHtml(item.title)}</div>
              ${item.author ? `<div class="card-author">${escapeHtml(item.author)}</div>` : ''}
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${progress}%"></div>
              </div>
            </a>
          `;
        }).join('');
      })
      .catch(err => {
        console.warn('[read-search] Continue reading load failed:', err);
        shelf.style.display = 'none';
      });
  }
  
  /**
   * Load Favorites shelf (also populates favoritedBooks set)
   */
  function loadFavorites() {
    const shelf = document.getElementById('favorites-shelf');
    const container = document.getElementById('favorites-items');
    if (!shelf || !container) return;
    
    fetch('/api/reading/favorites?limit=10', { credentials: 'include' })
      .then(r => {
        if (!r.ok) return { items: [] };
        return r.json();
      })
      .then(data => {
        // Populate the favorited set
        if (data.items) {
          data.items.forEach(item => favoritedBooks.add(item.bookKey));
        }
        
        if (!data.items || data.items.length === 0) {
          shelf.style.display = 'none';
          return;
        }
        
        shelf.style.display = 'block';
        container.innerHTML = data.items.map(item => {
          const cover = item.cover || '/public/img/cover-fallback.svg';
          const url = item.openUrl || item.readerUrl || '#';
          return `
            <a href="${url}" class="shelf-card">
              <div class="card-cover">
                <img src="${cover}" alt="" loading="lazy" data-fallback="/public/img/cover-fallback.svg">
              </div>
              <div class="card-title">${escapeHtml(item.title)}</div>
              ${item.author ? `<div class="card-author">${escapeHtml(item.author)}</div>` : ''}
            </a>
          `;
        }).join('');
      })
      .catch(err => {
        console.warn('[read-search] Favorites load failed:', err);
        shelf.style.display = 'none';
      });
  }
  
  /**
   * Lightweight: just populate favoritedBooks set (for search result heart buttons)
   * without rendering the shelf
   */
  function loadFavoritedSet() {
    fetch('/api/reading/favorites?limit=100', { credentials: 'include' })
      .then(r => { if (!r.ok) return { items: [] }; return r.json(); })
      .then(data => {
        if (data.items) {
          data.items.forEach(item => favoritedBooks.add(item.bookKey));
        }
      })
      .catch(() => {});
  }
  
  /**
   * Toggle favorite status for a book
   * @param {HTMLElement} btn - The favorite button element with data attributes
   */
  function toggleFavorite(btn) {
    // Robust guard: ensure btn is a valid DOM element
    if (!btn || typeof btn.classList === 'undefined') {
      console.error('[read-search] toggleFavorite called with invalid button:', btn);
      return;
    }
    
    // Read metadata from button dataset (or fallback to closest card)
    const card = btn.closest('.book-card');
    const bookKey = btn.dataset.bookKey || (card && card.dataset.archiveId ? 'bl-book-' + card.dataset.archiveId : null);
    
    if (!bookKey) {
      console.error('[read-search] toggleFavorite: no bookKey found');
      return;
    }
    
    const title = btn.dataset.title || (card && card.dataset.title) || '';
    const author = btn.dataset.author || (card && card.dataset.author) || '';
    const cover = btn.dataset.cover || (card && card.dataset.cover) || '';
    const readerUrl = btn.dataset.readerUrl || '';
    
    const isFavorited = btn.classList.contains('favorited');
    
    fetch('/api/reading/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        bookKey: bookKey,
        title: title,
        author: author,
        cover: cover,
        readerUrl: readerUrl
      })
    })
    .then(r => {
      if (!r.ok) {
        console.error('[read-search] Favorite toggle HTTP error:', r.status, r.statusText);
        return r.text().then(txt => { throw new Error(txt || r.statusText); });
      }
      return r.json();
    })
    .then(data => {
      if (data.favorited) {
        btn.classList.add('favorited');
        favoritedBooks.add(bookKey);
      } else {
        btn.classList.remove('favorited');
        favoritedBooks.delete(bookKey);
      }
    })
    .catch(err => {
      console.error('[read-search] Favorite toggle failed:', err);
    });
  }
  
  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  
  /**
   * Generate a bookKey from item data
   * Uses bl-book-<archive_id> for archive items (matches reader.js)
   */
  function generateBookKey(item) {
    if (item.archive_id) return 'bl-book-' + item.archive_id;
    if (item.identifier && (item.provider === 'archive' || (item.source_url || '').includes('archive.org')))
      return 'bl-book-' + item.identifier;
    if (item.identifier) return item.provider + '-' + item.identifier;
    if (item.id) return item.provider + '-' + item.id;
    // Hash the title+author as fallback
    const str = (item.title || '') + (item.author || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return 'book-' + Math.abs(hash);
  }
  
  // Helper to extract external URL from item (tries all common field variants)
  // Uses minimal normalization to avoid losing valid URLs
  function pickExternalUrl(item) {
    const candidates = [
      item.open_access_url,
      item.source_url,
      item.open_access_url?.url,  // if ever nested
      item.source_url?.url,       // if ever nested
      item.landing_url,
      item.open_url,
      item.url
    ];
    for (const u of candidates) {
      if (typeof u === 'string') {
        const s = u.trim();
        if (s.startsWith('http://') || s.startsWith('https://')) return s;
        if (s.startsWith('//')) return 'https:' + s;
        if (s.startsWith('www.')) return 'https://' + s;
      }
    }
    return null;
  }
  
  // Alias for backward compatibility
  const getExternalUrl = pickExternalUrl;
  
  // Helper to extract Archive.org identifier from URL
  function extractArchiveId(url) {
    if (!url || typeof url !== 'string') return null;
    if (!url.includes('archive.org')) return null;
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(Boolean);
      // /details/identifier or /download/identifier
      const idx = parts.findIndex(p => p === 'details' || p === 'download');
      if (idx !== -1 && parts[idx + 1]) {
        return parts[idx + 1];
      }
    } catch {
      return null;
    }
    return null;
  }
  
  // Create toast container for unavailable items - NO mention of borrow/restricted
  let toastContainer = document.getElementById('external-toast');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'external-toast';
    toastContainer.className = 'external-toast hidden';
    toastContainer.innerHTML = `
      <div class="toast-content">
        <button class="toast-close" aria-label="Close">&times;</button>
        <h4>This title can't be opened on BookLantern right now</h4>
        <p class="toast-suggestion">Try searching for a different edition of this book.</p>
        <button class="toast-close-btn">OK</button>
      </div>
    `;
    document.body.appendChild(toastContainer);
    
    // Close button handler
    toastContainer.querySelector('.toast-close').addEventListener('click', () => {
      toastContainer.classList.add('hidden');
    });
    
    // OK button handler
    const closeBtn = toastContainer.querySelector('.toast-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        toastContainer.classList.add('hidden');
      });
    }
    
    // Click outside to close
    toastContainer.addEventListener('click', (e) => {
      if (e.target === toastContainer) {
        toastContainer.classList.add('hidden');
      }
    });
    
    // Add styles for the toast
    const style = document.createElement('style');
    style.textContent = `
      .external-toast {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        padding: 16px;
      }
      .external-toast.hidden { display: none; }
      .toast-content {
        background: #fff;
        border-radius: 12px;
        padding: 24px;
        max-width: 400px;
        width: 100%;
        position: relative;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      }
      .toast-close {
        position: absolute;
        top: 12px; right: 12px;
        border: none;
        background: none;
        font-size: 24px;
        cursor: pointer;
        color: #666;
        line-height: 1;
      }
      .toast-close:hover { color: #000; }
      .toast-content h4 {
        margin: 0 0 12px;
        font-size: 18px;
        color: #1a1a1a;
      }
      .toast-content p {
        margin: 8px 0;
        font-size: 14px;
        color: #666;
      }
      .toast-suggestion {
        font-style: italic;
        color: #888;
      }
      .toast-close-btn {
        display: inline-block;
        margin-top: 12px;
        padding: 10px 24px;
        background: #4f46e5;
        color: #fff;
        border: none;
        border-radius: 8px;
        font-weight: 500;
        cursor: pointer;
      }
      .toast-close-btn:hover { background: #4338ca; }
      
      /* Unavailable card styling - subtle, not attention-grabbing */
      .book-card.unavailable {
        opacity: 0.6;
        cursor: default;
        pointer-events: none;
      }
      .book-card.unavailable .card-cta {
        color: #9ca3af;
        font-size: 12px;
      }
      .format-badge.unavailable-badge {
        background: #e5e7eb;
        color: #6b7280;
        font-size: 10px;
        padding: 2px 6px;
      }
      /* Clickable book cards (readable) */
      .book-card.readable-card {
        cursor: pointer;
      }
      .book-card.readable-card:focus {
        outline: 2px solid #4f46e5;
        outline-offset: 2px;
      }
    `;
    document.head.appendChild(style);
  }
  
  // Helper to show unavailable toast - NO mention of borrow/restricted
  function showUnavailableToast() {
    const toast = document.getElementById('external-toast');
    toast.classList.remove('hidden');
  }

  // Handle image error without inline onerror (CSP-safe)
  // If fallback also fails, generate an SVG placeholder with title/author
  function handleImageError(img) {
    img.style.display = 'none';
  }
  
  // Generate an SVG placeholder cover with title/author text
  function generatePlaceholderSvg(title, author) {
    const safeTitle = (title || 'Book').substring(0, 30).replace(/[<>&"']/g, '');
    const safeAuthor = (author || '').substring(0, 25).replace(/[<>&"']/g, '');
    // Use gradient background with readable text
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180" viewBox="0 0 120 180">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#4f46e5"/>
          <stop offset="100%" style="stop-color:#7c3aed"/>
        </linearGradient>
      </defs>
      <rect width="120" height="180" fill="url(#bg)" rx="4"/>
      <text x="60" y="75" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="11" font-weight="600">
        <tspan x="60" dy="0">${safeTitle.substring(0, 15)}</tspan>
        ${safeTitle.length > 15 ? '<tspan x="60" dy="14">' + safeTitle.substring(15, 30) + '</tspan>' : ''}
      </text>
      ${safeAuthor ? '<text x="60" y="140" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-family="system-ui,sans-serif" font-size="9">' + safeAuthor + '</text>' : ''}
    </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }
  
  if (q) {
    fetch('/api/search?q=' + encodeURIComponent(q))
      .then(async (r) => {
        if (r.status === 401) {
          const next = '/read?q=' + encodeURIComponent(q);
          window.location.href = '/login?next=' + encodeURIComponent(next);
          return Promise.reject(new Error('auth_required'));
        }
        if (!r.ok) throw new Error('Search request failed: ' + r.status);
        return r.json();
      })
      .then(data => {
        const items = Array.isArray(data.items)
          ? data.items
          : Array.isArray(data.results)
            ? data.results
            : Array.isArray(data.docs)
              ? data.docs
              : [];

        if (!items.length) { mount.innerHTML = '<p>No results.</p>'; return; }

        // Debug: log provider counts and readable status
        const providerCounts = {};
        const readableCounts = { readable: 0, maybe: 0, unavailable: 0 };
        items.forEach(i => { 
          providerCounts[i.provider || 'unknown'] = (providerCounts[i.provider || 'unknown'] || 0) + 1;
          if (i.readable === true || i.readable === 'true') {
            readableCounts.readable++;
          } else if (i.readable_status === 'maybe' || i.external_only === false) {
            readableCounts.maybe++;
          } else {
            readableCounts.unavailable++;
          }
        });
        console.log('[read-search] provider counts:', providerCounts);
        console.log('[read-search] readable counts:', readableCounts);
        
        mount.innerHTML = items.map((item, idx) => {
          // Always show title and author with fallbacks
          const title = item.title || 'Untitled';
          const authorText = item.author || 'Unknown author';
          const provider = item.provider ? `<span class="provider-badge provider-${item.provider}">${item.provider}</span>` : '';
          
          // Cover image - CSP-safe with data-fallback for error handling
          const coverUrl = item.cover_url || '/public/img/cover-fallback.svg';
          const cover = `<img src="${coverUrl}" alt="" data-fallback="/public/img/cover-fallback.svg">`;
          
          // Check if this item can be read on BookLantern
          // Determine readable by: explicit readable flag, or presence of an /open href
          const hasHref = typeof item.href === 'string' && item.href.length > 1;
          const isReadable = (item.readable === true) || (hasHref && item.href.startsWith('/open'));
          
          // Compute provider for catalog/doab detection
          const providerLower = (item.provider || item.source || item.collection || '').toLowerCase();
          const isCatalogOrDoab = providerLower.includes('catalog') || providerLower.includes('doab');
          const isArchive = providerLower.includes('archive');
          
          // Check for external URL using comprehensive helper
          const externalUrl = pickExternalUrl(item);
          
          // Extract Archive.org identifier if present
          const archiveId = item.archive_id || item.identifier || (isArchive && externalUrl ? extractArchiveId(externalUrl) : null);
          
          // For Archive items, use the thumbnail service for covers
          let finalCoverUrl = coverUrl;
          let archiveFallbackUrl = null;
          if (isArchive && archiveId) {
            // Always set Archive.org thumbnail as primary or fallback
            archiveFallbackUrl = 'https://archive.org/services/img/' + encodeURIComponent(archiveId);
            if (coverUrl === '/public/img/cover-fallback.svg' || !item.cover_url) {
              finalCoverUrl = archiveFallbackUrl;
            }
          }
          // Set fallback chain: Archive thumbnail (if archive) -> default placeholder
          const fallbackUrl = archiveFallbackUrl || '/public/img/cover-fallback.svg';
          const finalCover = `<img src="${finalCoverUrl}" alt="" data-fallback="${fallbackUrl}" data-title="${title.replace(/"/g, '&quot;')}" data-author="${authorText.replace(/"/g, '&quot;')}">`;
          
          // Show format badge for non-EPUB items (PDF, etc)
          const formatBadge = (item.format && item.format !== 'epub' && item.format !== 'unknown')
            ? `<span class="format-badge">${item.format.toUpperCase()}</span>`
            : '';
          
          // Escape HTML to prevent XSS
          const escapeHtml = (str) => {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
          };
          const escapedTitle = escapeHtml(title);
          const escapedAuthor = escapeHtml(authorText);
          
          // DECISION TREE:
          // 0. If Archive item with identifier -> render as internal archive card
          if (isArchive && archiveId) {
            const escapedCover = (finalCoverUrl || '').replace(/"/g, '&quot;');
            const bookKey = 'bl-book-' + archiveId;
            const isFavorited = favoritedBooks.has(bookKey) || favoritedBooks.has('archive-' + archiveId);
            const archiveOpenUrl = '/open?provider=archive&provider_id=' + encodeURIComponent(archiveId) + '&title=' + encodeURIComponent(escapedTitle) + '&author=' + encodeURIComponent(escapedAuthor) + '&cover=' + encodeURIComponent(escapedCover);
            const favBtn = `<button class="favorite-btn${isFavorited ? ' favorited' : ''}" data-favorite-btn="1" data-book-key="${bookKey}" data-title="${escapedTitle}" data-author="${escapedAuthor}" data-cover="${escapedCover}" data-reader-url="${archiveOpenUrl}" aria-label="Add to favorites">
                              <svg viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                            </button>`;
            return `<a class="book-card archive-card" href="#" 
                       data-archive-id="${archiveId}" 
                       data-title="${escapedTitle}"
                       data-author="${escapedAuthor}"
                       data-cover="${escapedCover}"
                       data-provider="archive"
                       data-item-idx="${idx}">
                      ${favBtn}
                      <span class="format-badge archive-badge">ARCHIVE</span>
                      ${provider}
                      <div class="card-cover">${finalCover}</div>
                      <div class="card-title">${escapedTitle}</div>
                      <div class="card-author">${escapedAuthor}</div>
                      <div class="card-cta"><span>Read</span></div>
                    </a>`;
          }
          
          // 1. If catalog/doab/oapen with external URL -> render as internal card that resolves PDF on click
          if (isCatalogOrDoab && externalUrl) {
            const escapedUrl = externalUrl.replace(/"/g, '&quot;');
            const escapedCover = (coverUrl || '').replace(/"/g, '&quot;');
            const bookKey = generateBookKey(item);
            const isFavorited = favoritedBooks.has(bookKey);
            const favBtn = `<button class="favorite-btn${isFavorited ? ' favorited' : ''}" data-favorite-btn="1" data-book-key="${bookKey}" data-title="${escapedTitle}" data-author="${escapedAuthor}" data-cover="${escapedCover}" data-reader-url="${escapedUrl}" aria-label="Add to favorites">
                              <svg viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                            </button>`;
            return `<a class="book-card external-card" href="#" 
                       data-landing-url="${escapedUrl}" 
                       data-title="${escapedTitle}"
                       data-author="${escapedAuthor}"
                       data-cover="${escapedCover}"
                       data-provider="${item.provider || 'catalog'}"
                       data-item-idx="${idx}">
                      ${favBtn}
                      <span class="format-badge external-badge">CATALOG</span>
                      ${provider}
                      <div class="card-cover">${finalCover}</div>
                      <div class="card-title">${escapedTitle}</div>
                      <div class="card-author">${escapedAuthor}</div>
                      <div class="card-cta"><span>Read</span></div>
                    </a>`;
          }
          
          // 2. If readable on BookLantern -> internal reader link
          if (isReadable) {
            const url = new URL(item.href, window.location.origin);
            url.searchParams.set('ref', location.pathname + location.search);
            const href = url.pathname + url.search;
            const bookKey = generateBookKey(item);
            const isFavorited = favoritedBooks.has(bookKey);
            const escapedCover = (finalCoverUrl || '').replace(/"/g, '&quot;');
            const favBtn = `<button class="favorite-btn${isFavorited ? ' favorited' : ''}" data-favorite-btn="1" data-book-key="${bookKey}" data-title="${escapedTitle}" data-author="${escapedAuthor}" data-cover="${escapedCover}" data-reader-url="${href}" aria-label="Add to favorites">
                              <svg viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                            </button>`;
            return `<a class="book-card readable-card" href="${href}" data-item-idx="${idx}">
                      ${favBtn}
                      ${formatBadge}
                      ${provider}
                      <div class="card-cover">${finalCover}</div>
                      <div class="card-title">${escapedTitle}</div>
                      <div class="card-author">${escapedAuthor}</div>
                      <div class="card-cta"><span>Read</span></div>
                    </a>`;
          }
          
          // 3. If has external URL -> render as internal card (never open externally)
          if (externalUrl) {
            const escapedUrl = externalUrl.replace(/"/g, '&quot;');
            const escapedCover = (finalCoverUrl || '').replace(/"/g, '&quot;');
            // Check if it's an Archive URL we can try to resolve
            const possibleArchiveId = extractArchiveId(externalUrl);
            if (possibleArchiveId) {
              const bookKey = 'bl-book-' + possibleArchiveId;
              const isFavorited = favoritedBooks.has(bookKey) || favoritedBooks.has('archive-' + possibleArchiveId);
              const archiveOpenUrl2 = '/open?provider=archive&provider_id=' + encodeURIComponent(possibleArchiveId) + '&title=' + encodeURIComponent(escapedTitle) + '&author=' + encodeURIComponent(escapedAuthor) + '&cover=' + encodeURIComponent(escapedCover);
              const favBtn = `<button class="favorite-btn${isFavorited ? ' favorited' : ''}" data-favorite-btn="1" data-book-key="${bookKey}" data-title="${escapedTitle}" data-author="${escapedAuthor}" data-cover="${escapedCover}" data-reader-url="${archiveOpenUrl2}" aria-label="Add to favorites">
                                <svg viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                              </button>`;
              return `<a class="book-card archive-card" href="#" 
                         data-archive-id="${possibleArchiveId}" 
                         data-title="${escapedTitle}"
                         data-author="${escapedAuthor}"
                         data-cover="${escapedCover}"
                         data-provider="archive"
                         data-item-idx="${idx}">
                        ${favBtn}
                        <span class="format-badge archive-badge">ARCHIVE</span>
                        ${provider}
                        <div class="card-cover">${finalCover}</div>
                        <div class="card-title">${escapedTitle}</div>
                        <div class="card-author">${escapedAuthor}</div>
                        <div class="card-cta"><span>Read</span></div>
                      </a>`;
            }
            // Non-archive external URL - still keep on site via fallback
            const bookKey = generateBookKey(item);
            const isFavorited = favoritedBooks.has(bookKey);
            const favBtn = `<button class="favorite-btn${isFavorited ? ' favorited' : ''}" data-favorite-btn="1" data-book-key="${bookKey}" data-title="${escapedTitle}" data-author="${escapedAuthor}" data-cover="${escapedCover}" data-reader-url="${escapedUrl}" aria-label="Add to favorites">
                              <svg viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                            </button>`;
            return `<a class="book-card external-card" href="#"
                       data-external-url="${escapedUrl}" 
                       data-title="${escapedTitle}"
                       data-author="${escapedAuthor}"
                       data-cover="${escapedCover}"
                       data-provider="${item.provider || 'external'}"
                       data-item-idx="${idx}">
                      ${favBtn}
                      <span class="format-badge external-badge">External</span>
                      ${provider}
                      <div class="card-cover">${finalCover}</div>
                      <div class="card-title">${escapedTitle}</div>
                      <div class="card-author">${escapedAuthor}</div>
                      <div class="card-cta"><span>Read</span></div>
                    </a>`;
          }
          
          // 4. Otherwise -> unavailable (no link, non-clickable)
          return `<div class="book-card unavailable" data-item-idx="${idx}" data-disabled="true">
                    <span class="format-badge unavailable-badge">Unavailable</span>
                    ${provider}
                    <div class="card-cover">${finalCover}</div>
                    <div class="card-title">${escapedTitle}</div>
                    <div class="card-author">${escapedAuthor}</div>
                  </div>`;
        }).join('');
        
        // Delegated click handler for results container (CSP-safe, no inline handlers)
        mount.addEventListener('click', handleCardClick);
        mount.addEventListener('keydown', handleCardKeydown);
        
        // Add error handlers for cover images (CSP-safe, no inline onerror)
        // On first error: try data-fallback (Archive.org thumbnail service or default)
        // On second error: generate SVG placeholder with title/author
        mount.querySelectorAll('img[data-fallback]').forEach(img => {
          const card = img.closest('.book-card');
          const title = card?.dataset?.title || card?.querySelector('.card-title')?.textContent || 'Book';
          const author = card?.dataset?.author || card?.querySelector('.card-author')?.textContent || '';
          
          img.addEventListener('error', function onFirstError() {
            // Get title/author from image data attributes (more reliable)
            const imgTitle = img.dataset.title || title;
            const imgAuthor = img.dataset.author || author;
            
            // First error: try fallback URL
            const fallbackUrl = img.dataset.fallback;
            img.removeAttribute('data-fallback');
            
            if (fallbackUrl && fallbackUrl !== img.src && !fallbackUrl.startsWith('data:')) {
              img.src = fallbackUrl;
              // Add handler for second error (fallback also failed)
              img.addEventListener('error', function onSecondError() {
                // Second error: use generated SVG placeholder
                img.src = generatePlaceholderSvg(imgTitle, imgAuthor);
              }, { once: true });
            } else {
              // No fallback available, use generated SVG
              img.src = generatePlaceholderSvg(imgTitle, imgAuthor);
            }
          }, { once: true });
        });
        
        // DEBUG: Log external-card count in DOM
        console.log('[read-search] external-card count in DOM:', mount.querySelectorAll('a.book-card.external-card').length);
        
        // DEBUG: Log first 3 catalog items with computed externalUrl
        const catalogItems = items.filter(i => {
          const prov = (i.provider || i.source || i.collection || '').toLowerCase();
          return prov.includes('catalog') || prov.includes('doab');
        }).slice(0, 3);
        if (catalogItems.length > 0) {
          console.log('[read-search] catalog sample', catalogItems.map(x => ({
            title: x.title,
            open_access_url: x.open_access_url,
            source_url: x.source_url,
            externalUrl: pickExternalUrl(x)
          })));
        }
        
        // Lazy-load covers for external cards that have placeholder images
        lazyLoadExternalCovers(mount);
      })
      .catch(err => {
        console.error('search render error', err);
        if (err.message !== 'auth_required') {
          mount.innerHTML = '<p>No results.</p>';
        }
      });
  }
  
  // Delegated click handler for book cards (CSP-safe)
  function handleCardClick(e) {
    // Handle favorite button clicks FIRST - use robust selector
    const favBtn = e.target.closest('.favorite-btn, [data-favorite-btn]');
    if (favBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
      toggleFavorite(favBtn);
      return;
    }
    
    const card = e.target.closest('.book-card');
    if (!card) return;
    
    // Ignore disabled/unavailable cards
    if (card.dataset.disabled === 'true' || card.classList.contains('unavailable')) {
      e.preventDefault();
      return;
    }
    
    // Handle external-card clicks (catalog/doab/oapen) - resolve PDF/EPUB and open in unified-reader
    if (card.classList.contains('external-card') && card.dataset.landingUrl) {
      e.preventDefault();
      
      const landingUrl = card.dataset.landingUrl;
      const title = card.dataset.title || 'Untitled';
      const author = card.dataset.author || '';
      const coverUrl = card.dataset.cover || '';
      const provider = card.dataset.provider || 'catalog';
      
      console.log('[external] clicked, provider=' + provider + ', title=' + title);
      
      // Show loading state on the card
      const ctaSpan = card.querySelector('.card-cta span');
      const originalCta = ctaSpan ? ctaSpan.textContent : 'Read';
      if (ctaSpan) ctaSpan.textContent = 'Loading...';
      card.style.pointerEvents = 'none';
      card.style.opacity = '0.7';
      
      // Call the server to resolve the landing page and mint a signed token
      // Server handles file extraction, format selection, and secure token generation
      fetch('/api/external/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider,
          title: title,
          author: author,
          cover_url: coverUrl,
          landing_url: landingUrl
        })
      })
        .then(r => r.json())
        .then(data => {
          if (data.ok && data.token) {
            console.log('[external] token ok, format=' + (data.format || 'unknown'));
            const ref = encodeURIComponent(location.pathname + location.search);
            // Use /open to mint a fresh token at click-time instead of embedding token in URL
            var openUrl = '/open?provider=' + encodeURIComponent(provider)
              + '&provider_id=' + encodeURIComponent(landingUrl)
              + '&title=' + encodeURIComponent(title)
              + '&author=' + encodeURIComponent(author)
              + '&cover=' + encodeURIComponent(coverUrl);
            if (data.direct_url) openUrl += '&direct_url=' + encodeURIComponent(data.direct_url);
            if (data.source_url) openUrl += '&source_url=' + encodeURIComponent(data.source_url);
            if (data.format) openUrl += '&format=' + encodeURIComponent(data.format);
            openUrl += '&ref=' + ref;
            window.location = openUrl;
          } else {
            console.log('[external] fallback to:', data.open_url || landingUrl);
            const ref = encodeURIComponent(location.pathname + location.search);
            const fallbackUrl = data.open_url || landingUrl;
            window.location = '/external?url=' + encodeURIComponent(fallbackUrl) + '&ref=' + ref;
          }
        })
        .catch(err => {
          console.error('[external] error:', err);
          // On error, go to fallback page
          const ref = encodeURIComponent(location.pathname + location.search);
          window.location = '/external?url=' + encodeURIComponent(landingUrl) + '&ref=' + ref;
        });
      
      return;
    }
    
    // Handle archive-card clicks - resolve via Archive API
    if (card.classList.contains('archive-card') && card.dataset.archiveId) {
      e.preventDefault();
      
      const archiveId = card.dataset.archiveId;
      const title = card.dataset.title || 'Untitled';
      const author = card.dataset.author || '';
      const coverUrl = card.dataset.cover || 'https://archive.org/services/img/' + encodeURIComponent(archiveId);
      
      console.log('[archive] clicked, id=' + archiveId + ', title=' + title);
      
      // Show loading state on the card
      const ctaSpan = card.querySelector('.card-cta span');
      if (ctaSpan) ctaSpan.textContent = 'Loading...';
      card.style.pointerEvents = 'none';
      card.style.opacity = '0.7';
      
      // Call the backend to resolve Archive item and get a token
      fetch('/api/archive/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: archiveId,
          title: title,
          author: author,
          cover_url: coverUrl
        })
      })
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.token) {
          console.log('[archive] token ok');
          const ref = encodeURIComponent(location.pathname + location.search);
          // Use /open to mint a fresh token at click-time
          window.location = '/open?provider=archive&provider_id=' + encodeURIComponent(archiveId)
            + '&title=' + encodeURIComponent(title)
            + '&author=' + encodeURIComponent(author)
            + '&cover=' + encodeURIComponent(coverUrl)
            + '&ref=' + ref;
        } else {
          console.log('[archive] fallback to:', data.open_url);
          const ref = encodeURIComponent(location.pathname + location.search);
          // Pass context to external page (title, author, cover, archive_id, available files)
          let fallbackUrl = '/external?url=' + encodeURIComponent(data.open_url) + '&ref=' + ref;
          fallbackUrl += '&title=' + encodeURIComponent(data.title || title);
          fallbackUrl += '&author=' + encodeURIComponent(data.author || author);
          fallbackUrl += '&archive_id=' + encodeURIComponent(data.archive_id || archiveId);
          if (data.cover_url) fallbackUrl += '&cover_url=' + encodeURIComponent(data.cover_url);
          if (data.available_files) fallbackUrl += '&files=' + encodeURIComponent(JSON.stringify(data.available_files));
          window.location = fallbackUrl;
        }
      })
      .catch(err => {
        console.error('[archive] error:', err);
        // On error, go to fallback page with basic context
        const ref = encodeURIComponent(location.pathname + location.search);
        let fallbackUrl = '/external?url=' + encodeURIComponent('https://archive.org/details/' + archiveId) + '&ref=' + ref;
        fallbackUrl += '&title=' + encodeURIComponent(title);
        fallbackUrl += '&author=' + encodeURIComponent(author);
        fallbackUrl += '&archive_id=' + encodeURIComponent(archiveId);
        window.location = fallbackUrl;
      });
      
      return;
    }
    
    // Handle generic external-card clicks (non-catalog, non-archive) - go to internal fallback
    if (card.classList.contains('external-card') && card.dataset.externalUrl) {
      e.preventDefault();
      
      const externalUrl = card.dataset.externalUrl;
      const title = card.dataset.title || 'Untitled';
      const author = card.dataset.author || '';
      
      console.log('[external] clicked generic external, title=' + title);
      
      const ref = encodeURIComponent(location.pathname + location.search);
      let fallbackUrl = '/external?url=' + encodeURIComponent(externalUrl) + '&ref=' + ref;
      fallbackUrl += '&title=' + encodeURIComponent(title);
      fallbackUrl += '&author=' + encodeURIComponent(author);
      window.location = fallbackUrl;
      return;
    }
    
    // Other anchor tags handle their own navigation - let native behavior work
    if (card.tagName === 'A') {
      return;
    }
  }
  
  // Keyboard handler for book cards (CSP-safe)
  function handleCardKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    
    const card = e.target.closest('.book-card');
    if (!card) return;
    
    // Ignore disabled/unavailable cards
    if (card.dataset.disabled === 'true' || card.classList.contains('unavailable')) {
      return;
    }
    
    // Prevent default space scroll behavior
    if (e.key === ' ') {
      e.preventDefault();
    }
    
    // Anchor tags handle their own Enter key behavior
    if (card.tagName === 'A') {
      return;
    }
  }
  
  // Lazy-load covers for external cards (OAPEN/DOAB/CATALOG) that have placeholder images
  function lazyLoadExternalCovers(container) {
    const PLACEHOLDER = '/public/img/cover-fallback.svg';
    const MAX_CONCURRENT = 4;
    
    // Find external cards with placeholder covers
    const externalCards = container.querySelectorAll('a.book-card.external-card[data-landing-url]');
    const cardsNeedingCovers = [];
    
    externalCards.forEach(card => {
      const img = card.querySelector('.card-cover img');
      if (img && (img.src.endsWith(PLACEHOLDER) || img.getAttribute('src') === PLACEHOLDER)) {
        cardsNeedingCovers.push({ card, img, landingUrl: card.dataset.landingUrl, title: card.dataset.title });
      }
    });
    
    if (cardsNeedingCovers.length === 0) return;
    
    console.log('[external] covers to resolve:', cardsNeedingCovers.length);
    
    // Simple queue with limited concurrency
    let activeRequests = 0;
    let queueIndex = 0;
    
    function processNext() {
      while (activeRequests < MAX_CONCURRENT && queueIndex < cardsNeedingCovers.length) {
        const { card, img, landingUrl, title } = cardsNeedingCovers[queueIndex++];
        activeRequests++;
        
        // Set image attributes for external cards (better loading behavior)
        img.referrerPolicy = 'no-referrer';
        img.loading = 'lazy';
        
        fetch('/api/external/meta?url=' + encodeURIComponent(landingUrl))
          .then(r => r.json())
          .then(data => {
            if (data.ok && data.cover_url) {
              // Route external cover through our image proxy for better reliability
              var proxiedUrl = '/api/proxy/image?url=' + encodeURIComponent(data.cover_url);
              img.src = proxiedUrl;
              // Also update data-cover on card for click handler (store original URL)
              card.dataset.cover = data.cover_url;
              console.log('[external] cover resolved', title, data.cover_url);
            }
            // Store files info in card for click handler (avoids re-fetch due to server cache)
            if (data.files && data.files.length > 0) {
              card.dataset.files = JSON.stringify(data.files);
              console.log('[external] files cached', title, data.files.length + ' files');
            }
          })
          .catch(err => {
            console.warn('[external] cover fetch error:', err.message);
          })
          .finally(() => {
            activeRequests--;
            processNext();
          });
      }
    }
    
    processNext();
  }
});
