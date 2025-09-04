/**
 * public/js/door-hero.js - 3D Library Door Hero Scene
 * Cinematic entrance with massive library doors and sunrise light burst
 */

export function initDoorHero({ containerId = 'door3d' } = {}) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn('[Door Hero] Container not found:', containerId);
    return null;
  }

  let scene, camera, renderer, doorGroup, lightBurst, particles;
  let animationId;
  let isAnimating = true;

  // Scene setup
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0a0a, 10, 50);

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
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x2a2a3a, 0.3);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffd700, 0.8);
  directionalLight.position.set(5, 10, 5);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  scene.add(directionalLight);

  // Create massive library doors
  doorGroup = new THREE.Group();
  
  // Door geometry
  const doorGeometry = new THREE.BoxGeometry(3, 6, 0.3);
  
  // Wood material with procedural texture
  const woodMaterial = new THREE.MeshLambertMaterial({
    color: 0x8B4513,
    map: createWoodTexture(),
    normalMap: createWoodNormalTexture()
  });

  // Metal hardware
  const metalMaterial = new THREE.MeshPhongMaterial({
    color: 0x888888,
    shininess: 100,
    specular: 0x444444
  });

  // Left door
  const leftDoor = new THREE.Mesh(doorGeometry, woodMaterial);
  leftDoor.position.set(-1.5, 0, 0);
  leftDoor.castShadow = true;
  leftDoor.receiveShadow = true;
  doorGroup.add(leftDoor);

  // Right door
  const rightDoor = new THREE.Mesh(doorGeometry, woodMaterial);
  rightDoor.position.set(1.5, 0, 0);
  rightDoor.castShadow = true;
  rightDoor.receiveShadow = true;
  doorGroup.add(rightDoor);

  // Door handles
  const handleGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8);
  const leftHandle = new THREE.Mesh(handleGeometry, metalMaterial);
  leftHandle.position.set(-2.2, 0, 0.2);
  leftHandle.rotation.z = Math.PI / 2;
  doorGroup.add(leftHandle);

  const rightHandle = new THREE.Mesh(handleGeometry, metalMaterial);
  rightHandle.position.set(2.2, 0, 0.2);
  rightHandle.rotation.z = Math.PI / 2;
  doorGroup.add(rightHandle);

  // Door frame
  const frameGeometry = new THREE.BoxGeometry(7, 7, 0.5);
  const frameMaterial = new THREE.MeshLambertMaterial({ color: 0x654321 });
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.position.set(0, 0, -0.25);
  frame.receiveShadow = true;
  doorGroup.add(frame);

  scene.add(doorGroup);

  // Light burst effect
  lightBurst = new THREE.Group();
  const burstGeometry = new THREE.ConeGeometry(0.1, 20, 8);
  const burstMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd700,
    transparent: true,
    opacity: 0.6
  });
  
  for (let i = 0; i < 8; i++) {
    const burst = new THREE.Mesh(burstGeometry, burstMaterial);
    burst.rotation.z = (i / 8) * Math.PI * 2;
    burst.position.set(0, 0, -10);
    lightBurst.add(burst);
  }
  lightBurst.visible = false;
  scene.add(lightBurst);

  // Dust particles
  const particleCount = 200;
  const particleGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const velocities = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = Math.random() * 10;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
    
    velocities[i * 3] = (Math.random() - 0.5) * 0.02;
    velocities[i * 3 + 1] = -Math.random() * 0.01;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
  }

  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

  const particleMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.1,
    transparent: true,
    opacity: 0.6
  });

  particles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particles);

  // GSAP animations
  const tl = gsap.timeline({ paused: true });
  
  // Entrance animation
  tl.from(doorGroup.scale, { duration: 1.5, x: 0, y: 0, z: 0, ease: "back.out(1.7)" })
    .from(doorGroup.rotation, { duration: 1, y: Math.PI * 0.1, ease: "power2.out" }, 0)
    .from(camera.position, { duration: 2, z: 15, ease: "power2.out" }, 0);

  // Door opening animation
  const openDoors = () => {
    const openTl = gsap.timeline();
    
    // Open doors
    openTl.to(leftDoor.rotation, { duration: 1.5, y: -Math.PI * 0.4, ease: "power2.inOut" })
          .to(rightDoor.rotation, { duration: 1.5, y: Math.PI * 0.4, ease: "power2.inOut" }, 0)
          .to(lightBurst.scale, { duration: 0.5, x: 1, y: 1, z: 1, ease: "power2.out" }, 0.5)
          .set(lightBurst, { visible: true }, 0.5)
          .to(lightBurst.material, { duration: 1, opacity: 0, ease: "power2.out" }, 1)
          .to(camera.position, { duration: 2, z: 2, ease: "power2.inOut" }, 0.5);
    
    return openTl;
  };

  // Start entrance animation
  tl.play();

  // Mouse interaction
  const mouse = new THREE.Vector2();
  const onMouseMove = (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    doorGroup.rotation.y = mouse.x * 0.1;
    doorGroup.rotation.x = mouse.y * 0.05;
  };

  // Enter button click handler
  const enterBtn = document.getElementById('enterBtn');
  if (enterBtn) {
    enterBtn.addEventListener('click', () => {
      const openAnimation = openDoors();
      openAnimation.eventCallback("onComplete", () => {
        // Transition to home scene
        setTimeout(() => {
          const homeStage = document.getElementById('home-stage');
          const doorStage = document.getElementById('door-stage');
          if (homeStage && doorStage) {
            doorStage.style.display = 'none';
            homeStage.style.display = 'block';
            // Trigger home scene initialization
            window.dispatchEvent(new CustomEvent('showHomeScene'));
          }
        }, 1000);
      });
    });
  }

  // Animation loop
  const animate = () => {
    if (!isAnimating) return;
    
    animationId = requestAnimationFrame(animate);
    
    const time = Date.now() * 0.001;
    
    // Gentle door sway
    doorGroup.rotation.y += Math.sin(time * 0.5) * 0.001;
    
    // Particle animation
    const positions = particles.geometry.attributes.position.array;
    const velocities = particles.geometry.attributes.velocity.array;
    
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] += velocities[i * 3];
      positions[i * 3 + 1] += velocities[i * 3 + 1];
      positions[i * 3 + 2] += velocities[i * 3 + 2];
      
      // Reset particles that fall too low
      if (positions[i * 3 + 1] < -5) {
        positions[i * 3 + 1] = 10;
        positions[i * 3] = (Math.random() - 0.5) * 20;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
      }
    }
    
    particles.geometry.attributes.position.needsUpdate = true;
    
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

  // Helper functions for textures
  function createWoodTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Wood grain pattern
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let i = 0; i < 20; i++) {
      ctx.strokeStyle = `rgba(139, 69, 19, ${0.3 + Math.random() * 0.4})`;
      ctx.lineWidth = 2 + Math.random() * 3;
      ctx.beginPath();
      ctx.moveTo(0, i * 12 + Math.random() * 10);
      ctx.quadraticCurveTo(128, i * 12 + Math.random() * 20, 256, i * 12 + Math.random() * 10);
      ctx.stroke();
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 4);
    return texture;
  }

  function createWoodNormalTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Simple normal map
    ctx.fillStyle = '#8080ff';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = `rgba(128, 128, 255, ${Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    
    return new THREE.CanvasTexture(canvas);
  }

  // Return controller
  return {
    openDoors,
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
      
      // Dispose of geometries and materials
      [doorGeometry, burstGeometry, particleGeometry].forEach(geo => geo.dispose());
      [woodMaterial, metalMaterial, frameMaterial, burstMaterial, particleMaterial].forEach(mat => {
        if (mat.map) mat.map.dispose();
        if (mat.normalMap) mat.normalMap.dispose();
        mat.dispose();
      });
      
      renderer.dispose();
    }
  };
}
