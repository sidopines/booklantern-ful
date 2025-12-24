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
          // Always show title and author with fallbacks
          const title = item.title || 'Untitled';
          const authorText = item.author || 'Unknown author';
          const provider = item.provider ? `<span class="provider-badge provider-${item.provider}">${item.provider}</span>` : '';
          
          // Cover image - CSP-safe with data-fallback for error handling
          const coverUrl = item.cover_url || '/public/img/cover-fallback.svg';
          const cover = `<img src="${coverUrl}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fallback="/public/img/cover-fallback.svg">`;
          
          // Check if this item can be read on BookLantern
          const hasValidToken = item.token && typeof item.token === 'string' && item.token.length > 10;
          const hasValidHref = item.href && typeof item.href === 'string' && item.href.includes('token=');
          const readableFlag = item.readable === true || item.readable === 'true';
          const isReadable = readableFlag && hasValidToken && hasValidHref;
          
          // Check for external URL - only use string URLs, not boolean open_access
          const externalUrl = item.open_access_url || item.source_url || item.open_url || item.landing_url ||
            (typeof item.open_access === 'string' && item.open_access.startsWith('http') ? item.open_access : null);
          
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
          // 1. If readable on BookLantern -> internal reader link
          if (isReadable) {
            const url = new URL(item.href, window.location.origin);
            url.searchParams.set('ref', location.pathname + location.search);
            const href = url.pathname + url.search;
            return `<a class="book-card readable-card" href="${href}" data-item-idx="${idx}">
                      ${formatBadge}
                      ${provider}
                      <div class="card-cover">${cover}</div>
                      <div class="card-title">${escapedTitle}</div>
                      <div class="card-author">${escapedAuthor}</div>
                      <div class="card-cta"><span>Read</span></div>
                    </a>`;
          }
          
          // 2. If has external URL -> external link (opens in new tab)
          if (externalUrl) {
            const escapedUrl = externalUrl.replace(/"/g, '&quot;');
            return `<a class="book-card external-card" href="${escapedUrl}" target="_blank" rel="noopener noreferrer"
                       data-item-idx="${idx}">
                      <span class="format-badge external-badge">External</span>
                      ${provider}
                      <div class="card-cover">${cover}</div>
                      <div class="card-title">${escapedTitle}</div>
                      <div class="card-author">${escapedAuthor}</div>
                      <div class="card-cta"><span>Open ↗</span></div>
                    </a>`;
          }
          
          // 3. Otherwise -> unavailable (no link, non-clickable)
          return `<div class="book-card unavailable" data-item-idx="${idx}" data-disabled="true">
                    <span class="format-badge unavailable-badge">Unavailable</span>
                    ${provider}
                    <div class="card-cover">${cover}</div>
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
    
    // Anchor tags handle their own navigation - let native behavior work
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
});
