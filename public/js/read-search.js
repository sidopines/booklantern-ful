// public/js/read-search.js
(function() {
  const searchForm = document.querySelector('form[action*="search"]') || document.querySelector('form');
  const searchInput = searchForm?.querySelector('input[type="search"], input[name="q"]');
  const resultsContainer = document.getElementById('search-results') || createResultsContainer();
  
  function createResultsContainer() {
    const container = document.createElement('div');
    container.id = 'search-results';
    container.style.cssText = 'margin-top: 20px;';
    if (searchForm) {
      searchForm.parentNode.insertBefore(container, searchForm.nextSibling);
    }
    return container;
  }
  
  if (!searchForm || !searchInput) return;
  
  searchForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (!query) return;
    
    resultsContainer.innerHTML = '<p>Searching...</p>';
    
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&page=1`);
      const data = await res.json();
      
      if (!data.items || data.items.length === 0) {
        resultsContainer.innerHTML = '<p>No results found.</p>';
        return;
      }
      
      renderResults(data.items);
    } catch (error) {
      console.error('Search error:', error);
      resultsContainer.innerHTML = '<p>Search failed. Please try again.</p>';
    }
  });
  
  function renderResults(items) {
    const html = items.map(item => `
      <div class="book-card" style="background: white; padding: 15px; margin-bottom: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); display: flex; gap: 15px;">
        ${item.cover_url ? `<img src="${item.cover_url}" alt="${item.title}" style="width: 100px; height: 150px; object-fit: cover; border-radius: 4px;" onerror="this.style.display='none'" />` : ''}
        <div style="flex: 1;">
          <h3 style="margin: 0 0 8px; font-size: 18px;">${item.title}</h3>
          <p style="margin: 0 0 8px; color: #666;">${item.author}</p>
          ${item.year ? `<p style="margin: 0 0 8px; font-size: 13px; color: #999;">${item.year}</p>` : ''}
          <button 
            class="read-btn" 
            data-token="${item.token}" 
            style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;"
            onmouseover="this.style.background='#0056b3'" 
            onmouseout="this.style.background='#007bff'">
            Read
          </button>
        </div>
      </div>
    `).join('');
    
    resultsContainer.innerHTML = html;
    
    // Attach click handlers
    document.querySelectorAll('.read-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const token = this.dataset.token;
        const url = `/unified-reader?token=${encodeURIComponent(token)}`;
        
        // Check if logged in (basic check)
        fetch('/api/reader/settings')
          .then(res => {
            if (res.status === 401 || res.status === 302) {
              // Not logged in - redirect to login with next param
              window.location.href = `/login?next=${encodeURIComponent(url)}`;
            } else {
              // Logged in - go to reader
              window.location.href = url;
            }
          })
          .catch(() => {
            // Assume not logged in on error
            window.location.href = `/login?next=${encodeURIComponent(url)}`;
          });
      });
    });
  }
})();
