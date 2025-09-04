/**
 * Door Gate Scene - 3D Library Door with Light Burst
 * Three.js door group with center medallion button
 */

class DoorGate {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.doorGroup = null;
    this.medallion = null;
    this.lightBurst = null;
    this.animationId = null;
    this.isEntering = false;
  }

  /**
   * Initialize WebGL scene
   */
  async initWebGL() {
    const container = document.getElementById('gate3d');
    if (!container) throw new Error('Gate container not found');

    // Scene setup
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ 
      canvas: container,
      antialias: true,
      alpha: true
    });
    
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0a0a0a, 1);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    this.scene.add(directionalLight);

    // Create door
    this.createDoor();
    
    // Create medallion
    this.createMedallion();
    
    // Create light burst effect
    this.createLightBurst();

    // Position camera
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);

    // Start render loop
    this.animate();

    // Handle resize
    window.addEventListener('resize', this.onResize.bind(this));

    // Handle click
    container.addEventListener('click', this.onClick.bind(this));

    return {
      pause: () => this.pause(),
      resume: () => this.resume(),
      destroy: () => this.destroy()
    };
  }

  /**
   * Create door geometry
   */
  createDoor() {
    this.doorGroup = new THREE.Group();

    // Left door panel
    const leftGeometry = new THREE.BoxGeometry(2, 4, 0.2);
    const leftMaterial = new THREE.MeshLambertMaterial({ 
      color: 0x8B4513,
      transparent: true,
      opacity: 0.9
    });
    const leftDoor = new THREE.Mesh(leftGeometry, leftMaterial);
    leftDoor.position.set(-1, 0, 0);
    this.doorGroup.add(leftDoor);

    // Right door panel
    const rightGeometry = new THREE.BoxGeometry(2, 4, 0.2);
    const rightMaterial = new THREE.MeshLambertMaterial({ 
      color: 0x8B4513,
      transparent: true,
      opacity: 0.9
    });
    const rightDoor = new THREE.Mesh(rightGeometry, rightMaterial);
    rightDoor.position.set(1, 0, 0);
    this.doorGroup.add(rightDoor);

    // Door frame
    const frameGeometry = new THREE.BoxGeometry(4.5, 4.5, 0.3);
    const frameMaterial = new THREE.MeshLambertMaterial({ color: 0x654321 });
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    frame.position.set(0, 0, -0.1);
    this.doorGroup.add(frame);

    this.scene.add(this.doorGroup);
  }

  /**
   * Create center medallion
   */
  createMedallion() {
    const medallionGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16);
    const medallionMaterial = new THREE.MeshLambertMaterial({ 
      color: 0xFFD700,
      emissive: 0x333300
    });
    this.medallion = new THREE.Mesh(medallionGeometry, medallionMaterial);
    this.medallion.position.set(0, 0, 0.2);
    this.doorGroup.add(this.medallion);

    // Add "Enter" text (simplified as geometry)
    const textGeometry = new THREE.RingGeometry(0.25, 0.3, 16);
    const textMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x000000,
      transparent: true,
      opacity: 0.8
    });
    const textRing = new THREE.Mesh(textGeometry, textMaterial);
    textRing.position.set(0, 0, 0.11);
    this.medallion.add(textRing);
  }

  /**
   * Create light burst effect
   */
  createLightBurst() {
    const burstGeometry = new THREE.SphereGeometry(0.1, 16, 16);
    const burstMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffffff,
      transparent: true,
      opacity: 0
    });
    this.lightBurst = new THREE.Mesh(burstGeometry, burstMaterial);
    this.lightBurst.position.set(0, 0, 0.3);
    this.scene.add(this.lightBurst);
  }

  /**
   * Handle click on door
   */
  onClick(event) {
    if (this.isEntering) return;
    
    const rect = event.target.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 2 - 1;
    const y = -(event.clientY - rect.top) / rect.height * 2 + 1;
    
    // Check if click is near medallion
    if (Math.abs(x) < 0.3 && Math.abs(y) < 0.3) {
      this.playEnter();
    }
  }

  /**
   * Play enter animation
   */
  async playEnter() {
    if (this.isEntering) return;
    this.isEntering = true;

    return new Promise((resolve) => {
      // Light burst effect
      const burstTimeline = gsap.timeline();
      burstTimeline
        .to(this.lightBurst.material, { opacity: 1, duration: 0.1 })
        .to(this.lightBurst.scale, { x: 50, y: 50, z: 50, duration: 0.5, ease: "power2.out" })
        .to(this.lightBurst.material, { opacity: 0, duration: 0.3 }, "-=0.2");

      // Camera dolly through door
      const cameraTimeline = gsap.timeline({ delay: 0.3 });
      cameraTimeline
        .to(this.camera.position, { 
          z: -2, 
          duration: 1.5, 
          ease: "power2.inOut",
          onComplete: () => {
            this.isEntering = false;
            resolve();
          }
        });

      // Door opening
      const doorTimeline = gsap.timeline({ delay: 0.5 });
      doorTimeline
        .to(this.doorGroup.children[0].rotation, { y: -Math.PI/3, duration: 1, ease: "power2.out" }, 0)
        .to(this.doorGroup.children[1].rotation, { y: Math.PI/3, duration: 1, ease: "power2.out" }, 0);
    });
  }

  /**
   * Animation loop
   */
  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());
    
    // Subtle medallion glow
    if (this.medallion) {
      this.medallion.rotation.y += 0.01;
      this.medallion.material.emissive.setHex(0x333300 + Math.sin(Date.now() * 0.001) * 0x111100);
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Handle window resize
   */
  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * Pause animation
   */
  pause() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Resume animation
   */
  resume() {
    if (!this.animationId) {
      this.animate();
    }
  }

  /**
   * Destroy scene
   */
  destroy() {
    this.pause();
    window.removeEventListener('resize', this.onResize.bind(this));
    
    if (this.renderer) {
      this.renderer.dispose();
    }
    
    if (this.scene) {
      this.scene.clear();
    }
  }
}

/**
 * Initialize Lottie fallback
 */
async function initLottie() {
  const container = document.getElementById('gate-lottie');
  if (!container || !window.lottie) return null;

  const animation = lottie.loadAnimation({
    container: container,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    path: '/animations/door-gate.json'
  });

  return {
    pause: () => animation.pause(),
    resume: () => animation.play(),
    destroy: () => animation.destroy()
  };
}

/**
 * Initialize SVG fallback
 */
async function initSVG() {
  const container = document.getElementById('gate-fallback');
  if (!container) return null;

  container.hidden = false;
  
  return {
    pause: () => {},
    resume: () => {},
    destroy: () => {}
  };
}

// Export for SceneManager
export { DoorGate, initWebGL, initLottie, initSVG };

// WebGL initialization
async function initWebGL() {
  const doorGate = new DoorGate();
  return await doorGate.initWebGL();
}
