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
          // Use placeholder cover if missing - NO inline onerror (CSP-safe)
          const coverUrl = item.cover_url || '/public/img/cover-fallback.svg';
          const cover = item.cover_url 
            ? `<img src="${coverUrl}" alt="" data-cover-img="true">` 
            : '<div class="card-cover-placeholder"><svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg></div>';
          // Always show title and author with fallbacks
          const title = item.title || 'Untitled';
          const authorText = item.author || 'Unknown author';
          const author = `<div class="card-author">${authorText}</div>`;
          const provider = item.provider ? `<span class="provider-badge provider-${item.provider}">${item.provider}</span>` : '';
          
          // Check if this item can be read on BookLantern
          // readable flag can be boolean true or string 'true' depending on source
          const hasValidToken = item.token && typeof item.token === 'string' && item.token.length > 10;
          const hasValidHref = item.href && typeof item.href === 'string' && item.href.includes('token=');
          // Handle both boolean and string 'true' for readable flag
          const readableFlag = item.readable === true || item.readable === 'true';
          const isReadable = readableFlag && hasValidToken && hasValidHref;
          const isExternalOnly = item.external_only === true || !isReadable;
          
          // Check if external-only item has a clickable external link
          // Check all possible URL fields (DOAB/catalog compatibility)
          const externalUrl = item.open_access_url || item.source_url || item.open_url || item.landing_url || item.open_access || null;
          const hasExternalLink = Boolean(item.has_external_link || externalUrl);
          
          // Show format badge for non-EPUB items (PDF, etc)
          const formatBadge = (item.format && item.format !== 'epub' && item.format !== 'unknown')
            ? `<span class="format-badge">${item.format.toUpperCase()}</span>`
            : '';
          
          if (isExternalOnly && hasExternalLink) {
            // External-only but has a link - render as anchor tag for full clickability
            // Escape HTML to prevent XSS
            const escapeHtml = (str) => {
              const div = document.createElement('div');
              div.textContent = str;
              return div.innerHTML;
            };
            const escapedUrl = externalUrl.replace(/"/g, '&quot;');
            const escapedTitle = escapeHtml(title);
            const escapedAuthor = escapeHtml(authorText);
            return `<a class="book-card external-card" href="${escapedUrl}" target="_blank" rel="noopener noreferrer"
                       data-item-idx="${idx}">
                      <span class="format-badge external-badge">External</span>
                      ${provider}
                      <div class="card-cover">${cover}</div>
                      <div class="card-title">${escapedTitle}</div>
                      <div class="card-author">${escapedAuthor}</div>
                      <div class="card-cta"><span>View Source ↗</span></div>
                    </a>`;
          }
          
          if (isExternalOnly) {
            // NOT available to read on BookLantern and no external link
            return `<div class="book-card unavailable" data-item-idx="${idx}" data-disabled="true">
                      <span class="format-badge unavailable-badge">Unavailable</span>
                      ${provider}
                      <div class="card-cover">${cover}</div>
                      <div class="card-title">${title}</div>
                      ${author}
                    </div>`;
          }
          
          // Readable on BookLantern - use data attributes instead of href (CSP-safe)
          const url = new URL(item.href, window.location.origin);
          url.searchParams.set('ref', location.pathname + location.search);
          const href = url.pathname + url.search;
          // Use div with data attributes instead of <a> with inline handlers
          return `<div class="book-card readable-card" tabindex="0" role="button" 
                       data-href="${href}" 
                       data-token="${item.token || ''}" 
                       data-provider="${item.provider || ''}">
                    ${formatBadge}
                    ${provider}
                    <div class="card-cover">${cover}</div>
                    <div class="card-title">${title}</div>
                    ${author}
                    <div class="card-cta"><span>Read</span></div>
                  </div>`;
        }).join('');
        
        // Delegated click handler for results container (CSP-safe, no inline handlers)
        mount.addEventListener('click', handleCardClick);
        mount.addEventListener('keydown', handleCardKeydown);
        
        // Add error handlers for cover images (CSP-safe, no inline onerror)
        mount.querySelectorAll('img[data-cover-img]').forEach(img => {
          img.addEventListener('error', () => handleImageError(img));
        });
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
      return;
    }
    
    // Handle external cards - they're now anchor tags, so native behavior handles it
    // No need to interfere with anchor tag clicks
    if (card.classList.contains('external-card') && card.tagName === 'A') {
      return;
    }
    
    // Navigate to reader if href exists (for div-based readable cards)
    const href = card.dataset.href;
    if (href) {
      window.location.href = href;
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
    e.preventDefault();
    
    // Handle external cards - they're now anchor tags, so native behavior handles it
    // Trigger click for keyboard accessibility
    if (card.classList.contains('external-card') && card.tagName === 'A') {
      card.click();
      return;
    }
    
    // Navigate to reader if href exists (for div-based readable cards)
    const href = card.dataset.href;
    if (href) {
      window.location.href = href;
    }
  }
});
