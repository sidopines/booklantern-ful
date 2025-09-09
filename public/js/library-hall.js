// public/js/library-hall.js - Library Hall with 3D Stacks and Modal
class LibraryHall {
  constructor(options = {}) {
    this.webgl = options.webgl !== false;
    this.reducedMotion = options.reducedMotion || false;
    this.container = null;
    this.mode = null; // 'webgl', 'lottie', 'svg'
    this.instance = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.bookStacks = [];
    this.raycaster = null;
    this.mouse = window.THREE ? new THREE.Vector2() : { x: 0, y: 0 };
    this.hoveredStack = null;
    this.animationId = null;
  }

  async mount(container) {
    this.container = container;
    
    // Setup genre buttons first (always available)
    this.setupGenreButtons();

    // Try different visual modes
    if (this.webgl && window.THREE && !this.reducedMotion) {
      try {
        await this.mountWebGL();
        this.mode = 'webgl';
        console.log('[LibraryHall] Mounted WebGL mode');
        return;
      } catch (e) {
        console.warn('[LibraryHall] WebGL failed, trying Lottie:', e);
      }
    }

    // Try Lottie fallback
    if (window.lottie) {
      try {
        await this.mountLottie();
        this.mode = 'lottie';
        console.log('[LibraryHall] Mounted Lottie mode');
        return;
      } catch (e) {
        console.warn('[LibraryHall] Lottie failed, using SVG:', e);
      }
    }

    // Final fallback: SVG
    this.mountSVG();
    this.mode = 'svg';
    console.log('[LibraryHall] Mounted SVG mode');
  }

