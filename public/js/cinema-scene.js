/**
 * public/js/cinema-scene.js - 3D Cinema Scene for Watch Page
 * Red curtains, projector light cone, and cinematic atmosphere
 */

export function initCinemaScene({ containerId = 'cinema3d' } = {}) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn('[Cinema Scene] Container not found:', containerId);
    return null;
  }

  let scene, camera, renderer, cinemaGroup, curtains, projector, screen, dust;
  let animationId;
  let isAnimating = true;

  // Scene setup
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0a0a, 5, 30);

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
  renderer.toneMappingExposure = 0.8;
  container.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x2a1a1a, 0.3);
  scene.add(ambientLight);

  // Projector light
  const projectorLight = new THREE.SpotLight(0xffd700, 2, 20, Math.PI / 6, 0.3);
  projectorLight.position.set(0, 8, 5);
  projectorLight.target.position.set(0, 0, -8);
  projectorLight.castShadow = true;
  projectorLight.shadow.mapSize.width = 2048;
  projectorLight.shadow.mapSize.height = 2048;
  scene.add(projectorLight);
  scene.add(projectorLight.target);

  // Create cinema hall
  cinemaGroup = new THREE.Group();

  // Floor
  const floorGeometry = new THREE.PlaneGeometry(20, 20);
  const floorMaterial = new THREE.MeshLambertMaterial({ 
    color: 0x1a1a1a,
    map: createCarpetTexture()
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  cinemaGroup.add(floor);

  // Screen
  const screenGeometry = new THREE.PlaneGeometry(12, 7);
  const screenMaterial = new THREE.MeshLambertMaterial({ 
    color: 0xffffff,
    emissive: 0x111111
  });
  screen = new THREE.Mesh(screenGeometry, screenMaterial);
  screen.position.set(0, 3.5, -8);
  screen.receiveShadow = true;
  cinemaGroup.add(screen);

  // Curtains
  curtains = new THREE.Group();
  
  // Left curtain
  const leftCurtainGeometry = new THREE.PlaneGeometry(6, 8);
  const curtainMaterial = new THREE.MeshLambertMaterial({ 
    color: 0x8B0000,
    map: createCurtainTexture()
  });
  const leftCurtain = new THREE.Mesh(leftCurtainGeometry, curtainMaterial);
  leftCurtain.position.set(-3, 4, -7.9);
  leftCurtain.castShadow = true;
  curtains.add(leftCurtain);

  // Right curtain
  const rightCurtain = new THREE.Mesh(leftCurtainGeometry, curtainMaterial);
  rightCurtain.position.set(3, 4, -7.9);
  rightCurtain.castShadow = true;
  curtains.add(rightCurtain);

  cinemaGroup.add(curtains);

  // Projector
  projector = new THREE.Group();
  
  // Projector body
  const projectorGeometry = new THREE.BoxGeometry(1, 0.5, 0.8);
  const projectorMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
  const projectorBody = new THREE.Mesh(projectorGeometry, projectorMaterial);
  projectorBody.position.set(0, 8, 5);
  projectorBody.castShadow = true;
  projector.add(projectorBody);

  // Projector lens
  const lensGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16);
  const lensMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x000000,
    emissive: 0x444444
  });
  const lens = new THREE.Mesh(lensGeometry, lensMaterial);
  lens.position.set(0, 8, 4.6);
  lens.rotation.x = Math.PI / 2;
  projector.add(lens);

  // Light cone
  const coneGeometry = new THREE.ConeGeometry(0.1, 15, 8);
  const coneMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd700,
    transparent: true,
    opacity: 0.3
  });
  const lightCone = new THREE.Mesh(coneGeometry, coneMaterial);
  lightCone.position.set(0, 8, 4.5);
  lightCone.rotation.x = Math.PI;
  projector.add(lightCone);

  cinemaGroup.add(projector);

  // Cinema seats (simplified)
  for (let row = 0; row < 4; row++) {
    for (let seat = 0; seat < 6; seat++) {
      const seatGeometry = new THREE.BoxGeometry(0.8, 0.4, 0.8);
      const seatMaterial = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
      const cinemaSeat = new THREE.Mesh(seatGeometry, seatMaterial);
      cinemaSeat.position.set(
        (seat - 2.5) * 1.2,
        0.2,
        -2 - row * 1.5
      );
      cinemaSeat.castShadow = true;
      cinemaSeat.receiveShadow = true;
      cinemaGroup.add(cinemaSeat);
    }
  }

  scene.add(cinemaGroup);

  // Dust particles in light cone
  const dustCount = 150;
  const dustGeometry = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(dustCount * 3);
  const dustVelocities = new Float32Array(dustCount * 3);

  for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 2;
    dustPositions[i * 3 + 1] = Math.random() * 15;
    dustPositions[i * 3 + 2] = 5 - Math.random() * 15;
    
    dustVelocities[i * 3] = (Math.random() - 0.5) * 0.02;
    dustVelocities[i * 3 + 1] = -Math.random() * 0.03;
    dustVelocities[i * 3 + 2] = -Math.random() * 0.02;
  }

  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute('velocity', new THREE.BufferAttribute(dustVelocities, 3));

  const dustMaterial = new THREE.PointsMaterial({
    color: 0xffd700,
    size: 0.1,
    transparent: true,
    opacity: 0.6
  });

  dust = new THREE.Points(dustGeometry, dustMaterial);
  scene.add(dust);

  // GSAP entrance animation
  const tl = gsap.timeline();
  tl.from(cinemaGroup.scale, { duration: 2, x: 0, y: 0, z: 0, ease: "back.out(1.7)" })
    .from(camera.position, { duration: 2.5, z: 15, ease: "power2.out" }, 0)
    .from(curtains.rotation, { duration: 1.5, y: Math.PI * 0.1, ease: "power2.out" }, 0.5);

  // Mouse interaction
  const mouse = new THREE.Vector2();
  const onMouseMove = (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Gentle camera movement
    camera.position.x = mouse.x * 1;
    camera.position.y = 2 + mouse.y * 0.5;
    camera.lookAt(0, 0, -8);
  };

  // Animation loop
  const animate = () => {
    if (!isAnimating) return;
    
    animationId = requestAnimationFrame(animate);
    
    const time = Date.now() * 0.001;
    
    // Gentle curtain sway
    curtains.rotation.y = Math.sin(time * 0.5) * 0.05;
    
    // Projector light flicker
    projectorLight.intensity = 2 + Math.sin(time * 10) * 0.2;
    
    // Dust animation
    const positions = dust.geometry.attributes.position.array;
    const velocities = dust.geometry.attributes.velocity.array;
    
    for (let i = 0; i < dustCount; i++) {
      positions[i * 3] += velocities[i * 3];
      positions[i * 3 + 1] += velocities[i * 3 + 1];
      positions[i * 3 + 2] += velocities[i * 3 + 2];
      
      // Reset dust that falls too low
      if (positions[i * 3 + 1] < 0 || positions[i * 3 + 2] < -15) {
        positions[i * 3 + 1] = 15;
        positions[i * 3 + 2] = 5;
        positions[i * 3] = (Math.random() - 0.5) * 2;
      }
    }
    
    dust.geometry.attributes.position.needsUpdate = true;
    
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

  // Start animation
  animate();

  // Helper functions
  function createCarpetTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Carpet pattern
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
  }

  function createCurtainTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Curtain fabric pattern
    ctx.fillStyle = '#8B0000';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let i = 0; i < 20; i++) {
      ctx.strokeStyle = `rgba(139, 0, 0, ${0.3 + Math.random() * 0.4})`;
      ctx.lineWidth = 2 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(0, i * 12 + Math.random() * 10);
      ctx.quadraticCurveTo(128, i * 12 + Math.random() * 20, 256, i * 12 + Math.random() * 10);
      ctx.stroke();
    }
    
    return new THREE.CanvasTexture(canvas);
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
      window.removeEventListener('resize', onResize);
      
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      
      renderer.dispose();
    }
  };
}
