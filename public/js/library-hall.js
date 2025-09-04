/**
 * Library Hall Scene - 3D Library with 7 Genre Stacks
 * Instanced book meshes for performance with hover/click interactions
 */

class LibraryHall {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.bookStacks = [];
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.hoveredStack = null;
    this.animationId = null;
  }

  /**
   * Initialize WebGL scene
   */
  async initWebGL() {
    const container = document.getElementById('hall3d');
    if (!container) throw new Error('Hall container not found');

    // Scene setup
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ 
      canvas: container,
      antialias: true,
      alpha: true
    });
    
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0b1020, 1);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
    this.scene.add(ambientLight);

    // God rays effect
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    this.scene.add(directionalLight);

    // Create library hall
    this.createLibraryHall();
    
    // Create genre stacks
    this.createGenreStacks();

    // Position camera
    this.camera.position.set(0, 2, 8);
    this.camera.lookAt(0, 0, 0);

    // Start render loop
    this.animate();

    // Handle interactions
    this.setupInteractions();

    // Handle resize
    window.addEventListener('resize', this.onResize.bind(this));

    return {
      pause: () => this.pause(),
      resume: () => this.resume(),
      destroy: () => this.destroy()
    };
  }

  /**
   * Create library hall environment
   */
  createLibraryHall() {
    // Floor
    const floorGeometry = new THREE.PlaneGeometry(20, 20);
    const floorMaterial = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Walls
    const wallGeometry = new THREE.PlaneGeometry(20, 10);
    const wallMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    
    // Back wall
    const backWall = new THREE.Mesh(wallGeometry, wallMaterial);
    backWall.position.set(0, 5, -10);
    this.scene.add(backWall);

    // Side walls
    const leftWall = new THREE.Mesh(wallGeometry, wallMaterial);
    leftWall.position.set(-10, 5, 0);
    leftWall.rotation.y = Math.PI / 2;
    this.scene.add(leftWall);

    const rightWall = new THREE.Mesh(wallGeometry, wallMaterial);
    rightWall.position.set(10, 5, 0);
    rightWall.rotation.y = -Math.PI / 2;
    this.scene.add(rightWall);

    // Ceiling
    const ceilingGeometry = new THREE.PlaneGeometry(20, 20);
    const ceilingMaterial = new THREE.MeshLambertMaterial({ color: 0x0f0f0f });
    const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
    ceiling.position.set(0, 10, 0);
    ceiling.rotation.x = Math.PI / 2;
    this.scene.add(ceiling);
  }

  /**
   * Create 7 genre stacks
   */
  createGenreStacks() {
    const genres = [
      { name: 'History', color: 0x8B4513, position: [-6, 0, -6] },
      { name: 'Religion', color: 0x4B0082, position: [-2, 0, -6] },
      { name: 'Philosophy', color: 0x2E8B57, position: [2, 0, -6] },
      { name: 'Science', color: 0x1E90FF, position: [6, 0, -6] },
      { name: 'AI', color: 0xFF6347, position: [-4, 0, -2] },
      { name: 'Technology', color: 0x32CD32, position: [0, 0, -2] },
      { name: 'Literature', color: 0xFFD700, position: [4, 0, -2] }
    ];

    genres.forEach((genre, index) => {
      const stack = this.createBookStack(genre, index);
      this.bookStacks.push(stack);
      this.scene.add(stack);
    });
  }

  /**
   * Create individual book stack
   */
  createBookStack(genre, index) {
    const stack = new THREE.Group();
    stack.userData = { genre: genre.name, index: index };

    // Create instanced books
    const bookGeometry = new THREE.BoxGeometry(0.3, 0.4, 0.05);
    const bookMaterial = new THREE.MeshLambertMaterial({ color: genre.color });
    
    const instancedMesh = new THREE.InstancedMesh(bookGeometry, bookMaterial, 50);
    
    // Position books in stack
    for (let i = 0; i < 50; i++) {
      const matrix = new THREE.Matrix4();
      const x = (i % 5) * 0.35 - 0.7;
      const y = Math.floor(i / 5) * 0.45;
      const z = (Math.floor(i / 25) * 0.1) - 0.1;
      
      matrix.setPosition(x, y, z);
      instancedMesh.setMatrixAt(i, matrix);
    }
    
    instancedMesh.instanceMatrix.needsUpdate = true;
    stack.add(instancedMesh);

    // Position stack
    stack.position.set(genre.position[0], genre.position[1], genre.position[2]);

    // Add subtle glow
    const glowGeometry = new THREE.SphereGeometry(1.5, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({ 
      color: genre.color,
      transparent: true,
      opacity: 0.1
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.set(0, 1, 0);
    stack.add(glow);

    return stack;
  }

  /**
   * Setup mouse interactions
   */
  setupInteractions() {
    const container = document.getElementById('hall3d');
    
    container.addEventListener('mousemove', (event) => {
      const rect = container.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      
      this.updateHover();
    });

    container.addEventListener('click', (event) => {
      this.handleClick();
    });
  }

  /**
   * Update hover effects
   */
  updateHover() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.bookStacks);

    // Reset previous hover
    if (this.hoveredStack) {
      this.hoveredStack.scale.set(1, 1, 1);
      this.hoveredStack = null;
    }

    // Set new hover
    if (intersects.length > 0) {
      this.hoveredStack = intersects[0].object;
      this.hoveredStack.scale.set(1.1, 1.1, 1.1);
    }
  }

  /**
   * Handle stack click
   */
  handleClick() {
    if (this.hoveredStack) {
      const genre = this.hoveredStack.userData.genre;
      this.openShelfModal(genre);
    }
  }

  /**
   * Open shelf modal with books
   */
  async openShelfModal(genre) {
    const modal = document.getElementById('shelf-modal');
    const title = document.getElementById('shelf-modal-title');
    const grid = document.getElementById('shelf-books-grid');
    
    if (!modal || !title || !grid) return;

    title.textContent = `${genre} Books`;
    grid.innerHTML = '<div class="loading">Loading books...</div>';
    
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'flex';

    try {
      // Fetch books for this genre
      const books = await this.fetchBooksByGenre(genre);
      this.populateShelf(books, grid);
    } catch (error) {
      console.error('Failed to fetch books:', error);
      grid.innerHTML = '<div class="error">Failed to load books</div>';
    }

    // Focus trap
    this.setupModalFocusTrap(modal);
  }

  /**
   * Fetch books by genre
   */
  async fetchBooksByGenre(genre) {
    // Use existing search endpoints
    const response = await fetch(`/api/search?q=${encodeURIComponent(genre)}&limit=12`);
    if (!response.ok) throw new Error('Search failed');
    
    const data = await response.json();
    return data.results || data.items || [];
  }

  /**
   * Populate shelf with books
   */
  populateShelf(books, grid) {
    if (!books.length) {
      grid.innerHTML = '<div class="empty">No books found for this genre</div>';
      return;
    }

    grid.innerHTML = books.map(book => `
      <div class="book-card" data-book-id="${book.identifier || book.id}">
        <div class="book-cover">
          ${book.cover ? `<img src="${book.cover}" alt="${book.title}" loading="lazy">` : ''}
        </div>
        <div class="book-info">
          <h3>${book.title || 'Untitled'}</h3>
          <p>${book.creator || 'Unknown Author'}</p>
        </div>
      </div>
    `).join('');

    // Add click handlers
    grid.querySelectorAll('.book-card').forEach(card => {
      card.addEventListener('click', () => {
        const bookId = card.dataset.bookId;
        this.handleBookClick(bookId, book);
      });
    });
  }

  /**
   * Handle book click
   */
  handleBookClick(bookId, book) {
    // Check if user is logged in
    const isLoggedIn = window.IS_LOGGED_IN || false;
    
    if (!isLoggedIn) {
      // Redirect to login with next parameter
      const bookUrl = `/read/book/${encodeURIComponent(bookId)}`;
      window.location.href = `/login?next=${encodeURIComponent(bookUrl)}`;
    } else {
      // Navigate to book
      const bookUrl = `/read/book/${encodeURIComponent(bookId)}`;
      window.location.href = bookUrl;
    }
  }

  /**
   * Setup modal focus trap
   */
  setupModalFocusTrap(modal) {
    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
      } else if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement) {
            firstElement.focus();
            e.preventDefault();
          }
        }
      }
    });

    // Close modal handlers
    modal.querySelector('.shelf-modal-close').addEventListener('click', () => {
      this.closeModal();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeModal();
      }
    });

    // Focus first element
    firstElement?.focus();
  }

  /**
   * Close modal
   */
  closeModal() {
    const modal = document.getElementById('shelf-modal');
    if (modal) {
      modal.setAttribute('aria-hidden', 'true');
      modal.style.display = 'none';
    }
  }

  /**
   * Animation loop
   */
  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());
    
    // Subtle book stack animations
    this.bookStacks.forEach((stack, index) => {
      stack.rotation.y = Math.sin(Date.now() * 0.0005 + index) * 0.05;
    });

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Handle window resize
   */
  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * Pause animation
   */
  pause() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Resume animation
   */
  resume() {
    if (!this.animationId) {
      this.animate();
    }
  }

  /**
   * Destroy scene
   */
  destroy() {
    this.pause();
    window.removeEventListener('resize', this.onResize.bind(this));
    
    if (this.renderer) {
      this.renderer.dispose();
    }
    
    if (this.scene) {
      this.scene.clear();
    }
  }
}

/**
 * Initialize Lottie fallback
 */
async function initLottie() {
  const container = document.getElementById('hall-lottie');
  if (!container || !window.lottie) return null;

  const animation = lottie.loadAnimation({
    container: container,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    path: '/animations/library-hall.json'
  });

  return {
    pause: () => animation.pause(),
    resume: () => animation.play(),
    destroy: () => animation.destroy()
  };
}

/**
 * Initialize SVG fallback
 */
async function initSVG() {
  const container = document.getElementById('hall-fallback');
  if (!container) return null;

  container.hidden = false;
  
  return {
    pause: () => {},
    resume: () => {},
    destroy: () => {}
  };
}

// Export for SceneManager
export { LibraryHall, initWebGL, initLottie, initSVG };

// WebGL initialization
async function initWebGL() {
  const libraryHall = new LibraryHall();
  return await libraryHall.initWebGL();
}
