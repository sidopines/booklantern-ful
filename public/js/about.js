/**
 * public/js/about.js - About Page Animation Module
 */

window.BLAbout = {
  init(anim) {
    console.log('[BL] about init');
    
    // Load candle animations
    this.loadCandleAnimations(anim);
    
    // Setup GSAP animations
    anim.tryGSAP(() => {
      this.setupGSAPAnimations();
    });
  },
  
  loadCandleAnimations(anim) {
    const candles = document.querySelectorAll('.timeline-candle');
    
    candles.forEach((candle, i) => {
      const candleId = `candle-${i}`;
      candle.id = candleId;
      
      anim.tryLottie(candleId, '/public/animations/candle.json', {
        loop: true,
        autoplay: true
      });
    });
  },
  
  setupGSAPAnimations() {
    if (!window.gsap || !window.ScrollTrigger) return;
    
    // Register ScrollTrigger
    gsap.registerPlugin(ScrollTrigger);
    
    // Timeline candles reveal
    gsap.utils.toArray('.timeline-candle').forEach((candle, i) => {
      gsap.from(candle, {
        opacity: 0,
        scale: 0.5,
        duration: 0.8,
        delay: i * 0.2,
        scrollTrigger: {
          trigger: candle,
          start: 'top 80%',
          toggleActions: 'play none none reverse'
        }
      });
    });
    
    // Team cards with library-themed hover
    gsap.utils.toArray('.team-card').forEach(card => {
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
      
      card.addEventListener('mouseenter', () => {
        gsap.to(card, {
          scale: 1.05,
          y: -10,
          rotationY: 5,
          boxShadow: "0 20px 40px rgba(99, 102, 241, 0.3)",
          duration: 0.3,
          ease: 'power2.out'
        });
        
        gsap.to(spine, {
          scaleY: 1.1,
          boxShadow: "0 0 15px rgba(99, 102, 241, 0.4)",
          duration: 0.3,
          ease: 'power2.out'
        });
      });
      
      card.addEventListener('mouseleave', () => {
        gsap.to(card, {
          scale: 1,
          y: 0,
          rotationY: 0,
          boxShadow: "0 10px 20px rgba(0, 0, 0, 0.1)",
          duration: 0.3,
          ease: 'power2.out'
        });
        
        gsap.to(spine, {
          scaleY: 1,
          boxShadow: "0 0 10px rgba(99, 102, 241, 0.2)",
          duration: 0.3,
          ease: 'power2.out'
        });
      });
    });
    
    // Create floating dust particles
    this.createAboutDustParticles();
  },
  
  createAboutDustParticles() {
    const aboutContainer = document.querySelector('.about-container') || document.body;
    
    for (let i = 0; i < 10; i++) {
      const particle = document.createElement('div');
      particle.className = 'dust-particle';
      particle.style.cssText = `
        position: absolute;
        width: 2px;
        height: 2px;
        background: rgba(255, 255, 255, 0.3);
        border-radius: 50%;
        pointer-events: none;
        left: ${Math.random() * 100}%;
        top: ${Math.random() * 100}%;
        animation: dust-drift 25s infinite linear;
        animation-delay: ${Math.random() * 5}s;
      `;
      aboutContainer.appendChild(particle);
    }
  }
};
