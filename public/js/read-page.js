/**
 * public/js/read-page.js - Read Page Animation Module
 */

window.BLRead = {
  init(anim) {
    console.log('[BL] read init');
    
    // Load empty state animation
    this.loadEmptyStateAnimation(anim);
    
    // Setup GSAP animations
    anim.tryGSAP(() => {
      this.setupGSAPAnimations();
    });
    
    // Setup book card interactions
    this.setupBookCardInteractions();
  },
  
  loadEmptyStateAnimation(anim) {
    const emptyState = document.querySelector('.empty-state');
    if (!emptyState) return;
    
    // Load magnifier animation
    anim.tryLottie('emptyMagnifier', '/public/animations/magnifier.json', {
      loop: true,
      autoplay: true
    });
    
    // Load books animation
    anim.tryLottie('emptyBooks', '/public/animations/books.json', {
      loop: true,
      autoplay: true
    });
  },
  
  setupGSAPAnimations() {
    if (!window.gsap || !window.ScrollTrigger) return;
    
    // Register ScrollTrigger
    gsap.registerPlugin(ScrollTrigger);
    
    // Spotlight header animation
    gsap.timeline()
      .from('.spotlight-cones', { opacity: 0, scale: 0.8, duration: 1 })
      .from('.search-pill', { opacity: 0, y: 20, duration: 0.8 }, '-=0.5');
    
    // Book cards reveal
    gsap.utils.toArray('.book-card').forEach((card, i) => {
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
    
    // Search pill glow effect
    const searchInput = document.querySelector('.search-pill input');
    if (searchInput) {
      searchInput.addEventListener('focus', () => {
        gsap.to('.search-pill', {
          boxShadow: '0 0 20px rgba(108, 124, 255, 0.5)',
          duration: 0.3
        });
      });
      
      searchInput.addEventListener('blur', () => {
        gsap.to('.search-pill', {
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
          duration: 0.3
        });
      });
    }
  },
  
  setupBookCardInteractions() {
    const bookCards = document.querySelectorAll('.book-card');
    
    bookCards.forEach(card => {
      // 3D tilt effect
      card.addEventListener('mousemove', (e) => {
        if (!BL.anim.wantsMotion()) return;
        
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        const rotateX = (y - centerY) / 10;
        const rotateY = (centerX - x) / 10;
        
        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px)`;
      });
      
      card.addEventListener('mouseleave', () => {
        if (!BL.anim.wantsMotion()) return;
        
        card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)';
      });
      
      // Book flip animation on hover
      const flipBtn = card.querySelector('.book-flip-btn');
      if (flipBtn) {
        flipBtn.addEventListener('mouseenter', () => {
          const flipAnimation = flipBtn.querySelector('.book-flip-animation');
          if (flipAnimation) {
            BL.anim.tryLottie(flipAnimation.id, '/public/animations/page-flip.json', {
              loop: false,
              autoplay: true
            });
          }
        });
      }
    });
  }
};
