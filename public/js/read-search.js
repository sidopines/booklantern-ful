document.addEventListener('DOMContentLoaded', () => {
  // Bind to any form that points at /search and has an input[name="q"]
  const forms = Array.from(document.querySelectorAll('form[action="/search"]'))
    .filter(f => f.querySelector('input[name="q"]'));

  if (forms.length === 0) return;

  forms.forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = (form.querySelector('input[name="q"]')?.value || '').trim();
      if (!q) return;
      await runSearch(q);
    });
  });

  // If the page URL already has ?q=..., auto-run (covers /search?q=foo)
  const urlQ = new URLSearchParams(location.search).get('q');
  if (urlQ) runSearch(urlQ);
});

async function runSearch(q) {
  // Ensure a results container exists
  let container = document.getElementById('search-results') || document.getElementById('read-results');
  if (!container) {
    container = document.createElement('div');
    container.id = 'search-results';
    const anchor = document.querySelector('h1, main') || document.body;
    anchor.parentNode.insertBefore(container, anchor.nextSibling);
  }
  container.innerHTML = `<p>Searching "${escapeHtml(q)}"…</p>`;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&page=1`, { headers: { 'Accept': 'application/json' }});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    if (items.length === 0) {
      container.innerHTML = `<p>No results.</p>`;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'cards grid'; // uses your existing card styles

    for (const it of items) {
      const cover = it.cover_url || '/public/img/placeholder-cover.png';
      const title = it.title || 'Untitled';
      const author = it.author || '';
      const token = it.token;

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <img src="${escapeAttr(cover)}" alt="">
        <div class="card-body">
          <div class="title">${escapeHtml(title)}</div>
          <div class="author">${escapeHtml(author)}</div>
          <a class="btn" href="/unified-reader?token=${encodeURIComponent(token)}">Read</a>
        </div>`;
      grid.appendChild(card);
    }

    container.innerHTML = '';
    container.appendChild(grid);
  } catch (err) {
    container.innerHTML = `<p>Search failed. Please try again.</p>`;
    // Optionally log to console for debugging:
    console.debug('[read-search] error', err);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function escapeAttr(s){ return String(s).replace(/"/g,'&quot;'); }
