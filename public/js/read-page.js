/**
 * public/js/read-page.js - Read Page Cinematic Effects
 * Spotlight header, glowing search, 3D card hovers
 */

window.BLRead = {
  init(anim) {
    console.log('[BL] read page init');
    
    // Setup spotlight header
    anim.tryGSAP(() => {
      this.setupSpotlightHeader();
    });
    
    // Setup glowing search pill
    this.setupGlowingSearch(anim);
    
    // Setup 3D card hovers
    anim.tryGSAP(() => {
      this.setup3DCardHovers();
    });
    
    // Setup section transitions
    this.setupSectionTransitions(anim);
    
    // Load empty state animations
    this.loadEmptyStateAnimations(anim);
  },
  
  setupSpotlightHeader() {
    if (!window.gsap) return;
    
    // Create reading lamp spotlight cones
    const header = document.querySelector('.read-header');
    if (!header) return;
    
    // Add reading lamp spotlight overlay
    const spotlight = document.createElement('div');
    spotlight.className = 'reading-spotlight';
    spotlight.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: radial-gradient(ellipse at center top, 
        rgba(245, 158, 11, 0.1) 0%, 
        rgba(245, 158, 11, 0.05) 30%, 
        transparent 70%);
      pointer-events: none;
      z-index: 1;
    `;
    header.appendChild(spotlight);
    
    // Create multiple spotlight cones
    this.createSpotlightCones(header);
    
    // Animate spotlight movement
    gsap.to(spotlight, {
      background: 'radial-gradient(ellipse at 20% 30%, transparent 0%, rgba(0, 0, 0, 0.2) 100%)',
      duration: 3,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut"
    });
    
    // Header content reveal
    gsap.fromTo(header.querySelector('.header-content'),
      {
        y: 50,
        opacity: 0
      },
      {
        y: 0,
        opacity: 1,
        duration: 1,
        ease: "power2.out"
      }
    );
  },
  
  createSpotlightCones(container) {
    // Create multiple reading lamp spotlight cones
    for (let i = 0; i < 3; i++) {
      const cone = document.createElement('div');
      cone.className = `spotlight-cone-${i + 1}`;
      cone.style.cssText = `
        position: absolute;
        width: 200px;
        height: 100px;
        background: conic-gradient(from 0deg at center, 
          transparent 0deg, 
          rgba(245, 158, 11, 0.1) 30deg, 
          transparent 60deg);
        border-radius: 50%;
        filter: blur(20px);
        pointer-events: none;
        z-index: 1;
        top: ${20 + i * 30}%;
        left: ${30 + i * 20}%;
        transform: translate(-50%, -50%);
      `;
      container.appendChild(cone);
      
      // Animate cone movement
      gsap.to(cone, {
        x: `random(-100, 100)`,
        y: `random(-50, 50)`,
        rotation: `random(-30, 30)`,
        duration: `random(8, 12)`,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        delay: i * 1
      });
    }
  },
  
  setupGlowingSearch(anim) {
    const searchPill = document.querySelector('.search-pill-glow');
    if (!searchPill) return;
    
    if (!anim.wantsMotion()) {
      searchPill.style.boxShadow = '0 0 20px rgba(108, 124, 255, 0.5)';
      return;
    }
    
    anim.tryGSAP(() => {
      // Idle glow animation
      gsap.to(searchPill, {
        boxShadow: '0 0 15px var(--primary), 0 0 30px var(--primary)',
        repeat: -1,
        yoyo: true,
        duration: 2,
        ease: "power1.inOut"
      });
      
      // Focus glow
      searchPill.addEventListener('focusin', () => {
        gsap.to(searchPill, {
          boxShadow: '0 0 25px var(--primary), 0 0 50px var(--primary)',
          duration: 0.3,
          overwrite: true
        });
      });
      
      searchPill.addEventListener('focusout', () => {
        gsap.to(searchPill, {
          boxShadow: '0 0 15px var(--primary), 0 0 30px var(--primary)',
          duration: 0.3,
          overwrite: true
        });
      });
    });
  },
  
  setup3DCardHovers() {
    if (!window.gsap) return;
    
    const bookCards = document.querySelectorAll('.book-card');
    
    bookCards.forEach(card => {
      const cardContent = card.querySelector('.book-content') || card;
      
      // Set up 3D perspective
      card.style.perspective = '1000px';
      card.style.transformStyle = 'preserve-3d';
      
      // Add book spine effect
      const spine = document.createElement('div');
      spine.className = 'book-spine';
      spine.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 4px;
        background: var(--gradient-primary);
        border-radius: 2px 0 0 2px;
        z-index: 1;
      `;
      card.appendChild(spine);
      
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        const rotateX = ((y - centerY) / centerY) * 8;
        const rotateY = -((x - centerX) / centerX) * 8;
        
        gsap.to(cardContent, {
          rotationX: rotateX,
          rotationY: rotateY,
          scale: 1.03,
          z: 15,
          boxShadow: "0 0 30px rgba(99, 102, 241, 0.3)",
          duration: 0.3,
          ease: "power1.out",
          overwrite: true
        });
        
        // Animate spine
        gsap.to(spine, {
          scaleY: 1.05,
          boxShadow: "0 0 15px rgba(99, 102, 241, 0.4)",
          duration: 0.3,
          ease: "power1.out"
        });
      });
      
      card.addEventListener('mouseleave', () => {
        gsap.to(cardContent, {
          rotationX: 0,
          rotationY: 0,
          scale: 1,
          z: 0,
          boxShadow: "0 0 20px rgba(99, 102, 241, 0.1)",
          duration: 0.5,
          ease: "power1.out",
          overwrite: true
        });
        
        gsap.to(spine, {
          scaleY: 1,
          boxShadow: "0 0 10px rgba(99, 102, 241, 0.2)",
          duration: 0.5,
          ease: "power1.out"
        });
      });
    });
  },
  
  setupSectionTransitions(anim) {
    if (!anim.wantsMotion()) return;
    
    // Filter change transitions
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        anim.tryGSAP(() => {
          // Fade out current results
          gsap.to('.book-grid', {
            opacity: 0,
            y: 20,
            duration: 0.3,
            onComplete: () => {
              // Fade in new results
              gsap.fromTo('.book-grid', 
                { opacity: 0, y: -20 },
                { opacity: 1, y: 0, duration: 0.3 }
              );
            }
          });
        });
      });
    });
  },
  
  loadEmptyStateAnimations(anim) {
    // Magnifier animation for empty state
    anim.tryLottie('magnifier-animation', '/public/animations/magnifier.json', {
      loop: true,
      autoplay: true
    });
    
    // Books animation for empty state
    anim.tryLottie('books-animation', '/public/animations/books.json', {
      loop: true,
      autoplay: true
    });
    
    // Book flip animations for read buttons
    const bookFlipElements = document.querySelectorAll('.book-flip-animation');
    bookFlipElements.forEach(element => {
      const lottieInstance = anim.tryLottie(element.id, '/public/animations/page-flip.json', {
        loop: false,
        autoplay: false
      });
      
      if (lottieInstance) {
        const flipBtn = element.closest('.book-flip-btn');
        if (flipBtn) {
          flipBtn.addEventListener('mouseenter', () => {
            lottieInstance.play();
          });
          flipBtn.addEventListener('mouseleave', () => {
            lottieInstance.stop();
          });
        }
      }
    });
  }
};