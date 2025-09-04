/**
 * public/js/library-scene.js - 3D Library Hall Scene
 * Cinematic library with genre stacks and interactive book browsing
 */

export function initLibraryScene({ containerId = 'library3d' } = {}) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn('[Library Scene] Container not found:', containerId);
    return null;
  }

  let scene, camera, renderer, libraryGroup, genreStacks = [], godRays, dustMotes;
  let animationId;
  let isAnimating = true;

  // Scene setup
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a1a2e, 20, 100);

  // Camera
  camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 3, 10);

  // Renderer
  renderer = new THREE.WebGLRenderer({ 
    alpha: true, 
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x2a2a3a, 0.4);
  scene.add(ambientLight);

  // God rays (volumetric lighting)
  const godRayLight = new THREE.DirectionalLight(0xffd700, 1.2);
  godRayLight.position.set(5, 15, 5);
  godRayLight.castShadow = true;
  godRayLight.shadow.mapSize.width = 2048;
  godRayLight.shadow.mapSize.height = 2048;
  scene.add(godRayLight);

  // Create library hall
  libraryGroup = new THREE.Group();

  // Floor
  const floorGeometry = new THREE.PlaneGeometry(50, 50);
  const floorMaterial = new THREE.MeshLambertMaterial({ 
    color: 0x2a2a2a,
    map: createMarbleTexture()
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  libraryGroup.add(floor);

  // Bookshelves
  createBookshelves();

  // Genre stacks
  const genres = [
    { name: 'History', color: 0x8B4513, position: [-8, 0, -5] },
    { name: 'Religion', color: 0x4B0082, position: [-4, 0, -5] },
    { name: 'Philosophy', color: 0x2E8B57, position: [0, 0, -5] },
    { name: 'Science', color: 0x1E90FF, position: [4, 0, -5] },
    { name: 'AI', color: 0xFF6347, position: [8, 0, -5] },
    { name: 'Technology', color: 0x32CD32, position: [-6, 0, 5] },
    { name: 'Literature', color: 0xDC143C, position: [6, 0, 5] }
  ];

  genres.forEach((genre, index) => {
    const stack = createGenreStack(genre, index);
    genreStacks.push(stack);
    libraryGroup.add(stack);
  });

  scene.add(libraryGroup);

  // God rays effect
  godRays = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const rayGeometry = new THREE.CylinderGeometry(0.1, 2, 20, 8);
    const rayMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      transparent: true,
      opacity: 0.1
    });
    const ray = new THREE.Mesh(rayGeometry, rayMaterial);
    ray.position.set(
      (Math.random() - 0.5) * 20,
      10,
      (Math.random() - 0.5) * 20
    );
    ray.rotation.x = Math.PI / 2;
    godRays.add(ray);
  }
  scene.add(godRays);

  // Dust motes
  const dustCount = 300;
  const dustGeometry = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(dustCount * 3);
  const dustVelocities = new Float32Array(dustCount * 3);

  for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 40;
    dustPositions[i * 3 + 1] = Math.random() * 15;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 40;
    
    dustVelocities[i * 3] = (Math.random() - 0.5) * 0.01;
    dustVelocities[i * 3 + 1] = -Math.random() * 0.005;
    dustVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
  }

  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute('velocity', new THREE.BufferAttribute(dustVelocities, 3));

  const dustMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.05,
    transparent: true,
    opacity: 0.3
  });

  dustMotes = new THREE.Points(dustGeometry, dustMaterial);
  scene.add(dustMotes);

  // GSAP entrance animation
  const tl = gsap.timeline();
  tl.from(libraryGroup.scale, { duration: 2, x: 0, y: 0, z: 0, ease: "back.out(1.7)" })
    .from(camera.position, { duration: 2.5, z: 20, ease: "power2.out" }, 0)
    .from(godRays.rotation, { duration: 3, y: Math.PI, ease: "power2.out" }, 0.5);

  // Mouse interaction
  const mouse = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  let hoveredStack = null;

  const onMouseMove = (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Gentle camera movement
    camera.position.x = mouse.x * 2;
    camera.position.y = 3 + mouse.y * 1;
    camera.lookAt(0, 0, 0);
    
    // Raycast for stack interaction
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(genreStacks);
    
    if (intersects.length > 0) {
      const stack = intersects[0].object;
      if (hoveredStack !== stack) {
        // Reset previous hover
        if (hoveredStack) {
          gsap.to(hoveredStack.scale, { duration: 0.3, x: 1, y: 1, z: 1 });
          gsap.to(hoveredStack.material.emissive, { duration: 0.3, r: 0, g: 0, b: 0 });
        }
        
        // New hover
        hoveredStack = stack;
        gsap.to(stack.scale, { duration: 0.3, x: 1.1, y: 1.1, z: 1.1 });
        gsap.to(stack.material.emissive, { duration: 0.3, r: 0.2, g: 0.2, b: 0.2 });
        
        // Show genre label
        showGenreLabel(stack.userData.genre);
      }
    } else if (hoveredStack) {
      // Reset hover
      gsap.to(hoveredStack.scale, { duration: 0.3, x: 1, y: 1, z: 1 });
      gsap.to(hoveredStack.material.emissive, { duration: 0.3, r: 0, g: 0, b: 0 });
      hoveredStack = null;
      hideGenreLabel();
    }
  };

  const onMouseClick = (event) => {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(genreStacks);
    
    if (intersects.length > 0) {
      const stack = intersects[0].object;
      const genre = stack.userData.genre;
      showGenreBooks(genre);
    }
  };

  // Animation loop
  const animate = () => {
    if (!isAnimating) return;
    
    animationId = requestAnimationFrame(animate);
    
    const time = Date.now() * 0.001;
    
    // Gentle library sway
    libraryGroup.rotation.y += Math.sin(time * 0.3) * 0.001;
    
    // God rays rotation
    godRays.rotation.y += 0.002;
    
    // Dust animation
    const positions = dustMotes.geometry.attributes.position.array;
    const velocities = dustMotes.geometry.attributes.velocity.array;
    
    for (let i = 0; i < dustCount; i++) {
      positions[i * 3] += velocities[i * 3];
      positions[i * 3 + 1] += velocities[i * 3 + 1];
      positions[i * 3 + 2] += velocities[i * 3 + 2];
      
      // Reset dust that falls too low
      if (positions[i * 3 + 1] < 0) {
        positions[i * 3 + 1] = 15;
        positions[i * 3] = (Math.random() - 0.5) * 40;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
      }
    }
    
    dustMotes.geometry.attributes.position.needsUpdate = true;
    
    renderer.render(scene, camera);
  };

  // Resize handler
  const onResize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };

  // Event listeners
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('click', onMouseClick);
  window.addEventListener('resize', onResize);
  window.addEventListener('visibilitychange', () => {
    isAnimating = !document.hidden;
    if (isAnimating) animate();
  });

  // Start animation
  animate();

  // Helper functions
  function createBookshelves() {
    // Back wall
    for (let i = -10; i <= 10; i += 2) {
      const shelfGeometry = new THREE.BoxGeometry(1.8, 8, 0.2);
      const shelfMaterial = new THREE.MeshLambertMaterial({ color: 0x654321 });
      const shelf = new THREE.Mesh(shelfGeometry, shelfMaterial);
      shelf.position.set(i, 4, -10);
      shelf.castShadow = true;
      shelf.receiveShadow = true;
      libraryGroup.add(shelf);
      
      // Books on shelf
      for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 6; k++) {
          const bookGeometry = new THREE.BoxGeometry(0.25, 0.3, 0.15);
          const bookMaterial = new THREE.MeshLambertMaterial({ 
            color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5)
          });
          const book = new THREE.Mesh(bookGeometry, bookMaterial);
          book.position.set(
            i - 0.6 + k * 0.3,
            1 + j * 0.35,
            -9.9
          );
          book.castShadow = true;
          libraryGroup.add(book);
        }
      }
    }
  }

  function createGenreStack(genre, index) {
    const stackGroup = new THREE.Group();
    
    // Stack base
    const baseGeometry = new THREE.CylinderGeometry(1.5, 1.5, 0.2, 8);
    const baseMaterial = new THREE.MeshPhongMaterial({ 
      color: genre.color,
      emissive: new THREE.Color(genre.color).multiplyScalar(0.1)
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.castShadow = true;
    base.receiveShadow = true;
    stackGroup.add(base);
    
    // Books in stack
    for (let i = 0; i < 12; i++) {
      const bookGeometry = new THREE.BoxGeometry(0.2, 0.3, 0.15);
      const bookMaterial = new THREE.MeshLambertMaterial({ 
        color: new THREE.Color(genre.color).multiplyScalar(0.8 + Math.random() * 0.4)
      });
      const book = new THREE.Mesh(bookGeometry, bookMaterial);
      
      const angle = (i / 12) * Math.PI * 2;
      const radius = 1.2;
      book.position.set(
        Math.cos(angle) * radius,
        0.1 + Math.floor(i / 4) * 0.35,
        Math.sin(angle) * radius
      );
      book.rotation.y = angle;
      book.castShadow = true;
      stackGroup.add(book);
    }
    
    stackGroup.position.set(genre.position[0], genre.position[1], genre.position[2]);
    stackGroup.userData = { genre: genre.name };
    
    return stackGroup;
  }

  function createMarbleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    // Marble pattern
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, 512, 512);
    
    for (let i = 0; i < 100; i++) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${Math.random() * 0.1})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(Math.random() * 512, Math.random() * 512);
      ctx.quadraticCurveTo(
        Math.random() * 512, Math.random() * 512,
        Math.random() * 512, Math.random() * 512
      );
      ctx.stroke();
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
  }

  function showGenreLabel(genreName) {
    let label = document.getElementById('genre-label');
    if (!label) {
      label = document.createElement('div');
      label.id = 'genre-label';
      label.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 18px;
        font-weight: bold;
        pointer-events: none;
        z-index: 1000;
        backdrop-filter: blur(10px);
      `;
      document.body.appendChild(label);
    }
    label.textContent = genreName;
    label.style.display = 'block';
  }

  function hideGenreLabel() {
    const label = document.getElementById('genre-label');
    if (label) {
      label.style.display = 'none';
    }
  }

  function showGenreBooks(genreName) {
    // Create book dropdown panel
    let panel = document.getElementById('genre-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'genre-panel';
      panel.style.cssText = `
        position: fixed;
        top: 20%;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 20px;
        border-radius: 12px;
        max-width: 600px;
        max-height: 400px;
        overflow-y: auto;
        z-index: 1001;
        backdrop-filter: blur(15px);
        border: 1px solid rgba(255, 255, 255, 0.1);
      `;
      document.body.appendChild(panel);
    }

    // Mock book data (in real implementation, fetch from API)
    const mockBooks = [
      { title: `${genreName} Book 1`, author: 'Author One' },
      { title: `${genreName} Book 2`, author: 'Author Two' },
      { title: `${genreName} Book 3`, author: 'Author Three' },
      { title: `${genreName} Book 4`, author: 'Author Four' },
      { title: `${genreName} Book 5`, author: 'Author Five' },
      { title: `${genreName} Book 6`, author: 'Author Six' }
    ];

    panel.innerHTML = `
      <h3 style="margin: 0 0 15px 0; color: #ffd700;">${genreName} Collection</h3>
      <div style="display: grid; gap: 10px;">
        ${mockBooks.map(book => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 6px;">
            <div>
              <div style="font-weight: bold;">${book.title}</div>
              <div style="font-size: 14px; color: #ccc;">by ${book.author}</div>
            </div>
            <button onclick="window.location.href='/login'" style="background: #ffd700; color: black; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;">
              Read
            </button>
          </div>
        `).join('')}
      </div>
      <button onclick="document.getElementById('genre-panel').style.display='none'" style="margin-top: 15px; background: transparent; color: white; border: 1px solid white; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
        Close
      </button>
    `;

    panel.style.display = 'block';
  }

  // Return controller
  return {
    pause() {
      isAnimating = false;
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    },
    resume() {
      isAnimating = true;
      if (!animationId) {
        animate();
      }
    },
    destroy() {
      isAnimating = false;
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('click', onMouseClick);
      window.removeEventListener('resize', onResize);
      
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      
      // Clean up UI elements
      const label = document.getElementById('genre-label');
      if (label) label.remove();
      const panel = document.getElementById('genre-panel');
      if (panel) panel.remove();
      
      renderer.dispose();
    }
  };
}
