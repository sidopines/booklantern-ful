// public/js/door-gate.js - WebGL Door with Fallbacks
class DoorGate {
  constructor(options = {}) {
    this.webgl = options.webgl !== false;
    this.reducedMotion = options.reducedMotion || false;
    this.container = null;
    this.mode = null; // 'webgl', 'video', 'lottie', 'svg'
    this.instance = null;
    this.isEntering = false;
  }

  async mount(container) {
    this.container = container;
    
    // Try different modes in order of preference
    if (this.webgl && window.THREE && !this.reducedMotion) {
      try {
        await this.mountWebGL();
        this.mode = 'webgl';
        console.log('[DoorGate] Mounted WebGL mode');
        return;
      } catch (e) {
        console.warn('[DoorGate] WebGL failed, trying video:', e);
      }
    }

    // Try video fallback
    try {
      await this.mountVideo();
      this.mode = 'video';
      console.log('[DoorGate] Mounted video mode');
      return;
    } catch (e) {
      console.warn('[DoorGate] Video failed, trying Lottie:', e);
    }

    // Try Lottie fallback
    if (window.lottie) {
      try {
        await this.mountLottie();
        this.mode = 'lottie';
        console.log('[DoorGate] Mounted Lottie mode');
        return;
      } catch (e) {
        console.warn('[DoorGate] Lottie failed, using SVG:', e);
      }
    }

    // Final fallback: SVG
    this.mountSVG();
    this.mode = 'svg';
    console.log('[DoorGate] Mounted SVG mode');
  }

  async mountWebGL() {
    const canvas = this.container.querySelector('#gate3d');
    if (!canvas) throw new Error('WebGL canvas not found');

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
    this.renderer.setClearColor(0x0a0a0a, 1);

    // Setup lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    this.scene.add(directionalLight);

    // Create door
    await this.createDoor();

    // Position camera
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);

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

  async createDoor() {
    // Try to load GLB model
    if (window.THREE && window.THREE.GLTFLoader) {
      try {
        const loader = new THREE.GLTFLoader();
        const gltf = await new Promise((resolve, reject) => {
          loader.load('/assets/3d/door.glb', resolve, null, reject);
        });
        
        this.doorModel = gltf.scene;
        this.doorModel.position.set(0, 0, 0);
        this.scene.add(this.doorModel);
        return;
      } catch (e) {
        console.warn('[DoorGate] GLB loading failed, using fallback geometry:', e);
      }
    }

    // Fallback: create procedural door
    this.createFallbackDoor();
  }

  createFallbackDoor() {
    const doorGroup = new THREE.Group();

    // Left door panel
    const leftGeometry = new THREE.BoxGeometry(2, 4, 0.2);
    const leftMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    const leftDoor = new THREE.Mesh(leftGeometry, leftMaterial);
    leftDoor.position.set(-1, 0, 0);
    leftDoor.userData = { isLeft: true };
    doorGroup.add(leftDoor);

    // Right door panel
    const rightGeometry = new THREE.BoxGeometry(2, 4, 0.2);
    const rightMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    const rightDoor = new THREE.Mesh(rightGeometry, rightMaterial);
    rightDoor.position.set(1, 0, 0);
    rightDoor.userData = { isRight: true };
    doorGroup.add(rightDoor);

    // Central medallion
    const medallionGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16);
    const medallionMaterial = new THREE.MeshLambertMaterial({ 
      color: 0xFFD700,
      emissive: 0x333300
    });
    this.medallion = new THREE.Mesh(medallionGeometry, medallionMaterial);
    this.medallion.position.set(0, 0, 0.2);
    this.medallion.rotation.x = Math.PI / 2;
    doorGroup.add(this.medallion);

