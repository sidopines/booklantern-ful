// public/js/door-gate.js
class DoorGate {
  constructor(options = {}) {
    this.webgl = options.webgl !== false;
    this.reducedMotion = options.reducedMotion || false;
    this.container = null;
    this.mode = null; // 'webgl', 'video', 'lottie', 'svg'
    this.instance = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.doorModel = null;
    this.medallion = null;
    this.enterButton = null;
    this.animationId = null;
    this.isEntering = false;
  }

  async mount(container) {
    this.container = container;
    
    // Create enter button overlay first (works for all modes)
    this.createEnterButton();
    
    // Try different modes in order of preference
    if (this.webgl && window.THREE && !this.reducedMotion) {
      try {
        await this.mountWebGL();
        this.mode = 'webgl';
        return;
      } catch (e) {
        console.warn('[GATE] WebGL failed, trying video:', e);
      }
    }

    // Try video fallback
    try {
      await this.mountVideo();
      this.mode = 'video';
      return;
    } catch (e) {
      console.warn('[GATE] Video failed, trying Lottie:', e);
    }

    // Try Lottie fallback
    if (window.lottie) {
      try {
        await this.mountLottie();
        this.mode = 'lottie';
        return;
      } catch (e) {
        console.warn('[GATE] Lottie failed, using SVG:', e);
      }
    }

    // Final fallback: SVG
    this.mountSVG();
    this.mode = 'svg';
  }

