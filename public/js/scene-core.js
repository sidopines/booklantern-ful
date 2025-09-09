// public/js/scene-core.js - Scene Management and Progressive Enhancement
class SceneManager {
  constructor() {
    this.webglSupported = this.detectWebGL();
    this.animEnabled = this.getAnimSetting();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.doorGate = null;
    this.libraryHall = null;
    this.isTransitioning = false;
  }

  detectWebGL() {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!ctx) return false;
      
      // Test texture creation
      const texture = ctx.createTexture();
      ctx.bindTexture(ctx.TEXTURE_2D, texture);
      ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, 1, 1, 0, ctx.RGBA, ctx.UNSIGNED_BYTE, new Uint8Array([255, 0, 0, 255]));
      
      const isValid = ctx.getError() === ctx.NO_ERROR;
      ctx.deleteTexture(texture);
      canvas.remove();
      
      return isValid;
    } catch (e) {
      return false;
    }
  }

  getAnimSetting() {
    // Check for user override first
    const override = localStorage.getItem('bl:anim:force');
    if (override === 'on') return true;
    if (override === 'off') return false;
    
    // Check server-side ANIM flag
    const animData = document.body.dataset.anim || window.BL_ANIM;
    if (animData === 'off') return false;
    
    // Default to on
    return true;
  }

  boot() {
    console.log('[SceneCore] Booting...', {
      webgl: this.webglSupported,
      anim: this.animEnabled,
      reducedMotion: this.reducedMotion
    });

    this.lockScroll();
    this.mountGate(document.getElementById('gate'));
    this.setupEnterHandler();
  }

  lockScroll() {
    document.body.classList.add('locked');
  }

  unlockScroll() {
    document.body.classList.remove('locked');
  }

  mountGate(element) {
    if (!element) return;
    
    try {
      if (window.DoorGate) {
        this.doorGate = new DoorGate({
          webgl: this.webglSupported && this.animEnabled && !this.reducedMotion,
          reducedMotion: this.reducedMotion
        });
        this.doorGate.mount(element);
      } else {
        // Fallback: just make the enter button clickable
        console.warn('[SceneCore] DoorGate not available, using fallback');
      }
    } catch (e) {
      console.warn('[SceneCore] Failed to mount gate:', e);
    }
  }

  mountHall(element) {
    if (!element) return;
    
    try {
      if (window.LibraryHall) {
        this.libraryHall = new LibraryHall({
          webgl: this.webglSupported && this.animEnabled && !this.reducedMotion,
          reducedMotion: this.reducedMotion
        });
        this.libraryHall.mount(element);
      } else {
        // Fallback: setup basic genre buttons
        console.warn('[SceneCore] LibraryHall not available, using fallback');
        this.setupBasicGenreButtons();
      }
    } catch (e) {
      console.warn('[SceneCore] Failed to mount hall:', e);
      this.setupBasicGenreButtons();
    }
  }

  setupEnterHandler() {
    const enterButton = document.querySelector('.enter-hit');
    if (!enterButton) return;

    enterButton.addEventListener('click', async (e) => {
      e.preventDefault();
      if (this.isTransitioning) return;
      
      this.isTransitioning = true;
      
      try {
        // Play entrance effect
        if (this.doorGate && typeof this.doorGate.playEnter === 'function') {
          await this.doorGate.playEnter();
        } else {
          // Fallback delay for static mode
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        // Transition to hall
        this.transitionToHall();
      } catch (e) {
        console.warn('[SceneCore] Enter transition failed:', e);
        this.transitionToHall(); // Still transition even if effects fail
      }
    });
  }

  transitionToHall() {
    const gate = document.getElementById('gate');
    const hall = document.getElementById('hall');
    
    if (gate) gate.classList.add('hidden');
    if (hall) hall.classList.remove('hidden');
    
    this.unlockScroll();
    this.mountHall(hall);
    this.isTransitioning = false;
  }

  pauseAll() {
    if (this.doorGate && typeof this.doorGate.pause === 'function') {
      this.doorGate.pause();
    }
    if (this.libraryHall && typeof this.libraryHall.pause === 'function') {
      this.libraryHall.pause();
    }
  }

  resumeAll() {
    if (this.doorGate && typeof this.doorGate.resume === 'function') {
      this.doorGate.resume();
    }
    if (this.libraryHall && typeof this.libraryHall.resume === 'function') {
      this.libraryHall.resume();
    }
  }

  dispose() {
    if (this.doorGate && typeof this.doorGate.dispose === 'function') {
      this.doorGate.dispose();
    }
    if (this.libraryHall && typeof this.libraryHall.dispose === 'function') {
      this.libraryHall.dispose();
    }
    this.unlockScroll();
  }

  teardownAll() {
    this.dispose();
  }

  setupBasicGenreButtons() {
    // Fallback: setup genre buttons for basic shelf modal functionality
    const stacks = document.querySelector('.stacks');
    if (!stacks) return;

    stacks.querySelectorAll('button[data-genre]').forEach(button => {
      button.addEventListener('click', () => {
        const genre = button.dataset.genre;
        this.openShelfModal(genre);
      });
    });
  }

  async openShelfModal(genre) {
    const modal = document.getElementById('shelfModal');
    const title = document.getElementById('shelfTitle');
    const grid = document.querySelector('.grid.books');
    
    if (!modal || !title || !grid) return;

    title.textContent = `${genre} Books`;
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--muted);">Loading books...</div>';
    
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    try {
      // Fetch books for this genre
      const response = await fetch(`/read?query=${encodeURIComponent(genre)}`);
      const html = await response.text();
      
      // Parse the response to extract book data
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const bookCards = doc.querySelectorAll('.book-card, .item-card');
      
      if (bookCards.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--muted);">No books found for this genre</div>';
        return;
      }

      // Convert found books to modal format
      const books = Array.from(bookCards).slice(0, 12).map(card => {
        const title = card.querySelector('h3, .title')?.textContent?.trim() || 'Untitled';
        const author = card.querySelector('.author, .creator')?.textContent?.trim() || 'Unknown Author';
        const cover = card.querySelector('img')?.src || '/img/cover-fallback.svg';
        const link = card.getAttribute('href') || card.querySelector('a')?.getAttribute('href') || '#';
        
        return { title, author, cover, link };
      });

      this.populateShelf(books, grid);
    } catch (error) {
      console.error('Failed to fetch books:', error);
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--error);">Failed to load books</div>';
    }

    // Setup modal interactions
    this.setupModalInteractions(modal);
  }

  populateShelf(books, grid) {
    grid.innerHTML = books.map(book => `
      <a href="${book.link}" class="book-card">
        <img src="${book.cover}" alt="${book.title}" loading="lazy" onerror="this.src='/img/cover-fallback.svg'">
        <div class="title">${book.title}</div>
        <div class="author">${book.author}</div>
        <div class="source">Read Now</div>
      </a>
    `).join('');
  }

  setupModalInteractions(modal) {
    const closeBtn = modal.querySelector('.close');
    const backdrop = modal.querySelector('.modal-backdrop');
    
    // Close handlers
    const closeModal = () => {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);
    
    // ESC key handler
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', handleKeydown);
      }
    };
    document.addEventListener('keydown', handleKeydown);
  }
}

// Initialize on DOM ready
let sceneManager = null;

function initSceneManager() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSceneManager);
    return;
  }
  
  // Only initialize on landing page
  if (document.body.dataset.page !== 'landing') return;
  
  sceneManager = new SceneManager();
  sceneManager.boot();
}

// Page visibility handling
document.addEventListener('visibilitychange', () => {
  if (!sceneManager) return;
  
  if (document.hidden) {
    sceneManager.pauseAll();
  } else {
    sceneManager.resumeAll();
  }
});

// Initialize
initSceneManager();

// Export for global access
window.SceneManager = SceneManager;
if (sceneManager) window.sceneManager = sceneManager;