    this.doorModel = doorGroup;
    this.scene.add(this.doorModel);
  }

  startRenderLoop() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      
      // Subtle medallion glow
      if (this.medallion) {
        this.medallion.rotation.z += 0.01;
        if (this.medallion.material.emissive) {
          const intensity = 0.1 + Math.sin(Date.now() * 0.002) * 0.05;
          this.medallion.material.emissive.setScalar(intensity);
        }
      }

      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  async mountVideo() {
    const video = this.container.querySelector('#gateVideo');
    if (!video) throw new Error('Video element not found');

    video.classList.remove('hidden');
    
    // Ensure video loads and plays
    await new Promise((resolve, reject) => {
      video.addEventListener('loadeddata', resolve, { once: true });
      video.addEventListener('error', reject, { once: true });
      video.load();
      
      // Timeout after 5 seconds
      setTimeout(() => reject(new Error('Video load timeout')), 5000);
    });

    video.play().catch(e => console.warn('[DoorGate] Video autoplay failed:', e));
    this.instance = video;
  }

  async mountLottie() {
    const lottieContainer = this.container.querySelector('#gateLottie');
    if (!lottieContainer) throw new Error('Lottie container not found');

    lottieContainer.classList.remove('hidden');

    this.instance = lottie.loadAnimation({
      container: lottieContainer,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path: '/assets/lottie/door.json'
    });

    // Wait for animation to load
    await new Promise((resolve, reject) => {
      this.instance.addEventListener('DOMLoaded', resolve, { once: true });
      this.instance.addEventListener('error', reject, { once: true });
      
      // Timeout after 5 seconds
      setTimeout(() => reject(new Error('Lottie load timeout')), 5000);
    });
  }

  mountSVG() {
    const svg = this.container.querySelector('#gateSvg');
    if (!svg) {
      console.warn('[DoorGate] SVG element not found');
      return;
    }

    svg.classList.remove('hidden');
    this.instance = svg;
  }

  async playEnter() {
    if (this.isEntering) return Promise.resolve();
    this.isEntering = true;

    try {
      switch (this.mode) {
        case 'webgl':
          await this.playWebGLEnter();
          break;
        case 'video':
          await this.playVideoEnter();
          break;
        case 'lottie':
          await this.playLottieEnter();
          break;
        case 'svg':
          await this.playSVGEnter();
          break;
        default:
          await this.playFallbackEnter();
      }
    } catch (e) {
      console.warn('[DoorGate] Enter animation failed:', e);
    }

    this.isEntering = false;
    return Promise.resolve();
  }

  async playWebGLEnter() {
    if (!window.gsap) {
      await this.playFallbackEnter();
      return;
    }

    return new Promise((resolve) => {
      const leftDoor = this.doorModel?.children.find(child => child.userData?.isLeft);
      const rightDoor = this.doorModel?.children.find(child => child.userData?.isRight);
      
      // Door opening animation
      const tl = gsap.timeline({
        onComplete: resolve
      });

      if (leftDoor && rightDoor) {
        tl.to(leftDoor.rotation, { 
          y: -Math.PI/3, 
          duration: 1.5, 
          ease: "power2.out" 
        }, 0);
        tl.to(rightDoor.rotation, { 
          y: Math.PI/3, 
          duration: 1.5, 
          ease: "power2.out" 
        }, 0);
      }

      // Camera dolly
      tl.to(this.camera.position, { 
        z: -2, 
        duration: 2, 
        ease: "power2.inOut" 
      }, 0.5);

      // Medallion glow
      if (this.medallion?.material) {
        tl.to(this.medallion.scale, {
          x: 1.5,
          y: 1.5,
          z: 1.5,
          duration: 0.5,
          yoyo: true,
          repeat: 1
        }, 0);
      }
    });
  }

  async playVideoEnter() {
    return new Promise((resolve) => {
      // Add a light burst effect overlay
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: absolute;
        inset: 0;
        background: radial-gradient(circle, rgba(255,255,255,0.8) 0%, transparent 70%);
        opacity: 0;
        pointer-events: none;
        z-index: 10;
      `;
      this.container.appendChild(overlay);

      // Animate overlay
      if (window.gsap) {
        gsap.to(overlay, {
          opacity: 1,
          duration: 0.3,
          yoyo: true,
          repeat: 1,
          onComplete: () => {
            overlay.remove();
            resolve();
          }
        });
      } else {
        setTimeout(() => {
          overlay.remove();
          resolve();
        }, 600);
      }
    });
  }

  async playLottieEnter() {
    if (this.instance && typeof this.instance.goToAndPlay === 'function') {
      // If animation has enter sequence, play it
      this.instance.goToAndPlay(0, true);
    }
    
    return new Promise((resolve) => {
      setTimeout(resolve, 1000); // Standard duration
    });
  }

  async playSVGEnter() {
    const svg = this.instance;
    if (!svg) return Promise.resolve();

    return new Promise((resolve) => {
      if (window.gsap) {
        gsap.fromTo(svg, 
          { scale: 1, rotation: 0 },
          { 
            scale: 1.1, 
            rotation: 5,
            duration: 0.3,
            yoyo: true,
            repeat: 1,
            onComplete: resolve
          }
        );
      } else {
        svg.style.transform = 'scale(1.1) rotate(5deg)';
        setTimeout(() => {
          svg.style.transform = '';
          resolve();
        }, 600);
      }
    });
  }

  async playFallbackEnter() {
    return new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
  }

  pause() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    if (this.mode === 'video' && this.instance) {
      this.instance.pause();
    } else if (this.mode === 'lottie' && this.instance) {
      this.instance.pause();
    }
  }

  resume() {
    if (this.mode === 'webgl' && !this.animationId) {
      this.startRenderLoop();
    } else if (this.mode === 'video' && this.instance) {
      this.instance.play().catch(e => console.warn('[DoorGate] Video resume failed:', e));
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

    // Hide all elements
    ['#gate3d', '#gateVideo', '#gateLottie', '#gateSvg'].forEach(selector => {
      const el = this.container?.querySelector(selector);
      if (el) el.classList.add('hidden');
    });
  }
}

// Export to global scope
window.DoorGate = DoorGate;