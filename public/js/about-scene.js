/**
 * public/js/about-scene.js - 3D Timeline Scene for About Page
 * Dim library corridor with flickering candles and timeline nodes
 */

export function initAboutScene({ containerId = 'about3d' } = {}) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn('[About Scene] Container not found:', containerId);
    return null;
  }

  let scene, camera, renderer, corridorGroup, candles = [], timelineNodes = [];
  let animationId;
  let isAnimating = true;

  // Scene setup
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a1a2e, 5, 25);

  // Camera
  camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 2, 8);

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
  renderer.toneMappingExposure = 0.6;
  container.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x2a2a3a, 0.2);
  scene.add(ambientLight);

  // Create corridor
  corridorGroup = new THREE.Group();

  // Floor
  const floorGeometry = new THREE.PlaneGeometry(8, 30);
  const floorMaterial = new THREE.MeshLambertMaterial({ 
    color: 0x2a2a2a,
    map: createStoneTexture()
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  corridorGroup.add(floor);

  // Left wall
  const wallGeometry = new THREE.PlaneGeometry(30, 6);
  const wallMaterial = new THREE.MeshLambertMaterial({ 
    color: 0x3a3a3a,
    map: createBrickTexture()
  });
  const leftWall = new THREE.Mesh(wallGeometry, wallMaterial);
  leftWall.position.set(-4, 3, 0);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.receiveShadow = true;
  corridorGroup.add(leftWall);

  // Right wall
  const rightWall = new THREE.Mesh(wallGeometry, wallMaterial);
  rightWall.position.set(4, 3, 0);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.receiveShadow = true;
  corridorGroup.add(rightWall);

  // Ceiling
  const ceilingGeometry = new THREE.PlaneGeometry(8, 30);
  const ceilingMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.position.set(0, 6, 0);
  ceiling.rotation.x = Math.PI / 2;
  corridorGroup.add(ceiling);

  scene.add(corridorGroup);

  // Create candles along the corridor
  const candlePositions = [
    { x: -3, z: -10, year: '2020' },
    { x: 3, z: -5, year: '2021' },
    { x: -3, z: 0, year: '2022' },
    { x: 3, z: 5, year: '2023' },
    { x: -3, z: 10, year: '2024' }
  ];

  candlePositions.forEach((pos, index) => {
    const candle = createCandle(pos.x, pos.z, pos.year, index);
    candles.push(candle);
    corridorGroup.add(candle);
  });

  // Timeline nodes
  const timelineData = [
    { year: '2020', title: 'Foundation', description: 'BookLantern was born from a vision to make knowledge accessible to everyone.' },
    { year: '2021', title: 'First Library', description: 'Launched with 1,000 free books from Project Gutenberg.' },
    { year: '2022', title: 'Community Growth', description: 'Reached 10,000 active readers and expanded our collection.' },
    { year: '2023', title: 'AI Integration', description: 'Introduced AI-powered search and personalized recommendations.' },
    { year: '2024', title: 'Global Reach', description: 'Serving readers in 50+ countries with 100,000+ books.' }
  ];

  timelineData.forEach((data, index) => {
    const node = createTimelineNode(data, index);
    timelineNodes.push(node);
    corridorGroup.add(node);
  });

  // GSAP entrance animation
  const tl = gsap.timeline();
  tl.from(corridorGroup.scale, { duration: 2, x: 0, y: 0, z: 0, ease: "back.out(1.7)" })
    .from(camera.position, { duration: 2.5, z: 15, ease: "power2.out" }, 0)
    .from(candles, { duration: 1.5, opacity: 0, stagger: 0.2, ease: "power2.out" }, 0.5);

  // Mouse interaction
  const mouse = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  let hoveredNode = null;

  const onMouseMove = (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Gentle camera movement
    camera.position.x = mouse.x * 0.5;
    camera.position.y = 2 + mouse.y * 0.3;
    camera.lookAt(0, 0, 0);
    
    // Raycast for timeline node interaction
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(timelineNodes);
    
    if (intersects.length > 0) {
      const node = intersects[0].object;
      if (hoveredNode !== node) {
        // Reset previous hover
        if (hoveredNode) {
          gsap.to(hoveredNode.scale, { duration: 0.3, x: 1, y: 1, z: 1 });
        }
        
        // New hover
        hoveredNode = node;
        gsap.to(node.scale, { duration: 0.3, x: 1.2, y: 1.2, z: 1.2 });
        
        // Show timeline info
        showTimelineInfo(node.userData);
      }
    } else if (hoveredNode) {
      // Reset hover
      gsap.to(hoveredNode.scale, { duration: 0.3, x: 1, y: 1, z: 1 });
      hoveredNode = null;
      hideTimelineInfo();
    }
  };

  const onMouseClick = (event) => {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(timelineNodes);
    
    if (intersects.length > 0) {
      const node = intersects[0].object;
      showTimelineDetail(node.userData);
    }
  };

  // Animation loop
  const animate = () => {
    if (!isAnimating) return;
    
    animationId = requestAnimationFrame(animate);
    
    const time = Date.now() * 0.001;
    
    // Candle flickering
    candles.forEach((candle, index) => {
      const flame = candle.children.find(child => child.userData.isFlame);
      if (flame) {
        flame.material.emissiveIntensity = 0.5 + Math.sin(time * 10 + index) * 0.3;
        flame.scale.y = 1 + Math.sin(time * 15 + index) * 0.2;
      }
    });
    
    // Gentle corridor sway
    corridorGroup.rotation.y = Math.sin(time * 0.2) * 0.01;
    
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
  function createCandle(x, z, year, index) {
    const candleGroup = new THREE.Group();
    
    // Candle base
    const candleGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.8, 8);
    const candleMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const candleBase = new THREE.Mesh(candleGeometry, candleMaterial);
    candleBase.position.set(0, 0.4, 0);
    candleBase.castShadow = true;
    candleGroup.add(candleBase);
    
    // Flame
    const flameGeometry = new THREE.SphereGeometry(0.05, 8, 6);
    const flameMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      emissive: 0xff3300,
      emissiveIntensity: 0.5
    });
    const flame = new THREE.Mesh(flameGeometry, flameMaterial);
    flame.position.set(0, 0.9, 0);
    flame.userData.isFlame = true;
    candleGroup.add(flame);
    
    // Candle light
    const candleLight = new THREE.PointLight(0xff6600, 0.5, 3);
    candleLight.position.set(0, 0.9, 0);
    candleLight.castShadow = true;
    candleGroup.add(candleLight);
    
    candleGroup.position.set(x, 0, z);
    candleGroup.userData = { year, index };
    
    return candleGroup;
  }

  function createTimelineNode(data, index) {
    const nodeGroup = new THREE.Group();
    
    // Node sphere
    const nodeGeometry = new THREE.SphereGeometry(0.2, 16, 12);
    const nodeMaterial = new THREE.MeshPhongMaterial({
      color: 0xffd700,
      emissive: 0xffaa00,
      emissiveIntensity: 0.2
    });
    const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
    node.castShadow = true;
    nodeGroup.add(node);
    
    // Year label (simplified as a small cube)
    const labelGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const labelMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const label = new THREE.Mesh(labelGeometry, labelMaterial);
    label.position.set(0, 0.5, 0);
    nodeGroup.add(label);
    
    nodeGroup.position.set(0, 1, -10 + index * 5);
    nodeGroup.userData = data;
    
    return nodeGroup;
  }

  function createStoneTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Stone pattern
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let i = 0; i < 100; i++) {
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 8);
    return texture;
  }

  function createBrickTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Brick pattern
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 4; col++) {
        const x = col * 64 + (row % 2) * 32;
        const y = row * 32;
        
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + Math.random() * 0.1})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, 60, 28);
      }
    }
    
    return new THREE.CanvasTexture(canvas);
  }

  function showTimelineInfo(data) {
    let info = document.getElementById('timeline-info');
    if (!info) {
      info = document.createElement('div');
      info.id = 'timeline-info';
      info.style.cssText = `
        position: fixed;
        top: 20%;
        right: 20px;
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 15px;
        border-radius: 8px;
        max-width: 300px;
        z-index: 1000;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 215, 0, 0.3);
      `;
      document.body.appendChild(info);
    }
    
    info.innerHTML = `
      <h4 style="margin: 0 0 8px 0; color: #ffd700;">${data.year}</h4>
      <h5 style="margin: 0 0 8px 0;">${data.title}</h5>
      <p style="margin: 0; font-size: 14px; line-height: 1.4;">${data.description}</p>
    `;
    info.style.display = 'block';
  }

  function hideTimelineInfo() {
    const info = document.getElementById('timeline-info');
    if (info) {
      info.style.display = 'none';
    }
  }

  function showTimelineDetail(data) {
    let detail = document.getElementById('timeline-detail');
    if (!detail) {
      detail = document.createElement('div');
      detail.id = 'timeline-detail';
      detail.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.95);
        color: white;
        padding: 30px;
        border-radius: 12px;
        max-width: 500px;
        z-index: 1001;
        backdrop-filter: blur(15px);
        border: 2px solid rgba(255, 215, 0, 0.5);
      `;
      document.body.appendChild(detail);
    }
    
    detail.innerHTML = `
      <h2 style="margin: 0 0 15px 0; color: #ffd700;">${data.year} - ${data.title}</h2>
      <p style="margin: 0 0 20px 0; line-height: 1.6;">${data.description}</p>
      <button onclick="document.getElementById('timeline-detail').style.display='none'" 
              style="background: #ffd700; color: black; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold;">
        Close
      </button>
    `;
    detail.style.display = 'block';
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
      const info = document.getElementById('timeline-info');
      if (info) info.remove();
      const detail = document.getElementById('timeline-detail');
      if (detail) detail.remove();
      
      renderer.dispose();
    }
  };
}
