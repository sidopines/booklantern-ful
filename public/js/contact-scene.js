/**
 * public/js/contact-scene.js - Animated Contact Scene
 * Pen writing line motif, glowing input focus rings, page-turn background
 */

export function initContactScene({ containerId = 'contact3d' } = {}) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn('[Contact Scene] Container not found:', containerId);
    return null;
  }

  let scene, camera, renderer, deskGroup, pen, paper, inkDrops = [];
  let animationId;
  let isAnimating = true;

  // Scene setup
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a2a3a, 5, 20);

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

  // Desk lamp light
  const lampLight = new THREE.SpotLight(0xffd700, 1.5, 15, Math.PI / 4, 0.3);
  lampLight.position.set(2, 6, 2);
  lampLight.target.position.set(0, 0, 0);
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.width = 1024;
  lampLight.shadow.mapSize.height = 1024;
  scene.add(lampLight);
  scene.add(lampLight.target);

  // Create desk scene
  deskGroup = new THREE.Group();

  // Desk surface
  const deskGeometry = new THREE.BoxGeometry(8, 0.2, 4);
  const deskMaterial = new THREE.MeshLambertMaterial({ 
    color: 0x8B4513,
    map: createWoodTexture()
  });
  const desk = new THREE.Mesh(deskGeometry, deskMaterial);
  desk.position.set(0, 0, 0);
  desk.castShadow = true;
  desk.receiveShadow = true;
  deskGroup.add(desk);

  // Paper
  const paperGeometry = new THREE.PlaneGeometry(3, 4);
  const paperMaterial = new THREE.MeshLambertMaterial({ 
    color: 0xffffff,
    map: createPaperTexture()
  });
  paper = new THREE.Mesh(paperGeometry, paperMaterial);
  paper.position.set(0, 0.11, 0);
  paper.rotation.x = -Math.PI / 2;
  paper.receiveShadow = true;
  deskGroup.add(paper);

  // Pen
  pen = new THREE.Group();
  
  // Pen body
  const penBodyGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8);
  const penBodyMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
  const penBody = new THREE.Mesh(penBodyGeometry, penBodyMaterial);
  penBody.position.set(0, 0.4, 0);
  penBody.castShadow = true;
  pen.add(penBody);

  // Pen tip
  const penTipGeometry = new THREE.ConeGeometry(0.02, 0.1, 8);
  const penTipMaterial = new THREE.MeshPhongMaterial({ color: 0x000000 });
  const penTip = new THREE.Mesh(penTipGeometry, penTipMaterial);
  penTip.position.set(0, 0.05, 0);
  pen.add(penTip);

  pen.position.set(1, 0.1, 0.5);
  pen.rotation.z = Math.PI / 6;
  deskGroup.add(pen);

  // Ink bottle
  const inkBottleGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.6, 8);
  const inkBottleMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x000000,
    transparent: true,
    opacity: 0.8
  });
  const inkBottle = new THREE.Mesh(inkBottleGeometry, inkBottleMaterial);
  inkBottle.position.set(-1.5, 0.3, 1);
  inkBottle.castShadow = true;
  deskGroup.add(inkBottle);

  // Books on desk
  for (let i = 0; i < 3; i++) {
    const bookGeometry = new THREE.BoxGeometry(0.3, 0.4, 0.2);
    const bookMaterial = new THREE.MeshLambertMaterial({ 
      color: new THREE.Color().setHSL(0.1 + i * 0.1, 0.7, 0.5)
    });
    const book = new THREE.Mesh(bookGeometry, bookMaterial);
    book.position.set(-2 + i * 0.4, 0.2, -1);
    book.rotation.y = Math.PI / 4;
    book.castShadow = true;
    deskGroup.add(book);
  }

  scene.add(deskGroup);

  // Writing line animation
  const linePoints = [];
  const lineGeometry = new THREE.BufferGeometry();
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x000000,
    linewidth: 2
  });
  const writingLine = new THREE.Line(lineGeometry, lineMaterial);
  writingLine.position.set(0, 0.12, 0);
  writingLine.rotation.x = -Math.PI / 2;
  scene.add(writingLine);

  // GSAP entrance animation
  const tl = gsap.timeline();
  tl.from(deskGroup.scale, { duration: 2, x: 0, y: 0, z: 0, ease: "back.out(1.7)" })
    .from(camera.position, { duration: 2.5, z: 15, ease: "power2.out" }, 0)
    .from(pen.rotation, { duration: 1.5, z: Math.PI / 2, ease: "power2.out" }, 0.5);

  // Writing animation
  const writeText = () => {
    const textPath = [
      { x: -1, y: 0 },
      { x: -0.5, y: 0.1 },
      { x: 0, y: -0.1 },
      { x: 0.5, y: 0.2 },
      { x: 1, y: 0 },
      { x: 1.2, y: -0.3 },
      { x: 0.8, y: -0.5 },
      { x: 0.4, y: -0.3 },
      { x: 0, y: -0.4 },
      { x: -0.4, y: -0.2 },
      { x: -0.8, y: -0.4 },
      { x: -1.2, y: -0.1 }
    ];

    const writeTl = gsap.timeline({ repeat: -1, repeatDelay: 2 });
    
    textPath.forEach((point, index) => {
      writeTl.to(linePoints, {
        duration: 0.1,
        onUpdate: () => {
          linePoints.push(new THREE.Vector3(point.x, point.y, 0));
          lineGeometry.setFromPoints(linePoints);
        }
      });
    });

    writeTl.to(linePoints, {
      duration: 0.5,
      onUpdate: () => {
        linePoints.length = 0;
        lineGeometry.setFromPoints(linePoints);
      }
    });
  };

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

  // Form input focus effects
  const setupFormEffects = () => {
    const inputs = document.querySelectorAll('input, textarea');
    inputs.forEach(input => {
      input.addEventListener('focus', () => {
        // Create glowing ring effect
        const ring = document.createElement('div');
        ring.className = 'input-glow';
        ring.style.cssText = `
          position: absolute;
          top: -2px;
          left: -2px;
          right: -2px;
          bottom: -2px;
          border: 2px solid #ffd700;
          border-radius: 8px;
          box-shadow: 0 0 20px rgba(255, 215, 0, 0.5);
          pointer-events: none;
          z-index: 1;
        `;
        input.parentElement.style.position = 'relative';
        input.parentElement.appendChild(ring);
      });

      input.addEventListener('blur', () => {
        const ring = input.parentElement.querySelector('.input-glow');
        if (ring) ring.remove();
      });
    });
  };

  // Animation loop
  const animate = () => {
    if (!isAnimating) return;
    
    animationId = requestAnimationFrame(animate);
    
    const time = Date.now() * 0.001;
    
    // Pen writing motion
    pen.rotation.z = Math.PI / 6 + Math.sin(time * 2) * 0.1;
    pen.position.x = 1 + Math.sin(time * 1.5) * 0.1;
    
    // Ink drops
    if (Math.random() < 0.01) {
      createInkDrop();
    }
    
    // Update ink drops
    inkDrops.forEach((drop, index) => {
      drop.position.y -= 0.01;
      drop.material.opacity -= 0.005;
      
      if (drop.material.opacity <= 0) {
        scene.remove(drop);
        inkDrops.splice(index, 1);
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

  // Start animation and effects
  animate();
  writeText();
  setupFormEffects();

  // Helper functions
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
    texture.repeat.set(2, 1);
    return texture;
  }

  function createPaperTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Paper texture
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 256);
    
    for (let i = 0; i < 100; i++) {
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.random() * 0.05})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }
    
    return new THREE.CanvasTexture(canvas);
  }

  function createInkDrop() {
    const dropGeometry = new THREE.SphereGeometry(0.02, 8, 6);
    const dropMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.8
    });
    const drop = new THREE.Mesh(dropGeometry, dropMaterial);
    drop.position.set(
      (Math.random() - 0.5) * 2,
      0.2,
      (Math.random() - 0.5) * 2
    );
    scene.add(drop);
    inkDrops.push(drop);
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
      
      // Clean up ink drops
      inkDrops.forEach(drop => scene.remove(drop));
      inkDrops = [];
      
      renderer.dispose();
    }
  };
}