  createEnterButton() {
    // Create large central clickable area
    this.enterButton = document.createElement('button');
    this.enterButton.className = 'enter-medallion';
    this.enterButton.setAttribute('aria-label', 'Enter the Library');
    this.enterButton.innerHTML = '<span class="enter-text">ENTER</span>';
    
    // Style the button
    Object.assign(this.enterButton.style, {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 'min(25vmin, 200px)',
      height: 'min(25vmin, 200px)',
      minWidth: '160px',
      minHeight: '160px',
      borderRadius: '50%',
      border: '3px solid rgba(255, 215, 0, 0.8)',
      background: 'radial-gradient(circle, rgba(255, 215, 0, 0.3) 0%, rgba(255, 215, 0, 0.1) 100%)',
      color: '#FFD700',
      fontSize: 'clamp(16px, 4vmin, 24px)',
      fontWeight: 'bold',
      fontFamily: 'inherit',
      cursor: 'pointer',
      zIndex: '10',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.3s ease',
      backdropFilter: 'blur(10px)'
    });

    // Hover effects
    this.enterButton.addEventListener('mouseenter', () => {
      Object.assign(this.enterButton.style, {
        transform: 'translate(-50%, -50%) scale(1.05)',
        boxShadow: '0 0 30px rgba(255, 215, 0, 0.6)',
        background: 'radial-gradient(circle, rgba(255, 215, 0, 0.4) 0%, rgba(255, 215, 0, 0.2) 100%)'
      });
    });

    this.enterButton.addEventListener('mouseleave', () => {
      Object.assign(this.enterButton.style, {
        transform: 'translate(-50%, -50%) scale(1)',
        boxShadow: 'none',
        background: 'radial-gradient(circle, rgba(255, 215, 0, 0.3) 0%, rgba(255, 215, 0, 0.1) 100%)'
      });
    });

    // Click and keyboard handlers
    this.enterButton.addEventListener('click', () => this.handleEnter());
    this.enterButton.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.handleEnter();
      }
    });

    this.container.appendChild(this.enterButton);
  }

  async handleEnter() {
    if (this.isEntering) return;
    this.isEntering = true;

    try {
      await this.playEnter();
      // Dispatch the Gate:enter event
      window.dispatchEvent(new CustomEvent('Gate:enter'));
    } catch (e) {
      console.warn('[GATE] Enter animation failed:', e);
      // Still dispatch event even if animation fails
      window.dispatchEvent(new CustomEvent('Gate:enter'));
    }
  }

  async mountWebGL() {
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    this.container.appendChild(canvas);

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
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
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
        console.warn('[GATE] GLB loading failed, using procedural door:', e);
      }
    }

    // Fallback: create procedural door
    this.createProceduralDoor();
  }

  createProceduralDoor() {
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

    // Central medallion area (invisible, for reference)
    const medallionGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16);
    const medallionMaterial = new THREE.MeshLambertMaterial({ 
      color: 0xFFD700,
      emissive: 0x331100,
      transparent: true,
      opacity: 0.3
    });
    this.medallion = new THREE.Mesh(medallionGeometry, medallionMaterial);
    this.medallion.position.set(0, 0, 0.15);
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
        this.medallion.rotation.z += 0.005;
        const intensity = 0.1 + Math.sin(Date.now() * 0.003) * 0.05;
        if (this.medallion.material.emissive) {
          this.medallion.material.emissive.setScalar(intensity);
        }
      }

      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  async mountVideo() {
    const video = document.createElement('video');
    video.src = '/assets/video/door-loop.webm';
    video.loop = true;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
    
    this.container.appendChild(video);
    
    // Wait for video to load
    await new Promise((resolve, reject) => {
      video.addEventListener('loadeddata', resolve, { once: true });
      video.addEventListener('error', reject, { once: true });
      setTimeout(() => reject(new Error('Video load timeout')), 5000);
    });

    video.play().catch(e => console.warn('[GATE] Video autoplay failed:', e));
    this.instance = video;
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
      path: '/animations/door.json'
    });

    // Wait for animation to load
    await new Promise((resolve, reject) => {
      this.instance.addEventListener('DOMLoaded', resolve, { once: true });
      this.instance.addEventListener('error', reject, { once: true });
      setTimeout(() => reject(new Error('Lottie load timeout')), 5000);
    });
  }

  mountSVG() {
    const img = document.createElement('img');
    img.src = '/img/door.svg';
    img.alt = 'Library Door';
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain';
    this.container.appendChild(img);
    this.instance = img;
  }

  async playEnter() {
    // Animate light burst
    const lightBurst = document.createElement('div');
    lightBurst.style.cssText = `
      position: absolute;
      inset: 0;
      background: radial-gradient(circle, rgba(255,255,255,0.8) 0%, transparent 70%);
      opacity: 0;
      pointer-events: none;
      z-index: 5;
    `;
    this.container.appendChild(lightBurst);

    // Disable button during animation
    if (this.enterButton) {
      this.enterButton.disabled = true;
      this.enterButton.style.opacity = '0.5';
    }

    if (window.gsap) {
      return new Promise((resolve) => {
        const tl = gsap.timeline({
          onComplete: () => {
            lightBurst.remove();
            resolve();
          }
        });

        // Light burst
        tl.to(lightBurst, {
          opacity: 1,
          duration: 0.3,
          ease: "power2.out"
        });

        tl.to(lightBurst, {
          opacity: 0,
          duration: 0.5,
          ease: "power2.in"
        }, 0.2);

        // Door animation if WebGL
        if (this.mode === 'webgl' && this.doorModel) {
          const leftDoor = this.doorModel.children.find(child => child.userData?.isLeft);
          const rightDoor = this.doorModel.children.find(child => child.userData?.isRight);
          
          if (leftDoor && rightDoor) {
            tl.to(leftDoor.rotation, { 
              y: -Math.PI/4, 
              duration: 1.2, 
              ease: "power2.out" 
            }, 0);
            tl.to(rightDoor.rotation, { 
              y: Math.PI/4, 
              duration: 1.2, 
              ease: "power2.out" 
            }, 0);
          }

          // Camera dolly
          tl.to(this.camera.position, { 
            z: 1, 
            duration: 1.5, 
            ease: "power2.inOut" 
          }, 0.3);
        }

        // Button shake
        if (this.enterButton) {
          tl.to(this.enterButton, {
            x: '+=5',
            duration: 0.1,
            yoyo: true,
            repeat: 3
          }, 0);
        }
      });
    } else {
      // Fallback without GSAP
      return new Promise((resolve) => {
        lightBurst.style.opacity = '1';
        setTimeout(() => {
          lightBurst.style.opacity = '0';
          setTimeout(() => {
            lightBurst.remove();
            resolve();
          }, 500);
        }, 300);
      });
    }
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
      this.instance.play().catch(e => console.warn('[GATE] Video resume failed:', e));
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

    if (this.enterButton) {
      this.enterButton.remove();
    }

    // Clear container
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

// Export to global scope
window.DoorGate = DoorGate;