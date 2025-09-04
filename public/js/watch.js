/**
 * public/js/watch.js - Watch Page Animation Module
 */

window.BLWatch = {
  init(anim) {
    console.log('[BL] watch init');
    
    // Load theater curtain animation
    this.loadCurtainAnimation(anim);
    
    // Setup GSAP animations
    anim.tryGSAP(() => {
      this.setupGSAPAnimations();
    });
    
    // Setup Three.js light plane
    anim.tryThreeJS(() => {
      this.setupThreeScene();
    });
  },
  
  loadCurtainAnimation(anim) {
    anim.tryLottie('theaterCurtain', '/public/animations/curtain.json', {
      loop: true,
      autoplay: true
    });
  },
  
  setupGSAPAnimations() {
    if (!window.gsap || !window.ScrollTrigger) return;
    
    // Register ScrollTrigger
    gsap.registerPlugin(ScrollTrigger);
    
    // Video cards reveal
    gsap.utils.toArray('.video-card').forEach((card, i) => {
      gsap.from(card, {
        opacity: 0,
        y: 50,
        duration: 0.6,
        delay: i * 0.1,
        scrollTrigger: {
          trigger: card,
          start: 'top 85%',
          toggleActions: 'play none none reverse'
        }
      });
    });
    
    // Light sweep effect
    gsap.to('.light-sweep', {
      x: '100%',
      duration: 3,
      repeat: -1,
      ease: 'power2.inOut'
    });
  },
  
  setupThreeScene() {
    const container = document.getElementById('light-plane');
    if (!container) return;
    
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, container.offsetWidth / container.offsetHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    
    renderer.setSize(container.offsetWidth, container.offsetHeight);
    container.appendChild(renderer.domElement);
    
    // Create light plane
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.MeshBasicMaterial({ 
      color: 0x6c7cff, 
      transparent: true, 
      opacity: 0.1 
    });
    const plane = new THREE.Mesh(geometry, material);
    scene.add(plane);
    
    camera.position.z = 5;
    
    // Animation loop
    function animate() {
      requestAnimationFrame(animate);
      plane.rotation.z += 0.01;
      renderer.render(scene, camera);
    }
    animate();
    
    // Handle resize
    window.addEventListener('resize', () => {
      camera.aspect = container.offsetWidth / container.offsetHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.offsetWidth, container.offsetHeight);
    });
  }
};
