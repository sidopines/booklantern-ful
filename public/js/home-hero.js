/**
 * public/js/home-hero.js - WebGL Hero Scene with Glowing Book
 * Lusion-inspired Three.js scene with custom shaders
 */

window.BLHomeHero = {
  scene: null,
  renderer: null,
  camera: null,
  book: null,
  particles: null,
  mouse: { x: 0, y: 0 },
  
  init(anim) {
    if (!anim.webglSupported || !anim.wantsMotion()) {
      this.createFallback();
      return;
    }
    
    this.setupScene();
    this.createBook();
    this.createParticles();
    this.setupLighting();
    this.setupEventListeners();
    this.animate();
    
    console.log('[BL] WebGL hero scene initialized');
  },
  
  setupScene() {
    const container = document.getElementById('hero-canvas');
    if (!container) return;
    
    // Scene
    this.scene = new THREE.Scene();
    
    // Camera
    this.camera = new THREE.PerspectiveCamera(
      75, 
      container.clientWidth / container.clientHeight, 
      0.1, 
      1000
    );
    this.camera.position.z = 5;
    
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ 
      alpha: true, 
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    
    container.appendChild(this.renderer.domElement);
    
    // Handle resize
    window.addEventListener('resize', () => this.onResize());
  },
  
  createBook() {
    // Custom shader for the glowing book
    const vertexShader = `
      uniform float uTime;
      uniform vec2 uMouse;
      varying vec2 vUv;
      varying vec3 vPosition;
      
      void main() {
        vUv = uv;
        vPosition = position;
        
        vec3 pos = position;
        
        // Subtle vertex noise
        pos.z += sin(pos.x * 10.0 + uTime) * 0.01;
        pos.z += sin(pos.y * 10.0 + uTime * 0.5) * 0.01;
        
        // Mouse influence
        float mouseInfluence = 1.0 - distance(uv, uMouse) * 0.5;
        pos.z += mouseInfluence * 0.1;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `;
    
    const fragmentShader = `
      uniform float uTime;
      uniform vec2 uMouse;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vPosition;
      
      void main() {
        vec2 uv = vUv;
        
        // Base gradient
        vec3 color = mix(uColor, uColor * 0.5, uv.y);
        
        // Noise distortion
        float noise = sin(uv.x * 20.0 + uTime) * 0.1;
        noise += sin(uv.y * 15.0 + uTime * 0.7) * 0.1;
        color += noise * 0.3;
        
        // Chromatic aberration
        float aberration = distance(uv, uMouse) * 0.1;
        color.r += aberration * 0.2;
        color.b -= aberration * 0.2;
        
        // Glow effect
        float glow = 1.0 - distance(uv, vec2(0.5)) * 2.0;
        glow = pow(glow, 2.0);
        color += glow * 0.5;
        
        // Mouse ripple
        float ripple = 1.0 - distance(uv, uMouse) * 3.0;
        ripple = max(0.0, ripple);
        color += ripple * 0.3;
        
        gl_FragColor = vec4(color, 0.8);
      }
    `;
    
    // Book geometry (layered planes)
    const bookGeometry = new THREE.PlaneGeometry(2, 2.5);
    
    // Book material
    const bookMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uColor: { value: new THREE.Color(0x6c7cff) }
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      side: THREE.DoubleSide
    });
    
    // Create book mesh
    this.book = new THREE.Mesh(bookGeometry, bookMaterial);
    this.scene.add(this.book);
    
    // Add book spine
    const spineGeometry = new THREE.BoxGeometry(0.1, 2.5, 0.05);
    const spineMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x4a5cff,
      transparent: true,
      opacity: 0.8
    });
    const spine = new THREE.Mesh(spineGeometry, spineMaterial);
    spine.position.x = -0.95;
    this.scene.add(spine);
  },
  
  createParticles() {
    const particleCount = 50;
    const particles = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      
      // Random positions
      positions[i3] = (Math.random() - 0.5) * 10;
      positions[i3 + 1] = (Math.random() - 0.5) * 10;
      positions[i3 + 2] = (Math.random() - 0.5) * 10;
      
      // Random colors
      const color = new THREE.Color();
      color.setHSL(0.6 + Math.random() * 0.2, 0.8, 0.6);
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;
    }
    
    particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particles.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const particleMaterial = new THREE.PointsMaterial({
      size: 0.02,
      vertexColors: true,
      transparent: true,
      opacity: 0.6
    });
    
    this.particles = new THREE.Points(particles, particleMaterial);
    this.scene.add(this.particles);
  },
  
  setupLighting() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
    this.scene.add(ambientLight);
    
    // Point light for book glow
    const pointLight = new THREE.PointLight(0x6c7cff, 1, 10);
    pointLight.position.set(0, 0, 2);
    this.scene.add(pointLight);
  },
  
  setupEventListeners() {
    // Mouse movement
    document.addEventListener('mousemove', (event) => {
      this.mouse.x = event.clientX / window.innerWidth;
      this.mouse.y = 1 - (event.clientY / window.innerHeight);
      
      if (this.book && this.book.material.uniforms) {
        this.book.material.uniforms.uMouse.value.set(this.mouse.x, this.mouse.y);
      }
    });
    
    // Touch support
    document.addEventListener('touchmove', (event) => {
      event.preventDefault();
      const touch = event.touches[0];
      this.mouse.x = touch.clientX / window.innerWidth;
      this.mouse.y = 1 - (touch.clientY / window.innerHeight);
      
      if (this.book && this.book.material.uniforms) {
        this.book.material.uniforms.uMouse.value.set(this.mouse.x, this.mouse.y);
      }
    });
  },
  
  animate() {
    requestAnimationFrame(() => this.animate());
    
    const time = Date.now() * 0.001;
    
    // Update book shader
    if (this.book && this.book.material.uniforms) {
      this.book.material.uniforms.uTime.value = time;
      
      // Subtle rotation
      this.book.rotation.y = Math.sin(time * 0.5) * 0.1;
    }
    
    // Update particles
    if (this.particles) {
      this.particles.rotation.y = time * 0.1;
      this.particles.rotation.x = time * 0.05;
    }
    
    // Render
    this.renderer.render(this.scene, this.camera);
  },
  
  onResize() {
    if (!this.camera || !this.renderer) return;
    
    const container = document.getElementById('hero-canvas');
    if (!container) return;
    
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  },
  
  createFallback() {
    const container = document.getElementById('hero-canvas');
    if (!container) return;
    
    container.innerHTML = `
      <div class="hero-fallback" style="
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        background: radial-gradient(circle, rgba(108, 124, 255, 0.1) 0%, transparent 70%);
        border-radius: 20px;
      ">
        <div style="
          font-size: 4rem;
          color: var(--primary);
          text-align: center;
          animation: pulse 2s ease-in-out infinite;
        ">
          📖
        </div>
      </div>
    `;
    
    // Add pulse animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 0.8; }
        50% { transform: scale(1.1); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  },
  
  destroy() {
    if (this.renderer) {
      this.renderer.dispose();
    }
    if (this.scene) {
      this.scene.clear();
    }
  }
};
