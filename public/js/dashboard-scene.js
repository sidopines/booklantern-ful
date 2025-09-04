/**
 * public/js/dashboard-scene.js - Cozy Personal Library Dashboard Scene
 * Animated reading streak flame, confetti bursts on milestones
 */

export function initDashboardScene({ containerId = 'dashboard3d' } = {}) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn('[Dashboard Scene] Container not found:', containerId);
    return null;
  }

  let scene, camera, renderer, libraryGroup, readingFlame, confetti = [];
  let animationId;
  let isAnimating = true;

  // Scene setup
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a2a3a, 5, 25);

  // Camera
  camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 3, 8);

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
  renderer.toneMappingExposure = 0.8;
  container.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x3a3a4a, 0.4);
  scene.add(ambientLight);

  // Warm reading light
  const readingLight = new THREE.PointLight(0xffd700, 1.2, 10);
  readingLight.position.set(0, 4, 2);
  readingLight.castShadow = true;
  readingLight.shadow.mapSize.width = 1024;
  readingLight.shadow.mapSize.height = 1024;
  scene.add(readingLight);

  // Create cozy library
  libraryGroup = new THREE.Group();

  // Floor
  const floorGeometry = new THREE.PlaneGeometry(12, 12);
  const floorMaterial = new THREE.MeshLambertMaterial({ 
    color: 0x4a4a4a,
    map: createCarpetTexture()
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  libraryGroup.add(floor);

  // Personal bookshelf
  const shelfGeometry = new THREE.BoxGeometry(6, 4, 0.3);
  const shelfMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
  const shelf = new THREE.Mesh(shelfGeometry, shelfMaterial);
  shelf.position.set(0, 2, -4);
  shelf.castShadow = true;
  shelf.receiveShadow = true;
  libraryGroup.add(shelf);

  // Books on shelf
  for (let i = 0; i < 20; i++) {
    const bookGeometry = new THREE.BoxGeometry(0.25, 0.3, 0.15);
    const bookMaterial = new THREE.MeshLambertMaterial({ 
      color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5)
    });
    const book = new THREE.Mesh(bookGeometry, bookMaterial);
    book.position.set(
      -2.5 + (i % 10) * 0.5,
      1 + Math.floor(i / 10) * 0.35,
      -3.8
    );
    book.castShadow = true;
    libraryGroup.add(book);
  }

  // Reading chair
  const chairGroup = new THREE.Group();
  
  // Chair seat
  const seatGeometry = new THREE.BoxGeometry(1.5, 0.2, 1.5);
  const seatMaterial = new THREE.MeshLambertMaterial({ color: 0x654321 });
  const seat = new THREE.Mesh(seatGeometry, seatMaterial);
  seat.position.set(0, 0.1, 2);
  seat.castShadow = true;
  seat.receiveShadow = true;
  chairGroup.add(seat);

  // Chair back
  const backGeometry = new THREE.BoxGeometry(1.5, 2, 0.2);
  const backMaterial = new THREE.MeshLambertMaterial({ color: 0x654321 });
  const back = new THREE.Mesh(backGeometry, backMaterial);
  back.position.set(0, 1.1, 2.6);
  back.castShadow = true;
  chairGroup.add(back);

  libraryGroup.add(chairGroup);

  // Reading table
  const tableGeometry = new THREE.BoxGeometry(2, 0.1, 1);
  const tableMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
  const table = new THREE.Mesh(tableGeometry, tableMaterial);
  table.position.set(0, 0.5, 1);
  table.castShadow = true;
  table.receiveShadow = true;
  libraryGroup.add(table);

  // Open book on table
  const bookGeometry = new THREE.BoxGeometry(0.4, 0.05, 0.6);
  const bookMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const openBook = new THREE.Mesh(bookGeometry, bookMaterial);
  openBook.position.set(0, 0.55, 1);
  openBook.rotation.y = Math.PI / 4;
  openBook.castShadow = true;
  libraryGroup.add(openBook);

  scene.add(libraryGroup);

  // Reading streak flame
  readingFlame = new THREE.Group();
  
  // Flame base
  const flameBaseGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8);
  const flameBaseMaterial = new THREE.MeshPhongMaterial({ color: 0x444444 });
  const flameBase = new THREE.Mesh(flameBaseGeometry, flameBaseMaterial);
  flameBase.position.set(0, 0.15, 0);
  readingFlame.add(flameBase);

  // Flame
  const flameGeometry = new THREE.SphereGeometry(0.15, 8, 6);
  const flameMaterial = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    emissive: 0xff3300,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.8
  });
  const flame = new THREE.Mesh(flameGeometry, flameMaterial);
  flame.position.set(0, 0.4, 0);
  readingFlame.add(flame);

  // Flame light
  const flameLight = new THREE.PointLight(0xff6600, 0.8, 3);
  flameLight.position.set(0, 0.4, 0);
  readingFlame.add(flameLight);

  readingFlame.position.set(1, 0.6, 1.5);
  scene.add(readingFlame);

  // Achievement badges floating around
  const badges = [];
  const badgePositions = [
    { x: -3, y: 2, z: -2 },
    { x: 3, y: 3, z: -1 },
    { x: -2, y: 4, z: 1 },
    { x: 2, y: 2, z: 2 }
  ];

  badgePositions.forEach((pos, index) => {
    const badge = createAchievementBadge(index);
    badge.position.set(pos.x, pos.y, pos.z);
    badges.push(badge);
    scene.add(badge);
  });

  // GSAP entrance animation
  const tl = gsap.timeline();
  tl.from(libraryGroup.scale, { duration: 2, x: 0, y: 0, z: 0, ease: "back.out(1.7)" })
    .from(camera.position, { duration: 2.5, z: 15, ease: "power2.out" }, 0)
    .from(readingFlame.scale, { duration: 1.5, x: 0, y: 0, z: 0, ease: "back.out(1.7)" }, 0.5)
    .from(badges, { duration: 1, opacity: 0, stagger: 0.2, ease: "power2.out" }, 1);

  // Mouse interaction
  const mouse = new THREE.Vector2();
  const onMouseMove = (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Gentle camera movement
    camera.position.x = mouse.x * 0.5;
    camera.position.y = 3 + mouse.y * 0.3;
    camera.lookAt(0, 0, 0);
  };

  // Milestone celebration
  const celebrateMilestone = (milestone) => {
    // Create confetti burst
    for (let i = 0; i < 50; i++) {
      createConfetti();
    }
    
    // Show achievement popup
    showAchievementPopup(milestone);
  };

  // Animation loop
  const animate = () => {
    if (!isAnimating) return;
    
    animationId = requestAnimationFrame(animate);
    
    const time = Date.now() * 0.001;
    
    // Flame animation
    const flameMesh = readingFlame.children.find(child => child.material && child.material.emissive);
    if (flameMesh) {
      flameMesh.material.emissiveIntensity = 0.8 + Math.sin(time * 8) * 0.3;
      flameMesh.scale.y = 1 + Math.sin(time * 12) * 0.2;
    }
    
    // Badge floating
    badges.forEach((badge, index) => {
      badge.rotation.y += 0.01;
      badge.position.y += Math.sin(time * 2 + index) * 0.005;
    });
    
    // Confetti animation
    confetti.forEach((piece, index) => {
      piece.position.y -= 0.05;
      piece.rotation.x += 0.1;
      piece.rotation.z += 0.1;
      piece.material.opacity -= 0.01;
      
      if (piece.material.opacity <= 0) {
        scene.remove(piece);
        confetti.splice(index, 1);
      }
    });
    
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
  window.addEventListener('resize', onResize);
  window.addEventListener('visibilitychange', () => {
    isAnimating = !document.hidden;
    if (isAnimating) animate();
  });

  // Simulate milestone achievement (for demo)
  setTimeout(() => {
    celebrateMilestone('7 Day Reading Streak!');
  }, 3000);

  // Start animation
  animate();

  // Helper functions
  function createCarpetTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Carpet pattern
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let i = 0; i < 100; i++) {
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    return texture;
  }

  function createAchievementBadge(index) {
    const badgeGroup = new THREE.Group();
    
    // Badge base
    const badgeGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 8);
    const badgeMaterial = new THREE.MeshPhongMaterial({ 
      color: new THREE.Color().setHSL(index * 0.1, 0.8, 0.6)
    });
    const badge = new THREE.Mesh(badgeGeometry, badgeMaterial);
    badge.castShadow = true;
    badgeGroup.add(badge);
    
    // Badge icon (simplified as a small sphere)
    const iconGeometry = new THREE.SphereGeometry(0.1, 8, 6);
    const iconMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const icon = new THREE.Mesh(iconGeometry, iconMaterial);
    icon.position.set(0, 0.06, 0);
    badgeGroup.add(icon);
    
    return badgeGroup;
  }

  function createConfetti() {
    const confettiGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    const confettiMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(Math.random(), 1, 0.5),
      transparent: true,
      opacity: 1
    });
    const confettiPiece = new THREE.Mesh(confettiGeometry, confettiMaterial);
    
    confettiPiece.position.set(
      (Math.random() - 0.5) * 4,
      5,
      (Math.random() - 0.5) * 4
    );
    
    confettiPiece.velocity = {
      x: (Math.random() - 0.5) * 0.1,
      y: -Math.random() * 0.05,
      z: (Math.random() - 0.5) * 0.1
    };
    
    scene.add(confettiPiece);
    confetti.push(confettiPiece);
  }

  function showAchievementPopup(milestone) {
    let popup = document.getElementById('achievement-popup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'achievement-popup';
      popup.style.cssText = `
        position: fixed;
        top: 20%;
        right: 20px;
        background: linear-gradient(135deg, #ffd700, #ffed4e);
        color: #333;
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(255, 215, 0, 0.3);
        z-index: 1000;
        transform: translateX(100%);
        transition: transform 0.5s ease;
        border: 2px solid #ffaa00;
      `;
      document.body.appendChild(popup);
    }
    
    popup.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="font-size: 24px;">🏆</div>
        <div>
          <h4 style="margin: 0 0 5px 0; font-size: 16px;">Achievement Unlocked!</h4>
          <p style="margin: 0; font-size: 14px; font-weight: bold;">${milestone}</p>
        </div>
      </div>
    `;
    
    // Animate in
    popup.style.transform = 'translateX(0)';
    
    // Auto hide after 3 seconds
    setTimeout(() => {
      popup.style.transform = 'translateX(100%)';
      setTimeout(() => {
        popup.remove();
      }, 500);
    }, 3000);
  }

  // Return controller
  return {
    celebrateMilestone,
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
      window.removeEventListener('resize', onResize);
      
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      
      // Clean up confetti
      confetti.forEach(piece => scene.remove(piece));
      confetti = [];
      
      renderer.dispose();
    }
  };
}
