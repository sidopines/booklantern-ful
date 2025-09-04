/**
 * public/js/home-hero.js - Cinematic WebGL Hero Scene
 * Lusion-style glowing book with particles and GSAP timelines
 */

window.initHomeHero = function({ containerId = 'hero3d' }) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn('[BL] hero container not found:', containerId);
    return null;
  }

  // Scene setup
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ 
    alpha: true, 
    antialias: true,
    premultipliedAlpha: true 
  });
  
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // Camera group for mouse parallax
  const cameraGroup = new THREE.Group();
  cameraGroup.add(camera);
  scene.add(cameraGroup);
  camera.position.z = 5;

  // Lighting setup
  const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0x6c7cff, 0.8);
  directionalLight.position.set(5, 5, 5);
  scene.add(directionalLight);

  // Book geometry - two planes for front and back
  const bookGroup = new THREE.Group();
  scene.add(bookGroup);

  // Book pages geometry
  const bookGeometry = new THREE.PlaneGeometry(2, 2.8);
  
  // Custom shader material for glowing book
  const bookMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      glowColor: { value: new THREE.Color(0x6c7cff) },
      rimColor: { value: new THREE.Color(0x9fb0ff) }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;
      
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        
        // Subtle page warp
        vec3 pos = position;
        pos.y += sin(pos.x * 2.0 + time * 0.5) * 0.05;
        pos.x += cos(pos.y * 1.5 + time * 0.3) * 0.03;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 glowColor;
      uniform vec3 rimColor;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vPosition;
      
      void main() {
        // Base book color
        vec3 baseColor = vec3(0.1, 0.15, 0.25);
        
        // Rim glow effect
        float rim = 1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
        rim = pow(rim, 2.0);
        
        // Chromatic aberration
        float aberration = sin(time * 0.5) * 0.1;
        vec2 offset = vUv - 0.5;
        float dist = length(offset);
        
        vec3 color = baseColor;
        color += rim * rimColor * 0.8;
        color += glowColor * rim * 0.3;
        
        // Subtle shimmer
        float shimmer = sin(vUv.x * 20.0 + time * 2.0) * 0.1;
        color += shimmer * glowColor * 0.2;
        
        gl_FragColor = vec4(color, 0.9);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide
  });

  // Create book pages
  const frontPage = new THREE.Mesh(bookGeometry, bookMaterial);
  frontPage.position.z = 0.1;
  bookGroup.add(frontPage);

  const backPage = new THREE.Mesh(bookGeometry, bookMaterial);
  backPage.position.z = -0.1;
  backPage.rotation.y = Math.PI;
  bookGroup.add(backPage);

  // Book spine
  const spineGeometry = new THREE.BoxGeometry(0.1, 2.8, 0.2);
  const spineMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x2a2a3a,
    transparent: true,
    opacity: 0.8
  });
  const spine = new THREE.Mesh(spineGeometry, spineMaterial);
  spine.position.x = -1.05;
  bookGroup.add(spine);

  // Particle system
  const particleCount = 150;
  const particles = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);

  for (let i = 0; i < particleCount; i++) {
    const i3 = i * 3;
    
    // Random positions in a sphere around the book
    positions[i3] = (Math.random() - 0.5) * 20;
    positions[i3 + 1] = (Math.random() - 0.5) * 20;
    positions[i3 + 2] = (Math.random() - 0.5) * 20;
    
    // Dust particle colors
    const color = new THREE.Color();
    color.setHSL(0.6, 0.3, Math.random() * 0.5 + 0.3);
    colors[i3] = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
    
    sizes[i] = Math.random() * 2 + 1;
  }

  particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particles.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  particles.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      pointTexture: { value: new THREE.TextureLoader().load('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==') }
    },
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      uniform float time;
      
      void main() {
        vColor = color;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        
        // Gentle floating motion
        mvPosition.y += sin(time * 0.5 + position.x * 0.1) * 0.1;
        mvPosition.x += cos(time * 0.3 + position.z * 0.1) * 0.05;
        
        gl_PointSize = size * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      
      void main() {
        float distanceToCenter = distance(gl_PointCoord, vec2(0.5));
        float alpha = 1.0 - smoothstep(0.0, 0.5, distanceToCenter);
        
        gl_FragColor = vec4(vColor, alpha * 0.6);
      }
    `,
    transparent: true,
    vertexColors: true,
    blending: THREE.AdditiveBlending
  });

  const particleSystem = new THREE.Points(particles, particleMaterial);
  scene.add(particleSystem);

  // Mouse interaction
  const mouse = new THREE.Vector2();
  const mouseTarget = new THREE.Vector2();
  
  function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  }
  
  window.addEventListener('mousemove', onMouseMove);

  // Animation loop
  let animationId;
  let time = 0;
  
  function animate() {
    animationId = requestAnimationFrame(animate);
    time += 0.01;
    
    // Update uniforms
    bookMaterial.uniforms.time.value = time;
    particleMaterial.uniforms.time.value = time;
    
    // Mouse parallax
    mouseTarget.lerp(mouse, 0.05);
    cameraGroup.rotation.y = mouseTarget.x * 0.1;
    cameraGroup.rotation.x = mouseTarget.y * 0.1;
    
    // Gentle book floating
    bookGroup.position.y = Math.sin(time * 0.5) * 0.1;
    bookGroup.rotation.y = Math.sin(time * 0.3) * 0.05;
    
    // Rotate particles
    particleSystem.rotation.y = time * 0.1;
    
    renderer.render(scene, camera);
  }

  // GSAP entrance timeline
  const tl = gsap.timeline({ delay: 0.5 });
  
  // Initial state
  gsap.set(bookGroup, { 
    scale: 0,
    rotationY: -Math.PI / 4,
    opacity: 0
  });
  gsap.set(particleSystem, { opacity: 0 });
  gsap.set(cameraGroup, { rotationY: -0.2, rotationX: 0.1 });
  
  // Entrance animation
  tl.to(bookGroup, {
    scale: 1,
    rotationY: 0,
    opacity: 1,
    duration: 1.5,
    ease: "back.out(1.7)"
  })
  .to(particleSystem, {
    opacity: 1,
    duration: 2,
    ease: "power2.out"
  }, "-=1")
  .to(cameraGroup, {
    rotationY: 0,
    rotationX: 0,
    duration: 2,
    ease: "power2.out"
  }, "-=1.5");

  // Start animation loop
  animate();

  // Resize handler
  function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  
  window.addEventListener('resize', onResize);

  // Handle visibility change
  function onVisibilityChange() {
    if (document.hidden) {
      cancelAnimationFrame(animationId);
    } else {
      animate();
    }
  }
  
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Return controller with cleanup
  return {
    pause() {
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    },
    
    resume() {
      if (!animationId) {
        animate();
      }
    },
    
    destroy() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      
      cancelAnimationFrame(animationId);
      
      // Dispose geometries and materials
      bookGeometry.dispose();
      bookMaterial.dispose();
      spineGeometry.dispose();
      spineMaterial.dispose();
      particles.dispose();
      particleMaterial.dispose();
      
      // Remove renderer
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      
      console.log('[BL] hero scene destroyed');
    }
  };
};

console.log('[BL] home-hero.js loaded');