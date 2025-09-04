/**
 * public/js/home.js - Homepage Animation Module
 */

window.BLHome = {
  init(anim) {
    console.log('[BL] home init');
    
    // Load Lottie animations
    this.loadDoorsAnimation(anim);
    this.loadCharacterAnimations(anim);
    this.loadBookFlipAnimation(anim);
    
    // Setup GSAP animations
    anim.tryGSAP(() => {
      this.setupGSAPAnimations();
    });
    
    // Setup Three.js scene
    anim.tryThreeJS(() => {
      this.setupThreeScene();
    });
  },
  
  loadDoorsAnimation(anim) {
    const doorsContainer = document.getElementById('doorsLottie');
    if (!doorsContainer) return;
    
    const animation = anim.tryLottie('doorsLottie', '/public/animations/library-doors.json', {
      loop: false,
      autoplay: true
    });
    
    if (animation && animation.addEventListener) {
      animation.addEventListener('complete', () => {
        // Fade out doors overlay
        doorsContainer.style.transition = 'opacity 1s ease';
        doorsContainer.style.opacity = '0';
        setTimeout(() => {
          doorsContainer.style.display = 'none';
        }, 1000);
      });
    }
  },
  
  loadCharacterAnimations(anim) {
    // Reading hero character
    anim.tryLottie('heroCharacter', '/public/animations/reading-hero.json', {
      loop: true,
      autoplay: true
    });
    
    // Side cat
    anim.tryLottie('sideCat', '/public/animations/side-cat.json', {
      loop: true,
      autoplay: true
    });
  },
  
  loadBookFlipAnimation(anim) {
    anim.tryLottie('bookFlip', '/public/animations/page-flip.json', {
      loop: true,
      autoplay: true
    });
  },
  
  setupGSAPAnimations() {
    if (!window.gsap || !window.ScrollTrigger) return;
    
    // Register ScrollTrigger
    gsap.registerPlugin(ScrollTrigger);
    
    // Hero section animations
    gsap.timeline()
      .from('.hero-act-1', { opacity: 0, y: 50, duration: 1 })
      .from('.hero-act-2', { opacity: 0, y: 50, duration: 1 }, '-=0.5')
      .from('.hero-act-3', { opacity: 0, y: 50, duration: 1 }, '-=0.5');
    
    // Scroll-triggered reveals
    gsap.utils.toArray('.reveal-card').forEach((card, i) => {
      gsap.from(card, {
        opacity: 0,
        y: 50,
        duration: 0.8,
        scrollTrigger: {
          trigger: card,
          start: 'top 80%',
          end: 'bottom 20%',
          toggleActions: 'play none none reverse'
        }
      });
    });
    
    // Search CTA pulse
    gsap.to('.search-cta', {
      scale: 1.05,
      duration: 2,
      repeat: -1,
      yoyo: true,
      ease: 'power2.inOut'
    });
  },
  
  setupThreeScene() {
    const container = document.getElementById('starfield');
    if (!container) return;
    
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, container.offsetWidth / container.offsetHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    
    renderer.setSize(container.offsetWidth, container.offsetHeight);
    container.appendChild(renderer.domElement);
    
    // Create starfield
    const starsGeometry = new THREE.BufferGeometry();
    const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 });
    
    const starsVertices = [];
    for (let i = 0; i < 1000; i++) {
      starsVertices.push(
        (Math.random() - 0.5) * 2000,
        (Math.random() - 0.5) * 2000,
        (Math.random() - 0.5) * 2000
      );
    }
    
    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starsVertices, 3));
    const stars = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(stars);
    
    camera.position.z = 5;
    
    // Animation loop
    function animate() {
      requestAnimationFrame(animate);
      stars.rotation.x += 0.0005;
      stars.rotation.y += 0.001;
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
