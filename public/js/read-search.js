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
  function handleImageError(img) {
    img.style.display = 'none';
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
          // Determine readable primarily by presence of valid token+href (some providers don't set readable flag)
          const hasToken = typeof item.token === 'string' && item.token.length > 10;
          const hasHref = typeof item.href === 'string' && item.href.includes('token=');
          const isReadable = hasToken && hasHref;
          
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
          if (isArchive && archiveId && (coverUrl === '/public/img/cover-fallback.svg' || !item.cover_url)) {
            finalCoverUrl = 'https://archive.org/services/img/' + encodeURIComponent(archiveId);
          }
          const finalCover = `<img src="${finalCoverUrl}" alt="" data-fallback="/public/img/cover-fallback.svg">`;
          
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
            return `<a class="book-card archive-card" href="#" 
                       data-archive-id="${archiveId}" 
                       data-title="${escapedTitle}"
                       data-author="${escapedAuthor}"
                       data-cover="${escapedCover}"
                       data-provider="archive"
                       data-item-idx="${idx}">
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
            return `<a class="book-card external-card" href="#" 
                       data-landing-url="${escapedUrl}" 
                       data-title="${escapedTitle}"
                       data-author="${escapedAuthor}"
                       data-cover="${escapedCover}"
                       data-provider="${item.provider || 'catalog'}"
                       data-item-idx="${idx}">
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
            return `<a class="book-card readable-card" href="${href}" data-item-idx="${idx}">
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
              return `<a class="book-card archive-card" href="#" 
                         data-archive-id="${possibleArchiveId}" 
                         data-title="${escapedTitle}"
                         data-author="${escapedAuthor}"
                         data-cover="${escapedCover}"
                         data-provider="archive"
                         data-item-idx="${idx}">
                        <span class="format-badge archive-badge">ARCHIVE</span>
                        ${provider}
                        <div class="card-cover">${finalCover}</div>
                        <div class="card-title">${escapedTitle}</div>
                        <div class="card-author">${escapedAuthor}</div>
                        <div class="card-cta"><span>Read</span></div>
                      </a>`;
            }
            // Non-archive external URL - still keep on site via fallback
            return `<a class="book-card external-card" href="#"
                       data-external-url="${escapedUrl}" 
                       data-title="${escapedTitle}"
                       data-author="${escapedAuthor}"
                       data-cover="${escapedCover}"
                       data-provider="${item.provider || 'external'}"
                       data-item-idx="${idx}">
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
        mount.querySelectorAll('img[data-fallback]').forEach(img => {
          img.addEventListener('error', () => {
            img.src = img.dataset.fallback;
            img.removeAttribute('data-fallback');
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
    const card = e.target.closest('.book-card');
    if (!card) return;
    
    // Ignore disabled/unavailable cards
    if (card.dataset.disabled === 'true' || card.classList.contains('unavailable')) {
      e.preventDefault();
      return;
    }
    
    // Handle external-card clicks (catalog/doab/oapen) - resolve PDF and open in unified-reader
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
      
      // Call the backend to resolve and get a token
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
          console.log('[external] token ok');
          const ref = encodeURIComponent(location.pathname + location.search);
          window.location = '/unified-reader?token=' + encodeURIComponent(data.token) + '&ref=' + ref;
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
          window.location = '/unified-reader?token=' + encodeURIComponent(data.token) + '&ref=' + ref;
        } else {
          console.log('[archive] fallback to:', data.open_url);
          const ref = encodeURIComponent(location.pathname + location.search);
          window.location = '/external?url=' + encodeURIComponent(data.open_url) + '&ref=' + ref;
        }
      })
      .catch(err => {
        console.error('[archive] error:', err);
        // On error, go to fallback page
        const ref = encodeURIComponent(location.pathname + location.search);
        window.location = '/external?url=' + encodeURIComponent('https://archive.org/details/' + archiveId) + '&ref=' + ref;
      });
      
      return;
    }
    
    // Handle generic external-card clicks (non-catalog, non-archive) - go to internal fallback
    if (card.classList.contains('external-card') && card.dataset.externalUrl) {
      e.preventDefault();
      
      const externalUrl = card.dataset.externalUrl;
      const title = card.dataset.title || 'Untitled';
      
      console.log('[external] clicked generic external, title=' + title);
      
      const ref = encodeURIComponent(location.pathname + location.search);
      window.location = '/external?url=' + encodeURIComponent(externalUrl) + '&ref=' + ref;
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
        
        fetch('/api/external/meta?url=' + encodeURIComponent(landingUrl))
          .then(r => r.json())
          .then(data => {
            if (data.ok && data.cover_url) {
              img.src = data.cover_url;
              // Also update data-cover on card for click handler
              card.dataset.cover = data.cover_url;
              console.log('[external] cover resolved', title, data.cover_url);
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
