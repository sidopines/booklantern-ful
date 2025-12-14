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
  
  if (q) {
    fetch('/api/search?q=' + encodeURIComponent(q))
      .then(async (r) => {
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

        mount.innerHTML = items.map(item => {
          const cover = item.cover_url ? `<img src="${item.cover_url}" alt="">` : '';
          const title = item.title || 'Untitled';
          const author = item.author ? `<div class="card-author">${item.author}</div>` : '';
          // Use href from response directly - server handles auth gating via ensureSubscriber
          const url = new URL((typeof item.href === 'string') ? item.href : '/unified-reader', window.location.origin);
          url.searchParams.set('ref', location.pathname + location.search);
          const href = url.pathname + url.search;
          return `<a class="book-card" href="${href}">
                    <div class="card-cover">${cover}</div>
                    <div class="card-title">${title}</div>
                    ${author}
                    <div class="card-cta"><span>Read</span></div>
                  </a>`;
        }).join('');
      })
      .catch(err => {
        console.error('search render error', err);
        mount.innerHTML = '<p>No results.</p>';
      });
  }
});
