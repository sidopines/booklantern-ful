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
  
  // Create toast container for external-only modal
  let toastContainer = document.getElementById('external-toast');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'external-toast';
    toastContainer.className = 'external-toast hidden';
    toastContainer.innerHTML = `
      <div class="toast-content">
        <button class="toast-close" aria-label="Close">&times;</button>
        <h4>This book can't be opened inside BookLantern</h4>
        <p class="toast-reason"></p>
        <p>You can view it on the original source:</p>
        <a href="#" class="toast-source-link" target="_blank" rel="noopener">Open Source Link ↗</a>
      </div>
    `;
    document.body.appendChild(toastContainer);
    
    // Close button handler
    toastContainer.querySelector('.toast-close').addEventListener('click', () => {
      toastContainer.classList.add('hidden');
    });
    
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
        margin: 0 0 8px;
        font-size: 18px;
        color: #1a1a1a;
      }
      .toast-content p {
        margin: 8px 0;
        font-size: 14px;
        color: #666;
      }
      .toast-reason {
        background: #f5f5f5;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 13px !important;
      }
      .toast-source-link {
        display: inline-block;
        margin-top: 12px;
        padding: 10px 20px;
        background: #4f46e5;
        color: #fff !important;
        text-decoration: none;
        border-radius: 8px;
        font-weight: 500;
      }
      .toast-source-link:hover { background: #4338ca; }
    `;
    document.head.appendChild(style);
  }
  
  // Helper to show external-only toast
  function showExternalToast(item) {
    const toast = document.getElementById('external-toast');
    const reasonEl = toast.querySelector('.toast-reason');
    const linkEl = toast.querySelector('.toast-source-link');
    
    // Set reason message based on reason code
    let reasonText = 'This book is not available in a format we can display.';
    if (item.reason === 'borrow_required') {
      reasonText = 'This book requires borrowing from the source library.';
    } else if (item.reason === 'no_direct_url') {
      reasonText = 'No direct download link is available for this book.';
    } else if (item.reason === 'no_epub') {
      reasonText = `This book is only available as ${(item.format || 'unknown').toUpperCase()}, which we cannot display.`;
    }
    
    reasonEl.textContent = reasonText;
    linkEl.href = item.source_url || '#';
    
    toast.classList.remove('hidden');
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

        mount.innerHTML = items.map((item, idx) => {
          const cover = item.cover_url ? `<img src="${item.cover_url}" alt="">` : '';
          const title = item.title || 'Untitled';
          const author = item.author ? `<div class="card-author">${item.author}</div>` : '';
          const provider = item.provider ? `<span class="provider-badge provider-${item.provider}">${item.provider}</span>` : '';
          
          // Check if this item can be read in-app or is external-only
          const isExternalOnly = item.external_only || !item.href;
          const sourceUrl = item.source_url || '';
          
          if (isExternalOnly) {
            // External-only: show card that opens toast on click
            const formatBadge = item.format && item.format !== 'epub' 
              ? `<span class="format-badge">${item.format.toUpperCase()}</span>` 
              : '';
            const reasonBadge = item.reason === 'borrow_required' 
              ? '<span class="format-badge borrow">BORROW</span>'
              : formatBadge;
            return `<div class="book-card external" data-item-idx="${idx}">
                      ${reasonBadge}
                      ${provider}
                      <div class="card-cover">${cover}</div>
                      <div class="card-title">${title}</div>
                      ${author}
                      <div class="card-cta"><span>View Source ↗</span></div>
                    </div>`;
          }
          
          // Regular in-app reading
          const url = new URL((typeof item.href === 'string') ? item.href : '/unified-reader', window.location.origin);
          url.searchParams.set('ref', location.pathname + location.search);
          const href = url.pathname + url.search;
          return `<a class="book-card" href="${href}">
                    ${provider}
                    <div class="card-cover">${cover}</div>
                    <div class="card-title">${title}</div>
                    ${author}
                    <div class="card-cta"><span>Read</span></div>
                  </a>`;
        }).join('');
        
        // Add click handlers for external-only cards
        mount.querySelectorAll('.book-card.external').forEach(card => {
          card.addEventListener('click', () => {
            const idx = parseInt(card.dataset.itemIdx, 10);
            const item = items[idx];
            if (item) showExternalToast(item);
          });
        });
      })
      .catch(err => {
        console.error('search render error', err);
        if (err.message !== 'auth_required') {
          mount.innerHTML = '<p>No results.</p>';
        }
      });
  }
});
