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
      .then(r => r.json())
      .then(data => {
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) { mount.innerHTML = '<p>No results.</p>'; return; }
        mount.innerHTML = items.map(item => {
          const cover = item.cover_url ? `<img src="${item.cover_url}" alt="">` : '';
          const title = item.title || 'Untitled';
          const author = item.author ? `<div class="card-author">${item.author}</div>` : '';
          const href = `/unified-reader?token=${encodeURIComponent(item.token)}`;
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
