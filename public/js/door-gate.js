/**
 * Real 3D Door Gate with Three.js
 * PBR-ready door model with post-processing effects
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PMREMGenerator } from 'three/examples/jsm/utils/PMREMGenerator.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

class DoorGate {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.composer = null;
    this.doorModel = null;
    this.medallion = null;
    this.animationId = null;
    this.isEntering = false;
  }

  /**
   * Mount the 3D door gate
   */
  async mount(container) {
    if (!container) throw new Error('Container not found');

    // Scene setup
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ 
      canvas: container.querySelector('#gate3d'),
      antialias: true,
      alpha: true
    });
    
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0a0a0a, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // PMREM for environment lighting
    const pmremGenerator = new PMREMGenerator(this.renderer);
    
    // Lighting setup
    const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    this.scene.add(directionalLight);

    // Load door model
    await this.loadDoorModel();

    // Create medallion
    this.createMedallion();

    // Setup post-processing
    this.setupPostProcessing();

    // Position camera
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);

    // Start render loop
    this.animate();

    // Handle interactions
    this.setupInteractions(container);

    // Handle resize
    window.addEventListener('resize', this.onResize.bind(this));

    return {
      dispose: () => this.dispose(),
      playEnter: () => this.playEnter()
    };
  }

  /**
   * Load door GLB model
   */
  async loadDoorModel() {
    try {
      const loader = new GLTFLoader();
      // TODO: Replace with real door.glb model
      const gltf = await loader.loadAsync('/assets/3d/door.glb');
      
      this.doorModel = gltf.scene;
      this.doorModel.position.set(0, 0, 0);
      this.scene.add(this.doorModel);
    } catch (error) {
      console.warn('Failed to load door model, using fallback:', error);
      this.createFallbackDoor();
    }
  }

  /**
   * Create fallback door geometry
   */
  createFallbackDoor() {
    const doorGroup = new THREE.Group();

    // Left door panel
    const leftGeometry = new THREE.BoxGeometry(2, 4, 0.2);
    const leftMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x8B4513,
      metalness: 0.1,
      roughness: 0.8
    });
    const leftDoor = new THREE.Mesh(leftGeometry, leftMaterial);
    leftDoor.position.set(-1, 0, 0);
    leftDoor.userData = { isLeft: true };
    doorGroup.add(leftDoor);

    // Right door panel
    const rightGeometry = new THREE.BoxGeometry(2, 4, 0.2);
    const rightMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x8B4513,
      metalness: 0.1,
      roughness: 0.8
    });
    const rightDoor = new THREE.Mesh(rightGeometry, rightMaterial);
    rightDoor.position.set(1, 0, 0);
    rightDoor.userData = { isRight: true };
    doorGroup.add(rightDoor);

    // Door frame
    const frameGeometry = new THREE.BoxGeometry(4.5, 4.5, 0.3);
    const frameMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x654321,
      metalness: 0.2,
      roughness: 0.7
    });
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    frame.position.set(0, 0, -0.1);
    doorGroup.add(frame);

    this.doorModel = doorGroup;
    this.scene.add(this.doorModel);
  }

  /**
   * Create center medallion
   */
  createMedallion() {
    const medallionGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16);
    const medallionMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xFFD700,
      metalness: 0.8,
      roughness: 0.2,
      emissive: 0x333300
    });
    this.medallion = new THREE.Mesh(medallionGeometry, medallionMaterial);
    this.medallion.position.set(0, 0, 0.2);
    this.scene.add(this.medallion);
  }

  /**
   * Setup post-processing effects
   */
  setupPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    
    // Render pass
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Bloom pass
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.5, // strength
      0.4, // radius
      0.85 // threshold
    );
    this.composer.addPass(bloomPass);

    // God rays shader (simplified)
    const godRaysShader = {
      uniforms: {
        tDiffuse: { value: null },
        lightPosition: { value: new THREE.Vector2(0.5, 0.5) },
        exposure: { value: 0.18 },
        decay: { value: 0.95 },
        density: { value: 0.96 },
        weight: { value: 0.4 },
        samples: { value: 50 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 lightPosition;
        uniform float exposure;
        uniform float decay;
        uniform float density;
        uniform float weight;
        uniform int samples;
        varying vec2 vUv;
        
        void main() {
          vec2 texCoord = vUv;
          vec2 deltaTextCoord = texCoord - lightPosition;
          deltaTextCoord *= 1.0 / float(samples) * density;
          float illuminationDecay = 1.0;
          vec4 color = texture2D(tDiffuse, texCoord);
          
          for(int i = 0; i < 50; i++) {
            if(i >= samples) break;
            texCoord -= deltaTextCoord;
            vec4 sample = texture2D(tDiffuse, texCoord);
            sample *= illuminationDecay * weight;
            color += sample;
            illuminationDecay *= decay;
          }
          
          gl_FragColor = color * exposure;
        }
      `
    };

    const godRaysPass = new ShaderPass(godRaysShader);
    this.composer.addPass(godRaysPass);
  }

  /**
   * Setup interactions
   */
  setupInteractions(container) {
    container.addEventListener('click', (event) => {
      if (this.isEntering) return;
      
      const rect = container.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width * 2 - 1;
      const y = -(event.clientY - rect.top) / rect.height * 2 + 1;
      
      // Check if click is near medallion
      if (Math.abs(x) < 0.3 && Math.abs(y) < 0.3) {
        this.playEnter();
      }
    });
  }

  /**
   * Play enter animation
   */
  async playEnter() {
    if (this.isEntering) return;
    this.isEntering = true;

    return new Promise((resolve) => {
      // Import GSAP dynamically
      import('gsap').then(({ gsap }) => {
        // Door opening animation
        const leftDoor = this.doorModel?.children.find(child => child.userData?.isLeft);
        const rightDoor = this.doorModel?.children.find(child => child.userData?.isRight);
        
        if (leftDoor && rightDoor) {
          gsap.to(leftDoor.rotation, { 
            y: -Math.PI/3, 
            duration: 1.5, 
            ease: "power2.out" 
          });
          gsap.to(rightDoor.rotation, { 
            y: Math.PI/3, 
            duration: 1.5, 
            ease: "power2.out" 
          });
        }

        // Camera dolly through doorway
        gsap.to(this.camera.position, { 
          z: -2, 
          duration: 2, 
          ease: "power2.inOut",
          onComplete: () => {
            this.isEntering = false;
            // Dispatch enter event
            const event = new CustomEvent('Gate:enter');
            document.getElementById('gate').dispatchEvent(event);
            resolve();
          }
        });

        // Medallion glow effect
        if (this.medallion) {
          gsap.to(this.medallion.material, {
            emissiveIntensity: 2,
            duration: 0.5,
            yoyo: true,
            repeat: 1
          });
        }
      }).catch(() => {
        // Fallback without GSAP
        this.isEntering = false;
        const event = new CustomEvent('Gate:enter');
        document.getElementById('gate').dispatchEvent(event);
        resolve();
      });
    });
  }

  /**
   * Animation loop
   */
  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());
    
    // Subtle medallion rotation
    if (this.medallion) {
      this.medallion.rotation.y += 0.01;
      this.medallion.material.emissive.setHex(0x333300 + Math.sin(Date.now() * 0.001) * 0x111100);
    }

    // Render with post-processing
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Handle window resize
   */
  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    
    if (this.composer) {
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  /**
   * Dispose of resources
   */
  dispose() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    window.removeEventListener('resize', this.onResize.bind(this));
    
    if (this.renderer) {
      this.renderer.dispose();
    }
    
    if (this.composer) {
      this.composer.dispose();
    }
    
    if (this.scene) {
      this.scene.clear();
    }
  }
}

/**
 * Mount function for SceneManager
 */
export async function mount(container) {
  const doorGate = new DoorGate();
  return await doorGate.mount(container);
}

/**
 * Fallback for reduced motion
 */
export async function mountVideoFallback(container) {
  const video = document.createElement('video');
  video.src = '/assets/video/door-loop.webm';
  video.loop = true;
  video.autoplay = true;
  video.muted = true;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'cover';
  
  container.appendChild(video);
  
  // Add click handler
  container.addEventListener('click', () => {
    const event = new CustomEvent('Gate:enter');
    container.dispatchEvent(event);
  });
  
  return {
    dispose: () => {
      video.remove();
    },
    playEnter: () => {
      const event = new CustomEvent('Gate:enter');
      container.dispatchEvent(event);
    }
  };
}

/**
 * Lottie fallback
 */
export async function mountLottieFallback(container) {
  if (!window.lottie) {
    throw new Error('Lottie not available');
  }
  
  const lottieContainer = container.querySelector('#gate-lottie');
  if (!lottieContainer) return null;
  
  const animation = lottie.loadAnimation({
    container: lottieContainer,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    path: '/assets/lottie/door.json'
  });
  
  // Add click handler
  container.addEventListener('click', () => {
    const event = new CustomEvent('Gate:enter');
    container.dispatchEvent(event);
  });
  
  return {
    dispose: () => animation.destroy(),
    playEnter: () => {
      const event = new CustomEvent('Gate:enter');
      container.dispatchEvent(event);
    }
  };
}

/**
 * SVG fallback
 */
export async function mountSVGFallback(container) {
  const fallbackImg = container.querySelector('#gate-fallback');
  if (!fallbackImg) return null;
  
  fallbackImg.hidden = false;
  
  // Add click handler
  container.addEventListener('click', () => {
    const event = new CustomEvent('Gate:enter');
    container.dispatchEvent(event);
  });
  
  return {
    dispose: () => {},
    playEnter: () => {
      const event = new CustomEvent('Gate:enter');
      container.dispatchEvent(event);
    }
  };
}