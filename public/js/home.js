/**
 * public/js/home.js - Homepage Animation Module
 * Integrates WebGL hero scene with scroll chapters
 */

window.BLHome = {
  init(anim) {
    console.log('[BL] home init');
    
    // Initialize WebGL hero scene
    if (window.BLHomeHero) {
      BLHomeHero.init(anim);
    }
    
    // Initialize scroll chapters
    if (window.BLHomeChapters) {
      BLHomeChapters.init(anim);
    }
    
    // Load Lottie animations as fallbacks
    this.loadLottieAnimations(anim);
    
    // Setup entrance timeline
    anim.tryGSAP(() => {
      this.setupEntranceTimeline();
    });
    
    // Setup fluid cursor
    this.setupFluidCursor(anim);
  },
  
  loadLottieAnimations(anim) {
    // Load fallback animations
    anim.tryLottie('hero-fallback', '/public/animations/hero-fallback.json', {
      loop: true,
      autoplay: true,
      allowReducedMotion: true
    });
    
    // Load character animations
    anim.tryLottie('heroCharacter', '/public/animations/reading-hero.json', {
      loop: true,
      autoplay: true
    });
    
    // Load side cat
    anim.tryLottie('sideCat', '/public/animations/side-cat.json', {
      loop: true,
      autoplay: true
    });
  },
  
  setupEntranceTimeline() {
    if (!window.gsap) return;
    
    // Create entrance timeline
    const tl = gsap.timeline();
    
    // Ambient fade-in
    tl.from('.hero-overlay', {
      opacity: 0,
      duration: 1,
      ease: "power2.out"
    });
    
    // Camera dolly effect (simulated with transform)
    tl.from('.hero-content', {
      scale: 0.8,
      y: 50,
      opacity: 0,
      duration: 1.5,
      ease: "power2.out"
    }, "-=0.5");
    
    // Title reveal
    tl.from('.hero-title', {
      y: 30,
      opacity: 0,
      duration: 1,
      ease: "back.out(1.7)"
    }, "-=1");
    
    // Subtitle reveal
    tl.from('.hero-subtitle', {
      y: 20,
      opacity: 0,
      duration: 0.8,
      ease: "power2.out"
    }, "-=0.5");
    
    // CTA reveal
    tl.from('.hero-cta', {
      y: 20,
      opacity: 0,
      duration: 0.8,
      ease: "power2.out"
    }, "-=0.3");
    
    // Search pill reveal
    tl.from('.search-pill-large', {
      scale: 0.9,
      opacity: 0,
      duration: 0.8,
      ease: "back.out(1.7)"
    }, "-=0.5");
  },
  
  setupFluidCursor(anim) {
    if (!anim.wantsMotion()) return;
    
    // Create fluid cursor
    const cursor = document.createElement('div');
    cursor.className = 'fluid-cursor';
    cursor.style.cssText = `
      position: fixed;
      width: 20px;
      height: 20px;
      background: radial-gradient(circle, rgba(108, 124, 255, 0.8) 0%, transparent 70%);
      border-radius: 50%;
      pointer-events: none;
      z-index: 9999;
      mix-blend-mode: difference;
      transition: transform 0.1s ease;
    `;
    document.body.appendChild(cursor);
    
    // Track mouse movement
    let mouseX = 0, mouseY = 0;
    let cursorX = 0, cursorY = 0;
    
    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });
    
    // Smooth cursor follow
    function animateCursor() {
      cursorX += (mouseX - cursorX) * 0.1;
      cursorY += (mouseY - cursorY) * 0.1;
      
      cursor.style.left = cursorX - 10 + 'px';
      cursor.style.top = cursorY - 10 + 'px';
      
      requestAnimationFrame(animateCursor);
    }
    animateCursor();
    
    // Cursor interactions
    const interactiveElements = document.querySelectorAll('a, button, .hover-lift');
    
    interactiveElements.forEach(el => {
      el.addEventListener('mouseenter', () => {
        cursor.style.transform = 'scale(2)';
        cursor.style.background = 'radial-gradient(circle, rgba(255, 110, 168, 0.8) 0%, transparent 70%)';
      });
      
      el.addEventListener('mouseleave', () => {
        cursor.style.transform = 'scale(1)';
        cursor.style.background = 'radial-gradient(circle, rgba(108, 124, 255, 0.8) 0%, transparent 70%)';
      });
    });
  }
};