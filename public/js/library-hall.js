// public/js/library-hall.js
class LibraryHall {
  constructor(options = {}) {
    this.options = options;
    this.mode = 'css';
  }

  mount(element) {
    this.element = element;
    this.setupModal();
    console.log('[HALL] mounted with mode:', this.mode);
  }

  setupModal() {
    // Create modal if it doesn't exist
    let modal = this.element.querySelector('#shelfModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'shelfModal';
      modal.className = 'shelf-modal hidden';
      modal.setAttribute('aria-hidden', 'true');
      modal.setAttribute('role', 'dialog');
      
      modal.innerHTML = `
        <div class="shelf-content">
          <div class="shelf-header">
            <h2 class="shelf-title"></h2>
            <button class="shelf-close" aria-label="Close">×</button>
          </div>
          <div class="book-grid"></div>
        </div>
      `;
      
      this.element.appendChild(modal);
    }

    // Setup close handlers
    const closeBtn = modal.querySelector('.shelf-close');
    closeBtn.addEventListener('click', () => this.closeModal());
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeModal();
    });

    // ESC key handler
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        this.closeModal();
      }
    });
  }

  async openGenreModal(genre) {
    console.log(`[HALL] opening genre: ${genre}`);
    
    const modal = this.element.querySelector('#shelfModal');
    const title = modal.querySelector('.shelf-title');
    const grid = modal.querySelector('.book-grid');
    
    title.textContent = `${genre} Books`;
    grid.innerHTML = '<div class="loading">Loading books...</div>';
    
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    
    try {
      const books = await this.loadGenreBooks(genre);
      this.renderBooks(books, grid);
    } catch (error) {
      console.error(`[HALL] Failed to load ${genre} books:`, error);
      grid.innerHTML = '<div class="error">Failed to load books. Please try again.</div>';
    }
  }

  async loadGenreBooks(genre) {
    // Try live search first
    let books = await this.searchGenre(genre);
    
    // If we don't have enough, try with seeds
    if (books.length < 12) {
      console.log(`[HALL] genre=${genre} merged=${books.length}, using seeds...`);
      const seeds = await this.fetchGenreSeeds(genre);
      books = books.concat(seeds);
    }
    
    // Dedupe by title+author
    const uniqueBooks = [];
    const seen = new Set();
    
    for (const book of books) {
      const key = `${book.title}-${book.author}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueBooks.push(book);
      }
    }
    
    console.log(`[HALL] genre=${genre} merged=${books.length} seeded=${books.length - uniqueBooks.length} total=${uniqueBooks.length}`);
    
    return uniqueBooks.slice(0, 24); // Limit to 24
  }

  async searchGenre(genre) {
    try {
      const response = await fetch(`/read?query=${encodeURIComponent(genre)}&format=json&sources=ol,ia,loc,gutenberg&limit=24`);
      if (!response.ok) throw new Error('Search failed');
      
      const results = await response.json();
      return results.map(book => ({
        title: book.title,
        author: book.author,
        cover: book.cover,
        href: book.href,
        source: book.source
      }));
    } catch (error) {
      console.warn(`[HALL] Search failed for ${genre}:`, error);
      return [];
    }
  }

  async fetchGenreSeeds(genre) {
    try {
      const response = await fetch('/assets/seed/genres.json');
      if (!response.ok) throw new Error('Seed data not available');
      
      const seeds = await response.json();
      return seeds[genre] || [];
    } catch (error) {
      console.warn('[HALL] Failed to fetch seed data:', error);
      return [];
    }
  }

  renderBooks(books, grid) {
    if (books.length === 0) {
      grid.innerHTML = '<div class="no-books">No books found for this genre.</div>';
      return;
    }

    grid.innerHTML = books.map(book => `
      <div class="book-card">
        <img src="${book.cover || '/img/cover-fallback.svg'}" alt="${book.title}" class="book-cover" loading="lazy">
        <div class="book-info">
          <h3 class="book-title">${book.title}</h3>
          <p class="book-author">${book.author}</p>
          <span class="book-source">${book.source}</span>
          <a href="${book.href}" class="btn-read">Read</a>
        </div>
      </div>
    `).join('');
  }

  closeModal() {
    const modal = this.element.querySelector('#shelfModal');
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
}

// Export to global scope
window.LibraryHall = LibraryHall;