// public/js/library-hall.js
class LibraryHall {
  constructor(options = {}) {
    this.webgl = options.webgl !== false;
    this.reducedMotion = options.reducedMotion || false;
    this.container = null;
    this.mode = null; // 'webgl', 'lottie', 'svg'
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.genreStacks = [];
    this.raycaster = null;
    this.mouse = window.THREE ? new THREE.Vector2() : { x: 0, y: 0 };
    this.hoveredStack = null;
    this.animationId = null;
    this.modal = null;
  }

  async mount(container) {
    this.container = container;
    
    // Setup genre buttons (always available)
    this.setupGenreButtons();
    this.setupModal();

    // Try different visual modes
    if (this.webgl && window.THREE && !this.reducedMotion) {
      try {
        await this.mountWebGL();
        this.mode = 'webgl';
        return;
      } catch (e) {
        console.warn('[HALL] WebGL failed, trying Lottie:', e);
      }
    }

    // Try Lottie fallback
    if (window.lottie) {
      try {
        await this.mountLottie();
        this.mode = 'lottie';
        return;
      } catch (e) {
        console.warn('[HALL] Lottie failed, using SVG:', e);
      }
    }

    // Final fallback: SVG
    this.mountSVG();
    this.mode = 'svg';
  }

  setupGenreButtons() {
    // Create genre buttons if they don't exist
    let stacksNav = this.container.querySelector('.genre-stacks');
    if (!stacksNav) {
      stacksNav = document.createElement('nav');
      stacksNav.className = 'genre-stacks';
      stacksNav.setAttribute('aria-label', 'Genres');
      
      const genres = ['History', 'Religion', 'Philosophy', 'Science', 'AI', 'Technology', 'Literature'];
      genres.forEach(genre => {
        const button = document.createElement('button');
        button.textContent = genre;
        button.className = 'genre-stack-btn';
        button.dataset.genre = genre;
        button.setAttribute('aria-label', `Browse ${genre} books`);
        
        // Style the button
        Object.assign(button.style, {
          padding: '12px 24px',
          margin: '8px',
          background: 'rgba(255, 255, 255, 0.1)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: '8px',
          color: '#fff',
          fontSize: '16px',
          fontWeight: '600',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
          backdropFilter: 'blur(10px)'
        });

        // Add hover effects
        button.addEventListener('mouseenter', () => {
          Object.assign(button.style, {
            background: 'rgba(108, 124, 255, 0.3)',
            borderColor: '#6c7cff',
            transform: 'translateY(-2px)',
            boxShadow: '0 4px 20px rgba(108, 124, 255, 0.3)'
          });
        });

        button.addEventListener('mouseleave', () => {
          Object.assign(button.style, {
            background: 'rgba(255, 255, 255, 0.1)',
            borderColor: 'rgba(255, 255, 255, 0.2)',
            transform: 'translateY(0)',
            boxShadow: 'none'
          });
        });

        button.addEventListener('click', () => this.populateShelf(genre));
        button.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.populateShelf(genre);
          }
        });

        stacksNav.appendChild(button);
      });

      // Position the nav
      Object.assign(stacksNav.style, {
        position: 'absolute',
        bottom: '10vh',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: '8px',
        zIndex: '5',
        maxWidth: '90vw'
      });

      this.container.appendChild(stacksNav);
    }
  }

  setupModal() {
    this.modal = document.getElementById('shelfModal');
    if (!this.modal) {
      // Create modal if it doesn't exist
      this.modal = document.createElement('div');
      this.modal.id = 'shelfModal';
      this.modal.className = 'shelf-modal hidden';
      this.modal.setAttribute('role', 'dialog');
      this.modal.setAttribute('aria-modal', 'true');
      this.modal.setAttribute('aria-hidden', 'true');
      
      this.modal.innerHTML = `
        <div class="shelf-content">
          <button class="shelf-close" aria-label="Close">×</button>
          <h2 id="shelfTitle"></h2>
          <div class="book-grid"></div>
        </div>
      `;

      this.container.appendChild(this.modal);
    }
  }

  async mountWebGL() {
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    this.container.appendChild(canvas);

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

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    this.scene.add(directionalLight);

    // Create library environment
    this.createLibraryEnvironment();
    
    // Create genre stacks (3D visualization)
    this.createGenreStacks3D();

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

    // Back wall
    const wallGeometry = new THREE.PlaneGeometry(20, 10);
    const wallMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const backWall = new THREE.Mesh(wallGeometry, wallMaterial);
    backWall.position.set(0, 5, -10);
    this.scene.add(backWall);

    // Add floating particles
    this.createFloatingParticles();
  }

  createFloatingParticles() {
    const particleCount = 30;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 20;     // x
      positions[i + 1] = Math.random() * 10;         // y
      positions[i + 2] = (Math.random() - 0.5) * 20; // z
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.05,
      transparent: true,
      opacity: 0.6
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }

  createGenreStacks3D() {
    const genres = [
      { name: 'History', color: 0x8B4513, position: [-6, 0, -6] },
      { name: 'Religion', color: 0x4B0082, position: [-2, 0, -6] },
      { name: 'Philosophy', color: 0x2E8B57, position: [2, 0, -6] },
      { name: 'Science', color: 0x1E90FF, position: [6, 0, -6] },
      { name: 'AI', color: 0xFF6347, position: [-3, 0, -2] },
      { name: 'Technology', color: 0x32CD32, position: [0, 0, -2] },
      { name: 'Literature', color: 0xFFD700, position: [3, 0, -2] }
    ];

    genres.forEach((genre, index) => {
      const stack = this.createBookStack3D(genre, index);
      this.genreStacks.push(stack);
      this.scene.add(stack);
    });
  }

  createBookStack3D(genre, index) {
    const stack = new THREE.Group();
    stack.userData = { genre: genre.name, index: index };

    // Create books
    for (let i = 0; i < 15; i++) {
      const bookGeometry = new THREE.BoxGeometry(0.3, 0.4, 0.05);
      const bookMaterial = new THREE.MeshLambertMaterial({ color: genre.color });
      const book = new THREE.Mesh(bookGeometry, bookMaterial);
      
      const x = (i % 3) * 0.35 - 0.35;
      const y = Math.floor(i / 3) * 0.45;
      const z = (Math.random() - 0.5) * 0.1;
      
      book.position.set(x, y, z);
      book.rotation.y = (Math.random() - 0.5) * 0.2;
      stack.add(book);
    }

    // Position stack
    stack.position.set(genre.position[0], genre.position[1], genre.position[2]);

    // Add hover zone for easier interaction
    const hoverGeometry = new THREE.BoxGeometry(1.5, 3, 1);
    const hoverMaterial = new THREE.MeshBasicMaterial({ 
      transparent: true, 
      opacity: 0,
      visible: false 
    });
    const hoverZone = new THREE.Mesh(hoverGeometry, hoverMaterial);
    hoverZone.position.set(0, 1.5, 0);
    hoverZone.userData = { isHoverZone: true, genre: genre.name };
    stack.add(hoverZone);

    return stack;
  }

  setupWebGLInteractions() {
    const canvas = this.container.querySelector('canvas');
    
    canvas.addEventListener('mousemove', (event) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.updateHover();
    });

    canvas.addEventListener('click', () => {
      if (this.hoveredStack) {
        const genre = this.hoveredStack.userData.genre;
        this.populateShelf(genre);
      }
    });
  }

  updateHover() {
    if (!this.raycaster || !this.camera) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    const hoverZones = [];
    this.genreStacks.forEach(stack => {
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
      this.hoveredStack = intersects[0].object.parent;
      this.hoveredStack.scale.set(1.1, 1.1, 1.1);
      document.body.style.cursor = 'pointer';
    } else {
      document.body.style.cursor = 'default';
    }
  }

  startRenderLoop() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      
      // Animate particles
      if (this.particles) {
        this.particles.rotation.y += 0.001;
        
        const positions = this.particles.geometry.attributes.position.array;
        for (let i = 1; i < positions.length; i += 3) {
          positions[i] += 0.002; // y movement
          if (positions[i] > 10) {
            positions[i] = 0;
          }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
      }

      // Subtle genre stack animations
      this.genreStacks.forEach((stack, index) => {
        const time = Date.now() * 0.0005;
        stack.rotation.y = Math.sin(time + index) * 0.02;
        stack.position.y = Math.sin(time * 1.5 + index) * 0.03;
      });

      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  async mountLottie() {
    const lottieContainer = document.createElement('div');
    lottieContainer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    this.container.appendChild(lottieContainer);

    this.instance = lottie.loadAnimation({
      container: lottieContainer,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path: '/assets/lottie/hall.json'
    });

    await new Promise((resolve, reject) => {
      this.instance.addEventListener('DOMLoaded', resolve, { once: true });
      this.instance.addEventListener('error', reject, { once: true });
      setTimeout(() => reject(new Error('Lottie load timeout')), 5000);
    });
  }

  mountSVG() {
    const img = document.createElement('img');
    img.src = '/assets/img/hall.svg';
    img.alt = 'Library Hall';
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
    this.container.appendChild(img);
    this.instance = img;
  }

  async populateShelf(genre) {
    console.log(`[HALL] genre=${genre}`);
    
    const modal = this.modal;
    const title = modal.querySelector('#shelfTitle') || modal.querySelector('h2');
    const grid = modal.querySelector('.book-grid');
    const closeBtn = modal.querySelector('.shelf-close');
    
    if (!modal || !grid) {
      console.warn('[HALL] Modal elements not found');
      return;
    }

    // Show modal
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    
    if (title) title.textContent = `${genre} Books`;
    grid.innerHTML = '<div style="text-align:center;padding:2rem;color:#ccc;">Loading books...</div>';

    try {
      // First attempt: direct genre search
      let results = await this.fetchBooks(genre);
      
      // Retry logic if <12 results (ensure never empty)
      if (results.length < 12) {
        console.log(`[HALL] genre=${genre} first attempt results=${results.length}, trying synonyms...`);
        
        // Second attempt: with synonyms
        const synonyms = this.getGenreSynonyms(genre);
        if (synonyms) {
          const retryResults = await this.fetchBooks(synonyms);
          results = results.concat(retryResults);
        }
        
        // Third attempt: fallback query if still <12
        if (results.length < 12) {
          const fallbackResults = await this.fetchBooks(`${genre} books`);
          results = results.concat(fallbackResults);
        }
        
        // Fourth attempt: seed data as ultimate fallback
        if (results.length < 12) {
          console.log(`[HALL] genre=${genre} using seed data fallback...`);
          const seedData = await this.fetchGenreSeeds(genre);
          results = results.concat(seedData);
        }
      }

      // Remove duplicates
      const uniqueResults = this.removeDuplicates(results);
      
      console.log(`[HALL] genre=${genre} final results=${uniqueResults.length}`);
      
      // Show at least 12 books (pad with seeds if needed)
      if (uniqueResults.length < 12) {
        const seedData = await this.fetchGenreSeeds(genre);
        const additionalSeeds = seedData.filter(seed => 
          !uniqueResults.some(book => book.title === seed.title)
        );
        uniqueResults.push(...additionalSeeds.slice(0, 12 - uniqueResults.length));
      }
      
      if (uniqueResults.length === 0) {
        grid.innerHTML = '<div style="text-align:center;padding:2rem;color:#ccc;">No books found for this genre</div>';
      } else {
        this.renderBooks(uniqueResults, grid);
      }
    } catch (error) {
      console.error(`[HALL] genre=${genre} error:`, error);
      // Use seed data even on error
      try {
        const seedData = await this.fetchGenreSeeds(genre);
        if (seedData.length > 0) {
          this.renderBooks(seedData, grid);
        } else {
          grid.innerHTML = '<div style="text-align:center;padding:2rem;color:#ff6b6b;">Failed to load books</div>';
        }
      } catch (seedError) {
        grid.innerHTML = '<div style="text-align:center;padding:2rem;color:#ff6b6b;">Failed to load books</div>';
      }
    }

    // Setup modal interactions
    this.setupModalInteractions(modal, closeBtn);
  }

  async fetchBooks(query) {
    const url = `/read?query=${encodeURIComponent(query)}&sources=ol,ia,loc,gutenberg&limit=24&format=json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Search failed');
    return await response.json();
  }

  async fetchGenreSeeds(genre) {
    try {
      const response = await fetch('/data/genre-seeds.json');
      if (!response.ok) throw new Error('Seed data not available');
      const seeds = await response.json();
      return seeds[genre] || [];
    } catch (error) {
      console.warn('[HALL] Failed to fetch seed data:', error);
      return [];
    }
  }

  getGenreSynonyms(genre) {
    const synonymMap = {
      'History': 'world history',
      'Religion': 'religious studies',
      'Philosophy': 'philosophical thought',
      'Science': 'scientific research',
      'AI': 'artificial intelligence',
      'Technology': 'computer science',
      'Literature': 'classic literature'
    };
    return synonymMap[genre] || null;
  }

  removeDuplicates(books) {
    const seen = new Set();
    return books.filter(book => {
      const key = `${book.title}:${book.author}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  renderBooks(books, grid) {
    const limitedBooks = books.slice(0, 24);
    
    grid.innerHTML = limitedBooks.map(book => `
      <div class="book-card" data-href="${book.href}">
        <img class="book-cover" src="${book.cover}" alt="${book.title}" loading="lazy" 
             onerror="this.src='/img/cover-fallback.svg'">
        <h3 class="book-title">${book.title}</h3>
        <p class="book-author">${book.author}</p>
        <span class="book-source">${book.source.toUpperCase()}</span>
        <button class="btn-read">Read</button>
      </div>
    `).join('');

    // Add click handlers
    grid.querySelectorAll('.book-card').forEach(card => {
      const href = card.dataset.href;
      const readBtn = card.querySelector('.btn-read');
      
      const handleClick = (e) => {
        e.preventDefault();
        if (href && href !== '#') {
          window.location.href = href; // Keep user on booklantern.org
        }
      };

      card.addEventListener('click', handleClick);
      readBtn.addEventListener('click', handleClick);
    });
  }

  setupModalInteractions(modal, closeBtn) {
    const closeModal = () => {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.cursor = 'default';
    };

    // Close button
    if (closeBtn) {
      closeBtn.onclick = closeModal;
    }

    // Backdrop click
    modal.onclick = (e) => {
      if (e.target === modal) {
        closeModal();
      }
    };

    // ESC key
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

    document.body.style.cursor = 'default';

    if (this.container) {
      // Remove only the visual elements, keep modal and buttons
      const canvas = this.container.querySelector('canvas');
      const lottieDiv = this.container.querySelector('div:not(.genre-stacks):not(.shelf-modal)');
      const img = this.container.querySelector('img');
      
      if (canvas) canvas.remove();
      if (lottieDiv) lottieDiv.remove();
      if (img) img.remove();
    }
  }
}

// Export to global scope
window.LibraryHall = LibraryHall;