  setupGenreButtons() {
    const stacks = this.container.querySelector('.stacks');
    if (!stacks) return;

    stacks.querySelectorAll('button[data-genre]').forEach(button => {
      button.addEventListener('click', () => {
        const genre = button.dataset.genre;
        this.openShelf(genre);
      });

      // Add keyboard navigation
      button.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          button.click();
        }
      });
    });
  }

  async mountWebGL() {
    const canvas = this.container.querySelector('#hall3d');
    if (!canvas) throw new Error('WebGL canvas not found');

    this.raycaster = new THREE.Raycaster();

    // Initialize Three.js scene
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ 
      canvas: canvas,
      antialias: true,
      alpha: true
    });
    
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0b1020, 1);

    // Setup lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    this.scene.add(directionalLight);

    // Create library environment
    this.createLibraryEnvironment();
    
    // Create genre stacks
    this.createGenreStacks();

    // Position camera
    this.camera.position.set(0, 2, 8);
    this.camera.lookAt(0, 0, 0);

    // Setup interactions
    this.setupWebGLInteractions();

    // Start render loop
    this.startRenderLoop();

    // Handle resize
    this.handleResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', this.handleResize);
  }

  createLibraryEnvironment() {
    // Floor
    const floorGeometry = new THREE.PlaneGeometry(20, 20);
    const floorMaterial = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Walls with subtle texture
    const wallGeometry = new THREE.PlaneGeometry(20, 10);
    const wallMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    
    const backWall = new THREE.Mesh(wallGeometry, wallMaterial);
    backWall.position.set(0, 5, -10);
    this.scene.add(backWall);

    // Add floating dust particles
    this.createDustParticles();
  }

  createDustParticles() {
    const dustGeometry = new THREE.BufferGeometry();
    const dustCount = 50;
    const positions = new Float32Array(dustCount * 3);

    for (let i = 0; i < dustCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 20;     // x
      positions[i + 1] = Math.random() * 10;         // y
      positions[i + 2] = (Math.random() - 0.5) * 20; // z
    }

    dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const dustMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.02,
      transparent: true,
      opacity: 0.3
    });

    this.dustParticles = new THREE.Points(dustGeometry, dustMaterial);
    this.scene.add(this.dustParticles);
  }

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

  createBookStack(genre, index) {
    const stack = new THREE.Group();
    stack.userData = { genre: genre.name, index: index };

    // Create book geometry
    const bookGeometry = new THREE.BoxGeometry(0.3, 0.4, 0.05);
    const bookMaterial = new THREE.MeshLambertMaterial({ color: genre.color });
    
    // Create individual books
    for (let i = 0; i < 20; i++) {
      const book = new THREE.Mesh(bookGeometry, bookMaterial);
      const x = (i % 4) * 0.35 - 0.525;
      const y = Math.floor(i / 4) * 0.45;
      const z = (Math.random() - 0.5) * 0.1;
      
      book.position.set(x, y, z);
      book.rotation.y = (Math.random() - 0.5) * 0.2;
      stack.add(book);
    }

    // Position stack
    stack.position.set(genre.position[0], genre.position[1], genre.position[2]);

    // Add hover zone (invisible box for easier clicking)
    const hoverGeometry = new THREE.BoxGeometry(2, 3, 1);
    const hoverMaterial = new THREE.MeshBasicMaterial({ 
      transparent: true, 
      opacity: 0,
      visible: false 
    });
    const hoverZone = new THREE.Mesh(hoverGeometry, hoverMaterial);
    hoverZone.position.set(0, 1, 0);
    hoverZone.userData = { isHoverZone: true, genre: genre.name };
    stack.add(hoverZone);

    return stack;
  }

  setupWebGLInteractions() {
    const canvas = this.container.querySelector('#hall3d');
    
    canvas.addEventListener('mousemove', (event) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.updateHover();
    });

    canvas.addEventListener('click', (event) => {
      this.handleStackClick();
    });
  }

  updateHover() {
    if (!this.raycaster || !this.camera) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Find all hover zones
    const hoverZones = [];
    this.bookStacks.forEach(stack => {
      stack.children.forEach(child => {
        if (child.userData.isHoverZone) {
          hoverZones.push(child);
        }
      });
    });

    const intersects = this.raycaster.intersectObjects(hoverZones);

    // Reset previous hover
    if (this.hoveredStack) {
      this.hoveredStack.scale.set(1, 1, 1);
      this.hoveredStack = null;
    }

    // Set new hover
    if (intersects.length > 0) {
      this.hoveredStack = intersects[0].object.parent; // Get the stack group
      this.hoveredStack.scale.set(1.05, 1.05, 1.05);
      document.body.style.cursor = 'pointer';
    } else {
      document.body.style.cursor = 'default';
    }
  }

  handleStackClick() {
    if (this.hoveredStack) {
      const genre = this.hoveredStack.userData.genre;
      this.openShelf(genre);
    }
  }

  startRenderLoop() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      
      // Animate dust particles
      if (this.dustParticles) {
        this.dustParticles.rotation.y += 0.001;
        
        // Move dust particles
        const positions = this.dustParticles.geometry.attributes.position.array;
        for (let i = 1; i < positions.length; i += 3) {
          positions[i] += 0.001; // y movement
          if (positions[i] > 10) {
            positions[i] = 0; // Reset to bottom
          }
        }
        this.dustParticles.geometry.attributes.position.needsUpdate = true;
      }

      // Subtle book stack animations
      this.bookStacks.forEach((stack, index) => {
        const time = Date.now() * 0.0005;
        stack.rotation.y = Math.sin(time + index) * 0.02;
        stack.position.y = Math.sin(time * 2 + index) * 0.05;
      });

      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  async mountLottie() {
    const lottieContainer = this.container.querySelector('#hallLottie');
    if (!lottieContainer) throw new Error('Lottie container not found');

    lottieContainer.classList.remove('hidden');

    this.instance = lottie.loadAnimation({
      container: lottieContainer,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path: '/assets/lottie/hall.json'
    });

    // Wait for animation to load
    await new Promise((resolve, reject) => {
      this.instance.addEventListener('DOMLoaded', resolve, { once: true });
      this.instance.addEventListener('error', reject, { once: true });
      setTimeout(() => reject(new Error('Lottie load timeout')), 5000);
    });
  }

  mountSVG() {
    const svg = this.container.querySelector('#hallSvg');
    if (!svg) {
      console.warn('[LibraryHall] SVG element not found');
      return;
    }

    svg.classList.remove('hidden');
    this.instance = svg;
  }

  async openShelf(genre) {
    const modal = document.getElementById('shelfModal');
    const title = document.getElementById('shelfTitle');
    const grid = document.querySelector('.grid.books');
    
    if (!modal || !title || !grid) {
      console.warn('[LibraryHall] Modal elements not found');
      return;
    }

    title.textContent = `${genre} Books`;
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--muted);">Loading books...</div>';
    
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    try {
      // Check auth status first
      const isLoggedIn = await this.checkAuthStatus();
      
      // Fetch books for this genre
      const response = await fetch(`/read?query=${encodeURIComponent(genre)}`);
      const html = await response.text();
      
      // Parse the response to extract book data
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const bookCards = doc.querySelectorAll('.book-card, .item-card, .result-item');
      
      if (bookCards.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--muted);">No books found for this genre</div>';
        return;
      }

      // Convert found books to modal format
      const books = Array.from(bookCards).slice(0, 12).map(card => {
        const titleEl = card.querySelector('h3, .title, .book-title');
        const authorEl = card.querySelector('.author, .creator, .book-author');
        const coverEl = card.querySelector('img');
        const linkEl = card.querySelector('a') || card;
        
        return {
          title: titleEl?.textContent?.trim() || 'Untitled',
          author: authorEl?.textContent?.trim() || 'Unknown Author',
          cover: coverEl?.src || '/img/cover-fallback.svg',
          link: linkEl?.getAttribute('href') || '#'
        };
      });

      this.populateShelf(books, grid, isLoggedIn);
    } catch (error) {
      console.error('Failed to fetch books:', error);
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--error);">Failed to load books</div>';
    }

    // Setup modal interactions
    this.setupModalInteractions(modal);
  }

  async checkAuthStatus() {
    try {
      const response = await fetch('/me');
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  populateShelf(books, grid, isLoggedIn) {
    grid.innerHTML = books.map(book => `
      <div class="book-card" data-book-link="${book.link}">
        <img src="${book.cover}" alt="${book.title}" loading="lazy" onerror="this.src='/img/cover-fallback.svg'">
        <div class="title">${book.title}</div>
        <div class="author">${book.author}</div>
        <div class="source">Read Now</div>
      </div>
    `).join('');

    // Add click handlers
    grid.querySelectorAll('.book-card').forEach(card => {
      card.addEventListener('click', () => {
        const bookLink = card.dataset.bookLink;
        if (bookLink && bookLink !== '#') {
          if (!isLoggedIn) {
            // Redirect to login with next parameter
            window.location.href = `/login?next=${encodeURIComponent(bookLink)}`;
          } else {
            // Navigate to book
            window.location.href = bookLink;
          }
        }
      });
    });
  }

  setupModalInteractions(modal) {
    const closeBtn = modal.querySelector('.close');
    const backdrop = modal.querySelector('.modal-backdrop');
    
    // Close handlers
    const closeModal = () => {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    };

    if (closeBtn) {
      closeBtn.removeEventListener('click', closeModal); // Remove any existing listeners
      closeBtn.addEventListener('click', closeModal);
    }
    
    if (backdrop) {
      backdrop.removeEventListener('click', closeModal);
      backdrop.addEventListener('click', closeModal);
    }
    
    // ESC key handler
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', handleKeydown);
      }
    };
    document.addEventListener('keydown', handleKeydown);

    // Focus management
    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }
  }

  pause() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    if (this.mode === 'lottie' && this.instance) {
      this.instance.pause();
    }
  }

  resume() {
    if (this.mode === 'webgl' && !this.animationId) {
      this.startRenderLoop();
    } else if (this.mode === 'lottie' && this.instance) {
      this.instance.play();
    }
  }

  dispose() {
    this.pause();

    if (this.handleResize) {
      window.removeEventListener('resize', this.handleResize);
    }

    if (this.renderer) {
      this.renderer.dispose();
    }

    if (this.scene) {
      this.scene.clear();
    }

    if (this.mode === 'lottie' && this.instance) {
      this.instance.destroy();
    }

    // Reset cursor
    document.body.style.cursor = 'default';

    // Hide all elements
    ['#hall3d', '#hallLottie', '#hallSvg'].forEach(selector => {
      const el = this.container?.querySelector(selector);
      if (el) el.classList.add('hidden');
    });
  }
}

// Export to global scope
window.LibraryHall = LibraryHall;