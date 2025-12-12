document.addEventListener('DOMContentLoaded', () => {
  const q = new URLSearchParams(location.search).get('q') || '';
  const box = document.querySelector('input[name="q"]');
  if (box) box.value = q;
  
  // Check if user is logged in (set by EJS template from res.locals.isAuthed)
  // Handle both boolean true and string 'true' for robustness
  const authed = window.__BL_USER_LOGGED_IN__ === true || window.__BL_USER_LOGGED_IN__ === 'true';
  console.log('[BL] logged in?', window.__BL_USER_LOGGED_IN__, '-> authed:', authed);
  
  // Client-side login gating helper
  function loginGate(href) {
    if (!href) return '#';
    if (authed) return href;
    // Gate unified-reader links for guests
    if (href.startsWith('/unified-reader')) {
      return '/login?next=' + encodeURIComponent(href);
    }
    return href;
  }
  
  let mount = document.getElementById('results');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'results';
    mount.className = 'results-grid';
    (document.querySelector('.reader-intro') || document.querySelector('main') || document.body).appendChild(mount);
  }
  
  if (q) {
    fetch('/api/search?q=' + encodeURIComponent(q))
      .then(r => r.json())
      .then(data => {
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) { mount.innerHTML = '<p>No results.</p>'; return; }
        mount.innerHTML = items.map(item => {
          const cover = item.cover_url ? `<img src="${item.cover_url}" alt="">` : '';
          const title = item.title || 'Untitled';
          const author = item.author ? `<div class="card-author">${item.author}</div>` : '';
          // Use href from response, add ref parameter to preserve search context
          const url = new URL((typeof item.href === 'string') ? item.href : '/unified-reader', window.location.origin);
          url.searchParams.set('ref', location.pathname + location.search);
          const rawHref = url.pathname + url.search;
          // Apply login gating
          const href = loginGate(rawHref);
          return `<a class="book-card" href="${href}">
                    <div class="card-cover">${cover}</div>
                    <div class="card-title">${title}</div>
                    ${author}
                    <div class="card-cta"><span>Read</span></div>
                  </a>`;
        }).join('');
      })
      .catch(err => { console.error('search render error', err); mount.innerHTML = '<p>No results.</p>'; });
  }
});
